import { describe, expect, it } from 'vitest';
import { economy, gameRules } from '@/lib/config';
import {
  gradeRound,
  isSubmissionOnTime,
  remainingRatio,
  scoreForCorrectAnswer,
} from '@/lib/engine/scoring';
import { MON, ROUND_START, makeAnswer, makePlayers, makeRound } from './helpers';

const CORRECT = 1;

describe('speed bonus', () => {
  const round = makeRound();

  it('awards the full bonus for an instant answer', () => {
    expect(scoreForCorrectAnswer(ROUND_START, round)).toBe(
      gameRules.baseScore + gameRules.maxSpeedBonus,
    );
  });

  it('awards no bonus for an answer at the buzzer', () => {
    expect(scoreForCorrectAnswer(round.endsAt, round)).toBe(gameRules.baseScore);
  });

  it('awards half the bonus at the halfway point', () => {
    expect(scoreForCorrectAnswer(ROUND_START + 5_000, round)).toBe(
      gameRules.baseScore + gameRules.maxSpeedBonus / 2,
    );
  });

  it('scores a faster correct answer strictly higher than a slower one', () => {
    const fast = scoreForCorrectAnswer(ROUND_START + 1_000, round);
    const slow = scoreForCorrectAnswer(ROUND_START + 8_000, round);
    expect(fast).toBeGreaterThan(slow);
  });

  it('clamps the ratio outside the round window', () => {
    expect(remainingRatio(ROUND_START - 5_000, round)).toBe(1);
    expect(remainingRatio(round.endsAt + 5_000, round)).toBe(0);
  });
});

describe('submission window', () => {
  const round = makeRound();

  it('accepts an answer inside the window', () => {
    expect(isSubmissionOnTime(ROUND_START + 4_000, round)).toBe(true);
  });

  it('accepts an answer inside the latency grace period', () => {
    expect(isSubmissionOnTime(round.endsAt + gameRules.submissionGraceMs - 1, round)).toBe(true);
  });

  it('rejects an answer past the grace period', () => {
    expect(isSubmissionOnTime(round.endsAt + gameRules.submissionGraceMs + 1, round)).toBe(false);
  });

  it('rejects an answer from before the round opened', () => {
    expect(isSubmissionOnTime(ROUND_START - 1, round)).toBe(false);
  });
});

describe('grading a round', () => {
  it('scores a correct answer and leaves the balance untouched', () => {
    const players = makePlayers([['alice']]);
    const result = gradeRound({
      round: makeRound(),
      correctAnswerIndex: CORRECT,
      players,
      answers: [makeAnswer('alice', CORRECT, 2_000)],
    });

    const alice = result.players.alice;
    expect(alice.score).toBe(gameRules.baseScore + 40);
    expect(alice.correctCount).toBe(1);
    expect(alice.currentGameBalanceWei).toBe(economy.startingGameBalanceWei.toString());
    expect(result.penaltyCollectedWei).toBe(0n);
  });

  it('penalises a wrong answer without awarding points', () => {
    const players = makePlayers([['alice']]);
    const result = gradeRound({
      round: makeRound(),
      correctAnswerIndex: CORRECT,
      players,
      answers: [makeAnswer('alice', 0, 2_000)],
    });

    const alice = result.players.alice;
    expect(alice.score).toBe(0);
    expect(alice.wrongCount).toBe(1);
    expect(BigInt(alice.currentGameBalanceWei)).toBe(
      economy.startingGameBalanceWei - economy.penaltyWei,
    );
    expect(result.penaltyCollectedWei).toBe(economy.penaltyWei);
  });

  it('treats a timeout exactly like a wrong answer', () => {
    const players = makePlayers([['alice']]);
    const result = gradeRound({
      round: makeRound(),
      correctAnswerIndex: CORRECT,
      players,
      answers: [],
    });

    const alice = result.players.alice;
    expect(alice.timeoutCount).toBe(1);
    expect(alice.wrongCount).toBe(0);
    expect(BigInt(alice.currentGameBalanceWei)).toBe(
      economy.startingGameBalanceWei - economy.penaltyWei,
    );
    expect(result.penaltyCollectedWei).toBe(economy.penaltyWei);
  });

  it('walks the documented balance ladder and eliminates on the fifth penalty', () => {
    let players = makePlayers([['alice']]);
    const expected = ['400000000000000000', '300000000000000000', '200000000000000000', '100000000000000000', '0'];

    for (let round = 1; round <= economy.maxWrongAnswers; round += 1) {
      const result = gradeRound({
        round: makeRound({ roundNumber: round }),
        correctAnswerIndex: CORRECT,
        players,
        answers: [makeAnswer('alice', 0, 1_000, round)],
      });
      players = result.players;
      expect(players.alice.currentGameBalanceWei).toBe(expected[round - 1]);
      expect(players.alice.eliminated).toBe(round === economy.maxWrongAnswers);
    }

    expect(players.alice.eliminated).toBe(true);
    expect(players.alice.eliminatedAtRound).toBe(economy.maxWrongAnswers);
    expect(BigInt(players.alice.penaltyTotalWei)).toBe(
      economy.penaltyWei * BigInt(economy.maxWrongAnswers),
    );
  });

  it('never lets a balance go negative', () => {
    const players = makePlayers([
      ['alice', { currentGameBalanceWei: '50000000000000000', wrongCount: 4 }],
    ]);
    const result = gradeRound({
      round: makeRound(),
      correctAnswerIndex: CORRECT,
      players,
      answers: [makeAnswer('alice', 0, 1_000)],
    });

    expect(BigInt(result.players.alice.currentGameBalanceWei)).toBe(0n);
    // Only what was actually available is collected into the pool.
    expect(result.penaltyCollectedWei).toBe(50000000000000000n);
    expect(result.players.alice.eliminated).toBe(true);
  });

  it('eliminates a player whose balance is exhausted before the penalty count', () => {
    const players = makePlayers([['alice', { currentGameBalanceWei: economy.penaltyWei.toString() }]]);
    const result = gradeRound({
      round: makeRound(),
      correctAnswerIndex: CORRECT,
      players,
      answers: [makeAnswer('alice', 0, 1_000)],
    });
    expect(result.players.alice.eliminated).toBe(true);
    expect(result.players.alice.wrongCount).toBe(1);
  });

  it('skips eliminated players entirely — no score, no penalty', () => {
    const players = makePlayers([
      ['ghost', { eliminated: true, currentGameBalanceWei: '0', score: 250 }],
    ]);
    const result = gradeRound({
      round: makeRound(),
      correctAnswerIndex: CORRECT,
      players,
      answers: [],
    });

    expect(result.players.ghost.score).toBe(250);
    expect(result.players.ghost.timeoutCount).toBe(0);
    expect(result.penaltyCollectedWei).toBe(0n);
    expect(result.outcomes.find((o) => o.playerId === 'ghost')?.correct).toBeNull();
  });

  it('keeps only the earliest answer if a duplicate somehow reaches grading', () => {
    const players = makePlayers([['alice']]);
    const result = gradeRound({
      round: makeRound(),
      correctAnswerIndex: CORRECT,
      players,
      answers: [makeAnswer('alice', 0, 8_000), makeAnswer('alice', CORRECT, 1_000)],
    });
    // The earliest submission (index 1, the correct one) is the one graded.
    expect(result.players.alice.correctCount).toBe(1);
    expect(result.players.alice.score).toBe(gameRules.baseScore + 45);
  });

  it('collects every penalty from a mixed round into the pool', () => {
    const players = makePlayers([['a'], ['b'], ['c'], ['d']]);
    const result = gradeRound({
      round: makeRound(),
      correctAnswerIndex: CORRECT,
      players,
      answers: [
        makeAnswer('a', CORRECT, 1_000),
        makeAnswer('b', 0, 2_000),
        makeAnswer('c', 2, 3_000),
        // d times out
      ],
    });

    expect(result.penaltyCollectedWei).toBe(economy.penaltyWei * 3n);
    expect(result.players.a.score).toBeGreaterThan(0);
    expect(result.players.b.score).toBe(0);
    expect(result.players.d.timeoutCount).toBe(1);
  });

  it('conserves value: penalties leave balances exactly as they entered the pool', () => {
    const players = makePlayers([['a'], ['b'], ['c']]);
    const before = Object.values(players).reduce(
      (total, player) => total + BigInt(player.currentGameBalanceWei),
      0n,
    );
    const result = gradeRound({
      round: makeRound(),
      correctAnswerIndex: CORRECT,
      players,
      answers: [makeAnswer('a', 0, 1_000), makeAnswer('b', 3, 2_000)],
    });
    const after = Object.values(result.players).reduce(
      (total, player) => total + BigInt(player.currentGameBalanceWei),
      0n,
    );
    expect(before - after).toBe(result.penaltyCollectedWei);
  });

  it('uses the demo economy constants the product specifies', () => {
    expect(economy.penaltyWei).toBe(MON / 10n);
    expect(economy.startingGameBalanceWei).toBe(MON / 2n);
    expect(economy.prizePoolContributionWei).toBe(MON / 2n);
    expect(economy.playerAllocationWei).toBe(MON);
    expect(economy.maxWrongAnswers).toBe(5);
  });
});
