import { z } from 'zod';
import { editQuestionSchema } from '@/lib/validation';
import { assertHost, getRoomOr404, setChallenges } from '@/server/rooms';
import { handle, ok, parseBody, requireUser, HttpError } from '@/server/http';
import type { Challenge } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ roomId: string; questionId: string }> };

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject') }),
  z.object({ action: z.literal('edit'), question: editQuestionSchema }),
]);

/**
 * Approve, reject, or edit a single question.
 * An edited question stays approved-by-the-host, which is the whole point of
 * the review step: nothing generated plays without a human accepting it.
 */
export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { roomId, questionId } = await params;
    const user = await requireUser();
    const room = await getRoomOr404(roomId);
    assertHost(room, user);

    const body = await parseBody(request, patchSchema);
    const index = room.challenges.findIndex((challenge) => challenge.id === questionId);
    if (index === -1) throw new HttpError('Question not found', 404, 'QUESTION_NOT_FOUND');

    const next: Challenge[] = room.challenges.slice();
    const current = next[index];

    if (body.action === 'approve') {
      next[index] = { ...current, status: 'APPROVED' };
    } else if (body.action === 'reject') {
      next[index] = { ...current, status: 'REJECTED' };
    } else {
      next[index] = {
        ...current,
        ...body.question,
        source: 'host',
        status: 'APPROVED',
      };
    }

    const updated = await setChallenges(roomId, next);
    return ok({ question: updated.challenges[index], questions: updated.challenges });
  });
}

/** Remove a question from the set entirely. */
export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const { roomId, questionId } = await params;
    const user = await requireUser();
    const room = await getRoomOr404(roomId);
    assertHost(room, user);

    const remaining = room.challenges.filter((challenge) => challenge.id !== questionId);
    if (remaining.length === room.challenges.length) {
      throw new HttpError('Question not found', 404, 'QUESTION_NOT_FOUND');
    }
    const updated = await setChallenges(roomId, remaining);
    return ok({ questions: updated.challenges });
  });
}
