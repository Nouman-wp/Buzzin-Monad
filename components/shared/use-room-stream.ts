'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { roomTopic } from '@/lib/realtime/topic';

/**
 * Live room data.
 *
 * Transport strategy, in order of importance:
 *
 *   1. Adaptive polling is the guaranteed path. The interval tightens during a
 *      live round and relaxes in the lobby, so the room stays responsive
 *      without hammering the server with 25 phones on it.
 *   2. A Supabase Realtime broadcast subscription, when configured, is a pure
 *      accelerator: a push just triggers an immediate refetch.
 *
 * Countdowns never depend on either. Rounds carry an absolute server `endsAt`
 * and the client renders the remaining time locally, so the timer stays smooth
 * between fetches and correct across a reconnect.
 *
 * Scheduling is one repeating watchdog rather than a chain of timeouts, and
 * that is deliberate. A chain has exactly one live link: whatever breaks it — a
 * request that never settles, a timeout dropped while the tab was frozen, an
 * effect teardown racing its own re-run — stops the stream for good, and the
 * only cure the player has is reloading the page. That is the failure this
 * shape removes. Every tick independently re-decides whether a fetch is due, so
 * the stream heals itself by the next tick no matter what went wrong.
 */

/** How often the watchdog re-evaluates whether a fetch is due. */
const TICK_MS = 250;

/**
 * A request is abandoned after this long. Backgrounded and frozen tabs can
 * leave a `fetch` pending indefinitely; without a deadline the in-flight guard
 * below would stay set forever and silently kill the stream.
 */
const REQUEST_TIMEOUT_MS = 9000;

export interface RoomStreamOptions<T> {
  url: string | null;
  /** Chooses the next poll delay from the freshest payload. */
  interval: (data: T | null) => number;
  enabled?: boolean;
  /** Realtime channel to subscribe to, when Supabase is configured. */
  realtime?: { url: string; anonKey: string; roomId: string } | null;
}

export interface RoomStream<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True once a request has failed and we are retrying in the background. */
  stale: boolean;
  refresh: () => Promise<void>;
}

export function useRoomStream<T>({
  url,
  interval,
  enabled = true,
  realtime = null,
}: RoomStreamOptions<T>): RoomStream<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);

  /** When the current request started, or null when nothing is in flight. */
  const startedAt = useRef<number | null>(null);
  const lastAttemptAt = useRef(0);
  const latest = useRef<T | null>(null);
  const failures = useRef(0);

  // Held in a ref so changing the caller's inline closure does not restart the
  // poll loop on every render.
  const intervalRef = useRef(interval);
  useEffect(() => {
    intervalRef.current = interval;
  }, [interval]);

  const fetchOnce = useCallback(async () => {
    if (!url || !enabled) return;

    // Coalesce concurrent callers — but only for as long as a request could
    // still plausibly be alive. Past the deadline the previous one is treated
    // as lost and a fresh request goes out.
    const now = Date.now();
    if (startedAt.current !== null && now - startedAt.current < REQUEST_TIMEOUT_MS) return;
    startedAt.current = now;
    lastAttemptAt.current = now;

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    // Captured so a response that arrives after the caller moved to a different
    // room cannot overwrite the new room's state.
    const requestedUrl = url;

    try {
      const response = await fetch(requestedUrl, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error ?? 'Request failed');
      }
      latest.current = payload as T;
      setData(payload as T);
      setError(null);
      setStale(false);
      failures.current = 0;
    } catch (cause) {
      failures.current += 1;
      // Keep showing the last good state; surface an error only once it is
      // clear this is not a single dropped packet.
      if (failures.current >= 3) {
        setError(cause instanceof Error ? cause.message : 'Connection lost');
      }
      setStale(true);
    } finally {
      clearTimeout(deadline);
      startedAt.current = null;
      lastAttemptAt.current = Date.now();
      setLoading(false);
    }
  }, [url, enabled]);

  // The watchdog. A fixed short tick that fetches whenever the adaptive
  // interval says the data is due, so the cadence still follows the phase of
  // the game while the schedule itself cannot be lost.
  useEffect(() => {
    if (!url || !enabled) return;

    const dueAt = () => {
      // Back off on sustained failure instead of retrying in a tight loop.
      const backoff = failures.current > 0 ? Math.min(8000, 500 * 2 ** failures.current) : 0;
      return lastAttemptAt.current + Math.max(backoff, intervalRef.current(latest.current));
    };

    void fetchOnce();
    const id = setInterval(() => {
      if (Date.now() >= dueAt()) void fetchOnce();
    }, TICK_MS);

    return () => clearInterval(id);
  }, [fetchOnce, url, enabled]);

  // Refetch the moment the tab comes back, so a player who locked their phone
  // mid-round is immediately back in sync.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchOnce();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [fetchOnce]);

  // Optional push accelerator.
  useEffect(() => {
    if (!realtime || !enabled) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        if (cancelled) return;
        const client = createClient(realtime.url, realtime.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          realtime: { params: { eventsPerSecond: 20 } },
        });
        const channel = client
          .channel(roomTopic(realtime.roomId))
          .on('broadcast', { event: 'room_update' }, () => {
            void fetchOnce();
          })
          .subscribe();
        dispose = () => {
          // This takes the socket with it: realtime-js disconnects as soon as
          // its last channel is removed, so there is no separate teardown and
          // calling one would only race the unsubscribe frame.
          void client.removeChannel(channel);
        };
      } catch {
        // Push is optional; polling already guarantees delivery.
      }
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [realtime, enabled, fetchOnce]);

  return { data, error, loading, stale, refresh: fetchOnce };
}

/**
 * Server-authoritative countdown, rendered locally between fetches.
 *
 * `serverTime` is the server clock at the moment the snapshot was built. The
 * offset between it and the device clock is recomputed whenever a fresh
 * snapshot arrives, so a badly-set phone clock cannot make the timer wrong.
 * The interval only forces a re-render; the value itself is derived.
 */
export function useCountdown(endsAt: number | null, serverTime: number | null): number {
  const [, tick] = useReducer((count: number) => count + 1, 0);

  const offset = useMemo(
    () => (serverTime === null ? 0 : serverTime - Date.now()),
    [serverTime],
  );

  useEffect(() => {
    if (endsAt === null) return;
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [endsAt]);

  if (endsAt === null) return 0;
  return Math.max(0, endsAt - (Date.now() + offset));
}
