import { economy } from '@/lib/config';
import { getStore } from '@/lib/store';
import { emitEvent, emitEvents } from '@/server/events';
import { newId, newRoomCode } from '@/lib/util/ids';
import { buildSeedChallengeSet } from '@/lib/content';
import type { SessionUser } from '@/lib/auth/session';
import type {
  Challenge,
  PlayerGameState,
  RoomConfig,
  RoomState,
  Settlement,
} from '@/lib/types';
import type { CreateRoomInput } from '@/lib/validation';

/**
 * Room lifecycle: creation, joining, and the treasury accounting that governs
 * who is allowed in.
 *
 * Every mutation here goes through the store's compare-and-swap update, so two
 * players tapping Join at the same instant can never both take the last seat.
 */

export const EMPTY_SETTLEMENT: Settlement = {
  status: 'NOT_STARTED',
  prizePoolWei: '0',
  totalPrizeAllocatedWei: '0',
  totalRefundWei: '0',
  totalAllocatedWei: '0',
  items: [],
  txHash: null,
  error: null,
  preparedAt: null,
  finalizedAt: null,
};

export class RoomError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Wei this room reserves from the demo treasury for a full house. */
function reservationFor(maxPlayers: number): bigint {
  return economy.playerAllocationWei * BigInt(maxPlayers);
}

/**
 * What a room should be holding against the demo budget, given where it is.
 *
 *   LOBBY        a full house — anyone may still scan the code, and a join must
 *                never fail for lack of funds once the room exists
 *   RUNNING /
 *   PAUSED       exactly the players who actually joined; the door is shut, so
 *                the empty seats are no longer anyone's claim on the budget
 *   anything     nothing. The game is over.
 *   else
 *
 * The last case is the one that was missing. A room that ended parked itself in
 * FINALIZING and, if settlement never completed, held its full-house
 * reservation there forever — four abandoned rooms were sitting on 16 of the 30
 * MON cap. The budget is a cap on what *may still be committed*, so a finished
 * game has no business holding any of it: settlement pays out of the treasury
 * account itself and never consults this number.
 */
export function reservationForState(room: RoomState): bigint {
  switch (room.status) {
    case 'LOBBY':
      return reservationFor(room.config.maxPlayers);
    case 'RUNNING':
    case 'PAUSED':
      return economy.playerAllocationWei * BigInt(Object.keys(room.players).length);
    default:
      return 0n;
  }
}

/**
 * Bring a room's reservation back in line with its status.
 *
 * Call this inside a room mutator, immediately after `status` changes — the
 * value is derived, so there is no second source of truth to drift.
 */
export function syncReservation(state: RoomState): void {
  state.reservedTreasuryWei = reservationForState(state).toString();
}

export interface TreasurySnapshot {
  totalWei: bigint;
  reservedWei: bigint;
  availableWei: bigint;
}

export async function readTreasury(): Promise<TreasurySnapshot> {
  const reservedWei = await getStore().reservedTreasuryWei();
  const totalWei = economy.totalTreasuryWei;
  const availableWei = totalWei > reservedWei ? totalWei - reservedWei : 0n;
  return { totalWei, reservedWei, availableWei };
}

// ------------------------------------------------------------------- create

export async function createRoom(
  host: SessionUser,
  input: CreateRoomInput,
): Promise<RoomState> {
  const store = getStore();
  const treasury = await readTreasury();
  const reserved = reservationFor(input.maxPlayers);

  // The demo has a hard 25 MON budget. A room that cannot be funded is never
  // created, so joining can never fail for lack of funds mid-demo.
  if (reserved > treasury.availableWei) {
    const maxAffordable = Number(treasury.availableWei / economy.playerAllocationWei);
    throw new RoomError(
      maxAffordable > 0
        ? `The demo treasury can only fund ${maxAffordable} more player${maxAffordable === 1 ? '' : 's'}. Lower the room capacity.`
        : 'The demo treasury is fully committed to other rooms. Complete or cancel one first.',
      409,
      'TREASURY_EXHAUSTED',
    );
  }

  const config: RoomConfig = {
    name: input.name,
    mode: input.mode,
    topic: input.topic,
    difficulty: input.difficulty,
    questionCount: input.questionCount,
    questionType: 'MULTIPLE_CHOICE',
    maxPlayers: input.maxPlayers,
    aiGameMasterEnabled: input.aiGameMasterEnabled,
  };

  const room: RoomState = {
    id: newId('room'),
    code: newRoomCode(),
    hostId: host.id,
    hostName: host.displayName,
    status: 'LOBBY',
    phase: 'LOBBY',
    config,
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    reservedTreasuryWei: reserved.toString(),
    prizePoolWei: '0',
    players: {},
    // Seed the room with an approved set immediately so the host can start
    // straight away; AI generation replaces or extends it on demand.
    challenges: buildSeedChallengeSet({
      mode: config.mode,
      topic: config.topic,
      difficulty: config.difficulty,
      count: config.questionCount,
      shuffleKey: `${host.id}:${Date.now()}`,
    }),
    rounds: [],
    currentRound: 0,
    phaseEndsAt: null,
    leaderboard: [],
    aiDecisions: [],
    settlement: { ...EMPTY_SETTLEMENT },
    version: 0,
    pausedAt: null,
  };

  // Room codes are random; retry the rare collision rather than failing.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const created = await store.createRoom(room);
      await emitEvent(created.id, {
        type: 'ROOM_CREATED',
        level: 'INFO',
        message: `Room ${created.code} created`,
        payload: {
          room: created.code,
          mode: config.mode,
          topic: config.topic,
          maxPlayers: config.maxPlayers,
          host: host.displayName,
        },
      });
      return created;
    } catch (error) {
      if (attempt === 4) throw error;
      room.code = newRoomCode();
    }
  }
  throw new RoomError('Could not allocate a room code', 500, 'ROOM_CODE');
}

// --------------------------------------------------------------------- read

export async function getRoomOr404(roomId: string): Promise<RoomState> {
  const room = await getStore().getRoomById(roomId);
  if (!room) throw new RoomError('Room not found', 404, 'ROOM_NOT_FOUND');
  return room;
}

export async function getRoomByCodeOr404(code: string): Promise<RoomState> {
  const room = await getStore().getRoomByCode(code);
  if (!room) throw new RoomError('Room not found', 404, 'ROOM_NOT_FOUND');
  return room;
}

export function assertHost(room: RoomState, user: SessionUser): void {
  // Room ownership is the primary check; an allowlisted admin can also operate
  // any room, which is what makes the live event recoverable if a host drops.
  if (room.hostId !== user.id && user.role !== 'ADMIN') {
    throw new RoomError('You do not control this room', 403, 'NOT_HOST');
  }
}

// --------------------------------------------------------------------- join

export function newPlayerState(user: SessionUser): PlayerGameState {
  return {
    playerId: user.id,
    displayName: user.displayName,
    walletAddress: user.walletAddress,
    avatarUrl: user.avatarUrl,
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
    joinedAt: Date.now(),
  };
}

export interface JoinResult {
  room: RoomState;
  alreadyJoined: boolean;
}

/**
 * Join a room.
 *
 * Idempotent: re-joining from a second tab, or after a reconnect, returns the
 * existing membership rather than re-allocating funds. The allocation amount is
 * fixed server-side and can never be influenced by the client.
 */
export async function joinRoom(roomId: string, user: SessionUser): Promise<JoinResult> {
  let alreadyJoined = false;
  let seatTaken = false;

  const updated = await getStore().updateRoom(roomId, (room) => {
    if (room.players[user.id]) {
      alreadyJoined = true;
      // Keep the display name fresh without touching any economic state.
      room.players[user.id].displayName = user.displayName;
      room.players[user.id].walletAddress = user.walletAddress;
      room.players[user.id].avatarUrl = user.avatarUrl;
      return room;
    }

    if (room.status === 'COMPLETED' || room.status === 'CANCELLED') {
      throw new RoomError('This game has already finished', 409, 'ROOM_FINISHED');
    }
    if (room.status !== 'LOBBY') {
      throw new RoomError('This game has already started', 409, 'ROOM_STARTED');
    }
    if (Object.keys(room.players).length >= room.config.maxPlayers) {
      seatTaken = true;
      return null;
    }

    room.players[user.id] = newPlayerState(user);
    // Half of every allocation seeds the prize pool the moment a player joins.
    room.prizePoolWei = (
      BigInt(room.prizePoolWei) + economy.prizePoolContributionWei
    ).toString();
    return room;
  });

  if (seatTaken) {
    throw new RoomError('This room is full', 409, 'ROOM_FULL');
  }
  if (!updated) {
    throw new RoomError('Room not found', 404, 'ROOM_NOT_FOUND');
  }

  if (!alreadyJoined) {
    await emitEvents(
      updated.id,
      [
        {
          type: 'PLAYER_JOINED',
          level: 'PLAYER',
          message: `${user.displayName} joined`,
          payload: {
            name: user.displayName,
            wallet: shortWallet(user.walletAddress),
            players: Object.keys(updated.players).length,
          },
        },
        {
          type: 'LOBBY_UPDATED',
          level: 'INFO',
          message: `Lobby at ${Object.keys(updated.players).length}/${updated.config.maxPlayers}`,
          payload: {
            players: Object.keys(updated.players).length,
            max: updated.config.maxPlayers,
            prizePool: updated.prizePoolWei,
          },
        },
      ],
      { version: updated.version },
    );
  }

  return { room: updated, alreadyJoined };
}

/** Leave the lobby. Only permitted before the game starts. */
export async function leaveRoom(roomId: string, user: SessionUser): Promise<RoomState | null> {
  let removed = false;
  const updated = await getStore().updateRoom(roomId, (room) => {
    if (room.status !== 'LOBBY' || !room.players[user.id]) return null;
    delete room.players[user.id];
    const pool = BigInt(room.prizePoolWei) - economy.prizePoolContributionWei;
    room.prizePoolWei = (pool > 0n ? pool : 0n).toString();
    removed = true;
    return room;
  });
  if (removed && updated) {
    await emitEvent(
      updated.id,
      {
        type: 'PLAYER_LEFT',
        level: 'PLAYER',
        message: `${user.displayName} left the lobby`,
        payload: { name: user.displayName, players: Object.keys(updated.players).length },
      },
      { version: updated.version },
    );
  }
  return updated;
}

// ---------------------------------------------------------------- questions

/** Replace the room's challenge set. Only valid before the game starts. */
export async function setChallenges(
  roomId: string,
  challenges: Challenge[],
): Promise<RoomState> {
  const updated = await getStore().updateRoom(roomId, (room) => {
    if (room.status !== 'LOBBY' && room.status !== 'DRAFT') {
      throw new RoomError('Questions are locked once the game starts', 409, 'GAME_STARTED');
    }
    room.challenges = challenges;
    return room;
  });
  if (!updated) throw new RoomError('Room not found', 404, 'ROOM_NOT_FOUND');
  return updated;
}

export function approvedChallenges(room: RoomState): Challenge[] {
  return room.challenges.filter((challenge) => challenge.status === 'APPROVED');
}

/**
 * A room is startable when it has at least one player and enough approved
 * content to fill the configured round count.
 */
export function startBlockers(room: RoomState): string[] {
  const blockers: string[] = [];
  if (Object.keys(room.players).length === 0) blockers.push('No players have joined yet');
  const approved = approvedChallenges(room).length;
  if (approved === 0) blockers.push('No approved questions');
  else if (approved < room.config.questionCount) {
    blockers.push(
      `Only ${approved} of ${room.config.questionCount} questions are approved`,
    );
  }
  if (room.status !== 'LOBBY') blockers.push(`Room is ${room.status.toLowerCase()}`);
  return blockers;
}

export function shortWallet(address: string): string {
  if (!address || address.length < 12) return address || 'unassigned';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
