import { submitAnswerSchema } from '@/lib/validation';
import { advanceGame, submitAnswer } from '@/server/game';
import { handle, ok, fail, parseBody, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ gameId: string }> };

/**
 * Submit an answer.
 *
 * The response deliberately does not say whether the answer was right: that
 * would leak the key to players who have not answered yet. Correctness is
 * revealed to everyone at once when the round closes.
 */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { gameId } = await params;
    const user = await requireUser();
    const input = await parseBody(request, submitAnswerSchema);

    // Advance first so a late submission meets an already-closed round rather
    // than slipping into a round the clock says is over. advanceGame raises
    // its own 404, so no separate existence check is needed.
    const { room } = await advanceGame(gameId);

    const result = await submitAnswer(room, user, input);
    if (!result.accepted) {
      return fail(
        result.reason ?? 'Answer rejected',
        result.duplicate ? 409 : 400,
        result.duplicate ? 'DUPLICATE_ANSWER' : 'ANSWER_REJECTED',
      );
    }

    return ok({ locked: true, roundNumber: input.roundNumber, answerIndex: input.answerIndex });
  });
}
