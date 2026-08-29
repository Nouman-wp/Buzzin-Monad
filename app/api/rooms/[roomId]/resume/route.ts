import { assertHost, getRoomOr404 } from '@/server/rooms';
import { resumeGame } from '@/server/game';
import { buildHostSnapshot } from '@/server/snapshots';
import { handle, ok, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ roomId: string }> };

/** Host control. Authorisation is re-checked server-side on every call. */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { roomId } = await params;
    const user = await requireUser();
    assertHost(await getRoomOr404(roomId), user);
    const room = await resumeGame(roomId);
    return ok(await buildHostSnapshot(room));
  });
}
