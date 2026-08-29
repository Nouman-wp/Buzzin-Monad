import { gameRules, serverConfig } from '@/lib/config';
import type {
  AiProvider,
  ChooseNextRoundRequest,
  ChooseNextRoundResult,
  GenerateQuestionSetRequest,
  GenerateQuestionSetResult,
} from '@/lib/ai/types';
import { aiDecisionSchema, aiQuestionSetSchema } from '@/lib/validation';
import { LocalAiProvider } from '@/lib/ai/fallback';
import { newId } from '@/lib/util/ids';
import type { Challenge } from '@/lib/types';

/**
 * Gemini adapter over the Google AI Studio REST API (free developer tier).
 *
 * Called through plain `fetch`, so there is no SDK version to drift, and every
 * call is wrapped in a timeout + bounded retry. Any failure — network, quota,
 * malformed JSON, schema mismatch — falls through to the deterministic local
 * Game Master rather than surfacing an error into gameplay.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiCallOptions {
  prompt: string;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
  maxOutputTokens: number;
  /** Ceiling for a single attempt. */
  timeoutMs: number;
  /**
   * Wall-clock ceiling across every attempt, including backoff. This is the
   * number that matters: it is what bounds the caller's own latency budget.
   */
  totalBudgetMs: number;
  /**
   * How many times to try before giving up. The free tier returns 503
   * "high demand" often enough that a single attempt frequently fails, so a
   * host-initiated generation is worth several tries — while a mid-game
   * decision must give up fast and let the deterministic Game Master run.
   */
  maxAttempts: number;
}

class RetryableError extends Error {}

async function callGemini(
  apiKey: string,
  model: string,
  options: GeminiCallOptions,
): Promise<unknown> {
  let lastError: unknown = null;
  const deadline = Date.now() + options.totalBudgetMs;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(options.timeoutMs, remaining));
    try {
      const response = await fetch(
        `${API_BASE}/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: options.systemInstruction }] },
            contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
            generationConfig: {
              temperature: 0.85,
              maxOutputTokens: options.maxOutputTokens,
              responseMimeType: 'application/json',
              responseSchema: options.responseSchema,
            },
          }),
        },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        // 429/5xx are worth one retry; 4xx config errors are not.
        if (response.status === 429 || response.status >= 500) {
          throw new RetryableError(`Gemini ${response.status}: ${body.slice(0, 200)}`);
        }
        throw new Error(`Gemini ${response.status}: ${body.slice(0, 200)}`);
      }

      const payload = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
      if (!text.trim()) throw new RetryableError('Gemini returned an empty response');
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof RetryableError ||
        (error instanceof Error && error.name === 'AbortError');
      if (!retryable || attempt === options.maxAttempts) break;
      // Exponential backoff, clipped so we never sleep past the budget.
      const backoff = Math.min(2000, 400 * 2 ** (attempt - 1));
      if (Date.now() + backoff >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Gemini request failed');
}

const QUESTION_SET_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correctAnswerIndex: { type: 'integer' },
          difficulty: { type: 'integer' },
          topic: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: ['question', 'options', 'correctAnswerIndex', 'difficulty', 'topic', 'explanation'],
      },
    },
  },
  required: ['questions'],
} as const;

const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    nextDifficulty: { type: 'integer' },
    nextTopic: { type: 'string' },
    reason: { type: 'string' },
    questionSelectionStrategy: { type: 'string', enum: ['easier', 'same', 'harder'] },
    decisionConfidence: { type: 'number' },
  },
  required: ['nextDifficulty', 'nextTopic', 'reason', 'questionSelectionStrategy', 'decisionConfidence'],
} as const;

export class GeminiAiProvider implements AiProvider {
  readonly name = 'gemini';
  readonly model: string;
  readonly available: boolean;
  private readonly apiKey: string;
  private readonly fallback = new LocalAiProvider();

  constructor(apiKey = serverConfig.aiApiKey, model = serverConfig.aiModel) {
    this.apiKey = apiKey;
    this.model = model;
    this.available = Boolean(apiKey);
  }

  async generateQuestionSet(
    request: GenerateQuestionSetRequest,
  ): Promise<GenerateQuestionSetResult> {
    if (!this.available) {
      const result = await this.fallback.generateQuestionSet(request);
      return { ...result, warning: 'No AI key configured — using the approved local pool.' };
    }

    try {
      const raw = await callGemini(this.apiKey, this.model, {
        systemInstruction:
          'You write multiple-choice questions for a fast-paced live trivia game. ' +
          'Players have ten seconds per question on a phone, so keep questions under 140 characters ' +
          'and every option under 60 characters. Exactly four options, exactly one correct. ' +
          'Options must be clearly distinct and none may restate another. ' +
          'The explanation is one sentence and must never appear inside an option. ' +
          'Return JSON only.',
        prompt: buildQuestionPrompt(request),
        responseSchema: QUESTION_SET_SCHEMA,
        maxOutputTokens: 4096,
        timeoutMs: 15_000,
        totalBudgetMs: gameRules.aiGenerationTimeoutMs,
        maxAttempts: 4,
      });

      const parsed = aiQuestionSetSchema.safeParse(raw);
      if (!parsed.success) throw new Error('AI response failed schema validation');

      const questions: Challenge[] = parsed.data.questions
        .slice(0, request.count)
        .map((item) => ({
          id: newId('q'),
          gameType: request.mode,
          question: item.question,
          options: item.options,
          correctAnswerIndex: item.correctAnswerIndex,
          difficulty: item.difficulty,
          topic: item.topic,
          explanation: item.explanation,
          source: 'ai' as const,
          // AI content is never playable until the host approves it.
          status: 'PENDING_APPROVAL' as const,
        }));

      if (questions.length === 0) throw new Error('AI returned no usable questions');

      return {
        questions,
        provider: this.name,
        model: this.model,
        fallbackUsed: false,
        warning: null,
      };
    } catch (error) {
      const result = await this.fallback.generateQuestionSet(request);
      return {
        ...result,
        warning: `AI generation unavailable (${describe(error)}) — using the approved local pool.`,
      };
    }
  }

  async chooseNextRound(request: ChooseNextRoundRequest): Promise<ChooseNextRoundResult> {
    if (!this.available) return this.fallback.chooseNextRound(request);

    try {
      const raw = await callGemini(this.apiKey, this.model, {
        systemInstruction:
          'You are the Game Master of a live multiplayer trivia room. ' +
          'Given the metrics of the round that just finished, choose the difficulty and topic ' +
          'for the next round so the game stays competitive: not so easy that everyone survives ' +
          'trivially, not so hard that players are eliminated en masse. ' +
          'Move difficulty by at most one level per round. Stay within the host-approved topic. ' +
          'The reason is one or two plain sentences describing the signals and the action — ' +
          'never internal reasoning steps. Return JSON only.',
        prompt: buildDecisionPrompt(request),
        responseSchema: DECISION_SCHEMA,
        maxOutputTokens: 512,
        timeoutMs: 2_500,
        totalBudgetMs: gameRules.aiDecisionTimeoutMs,
        // The decision runs after the round has already advanced, so a couple
        // of quick tries is right: useful if it lands, harmless if it does not.
        maxAttempts: 2,
      });

      const parsed = aiDecisionSchema.safeParse(raw);
      if (!parsed.success) throw new Error('AI decision failed schema validation');

      return {
        ...parsed.data,
        provider: this.name,
        model: this.model,
        fallbackUsed: false,
      };
    } catch {
      return this.fallback.chooseNextRound(request);
    }
  }
}

function buildQuestionPrompt(request: GenerateQuestionSetRequest): string {
  const modeHint =
    request.mode === 'WORDLESS'
      ? 'Each question is a short clue and the four options are candidate words.'
      : 'Each question is a standard multiple-choice trivia question.';
  const avoid =
    request.existing.length > 0
      ? `\nDo not repeat or paraphrase any of these existing questions:\n${request.existing
          .slice(0, 30)
          .map((text) => `- ${text}`)
          .join('\n')}`
      : '';
  return [
    `Topic: ${request.topic}`,
    `Difficulty: ${request.difficulty} on a 1-5 scale (1 = anyone could answer, 5 = expert)`,
    `Write ${request.count} questions.`,
    modeHint,
    'Vary the subareas within the topic so no two questions test the same fact.',
    avoid,
  ].join('\n');
}

function buildDecisionPrompt(request: ChooseNextRoundRequest): string {
  const { metrics } = request;
  return [
    `Host-approved topic: ${request.topic}`,
    `Game mode: ${request.mode}`,
    `Round ${request.roundNumber} of ${request.totalRounds} just finished.`,
    `Current difficulty: ${request.currentDifficulty}`,
    `Subareas already used: ${request.usedTopics.join(', ') || 'none'}`,
    '',
    'Metrics from the round that just finished:',
    JSON.stringify(
      {
        activePlayers: metrics.activePlayers,
        answers: metrics.answers,
        correct: metrics.correct,
        wrong: metrics.wrong,
        timeouts: metrics.timeouts,
        accuracy: metrics.accuracy,
        averageResponseTimeMs: metrics.averageResponseTimeMs,
        medianResponseTimeMs: metrics.medianResponseTimeMs,
        difficulty: metrics.difficulty,
        eliminatedPlayers: metrics.eliminatedPlayers,
        scoreSpread: metrics.scoreSpread,
      },
      null,
      2,
    ),
  ].join('\n');
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'timeout';
    return error.message.slice(0, 120);
  }
  return 'unknown error';
}
