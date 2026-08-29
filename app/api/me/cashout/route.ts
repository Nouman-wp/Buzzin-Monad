import { z } from 'zod';
import { cashOutAll } from '@/server/account';
import { handle, ok, parseBody, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Each settled game is a separate on-chain claim, confirmed before the next.
export const maxDuration = 300;

const bodySchema = z.object({
  destination: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Enter a valid EVM address')
    .optional(),
});

/**
 * Cash out every settled payout to one address.
 *
 * The destination is the only thing the request controls. Amounts come from
 * each game's frozen settlement, and a game already claimed is rejected by the
 * same guard the per-game endpoint uses.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const { destination } = await parseBody(request, bodySchema);
    const result = await cashOutAll(user, destination ?? user.walletAddress);
    return ok(result);
  });
}
