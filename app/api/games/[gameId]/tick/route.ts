import { advanceGame } from '@/server/game';
import { handle, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ gameId: string }> };

/**
 * Explicit clock driver for the host dashboard.
 *
 * Cheap when nothing is due — it compares timestamps and returns. Safe to call
 * concurrently from several dashboards at once.
 */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { gameId } = await params;
    // advanceGame raises its own 404; a prior existence check would only add a
    // round trip to the endpoint the host polls most often.
    const { room, changed } = await advanceGame(gameId);
    return ok({
      changed,
      phase: room.phase,
      status: room.status,
      currentRound: room.currentRound,
      phaseEndsAt: room.phaseEndsAt,
      version: room.version,
      serverTime: Date.now(),
    });
  });
}
