import { createHmac } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { serverConfig } from '@/lib/config';

/**
 * Embedded wallets.
 *
 * Every player gets a usable EVM address the moment they sign in — no
 * extension, no seed phrase, no faucet, nothing to understand. The address is
 * derived deterministically from the user id and the server-side session
 * secret, so it is stable across devices and reconnects.
 *
 * The derived key never leaves the server, is never persisted, and is never
 * used to sign anything — the player only ever sees their address. Cash-out is
 * submitted by the treasury on their behalf, so a player never needs gas, and
 * it pays out to whatever address they choose.
 *
 * This module is the wallet seam: swapping in a third-party embedded-wallet
 * provider means reimplementing `deriveWalletAddress` and the claim path in
 * `server/settlement.ts`, and nothing else.
 */

/**
 * Frozen at the pre-BuzzIn spelling on purpose.
 *
 * This string is an input to every player's key derivation, so changing it
 * changes every address — exactly like rotating AUTH_SESSION_SECRET. Payouts
 * already escrowed on the deployed contract are keyed to the addresses this
 * label produces, so renaming it would strand them. It is an identifier, not a
 * brand.
 */
const DERIVATION_LABEL = 'blitzplay/embedded-wallet/v1';

function derivePrivateKey(userId: string): `0x${string}` {
  const digest = createHmac('sha256', serverConfig.authSessionSecret)
    .update(`${DERIVATION_LABEL}:${userId}`)
    .digest('hex');
  return `0x${digest}` as `0x${string}`;
}

/** Address of the embedded wallet for a user. Stable for that user id. */
export function deriveWalletAddress(userId: string): `0x${string}` {
  return privateKeyToAccount(derivePrivateKey(userId)).address;
}

/**
 * Server-only signer for a player's embedded wallet.
 *
 * This was deliberately absent while nothing needed it — cash-out is submitted
 * by the treasury through the contract's operator-sponsored claim, so the
 * server never had to sign as a player. Sending from the dashboard does need
 * it: the funds are at the player's own address and only that key can move
 * them.
 *
 * Import it from `server/wallet.ts` and nowhere else. It exists so a player can
 * move their own money, at their own request, to an address they chose.
 */
export function deriveWalletAccount(userId: string) {
  return privateKeyToAccount(derivePrivateKey(userId));
}

// The comment below stays true of everything except the accessor above: a
// not exist until something genuinely needs one, and nothing does. Cash-out is
// submitted by the treasury through the contract's operator-sponsored claim, so
// the server never signs as a player. If player-signed claims are ever wanted,
// expose an accessor here — and only here.
