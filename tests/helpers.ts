import { economy } from '@/lib/config';
import type { PlayerGameState, RoundRecord, AnswerRecord } from '@/lib/types';

/** Test fixtures shared across the engine, settlement and API suites. */

export function makePlayer(
  id: string,
  overrides: Partial<PlayerGameState> = {},
): PlayerGameState {
  return {
    playerId: id,
    displayName: id,
    walletAddress: `0x${id.padEnd(40, '0').slice(0, 40)}`,
    avatarUrl: null,
    score: 0,
    correctCount: 0,
    wrongCount: 0,
    timeoutCount: 0,
    penaltyTotalWei: '0',
    startingGameBalanceWei: economy.startingGameBalanceWei.toString(),
    currentGameBalanceWei: economy.startingGameBalanceWei.toString(),
    eliminated: false,
    eliminatedAtRound: null,
    rank: 0,
    joinedAt: 1_700_000_000_000,
    ...overrides,
  };
}

export function makePlayers(
  entries: Array<[string, Partial<PlayerGameState>?]>,
): Record<string, PlayerGameState> {
  const players: Record<string, PlayerGameState> = {};
  entries.forEach(([id, overrides], index) => {
    players[id] = makePlayer(id, { joinedAt: 1_700_000_000_000 + index, ...overrides });
  });
  return players;
}

export const ROUND_START = 1_700_000_100_000;

export function makeRound(overrides: Partial<RoundRecord> = {}): RoundRecord {
  return {
    roundNumber: 1,
    challengeId: 'q_1',
    startedAt: ROUND_START,
    endsAt: ROUND_START + 10_000,
    gradedAt: null,
    difficulty: 3,
    topic: 'Web3',
    ...overrides,
  };
}

export function makeAnswer(
  playerId: string,
  answerIndex: number,
  msIntoRound: number,
  roundNumber = 1,
): AnswerRecord {
  return {
    roundNumber,
    playerId,
    answerIndex,
    receivedAt: ROUND_START + msIntoRound,
    clientTs: null,
    correct: null,
    scoreAwarded: 0,
    penaltyWei: '0',
  };
}

export const MON = 10n ** 18n;
