import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalAiProvider, decideNextRoundLocally } from '@/lib/ai/fallback';
import { GeminiAiProvider } from '@/lib/ai/gemini';
import { aiDecisionSchema, aiQuestionSchema } from '@/lib/validation';
import type { ChooseNextRoundRequest } from '@/lib/ai/types';
import type { GameMetrics } from '@/lib/types';

function metrics(overrides: Partial<GameMetrics> = {}): GameMetrics {
  return {
    roundNumber: 1,
    activePlayers: 18,
    answers: 17,
    correct: 15,
    wrong: 2,
    timeouts: 0,
    accuracy: 0.882,
    averageResponseTimeMs: 3210,
    medianResponseTimeMs: 3100,
    difficulty: 2,
    eliminatedPlayers: 2,
    prizePoolWei: '2100000000000000000',
    scoreSpread: 300,
    ...overrides,
  };
}

function request(overrides: Partial<ChooseNextRoundRequest> = {}): ChooseNextRoundRequest {
  return {
    mode: 'QUIZ',
    topic: 'Web3',
    currentDifficulty: 2,
    roundNumber: 1,
    totalRounds: 10,
    metrics: metrics(),
    usedTopics: ['Web3'],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('deterministic Game Master', () => {
  it('raises difficulty when the room is fast and accurate', () => {
    const decision = decideNextRoundLocally(request());
    expect(decision.questionSelectionStrategy).toBe('harder');
    expect(decision.nextDifficulty).toBe(3);
    expect(decision.reason).toMatch(/88%/);
  });

  it('lowers difficulty when the room is struggling', () => {
    const decision = decideNextRoundLocally(
      request({ currentDifficulty: 4, metrics: metrics({ accuracy: 0.25, correct: 4 }) }),
    );
    expect(decision.questionSelectionStrategy).toBe('easier');
    expect(decision.nextDifficulty).toBe(3);
  });

  it('holds steady inside the competitive band', () => {
    const decision = decideNextRoundLocally(
      request({ currentDifficulty: 3, metrics: metrics({ accuracy: 0.6, medianResponseTimeMs: 6500 }) }),
    );
    expect(decision.questionSelectionStrategy).toBe('same');
    expect(decision.nextDifficulty).toBe(3);
  });

  it('never moves difficulty outside 1-5', () => {
    const top = decideNextRoundLocally(request({ currentDifficulty: 5 }));
    expect(top.nextDifficulty).toBe(5);

    const bottom = decideNextRoundLocally(
      request({ currentDifficulty: 1, metrics: metrics({ accuracy: 0.1 }) }),
    );
    expect(bottom.nextDifficulty).toBe(1);
  });

  it('never moves more than one level per round', () => {
    for (const accuracy of [0, 0.2, 0.5, 0.9, 1]) {
      const decision = decideNextRoundLocally(
        request({ currentDifficulty: 3, metrics: metrics({ accuracy }) }),
      );
      expect(Math.abs(decision.nextDifficulty - 3)).toBeLessThanOrEqual(1);
    }
  });

  it('holds difficulty when nobody is left playing', () => {
    const decision = decideNextRoundLocally(
      request({ metrics: metrics({ activePlayers: 0, accuracy: 0 }) }),
    );
    expect(decision.questionSelectionStrategy).toBe('same');
  });

  it('stays inside the host-approved topic', () => {
    const decision = decideNextRoundLocally(request({ topic: 'Solidity' }));
    expect(decision.nextTopic).toBe('Solidity');
  });

  it('reports lower confidence with fewer players', () => {
    const many = decideNextRoundLocally(request({ metrics: metrics({ activePlayers: 20 }) }));
    const few = decideNextRoundLocally(request({ metrics: metrics({ activePlayers: 2 }) }));
    expect(many.decisionConfidence).toBeGreaterThan(few.decisionConfidence);
  });

  it('generates an approved question set from local content', async () => {
    const provider = new LocalAiProvider();
    const result = await provider.generateQuestionSet({
      mode: 'QUIZ',
      topic: 'Solidity',
      difficulty: 3,
      count: 6,
      existing: [],
    });

    expect(result.questions).toHaveLength(6);
    expect(result.fallbackUsed).toBe(true);
    expect(result.questions.every((q) => q.options.length === 4)).toBe(true);
    expect(result.questions.every((q) => q.status === 'APPROVED')).toBe(true);
  });
});

describe('Gemini adapter', () => {
  it('falls back to local content when no key is configured', async () => {
    const provider = new GeminiAiProvider('', 'gemini-2.0-flash');
    const result = await provider.generateQuestionSet({
      mode: 'QUIZ',
      topic: 'Web3',
      difficulty: 2,
      count: 3,
      existing: [],
    });
    expect(result.fallbackUsed).toBe(true);
    expect(result.warning).toMatch(/no ai key/i);
    expect(result.questions).toHaveLength(3);
  });

  it('falls back when the API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('quota exceeded', { status: 429 })),
    );
    const provider = new GeminiAiProvider('key', 'gemini-2.0-flash');
    const result = await provider.generateQuestionSet({
      mode: 'QUIZ',
      topic: 'Web3',
      difficulty: 2,
      count: 3,
      existing: [],
    });
    expect(result.fallbackUsed).toBe(true);
    expect(result.questions).toHaveLength(3);
    expect(result.warning).toMatch(/unavailable/i);
  });

  it('falls back when the model returns output that fails validation', async () => {
    const malformed = {
      candidates: [
        {
          content: {
            parts: [
              // Only two options — must be rejected, not repaired.
              { text: JSON.stringify({ questions: [{ question: 'Too short?', options: ['a', 'b'], correctAnswerIndex: 0, difficulty: 2, topic: 'Web3', explanation: 'x' }] }) },
            ],
          },
        },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(malformed)));

    const provider = new GeminiAiProvider('key', 'gemini-2.0-flash');
    const result = await provider.generateQuestionSet({
      mode: 'QUIZ',
      topic: 'Web3',
      difficulty: 2,
      count: 3,
      existing: [],
    });
    expect(result.fallbackUsed).toBe(true);
    expect(result.questions).toHaveLength(3);
  });

  it('accepts a well-formed response and marks it pending approval', async () => {
    const good = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  questions: [
                    {
                      question: 'What does the EVM execute?',
                      options: ['Bytecode', 'Python', 'SQL queries', 'Shell scripts'],
                      correctAnswerIndex: 0,
                      difficulty: 2,
                      topic: 'Ethereum',
                      explanation: 'The EVM runs compiled contract bytecode.',
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(good)));

    const provider = new GeminiAiProvider('key', 'gemini-2.0-flash');
    const result = await provider.generateQuestionSet({
      mode: 'QUIZ',
      topic: 'Ethereum',
      difficulty: 2,
      count: 1,
      existing: [],
    });

    expect(result.fallbackUsed).toBe(false);
    expect(result.questions[0].status).toBe('PENDING_APPROVAL');
    expect(result.questions[0].source).toBe('ai');
  });

  it('falls back to the deterministic decision when the model round-trip fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const provider = new GeminiAiProvider('key', 'gemini-2.0-flash');
    const decision = await provider.chooseNextRound(request());
    expect(decision.fallbackUsed).toBe(true);
    expect(decision.nextDifficulty).toBeGreaterThanOrEqual(1);
    expect(decision.nextDifficulty).toBeLessThanOrEqual(5);
  });
});

describe('structured output validation', () => {
  it('rejects a question with duplicate options', () => {
    const parsed = aiQuestionSchema.safeParse({
      question: 'Which one is a duplicate here?',
      options: ['Same', 'Same', 'Other', 'Another'],
      correctAnswerIndex: 0,
      difficulty: 2,
      topic: 'Web3',
      explanation: 'Duplicate options make the round unanswerable.',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a correct index outside the option range', () => {
    const parsed = aiQuestionSchema.safeParse({
      question: 'Which option is correct here?',
      options: ['A', 'B', 'C', 'D'],
      correctAnswerIndex: 9,
      difficulty: 2,
      topic: 'Web3',
      explanation: 'Out of range.',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a question with an empty explanation', () => {
    const parsed = aiQuestionSchema.safeParse({
      question: 'Is the explanation missing here?',
      options: ['A', 'B', 'C', 'D'],
      correctAnswerIndex: 0,
      difficulty: 2,
      topic: 'Web3',
      explanation: '',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a decision with an unknown strategy', () => {
    const parsed = aiDecisionSchema.safeParse({
      nextDifficulty: 3,
      nextTopic: 'Web3',
      reason: 'Because it seemed right to raise the level a little.',
      questionSelectionStrategy: 'chaotic',
      decisionConfidence: 0.8,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a confidence outside 0-1', () => {
    const parsed = aiDecisionSchema.safeParse({
      nextDifficulty: 3,
      nextTopic: 'Web3',
      reason: 'Accuracy was high so the next round should be harder.',
      questionSelectionStrategy: 'harder',
      decisionConfidence: 4,
    });
    expect(parsed.success).toBe(false);
  });
});
