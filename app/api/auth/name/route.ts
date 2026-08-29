import { cookies } from 'next/headers';
import { z } from 'zod';
import { displayNameSchema } from '@/lib/validation';
import {
  SESSION_COOKIE,
  createSessionToken,
  readSessionToken,
  sessionCookieOptions,
  updateDisplayName,
} from '@/lib/auth/session';
import { handle, ok, parseBody, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ displayName: displayNameSchema });

/** Change the display name shown on the leaderboard. */
export async function POST(request: Request) {
  return handle(async () => {
    const current = await requireUser();
    const { displayName } = await parseBody(request, bodySchema);
    const user = await updateDisplayName(current, displayName);

    const jar = await cookies();
    const previous = readSessionToken(jar.get(SESSION_COOKIE)?.value ?? '');
    jar.set(
      SESSION_COOKIE,
      createSessionToken({
        sub: user.id,
        name: user.displayName,
        email: user.email,
        // Renaming must not drop the picture either.
        picture: user.avatarUrl,
        provider: user.provider,
        // Renaming must not silently drop an admin grant.
        admin: previous?.admin === true,
        iat: Date.now(),
      }),
      sessionCookieOptions,
    );

    return ok({ user });
  });
}
