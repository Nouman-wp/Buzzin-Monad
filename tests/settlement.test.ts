import { describe, expect, it } from 'vitest';
import { economy } from '@/lib/config';
import {
  PRIZE_PLACES,
  RANK_WEIGHTS_BPS,
  buildSettlementPlan,
  calculatePrizeShares,
  validateSettlementPlan,
} from '@/lib/engine/settlement';
import { rankPlayers } from '@/lib/engine/leaderboard';
import { MON, makePlayers } from './helpers';

function ranked(scores: number[]) {
  return scores.map((score, index) => ({
    playerId: `p${index + 1}`,
    score,
    rank: index + 1,
  }));
}

describe('rank weights', () => {
  it('sums to exactly 100% of the rank component', () => {
    expect(RANK_WEIGHTS_BPS.reduce((total, weight) => total + weight, 0n)).toBe(10000n);
  });

  it('pays five places', () => {
    expect(PRIZE_PLACES).toBe(5);
  });
});

describe('prize distribution', () => {
  const pool = 10n * MON;

  it('distributes the entire pool and never more', () => {
    const shares = calculatePrizeShares(ranked([800, 700, 600, 500, 400]), pool);
    const total = shares.reduce((sum, share) => sum + share.prizeWei, 0n);
    expect(total).toBe(pool);
  });

  it('pays first place the most', () => {
    const shares = calculatePrizeShares(ranked([800, 700, 600, 500, 400]), pool);
    for (let i = 1; i < shares.length; i += 1) {
      expect(shares[0].prizeWei).toBeGreaterThan(shares[i].prizeWei);
    }
  });

  it('splits the pool exactly half rank-weighted, half performance-weighted', () => {
    const shares = calculatePrizeShares(ranked([800, 700, 600, 500, 400]), pool);
    const rankTotal = shares.reduce((sum, share) => sum + share.rankComponentWei, 0n);
    const perfTotal = shares.reduce((sum, share) => sum + share.performanceComponentWei, 0n);
    // First place absorbs the rounding dust, so allow a few wei of slack.
    expect(rankTotal - pool / 2n).toBeLessThan(10n);
    expect(pool / 2n - perfTotal).toBeLessThan(10n);
  });

  it('reflects performance, not just rank', () => {
    // A runaway leader should take more than a leader who barely edged ahead.
    const dominant = calculatePrizeShares(ranked([2000, 100, 90, 80, 70]), pool);
    const narrow = calculatePrizeShares(ranked([500, 490, 480, 470, 460]), pool);
    expect(dominant[0].prizeWei).toBeGreaterThan(narrow[0].prizeWei);
  });

  it('never pays a sixth place', () => {
    const shares = calculatePrizeShares(ranked([9, 8, 7, 6, 5, 4, 3]), pool);
    expect(shares).toHaveLength(5);
  });

  it('renormalises when fewer than five players finished', () => {
    const shares = calculatePrizeShares(ranked([300, 200]), pool);
    const total = shares.reduce((sum, share) => sum + share.prizeWei, 0n);
    expect(shares).toHaveLength(2);
    expect(total).toBe(pool);
  });

  it('still distributes the whole pool when nobody scored', () => {
    const shares = calculatePrizeShares(ranked([0, 0, 0, 0, 0]), pool);
    const total = shares.reduce((sum, share) => sum + share.prizeWei, 0n);
    expect(total).toBe(pool);
    expect(shares[0].prizeWei).toBeGreaterThan(shares[4].prizeWei);
  });

  it('produces no payouts from an empty pool', () => {
    const shares = calculatePrizeShares(ranked([100, 90, 80]), 0n);
    expect(shares.every((share) => share.prizeWei === 0n)).toBe(true);
  });

  it('handles a single player taking the whole pool', () => {
    const shares = calculatePrizeShares(ranked([120]), pool);
    expect(shares).toHaveLength(1);
    expect(shares[0].prizeWei).toBe(pool);
  });

  it('is deterministic across repeated runs', () => {
    const first = calculatePrizeShares(ranked([800, 700, 600, 500, 400]), pool);
    const second = calculatePrizeShares(ranked([800, 700, 600, 500, 400]), pool);
    expect(first.map((s) => s.prizeWei.toString())).toEqual(second.map((s) => s.prizeWei.toString()));
  });

  it('never produces a negative payout', () => {
    const shares = calculatePrizeShares(ranked([0, 5, 0, 0, 1]), pool);
    expect(shares.every((share) => share.prizeWei >= 0n)).toBe(true);
  });
});

describe('settlement plan', () => {
  it('conserves value: prizes plus refunds equal everything locked', () => {
    // Three players, each staking 1 MON. Two paid two penalties each, which
    // moved 0.4 MON from balances into the pool.
    const players = makePlayers([
      ['a', { score: 400, currentGameBalanceWei: '300000000000000000', wrongCount: 2 }],
      ['b', { score: 300, currentGameBalanceWei: '300000000000000000', wrongCount: 2 }],
      ['c', { score: 200, currentGameBalanceWei: '500000000000000000' }],
    ]);
    const poolWei =
      economy.prizePoolContributionWei * 3n + economy.penaltyWei * 4n;

    const plan = buildSettlementPlan(players, poolWei);
    const locked = economy.playerAllocationWei * 3n;

    expect(plan.totalAllocatedWei).toBe(locked);
    expect(plan.totalPrizeAllocatedWei).toBe(poolWei);
    expect(validateSettlementPlan(plan, locked)).toEqual({ ok: true });
  });

  it('refunds a fully spent balance as zero, not negative', () => {
    const players = makePlayers([
      ['a', { score: 100, currentGameBalanceWei: '0', wrongCount: 5, eliminated: true }],
      ['b', { score: 500 }],
    ]);
    const poolWei = economy.prizePoolContributionWei * 2n + economy.penaltyWei * 5n;
    const plan = buildSettlementPlan(players, poolWei);

    const a = plan.items.find((item) => item.playerId === 'a')!;
    expect(a.refundWei).toBe('0');
    expect(BigInt(a.totalPayoutWei)).toBeGreaterThanOrEqual(0n);
  });

  it('ranks and pays deterministically when scores tie', () => {
    const players = makePlayers([
      ['a', { score: 500, correctCount: 5 }],
      ['b', { score: 500, correctCount: 3 }],
    ]);
    const plan = buildSettlementPlan(players, 4n * MON);
    // More correct answers breaks the tie, so `a` outranks and outearns `b`.
    expect(plan.items[0].playerId).toBe('a');
    expect(BigInt(plan.items[0].prizeWei)).toBeGreaterThan(BigInt(plan.items[1].prizeWei));
  });

  it('gives a non-top-5 player their refund but no prize', () => {
    const players = makePlayers(
      Array.from({ length: 8 }, (_, index) => [
        `p${index}`,
        { score: 800 - index * 50 },
      ]) as Array<[string, Record<string, unknown>]>,
    );
    const plan = buildSettlementPlan(players, 8n * MON);
    const sixth = plan.items.find((item) => item.rank === 6)!;
    expect(sixth.prizeWei).toBe('0');
    expect(BigInt(sixth.refundWei)).toBe(economy.startingGameBalanceWei);
  });

  it('rejects a plan that would overpay the pool', () => {
    const players = makePlayers([['a', { score: 100 }]]);
    const plan = buildSettlementPlan(players, 5n * MON);
    // Understate the locked funds: the guard must catch it.
    const check = validateSettlementPlan(plan, 1n * MON);
    expect(check.ok).toBe(false);
  });

  it('accepts a plan whose payouts exactly match the locked funds', () => {
    const players = makePlayers([['a'], ['b']]);
    const poolWei = economy.prizePoolContributionWei * 2n;
    const plan = buildSettlementPlan(players, poolWei);
    expect(validateSettlementPlan(plan, economy.playerAllocationWei * 2n).ok).toBe(true);
  });

  it('marks every item unclaimed when the plan is built', () => {
    const players = makePlayers([['a'], ['b']]);
    const plan = buildSettlementPlan(players, 1n * MON);
    expect(plan.items.every((item) => !item.claimed && item.claimTxHash === null)).toBe(true);
  });
});

describe('ranking', () => {
  it('orders by score, then correct answers, then penalties', () => {
    const players = makePlayers([
      ['low', { score: 100 }],
      ['tieA', { score: 300, correctCount: 2, penaltyTotalWei: '200000000000000000' }],
      ['tieB', { score: 300, correctCount: 2, penaltyTotalWei: '100000000000000000' }],
      ['high', { score: 900 }],
    ]);
    const order = rankPlayers(players).map((player) => player.playerId);
    expect(order).toEqual(['high', 'tieB', 'tieA', 'low']);
  });

  it('is stable for players identical in every tiebreak but id', () => {
    const players = makePlayers([['zeta'], ['alpha']]);
    const first = rankPlayers(players).map((p) => p.playerId);
    const second = rankPlayers(players).map((p) => p.playerId);
    expect(first).toEqual(second);
  });
});
