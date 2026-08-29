import { createPublicKey, createVerify, type JsonWebKey as NodeJsonWebKey } from 'node:crypto';

/**
 * Google ID token verification.
 *
 * Implemented directly against Google's published JWKS so the app carries no
 * auth SDK dependency. Keys are cached for their advertised lifetime and
 * refreshed on a key-id miss, which is exactly the rotation behaviour Google
 * documents.
 *
 * This is the seam a different identity provider would replace. Nothing else
 * in the codebase knows how a user proved who they are.
 */

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
/** Tolerance for clock skew between this server and Google, in seconds. */
const CLOCK_SKEW_S = 120;

interface Jwk {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
}

interface JwksCache {
  keys: Map<string, Jwk>;
  expiresAt: number;
}

let cache: JwksCache = { keys: new Map(), expiresAt: 0 };

async function loadKeys(force = false): Promise<Map<string, Jwk>> {
  if (!force && cache.expiresAt > Date.now() && cache.keys.size > 0) return cache.keys;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(JWKS_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);
    const body = (await response.json()) as { keys: Jwk[] };

    // Respect Google's cache header; fall back to an hour.
    const cacheControl = response.headers.get('cache-control') ?? '';
    const maxAge = Number(/max-age=(\d+)/.exec(cacheControl)?.[1] ?? 3600);

    cache = {
      keys: new Map(body.keys.map((key) => [key.kid, key])),
      expiresAt: Date.now() + Math.max(60, maxAge) * 1000,
    };
    return cache.keys;
  } finally {
    clearTimeout(timer);
  }
}

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

/**
 * Verify a Google ID token and return the identity it asserts.
 *
 * Checks the signature, issuer, audience, and expiry. Returns null on any
 * failure — callers treat that as "not signed in", never as a server error.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  expectedAudience: string,
): Promise<GoogleIdentity | null> {
  try {
    const [headerB64, payloadB64, signatureB64] = idToken.split('.');
    if (!headerB64 || !payloadB64 || !signatureB64) return null;

    const header = decodeSegment(headerB64) as { kid?: string; alg?: string };
    if (header.alg !== 'RS256' || !header.kid) return null;

    let keys = await loadKeys();
    let jwk = keys.get(header.kid);
    if (!jwk) {
      // Unknown key id usually means Google rotated; refresh once.
      keys = await loadKeys(true);
      jwk = keys.get(header.kid);
    }
    if (!jwk) return null;

    const publicKey = createPublicKey({ key: jwk as unknown as NodeJsonWebKey, format: 'jwk' });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    if (!verifier.verify(publicKey, Buffer.from(signatureB64, 'base64url'))) return null;

    const payload = decodeSegment(payloadB64) as {
      iss?: string;
      aud?: string;
      sub?: string;
      exp?: number;
      iat?: number;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };

    if (!payload.iss || !ISSUERS.has(payload.iss)) return null;
    if (!payload.sub) return null;
    if (payload.aud !== expectedAudience) return null;

    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp + CLOCK_SKEW_S < now) return null;
    if (payload.iat && payload.iat - CLOCK_SKEW_S > now) return null;

    return {
      sub: payload.sub,
      email: payload.email ?? null,
      emailVerified: Boolean(payload.email_verified),
      name: payload.name ?? null,
      picture: payload.picture ?? null,
    };
  } catch {
    return null;
  }
}
