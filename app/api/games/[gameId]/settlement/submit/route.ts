import { assertHost, getRoomOr404 } from '@/server/rooms';
import { submitSettlement } from '@/server/settlement';
import { buildHostSnapshot } from '@/server/snapshots';
import { handle, ok, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Two on-chain transactions plus confirmations. */
export const maxDuration = 300;

type Params = { params: Promise<{ gameId: string }> };

/**
 * Escrow the payout total and freeze the table on Monad.
 * Retrying after a failure is safe: the submit path is guarded so a second
 * request cannot send a duplicate transaction.
 */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { gameId } = await params;
    const user = await requireUser();
    assertHost(await getRoomOr404(gameId), user);
    const room = await submitSettlement(gameId);
    return ok(await buildHostSnapshot(room));
  });
}
