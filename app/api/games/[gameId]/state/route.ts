import { getSessionUser } from '@/lib/auth/session';
import { advanceGame } from '@/server/game';
import { buildPlayerSnapshot } from '@/server/snapshots';
import { handle, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ gameId: string }> };

/**
 * The player's authoritative snapshot.
 *
 * Every poll also advances the clock, which is what keeps rounds flowing on a
 * serverless deployment with no background worker: whoever asks first performs
 * the transition, and the compare-and-swap makes sure it happens exactly once.
 */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { gameId } = await params;
    // Every player hits this several times a second, so it is worth keeping
    // lean: advanceGame raises its own 404, making a separate existence check
    // a wasted round trip, and the session read is independent of the room
    // read so the two overlap.
    const [user, advanced] = await Promise.all([getSessionUser(), advanceGame(gameId)]);
    return ok(await buildPlayerSnapshot(advanced.room, user));
  });
}
