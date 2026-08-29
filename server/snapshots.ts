import { appConfig, economy } from '@/lib/config';
import { getStore } from '@/lib/store';
import {
  challengeForRound,
  currentChallenge,
  liveRoundCounts,
  latestMetrics,
  toPublicChallenge,
} from '@/server/game';
import { readTreasury } from '@/server/rooms';
import { getCachedBalance, getTreasuryAddress } from '@/lib/chain/client';
import { explorerTxUrl } from '@/lib/chain/monad';
import type { HostSnapshot, PlayerSnapshot, RoomState } from '@/lib/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Snapshot builders.
 *
 * These decide exactly what leaves the server for each audience. The player
 * snapshot is the security-critical one: it must never contain an answer key
 * for a round that is still open, because anything sent to a device is public.
 */

export function joinUrlFor(room: RoomState): string {
  return `${appConfig.appUrl.replace(/\/$/, '')}/join/${room.code}`;
}

export async function buildPlayerSnapshot(
  room: RoomState,
  user: SessionUser | null,
): Promise<PlayerSnapshot> {
  const me = user ? (room.players[user.id] ?? null) : null;
  const round = room.rounds.find((entry) => entry.roundNumber === room.currentRound) ?? null;
  const challenge = currentChallenge(room);
  const roundIsOpen = room.phase === 'ROUND_ACTIVE' && round !== null && round.gradedAt === null;

  let myAnswerIndex: number | null = null;
  if (user && round) {
    const answers = await getStore().listAnswers(room.id, round.roundNumber);
    myAnswerIndex = answers.find((answer) => answer.playerId === user.id)?.answerIndex ?? null;
  }

  // The answer key is released only once the round is graded and no further
  // submissions can be accepted.
  let lastResult: PlayerSnapshot['lastResult'] = null;
  if (round && round.gradedAt !== null && challenge) {
    const correct = myAnswerIndex === null ? null : myAnswerIndex === challenge.correctAnswerIndex;
    lastResult = {
      roundNumber: round.roundNumber,
      correctAnswerIndex: challenge.correctAnswerIndex,
      explanation: challenge.explanation,
      myAnswerIndex,
      myCorrect: correct,
      scoreAwarded: 0,
      penaltyWei: correct === false || (myAnswerIndex === null && me && !me.eliminated)
        ? economy.penaltyWei.toString()
        : '0',
    };
  }

  const settlementItem = user
    ? (room.settlement.items.find((item) => item.playerId === user.id) ?? null)
    : null;

  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.config.name,
      mode: room.config.mode,
      status: room.status,
      phase: room.phase,
      hostName: room.hostName,
      maxPlayers: room.config.maxPlayers,
      playerCount: Object.keys(room.players).length,
      prizePoolWei: room.prizePoolWei,
      totalRounds: room.config.questionCount,
      currentRound: room.currentRound,
      serverTime: Date.now(),
      phaseEndsAt: room.phaseEndsAt,
    },
    players: Object.values(room.players)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((player) => ({
        id: player.playerId,
        displayName: player.displayName,
        walletAddress: player.walletAddress,
        avatarUrl: player.avatarUrl ?? null,
        joinedAt: player.joinedAt,
      })),
    me,
    challenge: roundIsOpen && challenge ? toPublicChallenge(challenge) : null,
    round: round
      ? { roundNumber: round.roundNumber, startedAt: round.startedAt, endsAt: round.endsAt }
      : null,
    lastResult,
    myAnswerIndex,
    leaderboard: room.leaderboard,
    myRank: me?.rank ?? 0,
    settlement:
      room.settlement.status === 'NOT_STARTED'
        ? null
        : {
            status: room.settlement.status,
            myItem: settlementItem,
            txHash: room.settlement.txHash,
            explorerUrl: room.settlement.txHash ? explorerTxUrl(room.settlement.txHash) : null,
          },
  };
}

/**
 * The host view. This one intentionally includes answer keys and full player
 * economics — it is served only after a host/admin authorisation check.
 */
export async function buildHostSnapshot(room: RoomState): Promise<HostSnapshot> {
  const [counts, treasury] = await Promise.all([liveRoundCounts(room), readTreasury()]);
  const treasuryAddress = getTreasuryAddress();
  const onChainBalance = treasuryAddress ? await getCachedBalance(treasuryAddress) : null;

  return {
    room,
    serverTime: Date.now(),
    metrics: latestMetrics(room),
    currentChallenge:
      room.currentRound > 0 ? challengeForRound(room, room.currentRound) : null,
    joinUrl: joinUrlFor(room),
    liveCounts: counts,
    treasury: {
      totalWei: treasury.totalWei.toString(),
      reservedWei: treasury.reservedWei.toString(),
      availableWei: treasury.availableWei.toString(),
      onChainBalanceWei: onChainBalance === null ? null : onChainBalance.toString(),
      address: treasuryAddress,
    },
  };
}
