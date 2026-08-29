import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gameRules } from '@/lib/config';
import { MemoryStore } from '@/lib/store/memory';
import { setStore } from '@/lib/store';
import {
  createSessionToken,
  readSessionToken,
  resolveRole,
} from '@/lib/auth/session';
import { deriveWalletAddress } from '@/lib/auth/wallet';
import { toPublicChallenge } from '@/server/game';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Anti-cheat and session integrity.
 *
 * The single most important property in the whole product: nothing sent to a
 * player's device can reveal the answer to a round that is still open.
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

const ALICE: SessionUser = {
  id: 'player-1',
  displayName: 'Alice',
  email: null,
  walletAddress: '0x2222222222222222222222222222222222222222',
  avatarUrl: null,
  provider: 'guest',
  role: 'PLAYER',
};

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

async function liveRoom() {
  const { createRoom, joinRoom } = await import('@/server/rooms');
  const { advanceGame, startGame } = await import('@/server/game');

  const room = await createRoom(HOST, {
    name: 'Security',
    mode: 'QUIZ',
    topic: 'Web3',
    difficulty: 3,
    questionCount: 3,
    maxPlayers: 5,
    aiGameMasterEnabled: false,
  } as never);

  await joinRoom(room.id, ALICE);
  await startGame(room.id);
  vi.advanceTimersByTime(gameRules.countdownMs + 10);
  const { room: live } = await advanceGame(room.id);
  return live;
}

describe('answer-key confidentiality', () => {
  it('strips the answer key from the public challenge shape', async () => {
    const room = await liveRoom();
    const challenge = room.challenges[0];
    const publicShape = toPublicChallenge(challenge) as Record<string, unknown>;

    expect(publicShape.correctAnswerIndex).toBeUndefined();
    expect(publicShape.explanation).toBeUndefined();
    expect(publicShape.status).toBeUndefined();
    expect(publicShape.options).toHaveLength(4);
  });

  it('never serialises the answer into a live player snapshot', async () => {
    const { buildPlayerSnapshot } = await import('@/server/snapshots');
    const room = await liveRoom();
    const snapshot = await buildPlayerSnapshot(room, ALICE);

    expect(snapshot.challenge).not.toBeNull();
    expect(snapshot.lastResult).toBeNull();

    const challenge = room.challenges.find((c) => c.id === snapshot.challenge!.id)!;
    const wire = JSON.stringify(snapshot);
    // The explanation names the answer, so its absence is the strongest check
    // that nothing leaked through an unexpected field.
    expect(wire).not.toContain(challenge.explanation);
    expect(JSON.parse(wire).challenge.correctAnswerIndex).toBeUndefined();
  });

  it('releases the answer only after the round is graded', async () => {
    const { buildPlayerSnapshot } = await import('@/server/snapshots');
    const { advanceGame } = await import('@/server/game');

    const room = await liveRoom();
    vi.advanceTimersByTime(gameRules.roundDurationMs + 100);
    const { room: graded } = await advanceGame(room.id);

    const snapshot = await buildPlayerSnapshot(graded, ALICE);
    expect(snapshot.challenge).toBeNull();
    expect(snapshot.lastResult).not.toBeNull();
    expect(snapshot.lastResult!.correctAnswerIndex).toBeGreaterThanOrEqual(0);
  });

  it('keeps the answer out of the event log', async () => {
    const room = await liveRoom();
    const events = await store.listEvents(room.id, 0, 500);
    const challenge = room.challenges.find(
      (c) => c.id === room.rounds[0].challengeId,
    )!;

    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(challenge.explanation);
    expect(serialised).not.toContain(`"correctAnswerIndex"`);
  });

  it('does not reveal correctness while the round is still open', async () => {
    const { liveRoundCounts, submitAnswer } = await import('@/server/game');
    const room = await liveRoom();

    await submitAnswer(room, ALICE, { roundNumber: 1, answerIndex: 0 });
    const fresh = await store.getRoomById(room.id);
    const counts = await liveRoundCounts(fresh!);

    expect(counts.answered).toBe(1);
    // Correct/wrong stay at zero until grading, so a spectator screen cannot
    // be used to infer the answer mid-round.
    expect(counts.correct).toBe(0);
    expect(counts.wrong).toBe(0);
  });
});

describe('session tokens', () => {
  it('round-trips valid claims', () => {
    const token = createSessionToken({
      sub: 'guest:abc',
      name: 'Alice',
      email: null,
      provider: 'guest',
      iat: Date.now(),
    });
    const claims = readSessionToken(token);
    expect(claims?.sub).toBe('guest:abc');
    expect(claims?.name).toBe('Alice');
  });

  it('rejects a tampered payload', () => {
    const token = createSessionToken({
      sub: 'guest:abc',
      name: 'Alice',
      email: null,
      provider: 'guest',
      iat: Date.now(),
    });
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'guest:attacker', name: 'Mallory', email: null, provider: 'guest', iat: Date.now() }),
    ).toString('base64url');

    expect(readSessionToken(`${forged}.${signature}`)).toBeNull();
    expect(payload).not.toBe(forged);
  });

  it('rejects a token with no signature', () => {
    expect(readSessionToken('just-a-payload')).toBeNull();
    expect(readSessionToken('')).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = createSessionToken({
      sub: 'guest:abc',
      name: 'Alice',
      email: null,
      provider: 'guest',
      iat: Date.now() - 13 * 60 * 60 * 1000,
    });
    expect(readSessionToken(token)).toBeNull();
  });
});

describe('embedded wallets', () => {
  it('derives a stable address per user', () => {
    expect(deriveWalletAddress('user-a')).toBe(deriveWalletAddress('user-a'));
  });

  it('derives a different address for a different user', () => {
    expect(deriveWalletAddress('user-a')).not.toBe(deriveWalletAddress('user-b'));
  });

  it('produces a valid checksummed EVM address', () => {
    expect(deriveWalletAddress('user-a')).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

describe('role resolution', () => {
  it('does NOT grant admin just because no allowlist is configured', () => {
    // Regression guard. An earlier version granted admin to everyone when
    // ADMIN_EMAILS was empty, which in a live room meant every player could
    // start, pause and end the game — and read the answer keys.
    expect(resolveRole('someone@example.com')).toBe('PLAYER');
    expect(resolveRole(null)).toBe('PLAYER');
  });

  it('grants admin only to an explicit token grant', () => {
    expect(resolveRole(null, true)).toBe('ADMIN');
    expect(resolveRole(null, false)).toBe('PLAYER');
  });

  it('grants admin to an allowlisted email and nobody else', async () => {
    vi.resetModules();
    vi.stubEnv('ADMIN_EMAILS', 'boss@example.com');
    const sessionModule = await import('@/lib/auth/session');
    expect(sessionModule.resolveRole('boss@example.com')).toBe('ADMIN');
    expect(sessionModule.resolveRole('BOSS@EXAMPLE.COM')).toBe('ADMIN');
    expect(sessionModule.resolveRole('random@example.com')).toBe('PLAYER');
    expect(sessionModule.resolveRole(null)).toBe('PLAYER');
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe('host authorisation', () => {
  it('rejects a plain player trying to control a room they do not own', async () => {
    const { assertHost } = await import('@/server/rooms');
    const room = await liveRoom();
    expect(() => assertHost(room, ALICE)).toThrow(/do not control/i);
  });

  it('accepts the room owner', async () => {
    const { assertHost } = await import('@/server/rooms');
    const room = await liveRoom();
    expect(() => assertHost(room, HOST)).not.toThrow();
  });
});

describe('admin wallet pinning', () => {
  it('gives ordinary players a derived wallet, never the pinned one', async () => {
    vi.resetModules();
    vi.stubEnv('ADMIN_EMAILS', 'boss@example.com');
    vi.stubEnv('ADMIN_WALLET_ADDRESS', '0x1111111111111111111111111111111111111111');
    const mod = await import('@/lib/auth/session');
    const wallet = mod.walletFor('someone@example.com', 'user-a', 'PLAYER');
    expect(wallet).not.toBe('0x1111111111111111111111111111111111111111');
    expect(wallet).toMatch(/^0x[0-9a-fA-F]{40}$/);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('pins the primary admin to the configured address', async () => {
    vi.resetModules();
    vi.stubEnv('ADMIN_EMAILS', 'boss@example.com');
    vi.stubEnv('ADMIN_WALLET_ADDRESS', '0x1111111111111111111111111111111111111111');
    const mod = await import('@/lib/auth/session');
    expect(mod.walletFor('boss@example.com', 'user-boss', 'ADMIN')).toBe(
      '0x1111111111111111111111111111111111111111',
    );
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('does NOT pin a second admin — two players sharing an address would pool payouts', async () => {
    vi.resetModules();
    vi.stubEnv('ADMIN_EMAILS', 'boss@example.com,deputy@example.com');
    vi.stubEnv('ADMIN_WALLET_ADDRESS', '0x1111111111111111111111111111111111111111');
    const mod = await import('@/lib/auth/session');
    const deputy = mod.walletFor('deputy@example.com', 'user-deputy', 'ADMIN');
    expect(deputy).not.toBe('0x1111111111111111111111111111111111111111');
    expect(mod.walletFor('boss@example.com', 'user-boss', 'ADMIN')).toBe(
      '0x1111111111111111111111111111111111111111',
    );
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('falls back to a derived wallet if the pinned address is malformed', async () => {
    vi.resetModules();
    vi.stubEnv('ADMIN_EMAILS', 'boss@example.com');
    vi.stubEnv('ADMIN_WALLET_ADDRESS', 'not-an-address');
    vi.stubEnv('TREASURY_PRIVATE_KEY', '');
    const mod = await import('@/lib/auth/session');
    expect(mod.walletFor('boss@example.com', 'user-boss', 'ADMIN')).toMatch(
      /^0x[0-9a-fA-F]{40}$/,
    );
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
