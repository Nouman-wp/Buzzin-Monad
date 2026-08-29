import { leaveRoom } from '@/server/rooms';
import { handle, ok, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ roomId: string }> };

/** Leave the lobby. Rejected once the game is under way. */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { roomId } = await params;
    const user = await requireUser();
    const room = await leaveRoom(roomId, user);
    return ok({ left: room !== null });
  });
}
