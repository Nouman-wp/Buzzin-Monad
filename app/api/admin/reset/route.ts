import { appConfig } from '@/lib/config';
import { getStore } from '@/lib/store';
import { handle, ok, fail, requireAdmin } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reset the demo: clears every room, answer and event.
 *
 * Destructive, so it requires the ADMIN role and demo mode. Admin is itself
 * only obtainable by an allowlisted email or by presenting ADMIN_API_TOKEN, so
 * the token is already enforced upstream — re-checking it here as a header
 * would add no real security while making the dashboard button impossible to
 * use, which is exactly the kind of thing that only fails during a live event.
 */
export async function POST() {
  return handle(async () => {
    await requireAdmin();

    if (!appConfig.demoMode) {
      return fail('Demo reset is disabled outside demo mode', 403, 'NOT_DEMO');
    }

    await getStore().resetAll();
    return ok({ reset: true });
  });
}
