import { buildAccountOverview } from '@/server/account';
import { handle, ok, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The signed-in user's own dashboard: their games, their stats, their money.
 *
 * Scoped to the caller by construction — every row is derived from rooms they
 * hosted or joined, and the user id comes from the signed cookie, never from
 * the request.
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const overview = await buildAccountOverview(user);
    return ok({ user, ...overview });
  });
}
