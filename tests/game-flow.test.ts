import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { economy, gameRules } from '@/lib/config';
import { MemoryStore } from '@/lib/store/memory';
import { setStore } from '@/lib/store';
import type { SessionUser } from '@/lib/auth/session';

/**
 * End-to-end engine tests against the real services, backed by the in-memory
 * store. These exercise the paths a live room actually takes: create, join,
 * start, answer, grade, eliminate, finish, settle, claim.
 */

const HOST: SessionUser = {
  id: 'host-1',
  displayName: 'Host',
  email: 'host@example.com',
  walletAddress: '0x1111111111111111111111111111111111111111',
  avatarUrl: null,
  provider: 'guest',
  role: 'ADMIN',
};

function player(index: number, role: SessionUser['role'] = 'PLAYER'): SessionUser {
  return {
    id: `player-${index}`,
    displayName: `Player ${index}`,
    email: null,
    walletAddress: `0x${String(index).padStart(40, '2')}`,
    avatarUrl: null,
    provider: 'guest',
    role,
  };
}

let store: MemoryStore;

beforeEach(() => {
  store = new MemoryStore();
  setStore(store);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-01T19:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  setStore(null);
});

async function createRoom(overrides: Record<string, unknown> = {}) {
  const { createRoom } = await import('@/server/rooms');
  return createRoom(HOST, {
    name: 'Test Room',
    mode: 'QUIZ',
    topic: 'Web3',
    difficulty: 3,
    questionCount: 4,
    maxPlayers: 10,
    aiGameMasterEnabled: false,
    ...overrides,
  } as never);
}

/** Push the clock past the current round deadline and let the engine catch up. */
async function runRound(roomId: string, answers: Array<[SessionUser, number]>) {
  const { advanceGame, submitAnswer } = await import('@/server/game');

  let { room } = await advanceGame(roomId);
  expect(room.phase).toBe('ROUND_ACTIVE');

  vi.advanceTimersByTime(2_000);
  for (const [user, index] of answers) {
    const fresh = await store.getRoomById(roomId);
    await submitAnswer(fresh!, user, {
      roundNumber: room.currentRound,
      answerIndex: index,
    });
  }

  vi.advanceTimersByTime(gameRules.roundDurationMs);
  ({ room } = await advanceGame(roomId));
  return room;
}

/** Correct index for the round currently on screen. */
async function correctIndex(roomId: string): Promise<number> {
  const { currentChallenge } = await import('@/server/game');
  const room = await store.getRoomById(roomId);
  return currentChallenge(room!)!.correctAnswerIndex;
}

describe('room lifecycle', () => {
  it('creates a room in the lobby with a seeded, approved question set', async () => {
    const room = await createRoom();
    expect(room.status).toBe('LOBBY');
    expect(room.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(room.challenges).toHaveLength(4);
    expect(room.challenges.every((q) => q.status === 'APPROVED')).toBe(true);
    expect(BigInt(room.reservedTreasuryWei)).toBe(economy.playerAllocationWei * 10n);
  });

  it('seeds the prize pool with half of every allocation as players join', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const room = await createRoom();

    await joinRoom(room.id, player(1));
    await joinRoom(room.id, player(2));

    const updated = await store.getRoomById(room.id);
    expect(Object.keys(updated!.players)).toHaveLength(2);
    expect(BigInt(updated!.prizePoolWei)).toBe(economy.prizePoolContributionWei * 2n);
    expect(BigInt(updated!.players['player-1'].currentGameBalanceWei)).toBe(
      economy.startingGameBalanceWei,
    );
  });

  it('is idempotent on re-join and does not double-allocate', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const room = await createRoom();

    await joinRoom(room.id, player(1));
    const second = await joinRoom(room.id, player(1));

    expect(second.alreadyJoined).toBe(true);
    const updated = await store.getRoomById(room.id);
    expect(Object.keys(updated!.players)).toHaveLength(1);
    expect(BigInt(updated!.prizePoolWei)).toBe(economy.prizePoolContributionWei);
  });

  it('rejects a join once the room is full', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const room = await createRoom({ maxPlayers: 2 });

    await joinRoom(room.id, player(1));
    await joinRoom(room.id, player(2));

    await expect(joinRoom(room.id, player(3))).rejects.toThrow(/full/i);
  });

  it('refuses a room the demo treasury cannot fund', async () => {
    await createRoom({ maxPlayers: 25 });
    await expect(createRoom({ maxPlayers: 25 })).rejects.toThrow(/treasury/i);
  });

  it('refuses to start without players or approved questions', async () => {
    const { startGame } = await import('@/server/game');
    const { joinRoom, setChallenges } = await import('@/server/rooms');
    const room = await createRoom();

    await expect(startGame(room.id)).rejects.toThrow(/player/i);

    await joinRoom(room.id, player(1));
    await setChallenges(
      room.id,
      room.challenges.map((q) => ({ ...q, status: 'REJECTED' as const })),
    );
    await expect(startGame(room.id)).rejects.toThrow(/approved/i);
  });

  it('rejects a join after the game has started', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { startGame } = await import('@/server/game');
    const room = await createRoom();

    await joinRoom(room.id, player(1));
    await startGame(room.id);

    await expect(joinRoom(room.id, player(2))).rejects.toThrow(/already started/i);
  });
});

describe('authorisation', () => {
  it('lets the owning host control the room', async () => {
    const { assertHost } = await import('@/server/rooms');
    const room = await createRoom();
    expect(() => assertHost(room, HOST)).not.toThrow();
  });

  it('rejects a player trying to control a room they do not own', async () => {
    const { assertHost } = await import('@/server/rooms');
    const room = await createRoom();
    expect(() => assertHost(room, player(1))).toThrow(/do not control/i);
  });

  it('lets an admin operate any room', async () => {
    const { assertHost } = await import('@/server/rooms');
    const room = await createRoom();
    expect(() => assertHost(room, player(9, 'ADMIN'))).not.toThrow();
  });
});

describe('answer handling', () => {
  it('rejects a second answer from the same player in one round', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { advanceGame, startGame, submitAnswer } = await import('@/server/game');
    const room = await createRoom();
    const alice = player(1);

    await joinRoom(room.id, alice);
    await startGame(room.id);
    vi.advanceTimersByTime(gameRules.countdownMs + 10);
    const { room: live } = await advanceGame(room.id);

    const first = await submitAnswer(live, alice, { roundNumber: 1, answerIndex: 0 });
    expect(first.accepted).toBe(true);

    const fresh = await store.getRoomById(room.id);
    const second = await submitAnswer(fresh!, alice, { roundNumber: 1, answerIndex: 1 });
    expect(second.accepted).toBe(false);
    expect(second.duplicate).toBe(true);
  });

  it('rejects an answer for a round that already closed', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { advanceGame, startGame, submitAnswer } = await import('@/server/game');
    const room = await createRoom();
    const alice = player(1);

    await joinRoom(room.id, alice);
    await startGame(room.id);
    vi.advanceTimersByTime(gameRules.countdownMs + 10);
    await advanceGame(room.id);

    vi.advanceTimersByTime(gameRules.roundDurationMs + gameRules.submissionGraceMs + 100);
    const { room: closed } = await advanceGame(room.id);

    const result = await submitAnswer(closed, alice, { roundNumber: 1, answerIndex: 0 });
    expect(result.accepted).toBe(false);
  });

  it('rejects an answer from someone who is not in the room', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { advanceGame, startGame, submitAnswer } = await import('@/server/game');
    const room = await createRoom();

    await joinRoom(room.id, player(1));
    await startGame(room.id);
    vi.advanceTimersByTime(gameRules.countdownMs + 10);
    const { room: live } = await advanceGame(room.id);

    const result = await submitAnswer(live, player(99), { roundNumber: 1, answerIndex: 0 });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/not in this room/i);
  });

  it('rejects an out-of-range answer index', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { advanceGame, startGame, submitAnswer } = await import('@/server/game');
    const room = await createRoom();
    const alice = player(1);

    await joinRoom(room.id, alice);
    await startGame(room.id);
    vi.advanceTimersByTime(gameRules.countdownMs + 10);
    const { room: live } = await advanceGame(room.id);

    const result = await submitAnswer(live, alice, { roundNumber: 1, answerIndex: 7 });
    expect(result.accepted).toBe(false);
  });
});

describe('full game', () => {
  it('plays through, eliminates, finalises and settles', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { startGame, advanceGame } = await import('@/server/game');
    const { prepareSettlement, submitSettlement, claimPayout } = await import(
      '@/server/settlement'
    );

    const room = await createRoom({ questionCount: 5, maxPlayers: 3 });
    const [alice, bob, carol] = [player(1), player(2), player(3)];
    for (const user of [alice, bob, carol]) await joinRoom(room.id, user);

    await startGame(room.id);
    vi.advanceTimersByTime(gameRules.countdownMs + 10);

    for (let roundNumber = 1; roundNumber <= 5; roundNumber += 1) {
      await advanceGame(room.id);
      const correct = await correctIndex(room.id);
      const wrong = (correct + 1) % 4;
      // Alice always right, Bob always wrong (eliminated on round 5),
      // Carol never answers (also eliminated on round 5).
      await runRound(room.id, [
        [alice, correct],
        [bob, wrong],
      ]);
      vi.advanceTimersByTime(gameRules.intermissionMs + 10);
    }

    const { room: finished } = await advanceGame(room.id);
    expect(finished.status).toBe('FINALIZING');
    expect(finished.rounds).toHaveLength(5);

    const alicesState = finished.players[alice.id];
    expect(alicesState.correctCount).toBe(5);
    expect(alicesState.eliminated).toBe(false);
    expect(alicesState.rank).toBe(1);

    expect(finished.players[bob.id].eliminated).toBe(true);
    expect(finished.players[bob.id].currentGameBalanceWei).toBe('0');
    expect(finished.players[carol.id].eliminated).toBe(true);
    expect(finished.players[carol.id].timeoutCount).toBe(5);

    // Pool = 3 contributions + every penalty actually collected.
    const expectedPool = economy.prizePoolContributionWei * 3n + economy.penaltyWei * 10n;
    expect(BigInt(finished.prizePoolWei)).toBe(expectedPool);

    const prepared = await prepareSettlement(room.id);
    expect(prepared.settlement.status).toBe('PREPARED');
    expect(BigInt(prepared.settlement.totalAllocatedWei)).toBe(
      economy.playerAllocationWei * 3n,
    );

    // No treasury key configured in tests, so this settles off-chain.
    const settled = await submitSettlement(room.id);
    expect(settled.settlement.status).toBe('OFF_CHAIN');
    expect(settled.status).toBe('COMPLETED');

    const claim = await claimPayout(room.id, alice);
    expect(BigInt(claim.item.totalPayoutWei)).toBeGreaterThan(0n);

    await expect(claimPayout(room.id, alice)).rejects.toThrow(/already cashed out/i);
  });

  it('blocks cash-out while the game is still running', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { startGame } = await import('@/server/game');
    const { claimPayout } = await import('@/server/settlement');

    const room = await createRoom();
    const alice = player(1);
    await joinRoom(room.id, alice);
    await startGame(room.id);

    await expect(claimPayout(room.id, alice)).rejects.toThrow(/complete/i);
  });

  it('pauses and resumes without stealing time from the live round', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { advanceGame, pauseGame, resumeGame, startGame } = await import('@/server/game');

    const room = await createRoom();
    await joinRoom(room.id, player(1));
    await startGame(room.id);
    vi.advanceTimersByTime(gameRules.countdownMs + 10);
    const { room: live } = await advanceGame(room.id);
    const originalEnd = live.rounds[0].endsAt;

    vi.advanceTimersByTime(3_000);
    await pauseGame(room.id);
    vi.advanceTimersByTime(30_000);
    const resumed = await resumeGame(room.id);

    expect(resumed.status).toBe('RUNNING');
    expect(resumed.rounds[0].endsAt).toBeGreaterThan(originalEnd + 29_000);
  });

  it('ends early when the host stops the game', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { endGame, startGame } = await import('@/server/game');

    const room = await createRoom();
    await joinRoom(room.id, player(1));
    await startGame(room.id);

    const ended = await endGame(room.id);
    expect(ended.status).toBe('FINALIZING');
  });

  it('cancels a room that never started', async () => {
    const { endGame } = await import('@/server/game');
    const room = await createRoom();
    const ended = await endGame(room.id);
    expect(ended.status).toBe('CANCELLED');
  });
});

describe('room isolation', () => {
  it('keeps players, state and events scoped to their own room', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const roomA = await createRoom({ name: 'A', maxPlayers: 5 });
    const roomB = await createRoom({ name: 'B', maxPlayers: 5 });

    await joinRoom(roomA.id, player(1));
    await joinRoom(roomB.id, player(2));

    const a = await store.getRoomById(roomA.id);
    const b = await store.getRoomById(roomB.id);

    expect(Object.keys(a!.players)).toEqual(['player-1']);
    expect(Object.keys(b!.players)).toEqual(['player-2']);
    expect(a!.code).not.toBe(b!.code);

    const eventsA = await store.listEvents(roomA.id);
    expect(eventsA.every((event) => event.roomId === roomA.id)).toBe(true);
    expect(eventsA.some((event) => event.message.includes('Player 2'))).toBe(false);
  });

  it('runs two rooms concurrently without interference', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { advanceGame, startGame } = await import('@/server/game');

    const roomA = await createRoom({ name: 'A', maxPlayers: 5 });
    const roomB = await createRoom({ name: 'B', maxPlayers: 5 });
    await joinRoom(roomA.id, player(1));
    await joinRoom(roomB.id, player(2));

    await startGame(roomA.id);
    vi.advanceTimersByTime(gameRules.countdownMs + 10);
    await advanceGame(roomA.id);

    const b = await store.getRoomById(roomB.id);
    expect(b!.status).toBe('LOBBY');
    expect(b!.currentRound).toBe(0);
  });
});

describe('concurrent transitions', () => {
  it('grades a round exactly once even when several ticks race', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { advanceGame, startGame, submitAnswer } = await import('@/server/game');

    const room = await createRoom();
    const alice = player(1);
    await joinRoom(room.id, alice);
    await startGame(room.id);
    vi.advanceTimersByTime(gameRules.countdownMs + 10);
    const { room: live } = await advanceGame(room.id);

    const correct = await correctIndex(room.id);
    vi.advanceTimersByTime(1_000);
    await submitAnswer(live, alice, { roundNumber: 1, answerIndex: correct });

    vi.advanceTimersByTime(gameRules.roundDurationMs + 100);
    await Promise.all([
      advanceGame(room.id),
      advanceGame(room.id),
      advanceGame(room.id),
    ]);

    const after = await store.getRoomById(room.id);
    // The score must reflect exactly one grading pass, not three.
    expect(after!.players[alice.id].correctCount).toBe(1);
    expect(after!.players[alice.id].score).toBeLessThanOrEqual(
      gameRules.baseScore + gameRules.maxSpeedBonus,
    );
    expect(after!.rounds.filter((round) => round.roundNumber === 1)).toHaveLength(1);
  });

  it('starts a round exactly once under concurrent advances', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { advanceGame, startGame } = await import('@/server/game');

    const room = await createRoom();
    await joinRoom(room.id, player(1));
    await startGame(room.id);
    vi.advanceTimersByTime(gameRules.countdownMs + 10);

    await Promise.all([advanceGame(room.id), advanceGame(room.id)]);
    const after = await store.getRoomById(room.id);
    expect(after!.rounds).toHaveLength(1);
    expect(after!.currentRound).toBe(1);
  });
});

describe('multi-round progression under concurrency', () => {
  /**
   * Regression: the game used to end after its first round.
   *
   * `beginRound` returned null both when content was exhausted and when
   * another request had already opened the round, and the caller treated
   * either as "nothing left to play" and finalised the game. With a host
   * dashboard ticking while every player polls, something loses that race at
   * every transition — so in practice every game died at round one.
   */
  it('plays every round when several requests race each transition', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { advanceGame, startGame, submitAnswer } = await import('@/server/game');

    const ROUNDS = 6;
    const room = await createRoom({ questionCount: ROUNDS, maxPlayers: 4 });
    const players = [player(1), player(2), player(3)];
    for (const user of players) await joinRoom(room.id, user);

    await startGame(room.id);
    vi.advanceTimersByTime(gameRules.countdownMs + 10);

    for (let round = 1; round <= ROUNDS; round += 1) {
      // Four callers hit the transition at once, as the host tick and three
      // polling players would.
      await Promise.all([
        advanceGame(room.id),
        advanceGame(room.id),
        advanceGame(room.id),
        advanceGame(room.id),
      ]);

      const open = await store.getRoomById(room.id);
      expect(open!.status, `status entering round ${round}`).toBe('RUNNING');
      expect(open!.currentRound, `round number at round ${round}`).toBe(round);

      vi.advanceTimersByTime(1_000);
      const correct = await correctIndex(room.id);
      for (const user of players) {
        const fresh = await store.getRoomById(room.id);
        await submitAnswer(fresh!, user, { roundNumber: round, answerIndex: correct });
      }

      // Close the round, again with everyone racing.
      vi.advanceTimersByTime(gameRules.roundDurationMs + 100);
      await Promise.all([advanceGame(room.id), advanceGame(room.id), advanceGame(room.id)]);
      vi.advanceTimersByTime(gameRules.intermissionMs + 10);
    }

    await Promise.all([advanceGame(room.id), advanceGame(room.id)]);
    const finished = await store.getRoomById(room.id);

    expect(finished!.rounds).toHaveLength(ROUNDS);
    expect(finished!.rounds.every((entry) => entry.gradedAt !== null)).toBe(true);
    expect(finished!.status).toBe('FINALIZING');
    // The leaderboard is rebuilt every round, not only at the end.
    expect(finished!.leaderboard).toHaveLength(players.length);
  });

  it('still finalises when the approved questions genuinely run out', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { advanceGame, startGame } = await import('@/server/game');

    const room = await createRoom({ questionCount: 4, maxPlayers: 2 });
    await joinRoom(room.id, player(1));
    await startGame(room.id);

    // Reach into the store rather than going through setChallenges, which
    // rightly refuses once a game is running. This is the defensive branch:
    // it should be unreachable in production, because a game cannot start
    // without enough approved questions and the set is locked afterwards.
    await store.updateRoom(room.id, (state) => {
      state.challenges = state.challenges.map((challenge, index) =>
        index < 2 ? challenge : { ...challenge, status: 'REJECTED' as const },
      );
      return state;
    });

    vi.advanceTimersByTime(gameRules.countdownMs + 10);
    for (let round = 1; round <= 3; round += 1) {
      await advanceGame(room.id);
      vi.advanceTimersByTime(gameRules.roundDurationMs + 100);
      await advanceGame(room.id);
      vi.advanceTimersByTime(gameRules.intermissionMs + 10);
    }
    await advanceGame(room.id);

    const finished = await store.getRoomById(room.id);
    expect(finished!.rounds).toHaveLength(2);
    expect(finished!.status).toBe('FINALIZING');
  });
});

/**
 * The demo budget is a cap on what rooms may *still* commit. Rooms that were
 * over kept holding their full-house reservation anyway — four abandoned games
 * in FINALIZING were sitting on 16 of the 30 MON cap on the live deployment,
 * and the only reason the number ever went down was a manual database edit.
 */
describe('treasury reservation', () => {
  it('holds a full house while the room is still open', async () => {
    const { readTreasury } = await import('@/server/rooms');
    const room = await createRoom({ maxPlayers: 10 });

    expect(BigInt(room.reservedTreasuryWei)).toBe(economy.playerAllocationWei * 10n);
    expect((await readTreasury()).reservedWei).toBe(economy.playerAllocationWei * 10n);
  });

  it('releases the empty seats once the game starts', async () => {
    const { joinRoom, readTreasury } = await import('@/server/rooms');
    const { startGame } = await import('@/server/game');
    const room = await createRoom({ maxPlayers: 10 });

    await joinRoom(room.id, player(1));
    await joinRoom(room.id, player(2));
    await startGame(room.id);

    // Two players took seats; the other eight can never be filled now, so the
    // budget they were holding goes back.
    expect((await readTreasury()).reservedWei).toBe(economy.playerAllocationWei * 2n);
  });

  it('releases everything the moment the game ends, before settlement', async () => {
    const { joinRoom, readTreasury } = await import('@/server/rooms');
    const { startGame, endGame } = await import('@/server/game');
    const room = await createRoom({ maxPlayers: 10 });

    await joinRoom(room.id, player(1));
    await joinRoom(room.id, player(2));
    await startGame(room.id);
    const ended = await endGame(room.id);

    // Deliberately checked at FINALIZING rather than COMPLETED: settlement pays
    // out of the treasury account, never out of this budget, so a settlement
    // that fails or is never submitted must not strand the cap.
    expect(ended.status).toBe('FINALIZING');
    expect(BigInt(ended.reservedTreasuryWei)).toBe(0n);
    expect((await readTreasury()).reservedWei).toBe(0n);
    expect((await readTreasury()).availableWei).toBe(economy.totalTreasuryWei);
  });

  it('releases a room cancelled before it ever started', async () => {
    const { readTreasury } = await import('@/server/rooms');
    const { endGame } = await import('@/server/game');
    const room = await createRoom({ maxPlayers: 10 });

    const cancelled = await endGame(room.id);
    expect(cancelled.status).toBe('CANCELLED');
    expect((await readTreasury()).reservedWei).toBe(0n);
  });
});
