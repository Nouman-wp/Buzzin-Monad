import type { Address, Hash } from 'viem';
import type { SettlementItem } from '@/lib/types';
import {
  SETTLEMENT_ABI,
  gameIdFor,
  getPublicClient,
  getSettlementAddress,
  getTreasuryAccount,
  getWalletClient,
  isChainSettlementEnabled,
} from '@/lib/chain/client';
import { monadChain } from '@/lib/chain/monad';

/**
 * On-chain settlement operations.
 *
 * These are the only functions in the codebase that move funds, and every one
 * of them is invoked from server code with an amount computed by the
 * deterministic settlement engine. The AI Game Master has no path to any of
 * this.
 */

const CONFIRMATION_TIMEOUT_MS = 90_000;

/**
 * Explicit gas limits, because Monad charges the LIMIT, not the gas consumed.
 *
 * On most EVM chains an over-generous limit is free — you are refunded the
 * difference. Monad bills all of it. Left to itself, viem takes the node's
 * `eth_estimateGas` answer, which came back around 5.4M for a call that does
 * a handful of storage writes; at 102 gwei that is roughly 0.55 MON *per
 * transaction*. Across one 25-player game — two settlement writes and 25
 * cash-outs — that is about 15 MON of pure waste, on top of the 25 MON escrow.
 *
 * The numbers below are sized from what the operations actually do, with
 * roughly 2x headroom. They must stay comfortably above real consumption: a
 * limit that is too low reverts out-of-gas and still costs the full limit.
 */
const GAS = {
  /** Struct init plus an event. */
  createGame: 250_000n,
  /** One balance update. */
  fundGame: 120_000n,
  /** Two storage writes, a value transfer, an event. */
  claim: 180_000n,
  /** Base cost before the per-winner loop. */
  finalizeBase: 200_000n,
  /** One entitlement write per payable entry. */
  finalizePerWinner: 45_000n,
} as const;

export interface ChainResult {
  ok: boolean;
  txHash: string | null;
  error: string | null;
}

const disabled: ChainResult = {
  ok: false,
  txHash: null,
  error: 'On-chain settlement is not configured',
};

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const short = error.message.split('\n')[0];
    return short.slice(0, 220);
  }
  return 'Unknown chain error';
}

/** Create the escrow context for a room and fund it in one transaction. */
export async function createAndFundGame(
  roomId: string,
  playerLimit: number,
  valueWei: bigint,
): Promise<ChainResult> {
  if (!isChainSettlementEnabled()) return disabled;
  const wallet = getWalletClient();
  const account = getTreasuryAccount();
  const contract = getSettlementAddress();
  if (!wallet || !account || !contract) return disabled;

  try {
    const hash = await wallet.writeContract({
      address: contract,
      abi: SETTLEMENT_ABI,
      functionName: 'createGame',
      args: [gameIdFor(roomId), BigInt(playerLimit)],
      value: valueWei,
      gas: GAS.createGame,
      account,
      chain: monadChain,
    });
    await waitForReceipt(hash);
    return { ok: true, txHash: hash, error: null };
  } catch (error) {
    return { ok: false, txHash: null, error: describeError(error) };
  }
}

/** Top up an existing escrow, e.g. when more players join than were funded. */
export async function fundGame(roomId: string, valueWei: bigint): Promise<ChainResult> {
  if (!isChainSettlementEnabled() || valueWei <= 0n) return disabled;
  const wallet = getWalletClient();
  const account = getTreasuryAccount();
  const contract = getSettlementAddress();
  if (!wallet || !account || !contract) return disabled;

  try {
    const hash = await wallet.writeContract({
      address: contract,
      abi: SETTLEMENT_ABI,
      functionName: 'fundGame',
      args: [gameIdFor(roomId)],
      value: valueWei,
      gas: GAS.fundGame,
      account,
      chain: monadChain,
    });
    await waitForReceipt(hash);
    return { ok: true, txHash: hash, error: null };
  } catch (error) {
    return { ok: false, txHash: null, error: describeError(error) };
  }
}

/**
 * Freeze the payout table on chain.
 *
 * Only entries with a non-zero payout and a valid address are submitted. The
 * contract independently rejects any table that exceeds the escrow, so a bug
 * in the caller cannot over-allocate.
 */
export async function finalizeGame(
  roomId: string,
  items: SettlementItem[],
): Promise<ChainResult> {
  if (!isChainSettlementEnabled()) return disabled;
  const wallet = getWalletClient();
  const account = getTreasuryAccount();
  const contract = getSettlementAddress();
  if (!wallet || !account || !contract) return disabled;

  const payable = items.filter(
    (item) => BigInt(item.totalPayoutWei) > 0n && isAddress(item.walletAddress),
  );
  if (payable.length === 0) {
    return { ok: false, txHash: null, error: 'No payable settlement entries' };
  }

  try {
    const hash = await wallet.writeContract({
      address: contract,
      abi: SETTLEMENT_ABI,
      functionName: 'finalizeGame',
      args: [
        gameIdFor(roomId),
        payable.map((item) => item.walletAddress as Address),
        payable.map((item) => BigInt(item.totalPayoutWei)),
      ],
      gas: GAS.finalizeBase + GAS.finalizePerWinner * BigInt(payable.length),
      account,
      chain: monadChain,
    });
    await waitForReceipt(hash);
    return { ok: true, txHash: hash, error: null };
  } catch (error) {
    return { ok: false, txHash: null, error: describeError(error) };
  }
}

/**
 * Operator-sponsored claim. Embedded-wallet players hold no gas, so the server
 * submits the claim once the player confirms their destination in the app.
 */
export async function claimFor(
  roomId: string,
  player: string,
  destination: string,
): Promise<ChainResult> {
  if (!isChainSettlementEnabled()) return disabled;
  if (!isAddress(player) || !isAddress(destination)) {
    return { ok: false, txHash: null, error: 'Invalid wallet address' };
  }
  const wallet = getWalletClient();
  const account = getTreasuryAccount();
  const contract = getSettlementAddress();
  if (!wallet || !account || !contract) return disabled;

  try {
    const hash = await wallet.writeContract({
      address: contract,
      abi: SETTLEMENT_ABI,
      functionName: 'claimFor',
      args: [gameIdFor(roomId), player as Address, destination as Address],
      gas: GAS.claim,
      account,
      chain: monadChain,
    });
    await waitForReceipt(hash);
    return { ok: true, txHash: hash, error: null };
  } catch (error) {
    return { ok: false, txHash: null, error: describeError(error) };
  }
}

async function waitForReceipt(hash: Hash): Promise<void> {
  const receipt = await getPublicClient().waitForTransactionReceipt({
    hash,
    timeout: CONFIRMATION_TIMEOUT_MS,
    confirmations: 1,
  });
  if (receipt.status !== 'success') {
    throw new Error(`Transaction reverted (${hash})`);
  }
}

export function isAddress(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}
