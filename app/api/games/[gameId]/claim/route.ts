import { claimSchema } from '@/lib/validation';
import { claimPayout } from '@/server/settlement';
import { handle, ok, parseBody, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Params = { params: Promise<{ gameId: string }> };

/**
 * Cash out. The amount comes from the frozen settlement; the request only
 * chooses the destination. Double claims are rejected here and, independently,
 * by the contract.
 */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { gameId } = await params;
    const user = await requireUser();
    const { destination } = await parseBody(request, claimSchema);
    const result = await claimPayout(gameId, user, destination);
    return ok(result);
  });
}
