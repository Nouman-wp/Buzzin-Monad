import { cookies } from 'next/headers';
import { z } from 'zod';
import { serverConfig } from '@/lib/config';
import { verifyGoogleIdToken } from '@/lib/auth/google';
import {
  SESSION_COOKIE,
  createSessionToken,
  hydrateUser,
  sessionCookieOptions,
} from '@/lib/auth/session';
import { handle, ok, fail, parseBody } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  credential: z.string().min(20, 'Missing Google credential'),
});

/**
 * Exchange a Google ID token for a first-party session.
 *
 * The token is verified against Google's JWKS server-side; the browser never
 * gets to assert who it is. The response includes the embedded wallet address
 * that was provisioned for this account.
 */
export async function POST(request: Request) {
  return handle(async () => {
    if (!serverConfig.googleClientId) {
      return fail('Google sign-in is not configured on this deployment', 503, 'GOOGLE_DISABLED');
    }

    const { credential } = await parseBody(request, bodySchema);
    const identity = await verifyGoogleIdToken(credential, serverConfig.googleClientId);
    if (!identity) {
      return fail('Google sign-in could not be verified. Please try again.', 401, 'BAD_CREDENTIAL');
    }

    const user = await hydrateUser({
      sub: `google:${identity.sub}`,
      name: (identity.name || identity.email?.split('@')[0] || 'Player').slice(0, 20),
      email: identity.email,
      picture: identity.picture,
      provider: 'google',
      iat: Date.now(),
    });

    const jar = await cookies();
    jar.set(
      SESSION_COOKIE,
      createSessionToken({
        sub: user.id,
        name: user.displayName,
        email: user.email,
        picture: user.avatarUrl,
        provider: 'google',
        iat: Date.now(),
      }),
      sessionCookieOptions,
    );

    return ok({ user });
  });
}
