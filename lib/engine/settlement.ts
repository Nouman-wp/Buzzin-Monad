import type { PlayerGameState, SettlementItem } from '@/lib/types';
import { rankPlayers } from '@/lib/engine/leaderboard';

/**
 * Performance-adjusted top-5 payout.
 *
 *   rank_component_i        = pool * 0.50 * rank_weight_i
 *   performance_component_i = pool * 0.50 * (score_i / sum_top5_scores)
 *   final_prize_i           = rank_component_i + performance_component_i
 *
 * All arithmetic is done in wei with bigints, so there is no floating-point
 * drift and the sum of all payouts is exactly the prize pool — never more.
 */

/** Basis points for places 1-5. Sums to 10000 (= 100% of the rank component). */
export const RANK_WEIGHTS_BPS = [3500n, 2500n, 1800n, 1300n, 900n] as const;

export const PRIZE_PLACES = RANK_WEIGHTS_BPS.length;

/** Half the pool is rank-weighted, half is performance-weighted. */
const HALF_BPS = 5000n;
const BPS = 10000n;

export interface PrizeShare {
  playerId: string;
  rank: number;
  score: number;
  rankComponentWei: bigint;
  performanceComponentWei: bigint;
  prizeWei: bigint;
}

/**
 * Split `prizePoolWei` across the top finishers.
 *
 * With fewer than five players the rank weights are renormalised over the
 * available places so the entire pool is still distributed. Any rounding dust
 * (at most a few wei) is added to first place, which keeps the invariant
 * `sum(prizes) === prizePoolWei` exact while never exceeding the pool.
 */
export function calculatePrizeShares(
  ranked: Array<Pick<PlayerGameState, 'playerId' | 'score' | 'rank'>>,
  prizePoolWei: bigint,
): PrizeShare[] {
  const winners = ranked.slice(0, PRIZE_PLACES);
  if (winners.length === 0 || prizePoolWei <= 0n) {
    return winners.map((winner) => ({
      playerId: winner.playerId,
      rank: winner.rank,
      score: winner.score,
      rankComponentWei: 0n,
      performanceComponentWei: 0n,
      prizeWei: 0n,
    }));
  }

  const weights = RANK_WEIGHTS_BPS.slice(0, winners.length);
  const weightTotal = weights.reduce((total, weight) => total + weight, 0n);

  const rankPoolWei = (prizePoolWei * HALF_BPS) / BPS;
  const performancePoolWei = prizePoolWei - rankPoolWei;

  const scoreTotal = winners.reduce((total, winner) => total + BigInt(Math.max(0, winner.score)), 0n);

  const shares: PrizeShare[] = winners.map((winner, index) => {
    const weight = weights[index];
    const rankComponentWei = (rankPoolWei * weight) / weightTotal;
    // When nobody scored, fall back to the rank weights so the pool is still
    // distributed deterministically instead of dividing by zero.
    const performanceComponentWei =
      scoreTotal > 0n
        ? (performancePoolWei * BigInt(Math.max(0, winner.score))) / scoreTotal
        : (performancePoolWei * weight) / weightTotal;
    return {
      playerId: winner.playerId,
      rank: winner.rank,
      score: winner.score,
      rankComponentWei,
      performanceComponentWei,
      prizeWei: rankComponentWei + performanceComponentWei,
    };
  });

  const distributed = shares.reduce((total, share) => total + share.prizeWei, 0n);
  const dust = prizePoolWei - distributed;
  if (dust > 0n) {
    shares[0].rankComponentWei += dust;
    shares[0].prizeWei += dust;
  }

  return shares;
}

export interface SettlementPlan {
  items: SettlementItem[];
  prizePoolWei: bigint;
  totalPrizeAllocatedWei: bigint;
  totalRefundWei: bigint;
  totalAllocatedWei: bigint;
}

/**
 * Build the full, deterministic settlement payload for a finished game.
 *
 * Policy (per spec):
 *   - A player's locked starting balance already absorbed their penalties
 *     during play, so whatever remains is refunded to them.
 *   - The prize pool is the sum of every player's 0.5 MON pool contribution
 *     plus every penalty collected, and goes to the top five.
 *   - Nothing is ever created or destroyed: prizes + refunds always equal the
 *     total locked funds.
 */
export function buildSettlementPlan(
  players: Record<string, PlayerGameState>,
  prizePoolWei: bigint,
): SettlementPlan {
  const ranked = rankPlayers(players);
  const shares = new Map(
    calculatePrizeShares(ranked, prizePoolWei).map((share) => [share.playerId, share]),
  );

  let totalPrizeAllocatedWei = 0n;
  let totalRefundWei = 0n;

  const items: SettlementItem[] = ranked.map((player) => {
    const prizeWei = shares.get(player.playerId)?.prizeWei ?? 0n;
    const refundWei = BigInt(player.currentGameBalanceWei);
    totalPrizeAllocatedWei += prizeWei;
    totalRefundWei += refundWei;
    return {
      playerId: player.playerId,
      displayName: player.displayName,
      walletAddress: player.walletAddress,
      rank: player.rank,
      score: player.score,
      prizeWei: prizeWei.toString(),
      refundWei: refundWei.toString(),
      totalPayoutWei: (prizeWei + refundWei).toString(),
      claimed: false,
      claimTxHash: null,
      claimedTo: null,
    };
  });

  return {
    items,
    prizePoolWei,
    totalPrizeAllocatedWei,
    totalRefundWei,
    totalAllocatedWei: totalPrizeAllocatedWei + totalRefundWei,
  };
}

/**
 * Independent safety check run before anything touches the chain. A settlement
 * that fails any of these is never submitted.
 */
export function validateSettlementPlan(
  plan: SettlementPlan,
  lockedTotalWei: bigint,
): { ok: true } | { ok: false; reason: string } {
  if (plan.totalPrizeAllocatedWei > plan.prizePoolWei) {
    return { ok: false, reason: 'Allocated prizes exceed the prize pool' };
  }
  if (plan.items.some((item) => BigInt(item.prizeWei) < 0n || BigInt(item.refundWei) < 0n)) {
    return { ok: false, reason: 'Settlement contains a negative payout' };
  }
  if (plan.totalAllocatedWei > lockedTotalWei) {
    return { ok: false, reason: 'Total payout exceeds the funds locked for this game' };
  }
  const winners = plan.items.filter((item) => BigInt(item.prizeWei) > 0n);
  if (winners.length > PRIZE_PLACES) {
    return { ok: false, reason: 'More than five players were allocated a prize' };
  }
  if (winners.some((item) => item.rank > PRIZE_PLACES)) {
    return { ok: false, reason: 'A prize was allocated outside the top five' };
  }
  return { ok: true };
}
