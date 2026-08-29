import type { Challenge, GameMode } from '@/lib/types';
import { QUIZ_SEED, QUIZ_TOPICS } from '@/lib/content/quiz-seed';
import { SONGLESS_SEED, SONGLESS_TOPICS } from '@/lib/content/songless-seed';
import { WORDLESS_SEED, WORDLESS_TOPICS } from '@/lib/content/wordless-seed';
import { newId } from '@/lib/util/ids';

type Seed = Omit<Challenge, 'id' | 'gameType' | 'source' | 'status'>;

const SEEDS: Record<GameMode, Seed[]> = {
  QUIZ: QUIZ_SEED,
  SONGLESS: SONGLESS_SEED,
  WORDLESS: WORDLESS_SEED,
};

export const TOPICS_BY_MODE: Record<GameMode, string[]> = {
  QUIZ: QUIZ_TOPICS,
  SONGLESS: SONGLESS_TOPICS,
  WORDLESS: WORDLESS_TOPICS,
};

export const MODE_LABELS: Record<GameMode, string> = {
  QUIZ: 'Quiz',
  SONGLESS: 'Songless',
  WORDLESS: 'Wordless',
};

export const MODE_DESCRIPTIONS: Record<GameMode, string> = {
  QUIZ: 'Multiple-choice questions on any topic. The AI Game Master writes and paces them.',
  SONGLESS: 'A short melody plays. Name it before the clock runs out.',
  WORDLESS: 'A clue and a letter count. Find the word fastest.',
};

export function seedPoolSize(mode: GameMode): number {
  return SEEDS[mode].length;
}

/**
 * Score a seed against the requested topic and difficulty so "Web3, medium"
 * yields a coherent set rather than a random grab bag.
 */
function relevance(seed: Seed, topic: string, difficulty: number): number {
  const wanted = topic.trim().toLowerCase();
  const seedTopic = seed.topic.toLowerCase();
  let score = 0;
  if (wanted && seedTopic === wanted) score += 100;
  else if (wanted && (seedTopic.includes(wanted) || wanted.includes(seedTopic))) score += 60;
  else if (wanted && wanted.split(/\s+/).some((word) => word.length > 3 && seedTopic.includes(word))) {
    score += 30;
  }
  score += Math.max(0, 20 - Math.abs(seed.difficulty - difficulty) * 7);
  return score;
}

/**
 * Deterministic shuffle keyed by a seed string so two servers building the same
 * room produce the same order, while different rooms differ.
 */
function shuffle<T>(items: T[], key: string): T[] {
  let state = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    state ^= key.charCodeAt(i);
    state = Math.imul(state, 16777619) >>> 0;
  }
  const output = items.slice();
  for (let i = output.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

export function seedToChallenge(
  seed: Seed,
  mode: GameMode,
  source: Challenge['source'],
  status: Challenge['status'],
): Challenge {
  return {
    id: newId('q'),
    gameType: mode,
    source,
    status,
    ...seed,
  };
}

/**
 * Build an approved challenge set from bundled content. This is the path used
 * when the AI is unavailable, when the host clicks "Use seeded questions", and
 * to top up a short AI set so a round is never missing content.
 */
export function buildSeedChallengeSet(params: {
  mode: GameMode;
  topic: string;
  difficulty: number;
  count: number;
  /** Stable key (usually the room id) so the same room gets the same order. */
  shuffleKey: string;
  /** Questions already in the set; their text is not repeated. */
  exclude?: string[];
}): Challenge[] {
  const { mode, topic, difficulty, count, shuffleKey } = params;
  const excluded = new Set((params.exclude ?? []).map((text) => text.trim().toLowerCase()));

  const candidates = SEEDS[mode]
    .filter((seed) => !excluded.has(seed.question.trim().toLowerCase()))
    .map((seed) => ({ seed, score: relevance(seed, topic, difficulty) }));

  // Shuffle first, then stable-sort by relevance so equally relevant items
  // appear in a varied order between rooms.
  const shuffled = shuffle(candidates, shuffleKey);
  shuffled.sort((a, b) => b.score - a.score);

  const chosen = shuffled.slice(0, count).map(({ seed }) =>
    seedToChallenge(seed, mode, 'seed', 'APPROVED'),
  );

  // If the pool is smaller than the requested count, cycle through it again so
  // the game always has enough rounds to run.
  if (chosen.length < count && shuffled.length > 0) {
    let index = 0;
    while (chosen.length < count) {
      const { seed } = shuffled[index % shuffled.length];
      chosen.push(seedToChallenge(seed, mode, 'seed', 'APPROVED'));
      index += 1;
    }
  }

  return chosen;
}

/** All bundled content for a mode, used by the admin content browser. */
export function allSeedChallenges(mode: GameMode): Challenge[] {
  return SEEDS[mode].map((seed) => seedToChallenge(seed, mode, 'seed', 'APPROVED'));
}
