import { getStore } from '@/lib/store';
import { assertHost, getRoomOr404 } from '@/server/rooms';
import { formatEventLine } from '@/server/events';
import { handle, ok, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ gameId: string }> };

/**
 * Real application events for the live terminal.
 *
 * `?since=<seq>` returns only what is new, so the dashboard streams rather than
 * refetching. Every line here was written by an actual state transition.
 */
export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { gameId } = await params;
    const user = await requireUser();
    const room = await getRoomOr404(gameId);
    assertHost(room, user);

    const url = new URL(request.url);
    const since = Number(url.searchParams.get('since') ?? 0);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200)));

    const events = await getStore().listEvents(
      gameId,
      Number.isFinite(since) ? since : 0,
      limit,
    );

    return ok({
      events: events.map((event) => ({ ...event, line: formatEventLine(event) })),
      latestSeq: events.length > 0 ? events[events.length - 1].seq : since,
    });
  });
}
