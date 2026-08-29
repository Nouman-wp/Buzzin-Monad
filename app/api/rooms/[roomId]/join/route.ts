import { joinRoom } from '@/server/rooms';
import { handle, ok, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ roomId: string }> };

/**
 * Join a room. Idempotent — a reconnect or a second tab returns the existing
 * membership instead of allocating a second stake.
 */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { roomId } = await params;
    const user = await requireUser();
    const { room, alreadyJoined } = await joinRoom(roomId, user);
    return ok({
      roomId: room.id,
      code: room.code,
      alreadyJoined,
      player: room.players[user.id],
    });
  });
}
