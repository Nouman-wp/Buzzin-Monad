'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Badge, Button, cx } from '@/components/shared/ui';
import type { EventLevel, GameEvent } from '@/lib/types';

/**
 * The live event terminal.
 *
 * Every line comes from a real application event written by an actual state
 * transition — nothing here is scripted for the demo. New events are fetched
 * incrementally by sequence number, so the panel streams instead of reloading.
 */

interface TerminalEvent extends GameEvent {
  line: string;
}

const LEVEL_STYLES: Record<EventLevel, string> = {
  INFO: 'text-ink-300',
  SUCCESS: 'text-mint-400',
  WARN: 'text-amber-500',
  ERROR: 'text-rose-500',
  AI: 'text-volt-300',
  CHAIN: 'text-sky-500',
  GAME: 'text-ink-100',
  PLAYER: 'text-ink-400',
};

export function EventTerminal({ gameId }: { gameId: string }) {
  const [events, setEvents] = useState<TerminalEvent[]>([]);
  const [cleared, setCleared] = useState(0);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sinceRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled || paused) return;
      try {
        const response = await fetch(
          `/api/games/${gameId}/logs?since=${sinceRef.current}&limit=200`,
          { cache: 'no-store' },
        );
        if (!response.ok) throw new Error('Log stream unavailable');
        const data = (await response.json()) as { events: TerminalEvent[]; latestSeq: number };
        if (cancelled) return;
        if (data.events.length > 0) {
          sinceRef.current = data.latestSeq;
          setEvents((current) => {
            const merged = [...current, ...data.events];
            // Bound the buffer so a long session cannot grow without limit.
            return merged.length > 500 ? merged.slice(-400) : merged;
          });
        }
        setError(null);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Log stream unavailable');
        }
      }
    };

    void poll();
    const id = setInterval(poll, 1200);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [gameId, paused]);

  // Track whether the operator has scrolled up to read history; only autoscroll
  // when they are already pinned to the newest line.
  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    pinnedRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 40;
  };

  useLayoutEffect(() => {
    if (!pinnedRef.current) return;
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [events]);

  const visible = events.filter((event) => event.seq > cleared);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-[var(--radius-card)] border border-[var(--hairline)] bg-ink-950/80">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--hairline)] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-300">
            Event stream
          </h2>
          <Badge tone={error ? 'rose' : paused ? 'amber' : 'mint'}>
            {error ? 'offline' : paused ? 'paused' : 'live'}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setPaused((value) => !value)}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCleared(events.at(-1)?.seq ?? 0)}
          >
            Clear
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3 font-[family-name:var(--font-mono)] text-[11.5px] leading-[1.65]"
        role="log"
        aria-live="polite"
        aria-label="Application event stream"
      >
        {visible.length === 0 ? (
          <p className="text-ink-600">Waiting for events…</p>
        ) : (
          visible.map((event) => (
            <p key={event.id} className={cx('whitespace-pre-wrap break-words', LEVEL_STYLES[event.level])}>
              {event.line}
            </p>
          ))
        )}
        {error && <p className="mt-2 text-rose-500">! {error}</p>}
      </div>
    </div>
  );
}
