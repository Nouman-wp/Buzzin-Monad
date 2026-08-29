import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chainConfig, serverConfig } from '@/lib/config';
import { monadChain } from '@/lib/chain/monad';
import { SETTLEMENT_ABI } from '@/lib/chain/abi';

/**
 * Server-side Monad access.
 *
 * The treasury private key is read from a server-only environment variable and
 * never crosses into a client bundle. Every function here degrades gracefully:
 * if the chain is not configured, callers get `null` and the game continues
 * with off-chain accounting, which is a supported settlement mode.
 */

let publicClient: PublicClient | null = null;

export function getPublicClient(): PublicClient {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: monadChain,
      transport: http(chainConfig.rpcUrl, { timeout: 15_000, retryCount: 2 }),
    }) as PublicClient;
  }
  return publicClient;
}

function normalisePrivateKey(raw: string): `0x${string}` | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withPrefix = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  return /^0x[0-9a-fA-F]{64}$/.test(withPrefix) ? (withPrefix as `0x${string}`) : null;
}

export function getTreasuryAccount() {
  const key = normalisePrivateKey(serverConfig.treasuryPrivateKey);
  return key ? privateKeyToAccount(key) : null;
}

export function getTreasuryAddress(): Address | null {
  return getTreasuryAccount()?.address ?? null;
}

export function getWalletClient(): WalletClient | null {
  const account = getTreasuryAccount();
  if (!account) return null;
  return createWalletClient({
    account,
    chain: monadChain,
    transport: http(chainConfig.rpcUrl, { timeout: 15_000, retryCount: 2 }),
  });
}

export function getSettlementAddress(): Address | null {
  const address = chainConfig.settlementContract.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? (address as Address) : null;
}

/** True only when a treasury key AND a settlement contract are both present. */
export function isChainSettlementEnabled(): boolean {
  return Boolean(getTreasuryAccount() && getSettlementAddress());
}

/**
 * Deterministic on-chain identifier for a room.
 *
 * The prefix keeps its pre-BuzzIn spelling deliberately: it is hashed into the
 * game id that every already-settled game is stored under in the live contract.
 * Renaming it would compute different ids and orphan that escrow, so it must
 * stay in step with `gameIdFor` in scripts/reclaim-escrow.mjs.
 */
export function gameIdFor(roomId: string): Hash {
  return keccak256(toHex(`blitzplay:${roomId}`));
}

export async function getBalance(address: Address): Promise<bigint | null> {
  try {
    return await getPublicClient().getBalance({ address });
  } catch (error) {
    console.error('[buzzin] balance lookup failed', error);
    return null;
  }
}

/**
 * Treasury balance for display, cached per instance.
 *
 * The host dashboard polls several times a second during a game, and an
 * uncached lookup put a Monad RPC round trip — around half a second — on every
 * one of those requests, for a number that only moves at settlement. The public
 * RPC is also rate limited, so a room full of dashboards could exhaust it.
 *
 * A stale-by-seconds balance is fine here: it is an operator readout, never an
 * input to settlement, which always reads the chain directly.
 */
const BALANCE_CACHE_MS = 15_000;
let balanceCache: { address: Address; value: bigint | null; at: number } | null = null;

export async function getCachedBalance(address: Address): Promise<bigint | null> {
  const now = Date.now();
  if (balanceCache && balanceCache.address === address && now - balanceCache.at < BALANCE_CACHE_MS) {
    return balanceCache.value;
  }
  const value = await getBalance(address);
  // Cache failures too, briefly, so an unreachable RPC cannot make every poll
  // wait for the same timeout.
  balanceCache = { address, value, at: now };
  return value;
}

export interface OnChainGame {
  exists: boolean;
  finalized: boolean;
  funded: bigint;
  allocated: bigint;
  paid: bigint;
}

export async function readGame(roomId: string): Promise<OnChainGame | null> {
  const contract = getSettlementAddress();
  if (!contract) return null;
  try {
    const result = (await getPublicClient().readContract({
      address: contract,
      abi: SETTLEMENT_ABI,
      functionName: 'getGame',
      args: [gameIdFor(roomId)],
    })) as readonly [boolean, boolean, bigint, bigint, bigint];
    return {
      exists: result[0],
      finalized: result[1],
      funded: result[2],
      allocated: result[3],
      paid: result[4],
    };
  } catch (error) {
    console.error('[buzzin] readGame failed', error);
    return null;
  }
}

export async function hasClaimedOnChain(roomId: string, player: Address): Promise<boolean | null> {
  const contract = getSettlementAddress();
  if (!contract) return null;
  try {
    return (await getPublicClient().readContract({
      address: contract,
      abi: SETTLEMENT_ABI,
      functionName: 'hasClaimed',
      args: [gameIdFor(roomId), player],
    })) as boolean;
  } catch {
    return null;
  }
}

export { SETTLEMENT_ABI };
