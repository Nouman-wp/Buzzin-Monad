import { getStore } from '@/lib/store';
import { claimPayout } from '@/server/settlement';
import { joinUrlFor } from '@/server/snapshots';
import { getBalance, isChainSettlementEnabled } from '@/lib/chain/client';
import { explorerAddressUrl, explorerTxUrl } from '@/lib/chain/monad';
import { RoomError } from '@/server/rooms';
import type { Address } from 'viem';
import type {
  GameMode,
  RoomState,
  RoomStatus,
  SettlementStatus,
} from '@/lib/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * The account surface: one player's history and money, across every room.
 *
 * Everything here is derived from room documents the player is actually part
 * of — hosted or joined — and from the frozen settlement inside each one. No
 * new source of truth is introduced: a payout shown on the dashboard is the
 * same `SettlementItem` the results screen and the contract agree on.
 *
 * The one thing this module adds over the per-game view is aggregation, which
 * is what makes "cash out everything I am owed" a single action instead of one
 * visit per finished game.
 */

/** Statuses in which a player's locked balance is still committed to a game. */
const ACTIVE_STATUSES: ReadonlySet<RoomStatus> = new Set<RoomStatus>([
  'DRAFT',
  'LOBBY',
  'RUNNING',
  'PAUSED',
  'FINALIZING',
]);

export interface AccountGamePlayer {
  rank: number;
  score: number;
  correctCount: number;
  wrongCount: number;
  timeoutCount: number;
  eliminated: boolean;
  eliminatedAtRound: number | null;
  /** Remaining locked game balance, wei string. */
  balanceWei: string;
  prizeWei: string;
  refundWei: string;
  payoutWei: string;
  claimed: boolean;
  claimTxHash: string | null;
  claimedTo: string | null;
  /** True when this payout can be cashed out right now. */
  claimable: boolean;
}

export interface AccountGame {
  roomId: string;
  code: string;
  name: string;
  mode: GameMode;
  status: RoomStatus;
  hostName: string;
  hosted: boolean;
  played: boolean;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  playerCount: number;
  totalRounds: number;
  roundsPlayed: number;
  prizePoolWei: string;
  settlementStatus: SettlementStatus;
  txHash: string | null;
  explorerUrl: string | null;
  joinUrl: string;
  me: AccountGamePlayer | null;
}

export interface AccountWallet {
  address: string;
  /** Settled payouts this player has not cashed out yet. */
  claimableWei: string;
  /** Payouts already sent, whether on chain or off. */
  cashedOutWei: string;
  /** Balance still locked inside games that have not finished. */
  lockedWei: string;
  /** Live native balance of the embedded address, or null if unreadable. */
  onChainBalanceWei: string | null;
  /** How many finished games still have money waiting. */
  claimableGames: number;
  chainEnabled: boolean;
  /** Explorer page for the embedded address. */
  explorerUrl: string;
}

export interface AccountStats {
  gamesPlayed: number;
  gamesHosted: number;
  wins: number;
  podiums: number;
  bestRank: number | null;
  totalScore: number;
  correct: number;
  wrong: number;
  timeouts: number;
  /** Correct answers as a fraction of rounds actually answered. */
  accuracy: number;
}

export interface AccountProfile {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  walletAddress: string;
  provider: string;
  role: string;
  /** When this account was first seen. Falls back to now for a new session. */
  createdAt: number;
}

export interface AccountOverview {
  profile: AccountProfile;
  wallet: AccountWallet;
  stats: AccountStats;
  games: AccountGame[];
}

// ------------------------------------------------------------------ reading

/**
 * Every room this user touched, most recent first.
 *
 * Hosted and played are two separate queries because they are two different
 * indexes; a host who also joins their own room appears once, with both flags
 * set.
 */
async function listRoomsForUser(userId: string): Promise<RoomState[]> {
  const store = getStore();
  const [hosted, played] = await Promise.all([
    store.listRoomsByHost(userId),
    store.listRoomsByPlayer(userId),
  ]);

  const byId = new Map<string, RoomState>();
  for (const room of [...hosted, ...played]) {
    if (!byId.has(room.id)) byId.set(room.id, room);
  }
  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/** Settlement is final and the contract will accept a claim. */
function isSettled(status: SettlementStatus): boolean {
  return status === 'CONFIRMED' || status === 'OFF_CHAIN';
}

function describeGame(room: RoomState, userId: string): AccountGame {
  const player = room.players[userId] ?? null;
  const item = room.settlement.items.find((entry) => entry.playerId === userId) ?? null;

  const me: AccountGamePlayer | null = player
    ? {
        rank: player.rank,
        score: player.score,
        correctCount: player.correctCount,
        wrongCount: player.wrongCount,
        timeoutCount: player.timeoutCount,
        eliminated: player.eliminated,
        eliminatedAtRound: player.eliminatedAtRound,
        balanceWei: player.currentGameBalanceWei,
        prizeWei: item?.prizeWei ?? '0',
        refundWei: item?.refundWei ?? '0',
        payoutWei: item?.totalPayoutWei ?? '0',
        claimed: item?.claimed ?? false,
        claimTxHash: item?.claimTxHash ?? null,
        claimedTo: item?.claimedTo ?? null,
        claimable: Boolean(
          item &&
            !item.claimed &&
            BigInt(item.totalPayoutWei) > 0n &&
            room.status === 'COMPLETED' &&
            isSettled(room.settlement.status),
        ),
      }
    : null;

  return {
    roomId: room.id,
    code: room.code,
    name: room.config.name,
    mode: room.config.mode,
    status: room.status,
    hostName: room.hostName,
    hosted: room.hostId === userId,
    played: player !== null,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    endedAt: room.endedAt,
    playerCount: Object.keys(room.players).length,
    totalRounds: room.config.questionCount,
    roundsPlayed: room.rounds.filter((round) => round.gradedAt !== null).length,
    prizePoolWei: room.prizePoolWei,
    settlementStatus: room.settlement.status,
    txHash: room.settlement.txHash,
    explorerUrl: room.settlement.txHash ? explorerTxUrl(room.settlement.txHash) : null,
    joinUrl: joinUrlFor(room),
    me,
  };
}

function summarise(games: AccountGame[]): AccountStats {
  const playedGames = games.filter((game) => game.me !== null);
  const ranked = playedGames.filter((game) => (game.me?.rank ?? 0) > 0);

  let correct = 0;
  let wrong = 0;
  let timeouts = 0;
  let totalScore = 0;
  for (const game of playedGames) {
    correct += game.me?.correctCount ?? 0;
    wrong += game.me?.wrongCount ?? 0;
    timeouts += game.me?.timeoutCount ?? 0;
    totalScore += game.me?.score ?? 0;
  }

  const answered = correct + wrong;
  return {
    gamesPlayed: playedGames.length,
    gamesHosted: games.filter((game) => game.hosted).length,
    wins: ranked.filter((game) => game.me?.rank === 1).length,
    podiums: ranked.filter((game) => (game.me?.rank ?? 99) <= 3).length,
    bestRank: ranked.length
      ? Math.min(...ranked.map((game) => game.me?.rank ?? Number.MAX_SAFE_INTEGER))
      : null,
    totalScore,
    correct,
    wrong,
    timeouts,
    // Timeouts are excluded: not answering is not a wrong answer.
    accuracy: answered === 0 ? 0 : correct / answered,
  };
}

/**
 * Build the account dashboard payload.
 *
 * The on-chain balance is read best-effort. Embedded wallets normally hold
 * nothing — claims pay straight out to whatever destination the player names,
 * so the address is an identity, not a purse — but the operator's pinned admin
 * wallet is a real funded account and reads correctly here.
 */
export async function buildAccountOverview(user: SessionUser): Promise<AccountOverview> {
  const [rooms, stored] = await Promise.all([
    listRoomsForUser(user.id),
    getStore().getProfile(user.id).catch(() => null),
  ]);
  const games = rooms.map((room) => describeGame(room, user.id));

  let claimable = 0n;
  let cashedOut = 0n;
  let locked = 0n;
  let claimableGames = 0;

  for (const game of games) {
    if (!game.me) continue;
    if (game.me.claimable) {
      claimable += BigInt(game.me.payoutWei);
      claimableGames += 1;
    }
    if (game.me.claimed) cashedOut += BigInt(game.me.payoutWei);
    if (ACTIVE_STATUSES.has(game.status)) locked += BigInt(game.me.balanceWei);
  }

  const onChainBalance = /^0x[0-9a-fA-F]{40}$/.test(user.walletAddress)
    ? await getBalance(user.walletAddress as Address)
    : null;

  return {
    profile: {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      walletAddress: user.walletAddress,
      provider: user.provider,
      role: user.role,
      createdAt: stored?.createdAt ?? Date.now(),
    },
    wallet: {
      address: user.walletAddress,
      claimableWei: claimable.toString(),
      cashedOutWei: cashedOut.toString(),
      lockedWei: locked.toString(),
      onChainBalanceWei: onChainBalance === null ? null : onChainBalance.toString(),
      claimableGames,
      chainEnabled: isChainSettlementEnabled(),
      explorerUrl: explorerAddressUrl(user.walletAddress),
    },
    stats: summarise(games),
    games,
  };
}

// ----------------------------------------------------------------- cash out

export interface CashOutEntry {
  roomId: string;
  code: string;
  name: string;
  amountWei: string;
  ok: boolean;
  txHash: string | null;
  explorerUrl: string | null;
  error: string | null;
}

export interface CashOutResult {
  destination: string;
  /** Total actually sent, wei string. */
  sentWei: string;
  entries: CashOutEntry[];
  onChain: boolean;
}

/**
 * Cash out every settled game at once.
 *
 * Each game is claimed independently through the same `claimPayout` path a
 * single game uses, so the per-game reservation, the double-claim rejection and
 * the contract's own guard all still apply. One game failing does not abandon
 * the rest — the caller gets a per-game result and can retry only what failed.
 */
export async function cashOutAll(
  user: SessionUser,
  destination: string,
): Promise<CashOutResult> {
  const rooms = await listRoomsForUser(user.id);
  const claimable = rooms
    .map((room) => describeGame(room, user.id))
    .filter((game) => game.me?.claimable);

  if (claimable.length === 0) {
    throw new RoomError('You have nothing to cash out right now', 409, 'NOTHING_TO_CLAIM');
  }

  const entries: CashOutEntry[] = [];
  let sent = 0n;
  let onChain = false;

  // Sequential on purpose: every on-chain claim is a treasury-signed
  // transaction, and firing several at once from one account races the nonce.
  for (const game of claimable) {
    const amount = game.me?.payoutWei ?? '0';
    try {
      const result = await claimPayout(game.roomId, user, destination);
      sent += BigInt(result.item.totalPayoutWei);
      onChain = onChain || result.onChain;
      entries.push({
        roomId: game.roomId,
        code: game.code,
        name: game.name,
        amountWei: result.item.totalPayoutWei,
        ok: true,
        txHash: result.txHash,
        explorerUrl: result.explorerUrl,
        error: null,
      });
    } catch (error) {
      entries.push({
        roomId: game.roomId,
        code: game.code,
        name: game.name,
        amountWei: amount,
        ok: false,
        txHash: null,
        explorerUrl: null,
        error: error instanceof Error ? error.message : 'Cash-out failed',
      });
    }
  }

  if (entries.every((entry) => !entry.ok)) {
    throw new RoomError(
      entries[0]?.error ?? 'Cash-out failed. Try again.',
      502,
      'CLAIM_FAILED',
    );
  }

  return {
    destination,
    sentWei: sent.toString(),
    entries,
    onChain,
  };
}
