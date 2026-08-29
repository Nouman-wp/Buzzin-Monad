import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { appConfig, serverConfig } from '@/lib/config';
import { getStore } from '@/lib/store';
import type { Profile } from '@/lib/store/types';
import type { Role } from '@/lib/types';
import { deriveWalletAddress } from '@/lib/auth/wallet';
import { getTreasuryAddress } from '@/lib/chain/client';

/**
 * Sessions and authorisation.
 *
 * A player signs in with Google (verified server-side in `lib/auth/google.ts`)
 * and immediately receives an embedded EVM wallet — no extension, no seed
 * phrase, no faucet. When no Google client id is configured the same flow runs
 * with a guest identity, so the product is fully playable and testable with an
 * empty `.env`.
 *
 * Either way the outcome is one signed, http-only, first-party session cookie.
 * Everything downstream re-derives identity, role and wallet from that cookie
 * on the server. Nothing the client asserts about who it is, is trusted.
 */

export const SESSION_COOKIE = 'buzzin_session';
const SESSION_MAX_AGE_S = 60 * 60 * 12;

export type AuthProvider = 'google' | 'guest';

export interface SessionUser {
  id: string;
  displayName: string;
  email: string | null;
  walletAddress: string;
  /** Provider-hosted picture URL, or null. Never a URL we host. */
  avatarUrl: string | null;
  provider: AuthProvider;
  role: Role;
}

export interface SessionClaims {
  sub: string;
  name: string;
  email: string | null;
  /** Picture asserted by the identity provider at sign-in. */
  picture?: string | null;
  provider: AuthProvider;
  /** Set only by an operator who presented ADMIN_API_TOKEN. */
  admin?: boolean;
  iat: number;
}

// ------------------------------------------------------------ token signing

function sign(payload: string): string {
  return createHmac('sha256', serverConfig.authSessionSecret).update(payload).digest('base64url');
}

export function createSessionToken(claims: SessionClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token: string): SessionClaims | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const provided = Buffer.from(signature);
  const computed = Buffer.from(expected);
  // Constant-time compare; length mismatch is itself a rejection.
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
    if (typeof claims.sub !== 'string' || !claims.sub) return null;
    if (Date.now() - claims.iat > SESSION_MAX_AGE_S * 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: appConfig.appUrl.startsWith('https://'),
  path: '/',
  maxAge: SESSION_MAX_AGE_S,
};

// -------------------------------------------------------------------- roles

/**
 * Admin is granted two ways, both explicit:
 *
 *   1. The signed-in email is on the ADMIN_EMAILS allowlist. This is the
 *      production path and pairs with Google sign-in.
 *   2. The session carries an `admin` claim, which is only ever issued by
 *      POST /api/auth/admin against ADMIN_API_TOKEN. This is what lets an
 *      operator running guest sign-in reach the dashboard.
 *
 * There is deliberately NO blanket demo fallback. An earlier version granted
 * admin to everyone when no allowlist was set, which in a 25-player room meant
 * every player could start, pause and end the game — and read answer keys.
 * Hosting does not require admin: room control is authorised by ownership.
 */
export function resolveRole(email: string | null, adminClaim = false): Role {
  if (adminClaim) return 'ADMIN';
  const normalised = email?.toLowerCase().trim() ?? '';
  if (normalised && serverConfig.adminEmails.includes(normalised)) return 'ADMIN';
  return 'PLAYER';
}

/**
 * The wallet a user sees in the app.
 *
 * Everyone gets a deterministic server-derived address. The one exception is
 * the *primary* admin — the first entry in ADMIN_EMAILS — who is pinned to a
 * real address they already control, so the operator's in-app wallet is the
 * same MetaMask account that funds the treasury.
 *
 * Pinning applies to exactly one identity on purpose. The settlement contract
 * accumulates entitlement per address, so two players sharing an address would
 * pool their payouts and whoever claimed first would take both.
 */
export function walletFor(email: string | null, userId: string, role: Role): string {
  if (role !== 'ADMIN') return deriveWalletAddress(userId);

  const primary = serverConfig.adminEmails[0];
  const normalised = email?.toLowerCase().trim() ?? '';
  const isPrimary = Boolean(primary && normalised && normalised === primary);
  if (!isPrimary) return deriveWalletAddress(userId);

  const pinned = serverConfig.adminWalletAddress || getTreasuryAddress() || '';
  return /^0x[0-9a-fA-F]{40}$/.test(pinned) ? pinned : deriveWalletAddress(userId);
}

// ----------------------------------------------------------------- resolver

/** True when nothing the profile row stores has actually changed. */
function profileMatches(stored: Profile | null, user: SessionUser): boolean {
  return (
    stored !== null &&
    stored.email === user.email &&
    stored.displayName === user.displayName &&
    stored.walletAddress === user.walletAddress &&
    stored.avatarUrl === user.avatarUrl &&
    stored.provider === user.provider &&
    stored.role === user.role
  );
}

/**
 * Write the profile row — but only when it would actually change.
 *
 * Every authenticated request hydrates a session, and players poll several
 * times a second during a round. Writing unconditionally meant a database
 * write per poll: with 25 players that is ~28 writes a second for data that
 * changes when someone renames themselves and essentially never otherwise.
 */
async function persistProfile(user: SessionUser, stored: Profile | null): Promise<void> {
  if (profileMatches(stored, user)) return;
  const profile: Profile = {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    walletAddress: user.walletAddress,
    avatarUrl: user.avatarUrl,
    provider: user.provider,
    role: user.role,
    createdAt: stored?.createdAt ?? Date.now(),
  };
  try {
    await getStore().upsertProfile(profile);
  } catch (error) {
    // A profile write failure must not block gameplay.
    console.error('[buzzin] failed to persist profile', error);
  }
}

/**
 * Accept a picture URL only if it is an https URL from a provider we actually
 * use. The value arrives inside a signature-verified ID token, but it still
 * ends up in an `<img src>` on every page, so it is narrowed here rather than
 * trusted wholesale.
 */
const AVATAR_HOSTS = /(^|\.)(googleusercontent\.com|google\.com)$/;

export function sanitiseAvatarUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (!AVATAR_HOSTS.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Build the session user for a set of verified claims. The stored profile wins
 * for the display name, because that is what the player chose in the app.
 */
export async function hydrateUser(claims: SessionClaims): Promise<SessionUser> {
  const stored = await getStore().getProfile(claims.sub).catch(() => null);
  const role = resolveRole(claims.email, claims.admin === true);
  // The pinned admin wallet wins over a previously stored one, so turning the
  // setting on takes effect on the operator's next sign-in.
  const wallet = walletFor(claims.email, claims.sub, role);
  const user: SessionUser = {
    id: claims.sub,
    displayName: stored?.displayName || claims.name,
    email: claims.email,
    walletAddress: wallet,
    // A fresh sign-in wins: Google rotates picture URLs, and a stale one 404s.
    avatarUrl: sanitiseAvatarUrl(claims.picture) ?? stored?.avatarUrl ?? null,
    provider: claims.provider,
    role,
  };
  await persistProfile(user, stored);
  return user;
}

/**
 * Resolve the caller. Returns null when nobody is signed in. Never throws — an
 * unreadable session is a 401, not a 500.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const claims = readSessionToken(raw);
  if (!claims) return null;
  return hydrateUser(claims);
}

/** Persist a new display name for the signed-in user. */
export async function updateDisplayName(
  user: SessionUser,
  displayName: string,
): Promise<SessionUser> {
  const next: SessionUser = { ...user, displayName };
  // Pass the pre-change state so the write is recognised as necessary.
  await persistProfile(next, { ...user, createdAt: Date.now() });
  return next;
}

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === 'ADMIN';
}
