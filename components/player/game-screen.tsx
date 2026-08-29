'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/shared/session';
import { useCountdown, useRoomStream } from '@/components/shared/use-room-stream';
import { Badge, Button, Card, Dot, ErrorState, Skeleton, cx } from '@/components/shared/ui';
import { Wordmark } from '@/components/shared/brand';
import { AccountLink } from '@/components/account/account-link';
import { formatMon } from '@/lib/util/money';
import { MODE_LABELS } from '@/lib/content';
import { SignInPanel } from '@/components/shared/sign-in';
import { Lobby } from '@/components/player/lobby';
import { AnswerGrid } from '@/components/player/answer-grid';
import { ResultsScreen } from '@/components/player/results-screen';
import type { PlayerSnapshot } from '@/lib/types';

/**
 * The player's whole game.
 *
 * One screen that swaps between lobby, countdown, question, result, and final
 * standings. Everything shown is server state; the only thing computed locally
 * is the countdown, which ticks down to a server-issued deadline.
 */

/** Poll cadence by phase — tight while a round is live, relaxed otherwise. */
function intervalFor(snapshot: PlayerSnapshot | null): number {
  if (!snapshot) return 1000;
  switch (snapshot.room.phase) {
    case 'ROUND_ACTIVE':
      return 900;
    case 'STARTING':
    case 'INTERMISSION':
      return 700;
    case 'COMPLETED':
      return 4000;
    case 'LOBBY':
      // Arrivals are the only thing happening here and the whole point of the
      // screen is watching the room fill, so it is worth a tight cadence even
      // though nothing is at stake yet.
      return 1200;
    default:
      return 1500;
  }
}

export function GameScreen({ gameId }: { gameId: string }) {
  const router = useRouter();
  const { user, config, loading: sessionLoading } = useSession();

  const realtime = useMemo(
    () =>
      config?.supabaseUrl && config.supabaseAnonKey
        ? { url: config.supabaseUrl, anonKey: config.supabaseAnonKey, roomId: gameId }
        : null,
    [config, gameId],
  );

  const { data, error, loading, stale, refresh } = useRoomStream<PlayerSnapshot>({
    url: `/api/games/${gameId}/state`,
    interval: intervalFor,
    enabled: !sessionLoading,
    realtime,
  });

  if (sessionLoading || (loading && !data)) return <GameSkeleton />;

  if (!user) {
    return (
      <Shell>
        <Card className="mt-10 p-6">
          <SignInPanel
            heading="Sign in to continue"
            description="Your place in this game is waiting."
          />
        </Card>
      </Shell>
    );
  }

  if (error && !data) {
    return (
      <Shell>
        <div className="mt-10">
          <ErrorState message={error} onRetry={() => void refresh()} />
        </div>
      </Shell>
    );
  }

  if (!data) return <GameSkeleton />;

  if (!data.me) {
    return (
      <Shell>
        <Card className="mt-10 p-6 text-center">
          <h1 className="font-display text-xl text-ink-50">You&apos;re not in this room</h1>
          <p className="mt-2 text-sm text-ink-400">
            Scan the host&apos;s QR code or enter the room code to join.
          </p>
          <Button className="mt-5" block size="lg" onClick={() => router.push('/')}>
            Find a room
          </Button>
        </Card>
      </Shell>
    );
  }

  return <ActiveGame gameId={gameId} snapshot={data} stale={stale} onRefresh={refresh} />;
}

function ActiveGame({
  gameId,
  snapshot,
  stale,
  onRefresh,
}: {
  gameId: string;
  snapshot: PlayerSnapshot;
  stale: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { room, me } = snapshot;
  const phase = room.phase;

  if (room.status === 'COMPLETED' || room.status === 'FINALIZING' || phase === 'COMPLETED') {
    return (
      <Shell stale={stale}>
        <ResultsScreen gameId={gameId} snapshot={snapshot} onRefresh={onRefresh} />
      </Shell>
    );
  }

  if (room.status === 'CANCELLED') {
    return (
      <Shell stale={stale}>
        <Card className="mt-10 p-6 text-center">
          <h1 className="font-display text-xl text-ink-50">This room was cancelled</h1>
          <p className="mt-2 text-sm text-ink-400">
            Nothing was staked. Ask the host for the next room code.
          </p>
        </Card>
      </Shell>
    );
  }

  if (phase === 'LOBBY') {
    return (
      <Shell stale={stale}>
        <Lobby snapshot={snapshot} />
      </Shell>
    );
  }

  if (phase === 'STARTING') {
    return <Countdown snapshot={snapshot} />;
  }

  return (
    <Shell stale={stale}>
      <PlayerHud snapshot={snapshot} />
      {me!.eliminated ? (
        <EliminatedPanel snapshot={snapshot} />
      ) : phase === 'ROUND_ACTIVE' ? (
        <RoundView gameId={gameId} snapshot={snapshot} onRefresh={onRefresh} />
      ) : (
        <RoundResult snapshot={snapshot} />
      )}
      <MiniLeaderboard snapshot={snapshot} />
    </Shell>
  );
}

// ------------------------------------------------------------------- layout

function Shell({ children, stale }: { children: React.ReactNode; stale?: boolean }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-8 pt-5">
      <header className="flex items-center justify-between gap-2">
        <Wordmark size="sm" />
        <div className="flex items-center gap-2">
          {stale && (
            <span className="flex items-center gap-1.5 text-xs text-amber-500">
              <Dot tone="amber" /> reconnecting
            </span>
          )}
          <AccountLink compact />
        </div>
      </header>
      {children}
    </main>
  );
}

function GameSkeleton() {
  return (
    <Shell>
      <div className="mt-8 space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- countdown

function Countdown({ snapshot }: { snapshot: PlayerSnapshot }) {
  const remaining = useCountdown(snapshot.room.phaseEndsAt, snapshot.room.serverTime);
  const seconds = Math.ceil(remaining / 1000);
  const label = seconds <= 0 ? 'GO' : String(seconds);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-volt-300">
        {snapshot.room.name}
      </p>
      <p
        key={label}
        className="tnum font-display text-shine animate-pop mt-6 text-[8rem] leading-none"
      >
        {label}
      </p>
      <p className="mt-6 text-sm text-ink-400">
        {snapshot.room.totalRounds} rounds · {MODE_LABELS[snapshot.room.mode]}
      </p>
    </main>
  );
}

// ---------------------------------------------------------------------- hud

function PlayerHud({ snapshot }: { snapshot: PlayerSnapshot }) {
  const me = snapshot.me!;
  const balance = BigInt(me.currentGameBalanceWei);
  const low = balance <= BigInt('100000000000000000'); // 0.1 MON — one wrong answer left

  return (
    <div className="mt-4 grid grid-cols-3 gap-2">
      <HudCell label="Score" value={me.score} tone="volt" />
      <HudCell
        label="Balance"
        value={`${formatMon(me.currentGameBalanceWei)}`}
        tone={low ? 'rose' : 'default'}
        hint="MON"
      />
      <HudCell label="Rank" value={me.rank > 0 ? `#${me.rank}` : '—'} />
    </div>
  );
}

function HudCell({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'volt' | 'rose';
}) {
  const tones = {
    default: 'text-ink-50',
    volt: 'text-volt-300',
    rose: 'text-rose-500',
  } as const;
  return (
    <div className="rounded-xl border border-[var(--hairline)] bg-ink-900/70 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-400">{label}</p>
      <p className={cx('tnum mt-0.5 text-lg font-semibold tracking-tight', tones[tone])}>
        {value}
        {hint && <span className="ml-1 text-[11px] font-normal text-ink-500">{hint}</span>}
      </p>
    </div>
  );
}

// -------------------------------------------------------------------- round

function RoundView({
  gameId,
  snapshot,
  onRefresh,
}: {
  gameId: string;
  snapshot: PlayerSnapshot;
  onRefresh: () => Promise<void>;
}) {
  const { challenge, round, room } = snapshot;
  const remaining = useCountdown(round?.endsAt ?? null, room.serverTime);
  const audioRef = useRef<HTMLAudioElement>(null);

  // All transient round state is keyed by round number and derived, never
  // synced with an effect. That way a new round resets the panel implicitly
  // and a reconnect mid-round restores the locked answer from the server.
  const roundNumber = round?.roundNumber ?? 0;
  const [local, setLocal] = useState<{
    round: number;
    pending: number | null;
    locked: number | null;
    error: string | null;
  }>({ round: roundNumber, pending: null, locked: null, error: null });

  const current = local.round === roundNumber ? local : null;
  // The server's view wins unless we have a newer optimistic lock for this
  // exact round, which is what makes the tap feel instant.
  const locked = current?.locked ?? snapshot.myAnswerIndex;
  const submitting = current?.pending ?? null;
  const submitError = current?.error ?? null;

  // Songless: start the clip as soon as the round opens.
  useEffect(() => {
    const element = audioRef.current;
    if (!element || !challenge?.audioUrl) return;
    element.currentTime = 0;
    void element.play().catch(() => {
      // Autoplay blocked — the visible control is the fallback.
    });
  }, [challenge?.audioUrl, round?.roundNumber]);

  const answer = useCallback(
    async (index: number) => {
      if (locked !== null || submitting !== null || !round) return;
      const forRound = round.roundNumber;
      setLocal({ round: forRound, pending: index, locked: null, error: null });
      try {
        const response = await fetch(`/api/games/${gameId}/answer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            roundNumber: forRound,
            answerIndex: index,
            clientTs: Date.now(),
          }),
        });
        const data = await response.json().catch(() => ({}));
        // A duplicate means the server already holds an answer from us, which
        // is a success from the player's point of view, not an error.
        if (!response.ok && response.status !== 409) {
          throw new Error((data as { error?: string }).error ?? 'Could not send your answer');
        }
        setLocal({ round: forRound, pending: null, locked: index, error: null });
      } catch (cause) {
        setLocal({
          round: forRound,
          pending: null,
          locked: null,
          error: cause instanceof Error ? cause.message : 'Could not send your answer',
        });
        void onRefresh();
      }
    },
    [gameId, locked, submitting, round, onRefresh],
  );

  if (!challenge || !round) {
    return (
      <Card className="mt-4 p-6">
        <p className="text-sm text-ink-400">Loading the next round…</p>
      </Card>
    );
  }

  const seconds = Math.ceil(remaining / 1000);
  const fraction = remaining / 10000;
  const urgent = seconds <= 3;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-400">
          Round {round.roundNumber} of {room.totalRounds}
        </span>
        <span
          className={cx(
            'tnum text-2xl font-semibold tabular-nums transition-colors',
            urgent ? 'text-rose-500' : 'text-ink-50',
            urgent && seconds > 0 && 'animate-pulse-soft',
          )}
        >
          {String(Math.max(0, seconds)).padStart(2, '0')}s
        </span>
      </div>

      <div
        className="mt-2 h-1 overflow-hidden rounded-full bg-ink-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={seconds}
        aria-label="Time remaining"
      >
        <div
          className={cx(
            'h-full rounded-full transition-[width] duration-100 ease-linear',
            urgent ? 'bg-rose-500' : 'bg-volt-500',
          )}
          style={{ width: `${Math.max(0, Math.min(100, fraction * 100))}%` }}
        />
      </div>

      <Card className="mt-4 p-5">
        {challenge.audioUrl && (
          <div className="mb-4">
            <audio
              ref={audioRef}
              src={challenge.audioUrl}
              controls
              preload="auto"
              className="w-full"
              aria-label="Round audio clip"
            />
            <p className="mt-2 text-xs text-ink-500">
              Tap play if the clip doesn&apos;t start on its own.
            </p>
          </div>
        )}

        <h1 className="font-display text-xl leading-snug text-ink-50">
          {challenge.question}
        </h1>

        {challenge.pattern && (
          <p className="tnum mt-3 font-[family-name:var(--font-mono)] text-base tracking-[0.2em] text-volt-300">
            {challenge.pattern}
          </p>
        )}
      </Card>

      <AnswerGrid
        options={challenge.options}
        locked={locked}
        submitting={submitting}
        disabled={locked !== null || seconds <= 0}
        onAnswer={answer}
      />

      {locked !== null && (
        <div className="animate-rise mt-4 rounded-xl border border-volt-500/30 bg-volt-500/8 px-4 py-3 text-center">
          <p className="text-sm font-medium text-volt-300">Answer locked</p>
          <p className="mt-0.5 text-xs text-ink-400">
            Waiting for the round to close…
          </p>
        </div>
      )}

      {submitError && (
        <div className="mt-4">
          <ErrorState message={submitError} />
        </div>
      )}
    </div>
  );
}

function RoundResult({ snapshot }: { snapshot: PlayerSnapshot }) {
  const result = snapshot.lastResult;

  if (!result) {
    return (
      <Card className="mt-4 p-6 text-center">
        <p className="text-sm text-ink-400">Scoring the round…</p>
      </Card>
    );
  }

  const correct = result.myCorrect === true;
  const missed = result.myAnswerIndex === null;

  return (
    <Card
      className={cx(
        'animate-pop mt-4 overflow-hidden border p-5 text-center',
        correct ? 'border-mint-500/35 bg-mint-500/6' : 'border-rose-500/30 bg-rose-500/6',
      )}
    >
      <p
        className={cx(
          'text-sm font-semibold uppercase tracking-[0.1em]',
          correct ? 'text-mint-400' : 'text-rose-500',
        )}
      >
        {correct ? 'Correct' : missed ? 'Out of time' : 'Wrong'}
      </p>

      {!correct && (
        <p className="tnum mt-3 text-3xl font-semibold text-rose-500">
          −{formatMon(result.penaltyWei, 1)} MON
        </p>
      )}

      {correct && (
        <p className="tnum mt-3 text-3xl font-semibold text-mint-400">
          +{snapshot.me?.score ?? 0}
          <span className="ml-1.5 text-sm font-normal text-ink-400">total</span>
        </p>
      )}

      {result.explanation && (
        <p className="mt-4 text-sm leading-relaxed text-ink-300">{result.explanation}</p>
      )}

      <p className="mt-4 text-xs text-ink-500">Next round starting…</p>
    </Card>
  );
}

function EliminatedPanel({ snapshot }: { snapshot: PlayerSnapshot }) {
  const me = snapshot.me!;
  return (
    <Card className="animate-rise mt-4 border-rose-500/25 bg-rose-500/5 p-6 text-center">
      <Badge tone="rose">Eliminated</Badge>
      <h1 className="font-display mt-4 text-xl text-ink-50">
        Your balance ran out
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-400">
        {me.wrongCount + me.timeoutCount} penalties spent your {formatMon(me.startingGameBalanceWei)} MON
        game balance. You stay on the leaderboard — stick around for the final
        standings and settlement.
      </p>
      <p className="tnum mt-5 text-2xl font-semibold text-ink-50">
        {me.score}
        <span className="ml-1.5 text-sm font-normal text-ink-400">points</span>
      </p>
    </Card>
  );
}

// -------------------------------------------------------------- leaderboard

function MiniLeaderboard({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { leaderboard, me } = snapshot;
  if (leaderboard.length === 0) return null;

  const top = leaderboard.slice(0, 5);
  const inTop = top.some((entry) => entry.playerId === me?.playerId);
  const mine = leaderboard.find((entry) => entry.playerId === me?.playerId);

  return (
    <Card className="mt-4">
      <div className="border-b border-[var(--hairline)] px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-400">
          Leaderboard
        </h2>
      </div>
      <ul className="divide-y divide-[var(--hairline)]">
        {top.map((entry) => (
          <LeaderRow
            key={entry.playerId}
            rank={entry.rank}
            name={entry.displayName}
            score={entry.score}
            delta={entry.delta}
            eliminated={entry.eliminated}
            highlight={entry.playerId === me?.playerId}
          />
        ))}
        {!inTop && mine && (
          <LeaderRow
            rank={mine.rank}
            name={mine.displayName}
            score={mine.score}
            delta={mine.delta}
            eliminated={mine.eliminated}
            highlight
          />
        )}
      </ul>
    </Card>
  );
}

function LeaderRow({
  rank,
  name,
  score,
  delta,
  eliminated,
  highlight,
}: {
  rank: number;
  name: string;
  score: number;
  delta: number;
  eliminated: boolean;
  highlight?: boolean;
}) {
  return (
    <li
      className={cx(
        'flex items-center gap-3 px-4 py-2.5 transition-colors',
        highlight && 'bg-volt-500/8',
      )}
    >
      <span className="tnum w-6 shrink-0 text-sm font-medium text-ink-400">{rank}</span>
      <span
        className={cx(
          'min-w-0 flex-1 truncate text-sm',
          eliminated ? 'text-ink-500 line-through' : 'text-ink-100',
        )}
      >
        {name}
      </span>
      {delta !== 0 && (
        <span
          className={cx(
            'tnum text-[11px] font-medium',
            delta > 0 ? 'text-mint-400' : 'text-rose-500',
          )}
        >
          {delta > 0 ? '▲' : '▼'}
          {Math.abs(delta)}
        </span>
      )}
      <span className="tnum shrink-0 text-sm font-semibold text-ink-50">{score}</span>
    </li>
  );
}
