import { assertHost, getRoomOr404 } from '@/server/rooms';
import { buildHostSnapshot } from '@/server/snapshots';
import { advanceGame } from '@/server/game';
import { handle, ok, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ roomId: string }> };

/**
 * Full host/admin view of a room, including answer keys and player economics.
 * Guarded by an explicit host check — never by route obscurity.
 */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { roomId } = await params;
    const user = await requireUser();
    const room = await getRoomOr404(roomId);
    assertHost(room, user);
    // Reading the dashboard also drives the clock, so the game never stalls
    // just because no player happens to be polling.
    const { room: current } = await advanceGame(roomId);
    return ok(await buildHostSnapshot(current));
  });
}
