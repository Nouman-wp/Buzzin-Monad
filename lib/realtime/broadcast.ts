import { featureFlags, serverConfig } from '@/lib/config';
import { roomTopic } from '@/lib/realtime/topic';
import type { GameEvent } from '@/lib/types';

/**
 * Server -> client push over Supabase Realtime broadcast.
 *
 * Vercel serverless functions cannot hold long-lived sockets, so the websocket
 * lives between the browser and Supabase; the server pushes through Supabase's
 * HTTP broadcast endpoint. Clients additionally poll on a slow interval, so a
 * dropped broadcast delays an update rather than breaking the game.
 */

export { roomTopic };

export interface RoomPing {
  /** Highest event sequence the server has written for this room. */
  seq: number;
  /** Room version, so a client can skip a refetch it already has. */
  version: number;
  reason: string;
}

/**
 * Fire-and-forget push. Never throws and never blocks a game transition: a
 * failed broadcast is a UI latency problem, not a correctness problem.
 */
export async function broadcastRoom(roomId: string, ping: RoomPing): Promise<void> {
  if (!featureFlags.supabaseEnabled) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    await fetch(`${serverConfig.supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: serverConfig.supabaseServiceRoleKey,
        authorization: `Bearer ${serverConfig.supabaseServiceRoleKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        messages: [
          {
            topic: roomTopic(roomId),
            event: 'room_update',
            payload: ping,
          },
        ],
      }),
    }).finally(() => clearTimeout(timer));
  } catch {
    // Deliberately swallowed — polling is the guaranteed transport.
  }
}

export function highestSeq(events: GameEvent[]): number {
  return events.reduce((max, event) => (event.seq > max ? event.seq : max), 0);
}
