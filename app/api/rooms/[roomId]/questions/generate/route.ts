import { getAiProvider } from '@/lib/ai';
import { generateQuestionsSchema } from '@/lib/validation';
import { assertHost, getRoomOr404, setChallenges } from '@/server/rooms';
import { emitEvent } from '@/server/events';
import { handle, ok, parseBody, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Generation can take a few seconds; give it room on the platform. */
export const maxDuration = 60;

type Params = { params: Promise<{ roomId: string }> };

/**
 * Generate a question set with the AI Game Master.
 *
 * Generated questions land as PENDING_APPROVAL — they are not playable until
 * the host approves them. If the provider is unavailable the approved local
 * pool is returned instead, with a warning, so the host is never blocked.
 */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { roomId } = await params;
    const user = await requireUser();
    const room = await getRoomOr404(roomId);
    assertHost(room, user);

    const input = await parseBody(request, generateQuestionsSchema);
    const provider = getAiProvider();

    const result = await provider.generateQuestionSet({
      mode: input.mode,
      topic: input.topic,
      difficulty: input.difficulty,
      count: input.count,
      existing: room.challenges.map((challenge) => challenge.question),
    });

    // Replace the set rather than appending, so the host sees exactly what
    // they asked for and the round count stays predictable.
    const updated = await setChallenges(roomId, result.questions);

    await emitEvent(
      roomId,
      {
        type: 'AI_DECISION',
        level: 'AI',
        message: result.fallbackUsed
          ? `Generated ${result.questions.length} questions from the local pool`
          : `AI generated ${result.questions.length} questions on "${input.topic}"`,
        payload: {
          count: result.questions.length,
          topic: input.topic,
          difficulty: input.difficulty,
          provider: result.provider,
          model: result.model,
          fallback: result.fallbackUsed,
        },
      },
      { version: updated.version },
    );

    return ok({
      questions: updated.challenges,
      provider: result.provider,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
      warning: result.warning,
    });
  });
}
