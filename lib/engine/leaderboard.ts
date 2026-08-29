import type { LeaderboardEntry, PlayerGameState } from '@/lib/types';

/**
 * Deterministic ranking.
 *
 * Ties are broken in a fixed order so two servers grading the same data always
 * produce the same ranking:
 *   1. score            (higher wins)
 *   2. correct answers  (higher wins)
 *   3. penalties paid   (lower wins)
 *   4. join time        (earlier wins)
 *   5. player id        (lexicographic — final deterministic guarantee)
 */
export function comparePlayers(a: PlayerGameState, b: PlayerGameState): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
  const penaltyA = BigInt(a.penaltyTotalWei);
  const penaltyB = BigInt(b.penaltyTotalWei);
  if (penaltyA !== penaltyB) return penaltyA < penaltyB ? -1 : 1;
  if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
  return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
}

export function rankPlayers(players: Record<string, PlayerGameState>): PlayerGameState[] {
  return Object.values(players)
    .slice()
    .sort(comparePlayers)
    .map((player, index) => ({ ...player, rank: index + 1 }));
}

/**
 * Build the broadcast leaderboard. `previous` supplies the rank each player
 * held before this round so the UI can animate movement.
 */
export function buildLeaderboard(
  players: Record<string, PlayerGameState>,
  previous: LeaderboardEntry[] = [],
): LeaderboardEntry[] {
  const previousRank = new Map(previous.map((entry) => [entry.playerId, entry.rank]));
  return rankPlayers(players).map((player) => {
    const before = previousRank.get(player.playerId);
    return {
      rank: player.rank,
      playerId: player.playerId,
      displayName: player.displayName,
      walletAddress: player.walletAddress,
      score: player.score,
      balanceWei: player.currentGameBalanceWei,
      eliminated: player.eliminated,
      correctCount: player.correctCount,
      wrongCount: player.wrongCount,
      timeoutCount: player.timeoutCount,
      delta: before === undefined ? 0 : before - player.rank,
    };
  });
}

/** Apply computed ranks back onto the authoritative player map. */
export function applyRanks(
  players: Record<string, PlayerGameState>,
): Record<string, PlayerGameState> {
  const ranked = rankPlayers(players);
  const next: Record<string, PlayerGameState> = {};
  for (const player of ranked) next[player.playerId] = player;
  return next;
}
