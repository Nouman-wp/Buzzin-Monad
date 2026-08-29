import { buildSeedChallengeSet } from '@/lib/content';
import { assertHost, getRoomOr404, setChallenges } from '@/server/rooms';
import { emitEvent } from '@/server/events';
import { handle, ok, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ roomId: string }> };

/**
 * "Use seeded questions" — load the bundled approved pool for this room's mode.
 * The demo-day escape hatch: instant, offline, and already approved.
 */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { roomId } = await params;
    const user = await requireUser();
    const room = await getRoomOr404(roomId);
    assertHost(room, user);

    const challenges = buildSeedChallengeSet({
      mode: room.config.mode,
      topic: room.config.topic,
      difficulty: room.config.difficulty,
      count: room.config.questionCount,
      shuffleKey: `${room.id}:${Date.now()}`,
    });

    const updated = await setChallenges(roomId, challenges);
    await emitEvent(
      roomId,
      {
        type: 'AI_DECISION',
        level: 'INFO',
        message: `Loaded ${challenges.length} approved questions from the local pool`,
        payload: { count: challenges.length, mode: room.config.mode, source: 'seed' },
      },
      { version: updated.version },
    );

    return ok({ questions: updated.challenges });
  });
}
