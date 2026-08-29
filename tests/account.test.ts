import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { economy, gameRules } from '@/lib/config';
import { MemoryStore } from '@/lib/store/memory';
import { setStore } from '@/lib/store';
import type { SessionUser } from '@/lib/auth/session';

/**
 * The account surface: a player's history, their balance, and cashing out
 * across several games at once.
 *
 * These run against the real room/settlement services on the in-memory store,
 * so what is asserted here is the same aggregation the dashboard shows.
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

function player(index: number): SessionUser {
  return {
    id: `player-${index}`,
    displayName: `Player ${index}`,
    email: null,
    walletAddress: `0x${String(index).padStart(40, '2')}`,
    avatarUrl: null,
    provider: 'guest',
    role: 'PLAYER',
  };
}

const ALICE = player(1);
const BOB = player(2);
const OUTSIDER = player(9);

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

async function createRoom(name: string) {
  const { createRoom } = await import('@/server/rooms');
  return createRoom(HOST, {
    name,
    mode: 'QUIZ',
    topic: 'Web3',
    difficulty: 3,
    questionCount: 3,
    maxPlayers: 5,
    aiGameMasterEnabled: false,
  } as never);
}

/** Play a room from lobby to a finalised, claimable settlement. */
async function playToSettlement(name: string, users: SessionUser[]) {
  const { joinRoom } = await import('@/server/rooms');
  const { startGame, advanceGame, submitAnswer, currentChallenge } = await import(
    '@/server/game'
  );
  const { prepareSettlement, submitSettlement } = await import('@/server/settlement');

  const room = await createRoom(name);
  for (const user of users) await joinRoom(room.id, user);

  await startGame(room.id);
  vi.advanceTimersByTime(gameRules.countdownMs + 10);

  for (let roundNumber = 1; roundNumber <= 3; roundNumber += 1) {
    await advanceGame(room.id);

    const open = await store.getRoomById(room.id);
    const correct = currentChallenge(open!)!.correctAnswerIndex;

    // The first player answers correctly every round and the rest do not, so
    // the final ranking — and therefore every payout — is deterministic.
    vi.advanceTimersByTime(2_000);
    for (const [position, user] of users.entries()) {
      const live = await store.getRoomById(room.id);
      await submitAnswer(live!, user, {
        roundNumber,
        answerIndex: position === 0 ? correct : (correct + 1) % 4,
      });
    }

    vi.advanceTimersByTime(gameRules.roundDurationMs);
    await advanceGame(room.id);
    vi.advanceTimersByTime(gameRules.intermissionMs + 10);
  }

  const { room: finished } = await advanceGame(room.id);
  expect(finished.status).toBe('FINALIZING');

  await prepareSettlement(room.id);
  const settled = await submitSettlement(room.id);
  expect(settled.settlement.status).toBe('OFF_CHAIN');
  return room.id;
}

describe('account overview', () => {
  it('lists rooms the user hosted and rooms they only played in', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { buildAccountOverview } = await import('@/server/account');

    const hosted = await createRoom('Hosted room');
    await joinRoom(hosted.id, ALICE);

    const other = await createRoom('Someone else’s room');
    await joinRoom(other.id, ALICE);

    const forAlice = await buildAccountOverview(ALICE);
    expect(forAlice.games).toHaveLength(2);
    expect(forAlice.games.every((game) => game.played)).toBe(true);
    expect(forAlice.games.every((game) => game.hosted)).toBe(false);
    expect(forAlice.stats.gamesPlayed).toBe(2);
    expect(forAlice.stats.gamesHosted).toBe(0);

    const forHost = await buildAccountOverview(HOST);
    expect(forHost.games).toHaveLength(2);
    expect(forHost.games.every((game) => game.hosted)).toBe(true);
    // The host never joined, so they have no player row in either room.
    expect(forHost.games.every((game) => game.me === null)).toBe(true);
    expect(forHost.stats.gamesHosted).toBe(2);
  });

  it('shows nothing to a user who has neither hosted nor joined', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { buildAccountOverview } = await import('@/server/account');

    const room = await createRoom('Private');
    await joinRoom(room.id, ALICE);

    const overview = await buildAccountOverview(OUTSIDER);
    expect(overview.games).toHaveLength(0);
    expect(overview.wallet.claimableWei).toBe('0');
    expect(overview.stats.gamesPlayed).toBe(0);
  });

  it('counts a room the user both hosts and plays exactly once', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { buildAccountOverview } = await import('@/server/account');

    const room = await createRoom('Playing host');
    await joinRoom(room.id, HOST);

    const overview = await buildAccountOverview(HOST);
    expect(overview.games).toHaveLength(1);
    expect(overview.games[0].hosted).toBe(true);
    expect(overview.games[0].played).toBe(true);
  });

  it('reports a locked balance while a game is still running', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { startGame } = await import('@/server/game');
    const { buildAccountOverview } = await import('@/server/account');

    const room = await createRoom('Live');
    await joinRoom(room.id, ALICE);
    await joinRoom(room.id, BOB);
    await startGame(room.id);

    const overview = await buildAccountOverview(ALICE);
    expect(BigInt(overview.wallet.lockedWei)).toBe(economy.startingGameBalanceWei);
    // Nothing is claimable until the game is settled.
    expect(overview.wallet.claimableWei).toBe('0');
    expect(overview.wallet.claimableGames).toBe(0);
  });

  it('makes a settled payout claimable, and stops counting it once claimed', async () => {
    const { buildAccountOverview } = await import('@/server/account');
    const { claimPayout } = await import('@/server/settlement');

    const roomId = await playToSettlement('Settled', [ALICE, BOB]);

    const before = await buildAccountOverview(ALICE);
    expect(before.wallet.claimableGames).toBe(1);
    expect(BigInt(before.wallet.claimableWei)).toBeGreaterThan(0n);
    expect(before.wallet.cashedOutWei).toBe('0');
    expect(before.games[0].me?.claimable).toBe(true);
    // A finished game holds nothing back.
    expect(before.wallet.lockedWei).toBe('0');

    await claimPayout(roomId, ALICE);

    const after = await buildAccountOverview(ALICE);
    expect(after.wallet.claimableWei).toBe('0');
    expect(after.wallet.claimableGames).toBe(0);
    expect(BigInt(after.wallet.cashedOutWei)).toBe(BigInt(before.wallet.claimableWei));
    expect(after.games[0].me?.claimed).toBe(true);
  });
});

describe('cash out across games', () => {
  it('claims every settled game in one call and reports each one', async () => {
    const { cashOutAll, buildAccountOverview } = await import('@/server/account');

    await playToSettlement('Night one', [ALICE, BOB]);
    await playToSettlement('Night two', [ALICE, BOB]);

    const before = await buildAccountOverview(ALICE);
    expect(before.wallet.claimableGames).toBe(2);

    const destination = '0x00000000000000000000000000000000000000aa';
    const result = await cashOutAll(ALICE, destination);

    expect(result.entries).toHaveLength(2);
    expect(result.entries.every((entry) => entry.ok)).toBe(true);
    expect(BigInt(result.sentWei)).toBe(BigInt(before.wallet.claimableWei));

    const after = await buildAccountOverview(ALICE);
    expect(after.wallet.claimableWei).toBe('0');
    expect(after.games.every((game) => game.me?.claimed)).toBe(true);
    // The destination is recorded per game, so a payout is auditable.
    expect(after.games.every((game) => game.me?.claimedTo === destination)).toBe(true);
  });

  it('refuses a second cash-out once everything is claimed', async () => {
    const { cashOutAll } = await import('@/server/account');

    await playToSettlement('Only game', [ALICE, BOB]);
    await cashOutAll(ALICE, ALICE.walletAddress);

    await expect(cashOutAll(ALICE, ALICE.walletAddress)).rejects.toThrow(
      /nothing to cash out/i,
    );
  });

  it('refuses to cash out a game that has not settled', async () => {
    const { joinRoom } = await import('@/server/rooms');
    const { cashOutAll } = await import('@/server/account');

    const room = await createRoom('Unsettled');
    await joinRoom(room.id, ALICE);

    await expect(cashOutAll(ALICE, ALICE.walletAddress)).rejects.toThrow(
      /nothing to cash out/i,
    );
  });
});
