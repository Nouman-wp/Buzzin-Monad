import type { Challenge, GameMetrics, GameMode } from '@/lib/types';

export interface GenerateQuestionSetRequest {
  mode: GameMode;
  topic: string;
  difficulty: number;
  count: number;
  /** Question text already in the set, so the model avoids repeats. */
  existing: string[];
}

export interface GenerateQuestionSetResult {
  questions: Challenge[];
  provider: string;
  model: string;
  fallbackUsed: boolean;
  /** Populated when the provider failed and the fallback was used. */
  warning: string | null;
}

export interface ChooseNextRoundRequest {
  mode: GameMode;
  topic: string;
  currentDifficulty: number;
  roundNumber: number;
  totalRounds: number;
  metrics: GameMetrics;
  /** Topics already used, so the Game Master can vary subareas. */
  usedTopics: string[];
}

export interface ChooseNextRoundResult {
  nextDifficulty: number;
  nextTopic: string;
  reason: string;
  questionSelectionStrategy: 'easier' | 'same' | 'harder';
  decisionConfidence: number;
  provider: string;
  model: string;
  fallbackUsed: boolean;
}

/**
 * The AI seam. Every implementation must be safe to call from a request path:
 * bounded latency, no throwing, and a deterministic result when the upstream
 * provider is unavailable.
 *
 * The Game Master proposes; deterministic engine code validates and executes.
 * No implementation of this interface can move funds or mutate game state.
 */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  readonly available: boolean;
  generateQuestionSet(request: GenerateQuestionSetRequest): Promise<GenerateQuestionSetResult>;
  chooseNextRound(request: ChooseNextRoundRequest): Promise<ChooseNextRoundResult>;
}
