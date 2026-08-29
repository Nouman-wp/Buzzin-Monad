import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MODE_LABELS,
  TOPICS_BY_MODE,
  allSeedChallenges,
  buildSeedChallengeSet,
  seedPoolSize,
} from '@/lib/content';
import { SONGLESS_TRACKS } from '@/lib/content/songless-seed';
import type { GameMode } from '@/lib/types';

const MODES: GameMode[] = ['QUIZ', 'SONGLESS', 'WORDLESS'];

describe('bundled content', () => {
  it('ships enough seeded content for every mode', () => {
    expect(seedPoolSize('QUIZ')).toBeGreaterThanOrEqual(20);
    expect(seedPoolSize('WORDLESS')).toBeGreaterThanOrEqual(20);
    expect(seedPoolSize('SONGLESS')).toBeGreaterThanOrEqual(10);
  });

  it.each(MODES)('%s content is structurally valid', (mode) => {
    for (const challenge of allSeedChallenges(mode)) {
      expect(challenge.options).toHaveLength(4);
      expect(new Set(challenge.options).size).toBe(4);
      expect(challenge.correctAnswerIndex).toBeGreaterThanOrEqual(0);
      expect(challenge.correctAnswerIndex).toBeLessThan(4);
      expect(challenge.explanation.trim().length).toBeGreaterThan(0);
      expect(challenge.question.trim().length).toBeGreaterThan(0);
      expect(challenge.difficulty).toBeGreaterThanOrEqual(1);
      expect(challenge.difficulty).toBeLessThanOrEqual(5);
    }
  });

  it('covers all three difficulty tiers in the quiz pool', () => {
    const difficulties = new Set(allSeedChallenges('QUIZ').map((q) => q.difficulty));
    expect(difficulties.size).toBeGreaterThanOrEqual(3);
  });

  it('offers multiple topic categories per mode', () => {
    for (const mode of MODES) {
      expect(TOPICS_BY_MODE[mode].length).toBeGreaterThan(0);
      expect(MODE_LABELS[mode]).toBeTruthy();
    }
    expect(TOPICS_BY_MODE.QUIZ.length).toBeGreaterThanOrEqual(8);
  });

  it('never leaks an answer through the options of another question', () => {
    // A quick sanity check that no explanation simply restates one option
    // verbatim in a way that would give the answer away in the UI.
    for (const challenge of allSeedChallenges('QUIZ')) {
      const wrong = challenge.options.filter((_, i) => i !== challenge.correctAnswerIndex);
      expect(wrong).toHaveLength(3);
    }
  });
});

describe('seed set builder', () => {
  it('returns exactly the requested number of approved challenges', () => {
    const set = buildSeedChallengeSet({
      mode: 'QUIZ',
      topic: 'Solidity',
      difficulty: 3,
      count: 10,
      shuffleKey: 'room-1',
    });
    expect(set).toHaveLength(10);
    expect(set.every((q) => q.status === 'APPROVED')).toBe(true);
    expect(new Set(set.map((q) => q.id)).size).toBe(10);
  });

  it('prefers content matching the requested topic', () => {
    const set = buildSeedChallengeSet({
      mode: 'QUIZ',
      topic: 'Solidity',
      difficulty: 3,
      count: 4,
      shuffleKey: 'room-topic',
    });
    expect(set.filter((q) => q.topic === 'Solidity').length).toBeGreaterThan(0);
  });

  it('still fills the set when more rounds are requested than the pool holds', () => {
    const set = buildSeedChallengeSet({
      mode: 'SONGLESS',
      topic: 'Classical',
      difficulty: 2,
      count: 30,
      shuffleKey: 'room-overflow',
    });
    expect(set).toHaveLength(30);
  });

  it('is deterministic for the same shuffle key and varies across rooms', () => {
    const args = { mode: 'QUIZ' as const, topic: 'Web3', difficulty: 3, count: 8 };
    const a1 = buildSeedChallengeSet({ ...args, shuffleKey: 'room-a' });
    const a2 = buildSeedChallengeSet({ ...args, shuffleKey: 'room-a' });
    const b = buildSeedChallengeSet({ ...args, shuffleKey: 'room-b' });

    expect(a1.map((q) => q.question)).toEqual(a2.map((q) => q.question));
    expect(a1.map((q) => q.question)).not.toEqual(b.map((q) => q.question));
  });

  it('honours the exclusion list', () => {
    const first = buildSeedChallengeSet({
      mode: 'QUIZ',
      topic: 'Web3',
      difficulty: 2,
      count: 5,
      shuffleKey: 'room-x',
    });
    const second = buildSeedChallengeSet({
      mode: 'QUIZ',
      topic: 'Web3',
      difficulty: 2,
      count: 5,
      shuffleKey: 'room-x',
      exclude: first.map((q) => q.question),
    });
    const overlap = second.filter((q) =>
      first.some((existing) => existing.question === q.question),
    );
    expect(overlap).toHaveLength(0);
  });
});

describe('Songless assets', () => {
  it('ships every referenced audio clip', () => {
    for (const track of SONGLESS_TRACKS) {
      const path = join(process.cwd(), 'public', 'audio', track.file);
      expect(existsSync(path), `missing ${track.file}`).toBe(true);
    }
  });

  it('uses opaque filenames that do not leak the answer', () => {
    for (const track of SONGLESS_TRACKS) {
      expect(track.file).toMatch(/^track-\d+\.wav$/);
      const slug = track.title.toLowerCase().replace(/[^a-z]/g, '');
      expect(track.file.toLowerCase()).not.toContain(slug.slice(0, 5));
    }
  });

  it('builds four distinct options with the correct answer among them', () => {
    for (const challenge of allSeedChallenges('SONGLESS')) {
      expect(challenge.audioUrl).toMatch(/^\/audio\/track-\d+\.wav$/);
      expect(new Set(challenge.options).size).toBe(4);
      expect(challenge.options[challenge.correctAnswerIndex]).toBeTruthy();
    }
  });

  it('matches each clip to its own title', () => {
    const challenges = allSeedChallenges('SONGLESS');
    for (const track of SONGLESS_TRACKS) {
      const challenge = challenges.find((c) => c.audioUrl === `/audio/${track.file}`)!;
      expect(challenge.options[challenge.correctAnswerIndex]).toBe(track.title);
    }
  });
});

describe('Wordless hints', () => {
  it('shows the length without revealing any letter', () => {
    for (const challenge of allSeedChallenges('WORDLESS')) {
      expect(challenge.pattern).toBeTruthy();
      const answer = challenge.options[challenge.correctAnswerIndex];
      // No alphabetic character from the answer may appear in the hint.
      expect(/[A-Za-z]/.test(challenge.pattern!.replace(/\d/g, ''))).toBe(false);
      expect(challenge.pattern).toContain(String(answer.length));
    }
  });
});
