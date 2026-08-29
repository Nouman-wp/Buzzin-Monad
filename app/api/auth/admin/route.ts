import { cookies } from 'next/headers';
import { z } from 'zod';
import { serverConfig } from '@/lib/config';
import {
  SESSION_COOKIE,
  createSessionToken,
  hydrateUser,
  readSessionToken,
  sessionCookieOptions,
} from '@/lib/auth/session';
import { handle, ok, fail, parseBody, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ token: z.string().min(1) });

/**
 * Elevate the current session to ADMIN by presenting ADMIN_API_TOKEN.
 *
 * This is the path for an operator running guest sign-in, where there is no
 * email to put on the ADMIN_EMAILS allowlist. The grant is written into the
 * signed session cookie, so it cannot be forged client-side, and the endpoint
 * is inert unless ADMIN_API_TOKEN is configured.
 */
export async function POST(request: Request) {
  return handle(async () => {
    // Elevation applies to the caller's existing session, so they must have one.
    await requireUser();

    if (!serverConfig.adminApiToken) {
      return fail(
        'Admin elevation is disabled. Set ADMIN_API_TOKEN, or add your email to ADMIN_EMAILS.',
        503,
        'ADMIN_TOKEN_UNSET',
      );
    }

    const { token } = await parseBody(request, bodySchema);
    if (!timingSafeEqualString(token, serverConfig.adminApiToken)) {
      return fail('Invalid admin token', 403, 'BAD_TOKEN');
    }

    const jar = await cookies();
    const existing = jar.get(SESSION_COOKIE)?.value;
    const claims = existing ? readSessionToken(existing) : null;
    if (!claims) return fail('Sign in again to continue', 401, 'UNAUTHENTICATED');

    jar.set(
      SESSION_COOKIE,
      createSessionToken({ ...claims, admin: true, iat: Date.now() }),
      sessionCookieOptions,
    );

    const elevated = await hydrateUser({ ...claims, admin: true });
    return ok({ user: elevated });
  });
}

/** Length-independent comparison so the token cannot be probed by timing. */
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
