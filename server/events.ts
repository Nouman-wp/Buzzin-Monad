import { getStore } from '@/lib/store';
import { broadcastRoom, highestSeq } from '@/lib/realtime/broadcast';
import { newId } from '@/lib/util/ids';
import type { EventLevel, GameEvent, GameEventType } from '@/lib/types';

/**
 * Structured application logging.
 *
 * Every line the admin terminal renders originates here, from a real state
 * transition. Nothing in the terminal is synthesised for presentation.
 */

export interface EmitEvent {
  type: GameEventType;
  level: EventLevel;
  message: string;
  payload?: Record<string, unknown>;
}

const DEFAULT_LEVELS: Partial<Record<GameEventType, EventLevel>> = {
  ROOM_CREATED: 'INFO',
  PLAYER_JOINED: 'PLAYER',
  PLAYER_LEFT: 'PLAYER',
  LOBBY_UPDATED: 'INFO',
  GAME_STARTING: 'GAME',
  ROUND_STARTED: 'GAME',
  QUESTION_REVEALED: 'GAME',
  ANSWER_SUBMITTED: 'PLAYER',
  ANSWER_LOCKED: 'PLAYER',
  ROUND_ENDED: 'GAME',
  LEADERBOARD_UPDATED: 'INFO',
  AI_DECISION: 'AI',
  PLAYER_ELIMINATED: 'WARN',
  GAME_PAUSED: 'WARN',
  GAME_RESUMED: 'INFO',
  GAME_FINALIZING: 'GAME',
  SETTLEMENT_STARTED: 'CHAIN',
  SETTLEMENT_CONFIRMED: 'CHAIN',
  SETTLEMENT_FAILED: 'ERROR',
  CLAIM_SUBMITTED: 'CHAIN',
  GAME_COMPLETED: 'SUCCESS',
  DEMO_RESET: 'WARN',
};

/**
 * Persist events and notify subscribers. Logging must never take down a game
 * transition, so failures are reported to the server console and swallowed.
 */
export async function emitEvents(
  roomId: string,
  events: EmitEvent[],
  options: { version?: number; reason?: string } = {},
): Promise<GameEvent[]> {
  if (events.length === 0) return [];
  const now = Date.now();
  const records = events.map((event, index) => ({
    id: newId('evt'),
    roomId,
    type: event.type,
    level: event.level ?? DEFAULT_LEVELS[event.type] ?? 'INFO',
    message: event.message,
    payload: event.payload ?? {},
    // Preserve ordering when several events are written in one batch.
    createdAt: now + index,
  }));

  try {
    const written = await getStore().appendEvents(records);
    void broadcastRoom(roomId, {
      seq: highestSeq(written),
      version: options.version ?? 0,
      reason: options.reason ?? events[events.length - 1].type,
    });
    return written;
  } catch (error) {
    console.error('[buzzin] failed to persist events', error);
    return [];
  }
}

export async function emitEvent(
  roomId: string,
  event: EmitEvent,
  options: { version?: number } = {},
): Promise<void> {
  await emitEvents(roomId, [event], options);
}

/** Renders one stored event as a terminal line. */
export function formatEventLine(event: GameEvent): string {
  const time = new Date(event.createdAt).toISOString().slice(11, 23);
  const details = Object.entries(event.payload)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ');
  return `[${time}] ${event.type}${details ? ` ${details}` : ''}`;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value.includes(' ') ? `"${value}"` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
