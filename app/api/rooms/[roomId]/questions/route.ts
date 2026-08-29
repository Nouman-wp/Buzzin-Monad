import { z } from 'zod';
import { assertHost, getRoomOr404, setChallenges } from '@/server/rooms';
import { handle, ok, parseBody, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ roomId: string }> };

/** The room's full question set, answer keys included. Host only. */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { roomId } = await params;
    const user = await requireUser();
    const room = await getRoomOr404(roomId);
    assertHost(room, user);
    return ok({ questions: room.challenges });
  });
}

const bulkSchema = z.object({ action: z.enum(['approveAll', 'rejectPending']) });

/** Bulk approval, so a host reviewing ten questions is not clicking ten times. */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { roomId } = await params;
    const user = await requireUser();
    const room = await getRoomOr404(roomId);
    assertHost(room, user);

    const { action } = await parseBody(request, bulkSchema);
    const next = room.challenges.map((challenge) =>
      action === 'approveAll'
        ? { ...challenge, status: 'APPROVED' as const }
        : challenge.status === 'PENDING_APPROVAL'
          ? { ...challenge, status: 'REJECTED' as const }
          : challenge,
    );

    const updated = await setChallenges(roomId, next);
    return ok({ questions: updated.challenges });
  });
}
