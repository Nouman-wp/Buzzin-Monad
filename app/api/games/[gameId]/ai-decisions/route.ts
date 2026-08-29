import { assertHost, getRoomOr404 } from '@/server/rooms';
import { handle, ok, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ gameId: string }> };

/**
 * The Game Master's decision history with the metrics behind each one.
 * Explanations are the concise summaries the model returns — never internal
 * reasoning, which is neither requested nor stored.
 */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { gameId } = await params;
    const user = await requireUser();
    const room = await getRoomOr404(gameId);
    assertHost(room, user);
    return ok({ decisions: room.aiDecisions });
  });
}
