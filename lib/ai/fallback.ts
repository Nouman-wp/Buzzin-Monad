import type {
  AiProvider,
  ChooseNextRoundRequest,
  ChooseNextRoundResult,
  GenerateQuestionSetRequest,
  GenerateQuestionSetResult,
} from '@/lib/ai/types';
import { buildSeedChallengeSet } from '@/lib/content';

/**
 * Deterministic local Game Master.
 *
 * This is not a stub — it is the guaranteed floor for the whole product. If the
 * AI key is missing, the provider times out, or its output fails validation,
 * the game keeps running with exactly this logic and the admin sees it labelled
 * as a local decision.
 */

/** Accuracy bands that drive the difficulty ladder. */
const TOO_EASY = 0.8;
const TOO_HARD = 0.4;
/** Below this median response time the room is clearly ahead of the questions. */
const FAST_RESPONSE_MS = 4000;

export function decideNextRoundLocally(
  request: ChooseNextRoundRequest,
): Omit<ChooseNextRoundResult, 'provider' | 'model' | 'fallbackUsed'> {
  const { metrics, currentDifficulty, usedTopics, topic } = request;
  const accuracy = metrics.accuracy;
  const responseTime = metrics.medianResponseTimeMs || metrics.averageResponseTimeMs;

  let strategy: 'easier' | 'same' | 'harder' = 'same';
  let nextDifficulty = currentDifficulty;
  let reason: string;

  if (metrics.activePlayers === 0) {
    reason = 'No active players remained in the round, so difficulty is held steady.';
  } else if (accuracy >= TOO_EASY && responseTime > 0 && responseTime < FAST_RESPONSE_MS) {
    strategy = 'harder';
    nextDifficulty = Math.min(5, currentDifficulty + 1);
    reason = `${Math.round(accuracy * 100)}% answered correctly in a median of ${(responseTime / 1000).toFixed(1)}s, so the next round steps up a level.`;
  } else if (accuracy >= TOO_EASY) {
    strategy = 'harder';
    nextDifficulty = Math.min(5, currentDifficulty + 1);
    reason = `Accuracy of ${Math.round(accuracy * 100)}% is above the target band, so the next round is harder.`;
  } else if (accuracy <= TOO_HARD) {
    strategy = 'easier';
    nextDifficulty = Math.max(1, currentDifficulty - 1);
    reason = `Only ${Math.round(accuracy * 100)}% answered correctly, so the next round eases off to keep players in the game.`;
  } else {
    reason = `Accuracy of ${Math.round(accuracy * 100)}% is inside the competitive band, so difficulty stays at ${currentDifficulty}.`;
  }

  // The local Game Master stays inside the host-approved topic. Selecting a
  // subarea is a judgement call, so it is left to the model when one is
  // configured; here `usedTopics` only feeds the confidence estimate.
  const nextTopic = topic;
  const breadth = new Set(usedTopics).size;

  // Confidence scales with how much evidence the decision had: more active
  // players and more topic variety already seen means a firmer read.
  const sample = Math.min(1, metrics.activePlayers / 8);
  const variety = Math.min(1, breadth / 3);
  const decisionConfidence = Number((0.55 + 0.3 * sample + 0.1 * variety).toFixed(2));

  return { nextDifficulty, nextTopic, reason, questionSelectionStrategy: strategy, decisionConfidence };
}

export class LocalAiProvider implements AiProvider {
  readonly name = 'local';
  readonly model = 'deterministic-game-master';
  readonly available = true;

  async generateQuestionSet(
    request: GenerateQuestionSetRequest,
  ): Promise<GenerateQuestionSetResult> {
    const questions = buildSeedChallengeSet({
      mode: request.mode,
      topic: request.topic,
      difficulty: request.difficulty,
      count: request.count,
      shuffleKey: `${request.topic}:${request.difficulty}:${request.count}:${request.existing.length}`,
      exclude: request.existing,
    });
    return {
      questions,
      provider: this.name,
      model: this.model,
      fallbackUsed: true,
      warning: null,
    };
  }

  async chooseNextRound(request: ChooseNextRoundRequest): Promise<ChooseNextRoundResult> {
    return {
      ...decideNextRoundLocally(request),
      provider: this.name,
      model: this.model,
      fallbackUsed: true,
    };
  }
}
