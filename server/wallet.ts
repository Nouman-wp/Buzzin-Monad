import { createWalletClient, http, type Address } from 'viem';
import { chainConfig } from '@/lib/config';
import { monadChain } from '@/lib/chain/monad';
import { getPublicClient } from '@/lib/chain/client';
import { explorerTxUrl } from '@/lib/chain/monad';
import { deriveWalletAccount } from '@/lib/auth/wallet';
import { RoomError } from '@/server/rooms';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Moving MON out of a player's own embedded wallet.
 *
 * This is the one place the server signs as a player rather than as the
 * treasury, and it does so only for the signed-in user, only from their own
 * derived address, and only to a destination they supplied in the request.
 *
 * Everything else about payouts stays as it was: a settlement claim is
 * submitted by the treasury through the contract, because a player has no gas.
 * Here the funds are already at the player's address, so the gas comes out of
 * that balance and only their key can authorise the move.
 */

/** A native transfer is exactly 21000 gas — and Monad bills the limit. */
const TRANSFER_GAS = 21_000n;

export interface WalletBalance {
  address: string;
  balanceWei: string;
  /** What could actually be sent right now, after reserving gas. */
  sendableWei: string;
  gasReserveWei: string;
  chainEnabled: boolean;
  explorerUrl: string | null;
}

async function gasReserve(): Promise<bigint> {
  try {
    const price = await getPublicClient().getGasPrice();
    // A little headroom: the price can tick up between quoting and sending.
    return TRANSFER_GAS * ((price * 12n) / 10n);
  } catch {
    // 150 gwei is comfortably above what Monad testnet has been charging.
    return TRANSFER_GAS * 150_000_000_000n;
  }
}

/** Balance of the caller's embedded wallet, and what is actually sendable. */
export async function readWallet(user: SessionUser): Promise<WalletBalance> {
  const address = user.walletAddress as Address;
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address);

  let balance = 0n;
  if (valid) {
    try {
      balance = await getPublicClient().getBalance({ address });
    } catch {
      balance = 0n;
    }
  }

  const reserve = await gasReserve();
  const sendable = balance > reserve ? balance - reserve : 0n;

  return {
    address,
    balanceWei: balance.toString(),
    sendableWei: sendable.toString(),
    gasReserveWei: reserve.toString(),
    chainEnabled: Boolean(chainConfig.rpcUrl),
    explorerUrl: valid
      ? `${chainConfig.explorerUrl.replace(/\/$/, '')}/address/${address}`
      : null,
  };
}

export interface SendResult {
  txHash: string;
  explorerUrl: string;
  amountWei: string;
  to: string;
}

/**
 * Send MON from the caller's embedded wallet.
 *
 * `amountWei` of null means "everything that can be sent", which is the balance
 * less a gas reserve — a player emptying their wallet should not have to work
 * out the fee themselves.
 */
export async function sendFromWallet(
  user: SessionUser,
  to: string,
  amountWei: bigint | null,
): Promise<SendResult> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
    throw new RoomError('Enter a valid EVM address', 400, 'BAD_DESTINATION');
  }
  if (to.toLowerCase() === user.walletAddress.toLowerCase()) {
    throw new RoomError('That is already your own address', 400, 'SAME_ADDRESS');
  }

  const wallet = await readWallet(user);
  const balance = BigInt(wallet.balanceWei);
  const sendable = BigInt(wallet.sendableWei);

  if (balance === 0n) {
    throw new RoomError('Your wallet is empty', 409, 'EMPTY_WALLET');
  }
  if (sendable === 0n) {
    throw new RoomError(
      'Your balance is too small to cover the network fee',
      409,
      'BELOW_GAS',
    );
  }

  const amount = amountWei ?? sendable;
  if (amount <= 0n) {
    throw new RoomError('Enter an amount greater than zero', 400, 'BAD_AMOUNT');
  }
  if (amount > sendable) {
    throw new RoomError(
      `You can send at most ${wallet.sendableWei} wei after the network fee`,
      409,
      'INSUFFICIENT',
    );
  }

  const account = deriveWalletAccount(user.id);
  // Defensive: the derived account must be the address we told the player they
  // own. If these ever disagree, the session secret changed and signing would
  // move someone else's funds.
  if (account.address.toLowerCase() !== user.walletAddress.toLowerCase()) {
    throw new RoomError('Wallet mismatch — sign in again', 409, 'WALLET_MISMATCH');
  }

  const client = createWalletClient({
    account,
    chain: monadChain,
    transport: http(chainConfig.rpcUrl, { timeout: 20_000, retryCount: 2 }),
  });

  try {
    const hash = await client.sendTransaction({
      to: to as Address,
      value: amount,
      gas: TRANSFER_GAS,
      account,
      chain: monadChain,
    });
    const receipt = await getPublicClient().waitForTransactionReceipt({
      hash,
      timeout: 90_000,
      confirmations: 1,
    });
    if (receipt.status !== 'success') {
      throw new Error('Transaction reverted');
    }
    return {
      txHash: hash,
      explorerUrl: explorerTxUrl(hash),
      amountWei: amount.toString(),
      to,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : 'Send failed';
    throw new RoomError(detail.slice(0, 180), 502, 'SEND_FAILED');
  }
}
