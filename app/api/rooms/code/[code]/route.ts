import { normaliseRoomCode } from '@/lib/util/ids';
import { getRoomByCodeOr404 } from '@/server/rooms';
import { handle, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ code: string }> };

/**
 * Public room lookup used by the join screen.
 * Returns only what a prospective player needs to decide to join.
 */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { code } = await params;
    const room = await getRoomByCodeOr404(normaliseRoomCode(code));
    const playerCount = Object.keys(room.players).length;
    return ok({
      room: {
        id: room.id,
        code: room.code,
        name: room.config.name,
        mode: room.config.mode,
        status: room.status,
        hostName: room.hostName,
        topic: room.config.topic,
        totalRounds: room.config.questionCount,
        playerCount,
        maxPlayers: room.config.maxPlayers,
        prizePoolWei: room.prizePoolWei,
        full: playerCount >= room.config.maxPlayers,
        joinable: room.status === 'LOBBY' && playerCount < room.config.maxPlayers,
      },
    });
  });
}
