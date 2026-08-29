import { assertHost, getRoomOr404 } from '@/server/rooms';
import { prepareSettlement } from '@/server/settlement';
import { buildHostSnapshot } from '@/server/snapshots';
import { handle, ok, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ gameId: string }> };

/**
 * Compute the final payout table. Deterministic and side-effect free with
 * respect to the chain, so it is safe to run repeatedly before submitting.
 */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { gameId } = await params;
    const user = await requireUser();
    assertHost(await getRoomOr404(gameId), user);
    const room = await prepareSettlement(gameId);
    return ok(await buildHostSnapshot(room));
  });
}
