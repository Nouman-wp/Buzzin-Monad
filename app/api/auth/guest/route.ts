import { cookies } from 'next/headers';
import { z } from 'zod';
import { randomToken } from '@/lib/util/ids';
import { displayNameSchema } from '@/lib/validation';
import {
  SESSION_COOKIE,
  createSessionToken,
  hydrateUser,
  readSessionToken,
  sessionCookieOptions,
  updateDisplayName,
} from '@/lib/auth/session';
import { handle, ok, parseBody } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ displayName: displayNameSchema });

/**
 * Guest sign-in.
 *
 * Used when no Google client id is configured, so the product is fully
 * playable out of the box. The resulting session is identical in every other
 * respect — same signed cookie, same embedded wallet derivation, same
 * server-side authorisation — so nothing downstream needs to special-case it.
 *
 * Re-signing in from the same browser keeps the existing identity, which is
 * what makes a mid-game reconnect restore the player's own state.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { displayName } = await parseBody(request, bodySchema);
    const jar = await cookies();

    const existing = jar.get(SESSION_COOKIE)?.value;
    const previous = existing ? readSessionToken(existing) : null;
    const subject =
      previous?.provider === 'guest' ? previous.sub : `guest:${randomToken(12)}`;

    const hydrated = await hydrateUser({
      sub: subject,
      name: displayName,
      email: null,
      provider: 'guest',
      // An operator who already elevated keeps that grant across a rename.
      admin: previous?.admin === true,
      iat: Date.now(),
    });

    // The name the player just typed wins over any previously stored one.
    const user = await updateDisplayName(hydrated, displayName);

    jar.set(
      SESSION_COOKIE,
      createSessionToken({
        sub: subject,
        name: displayName,
        email: null,
        provider: 'guest',
        admin: previous?.admin === true,
        iat: Date.now(),
      }),
      sessionCookieOptions,
    );

    return ok({ user });
  });
}
