import { getRoomOr404 } from '@/server/rooms';
import { handle, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ gameId: string }> };

/** Public leaderboard for a room. Contains no answer data. */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { gameId } = await params;
    const room = await getRoomOr404(gameId);
    return ok({
      leaderboard: room.leaderboard,
      prizePoolWei: room.prizePoolWei,
      currentRound: room.currentRound,
      totalRounds: room.config.questionCount,
      status: room.status,
    });
  });
}
