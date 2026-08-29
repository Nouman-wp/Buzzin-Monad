'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Wordmark } from '@/components/shared/brand';
import { SignInPanel } from '@/components/shared/sign-in';
import { useSession } from '@/components/shared/session';
import { useCountdown, useRoomStream } from '@/components/shared/use-room-stream';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dot,
  ErrorState,
  Skeleton,
  Stat,
  cx,
} from '@/components/shared/ui';
import { StatusBadge } from '@/components/host/host-home';
import { EventTerminal } from '@/components/host/terminal';
import { QuestionReview } from '@/components/host/question-review';
import { SharePanel } from '@/components/host/share-panel';
import { AiPanel } from '@/components/host/ai-panel';
import { SettlementPanel } from '@/components/host/settlement-panel';
import { PlayerTable } from '@/components/host/player-table';
import { formatMon } from '@/lib/util/money';
import { MODE_LABELS } from '@/lib/content';
import type { HostSnapshot } from '@/lib/types';

/**
 * The host dashboard.
 *
 * Desktop-first and dense, but it collapses cleanly onto a tablet. The layout
 * follows the shape of a live event: what's happening right now on the left,
 * who's winning and what the Game Master decided on the right, and the raw
 * event stream underneath everything as the ground truth.
 */

/** localStorage key for the per-room presentation-mode preference. */
const HIDE_ANSWERS_KEY = (roomId: string) => `buzzin:hide-answers:${roomId}`;

function intervalFor(snapshot: HostSnapshot | null): number {
  if (!snapshot) return 1000;
  switch (snapshot.room.phase) {
    case 'ROUND_ACTIVE':
      return 700;
    case 'STARTING':
    case 'INTERMISSION':
      return 600;
    default:
      return snapshot.room.status === 'LOBBY' ? 1500 : 2500;
  }
}

export function HostDashboard({ roomId }: { roomId: string }) {
  const { user, config, loading: sessionLoading } = useSession();
  const [action, setAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // null until the host expresses a preference; see `answersHidden` below.
  const [hidePreference, setHidePreference] = useState<boolean | null>(null);

  const realtime = useMemo(
    () =>
      config?.supabaseUrl && config.supabaseAnonKey
        ? { url: config.supabaseUrl, anonKey: config.supabaseAnonKey, roomId }
        : null,
    [config, roomId],
  );

  const { data, error, loading, stale, refresh } = useRoomStream<HostSnapshot>({
    url: `/api/rooms/${roomId}`,
    interval: intervalFor,
    enabled: !sessionLoading && Boolean(user),
    realtime,
  });

  const running = data?.room.status === 'RUNNING';

  // A dedicated tick keeps rounds advancing at a steadier cadence than the
  // snapshot poll, which matters most in the gap between two rounds.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      void fetch(`/api/games/${roomId}/tick`, { method: 'POST' }).catch(() => {});
    }, 700);
    return () => clearInterval(id);
  }, [running, roomId]);

  const control = useCallback(
    async (name: string, url: string) => {
      setAction(name);
      setActionError(null);
      try {
        const response = await fetch(url, { method: 'POST' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? 'Action failed');
        await refresh();
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : 'Action failed');
      } finally {
        setAction(null);
      }
    },
    [refresh],
  );

  // Presentation mode is remembered per room, because a host who hid the answer
  // keys for a projector wants them still hidden after a refresh mid-game.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(HIDE_ANSWERS_KEY(roomId));
      if (stored !== null) setHidePreference(stored === '1');
    } catch {
      // Private browsing or a blocked storage partition. The default applies.
    }
  }, [roomId]);

  /**
   * Default to hiding once the game is live: that is the point at which the
   * dashboard is likely to be on a screen other people can see, and the point
   * at which the host no longer needs the keys. An explicit choice always wins.
   */
  const answersHidden = hidePreference ?? (data ? data.room.status !== 'LOBBY' : false);

  const toggleAnswers = useCallback(() => {
    const next = !answersHidden;
    setHidePreference(next);
    try {
      window.localStorage.setItem(HIDE_ANSWERS_KEY(roomId), next ? '1' : '0');
    } catch {
      // Not persisting is survivable; the toggle still works for this session.
    }
  }, [answersHidden, roomId]);

  if (sessionLoading) return <DashboardSkeleton />;

  if (!user) {
    return (
      <Shell>
        <Card className="mx-auto mt-16 max-w-md p-6">
          <SignInPanel heading="Sign in to open this dashboard" description="Host access only." />
        </Card>
      </Shell>
    );
  }

  if (error && !data) {
    return (
      <Shell>
        <div className="mt-10 max-w-lg">
          <ErrorState message={error} onRetry={() => void refresh()} />
          <Link href="/host" className="mt-4 inline-block text-sm text-ink-300 hover:text-ink-100">
            ← Back to your rooms
          </Link>
        </div>
      </Shell>
    );
  }

  if (loading && !data) return <DashboardSkeleton />;
  if (!data) return <DashboardSkeleton />;

  const { room } = data;
  const locked = room.status !== 'LOBBY';

  return (
    <Shell stale={stale} answersHidden={answersHidden} onToggleAnswers={toggleAnswers}>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={room.status} />
            <Badge tone="volt">{MODE_LABELS[room.config.mode]}</Badge>
            <Badge tone="neutral">{room.config.topic}</Badge>
            {room.config.aiGameMasterEnabled && <Badge tone="volt">Game Master on</Badge>}
          </div>
          <h1 className="font-display mt-2.5 truncate text-3xl text-ink-50">
            {room.config.name}
          </h1>
          <p className="tnum mt-1 text-sm text-ink-400">
            {room.code} · {Object.keys(room.players).length}/{room.config.maxPlayers} players ·{' '}
            {room.config.questionCount} rounds
          </p>
        </div>

        <HostControls
          snapshot={data}
          action={action}
          onControl={control}
        />
      </div>

      {actionError && (
        <div className="mt-4">
          <ErrorState message={actionError} />
        </div>
      )}

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <LiveMonitor snapshot={data} answersHidden={answersHidden} />
          {room.status === 'LOBBY' && <SharePanel snapshot={data} />}
          <QuestionReview
            roomId={roomId}
            config={room.config}
            questions={room.challenges}
            aiEnabled={Boolean(config?.aiEnabled)}
            locked={locked}
            hideAnswers={answersHidden}
            onToggleHideAnswers={toggleAnswers}
            onChanged={refresh}
          />
        </div>

        <div className="min-w-0 space-y-5">
          <LeaderboardPanel snapshot={data} />
          <AiPanel snapshot={data} aiEnabled={Boolean(config?.aiEnabled)} />
          <SettlementPanel snapshot={data} onRefresh={refresh} />
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="h-[380px] min-w-0">
          <EventTerminal gameId={roomId} />
        </div>
        <PlayerTable snapshot={data} />
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------------- layout

function Shell({
  children,
  stale,
  answersHidden,
  onToggleAnswers,
}: {
  children: React.ReactNode;
  stale?: boolean;
  answersHidden?: boolean;
  onToggleAnswers?: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-[1400px] px-5 pb-16 pt-6 sm:px-8">
      <header className="flex items-center justify-between gap-3">
        <Wordmark />
        <div className="flex items-center gap-3">
          {stale && (
            <span className="flex items-center gap-1.5 text-xs text-amber-500">
              <Dot tone="amber" /> reconnecting
            </span>
          )}
          {onToggleAnswers && (
            // Duplicated from the Questions panel on purpose: this is the
            // control you reach for when the projector is already live and the
            // panel is somewhere below the fold.
            <button
              type="button"
              onClick={onToggleAnswers}
              aria-pressed={answersHidden}
              title="Mask answer keys so this dashboard is safe to project"
              className={cx(
                'rounded-full border px-4 py-2 text-sm transition-colors',
                answersHidden
                  ? 'border-volt-500/40 bg-volt-500/10 text-volt-300'
                  : 'border-[var(--hairline-strong)] bg-ink-850/60 text-ink-300 backdrop-blur-sm hover:bg-ink-800',
              )}
            >
              {answersHidden ? 'Answers hidden' : 'Hide answers'}
            </button>
          )}
          <Link
            href="/dashboard"
            className="rounded-full border border-[var(--hairline-strong)] bg-ink-850/60 px-4 py-2 text-sm text-ink-200 backdrop-blur-sm transition-colors hover:border-volt-500/40 hover:bg-ink-800"
          >
            My dashboard
          </Link>
          <Link
            href="/host"
            className="rounded-full border border-[var(--hairline-strong)] bg-ink-850/60 px-4 py-2 text-sm text-ink-200 backdrop-blur-sm transition-colors hover:border-volt-500/40 hover:bg-ink-800"
          >
            All rooms
          </Link>
        </div>
      </header>
      {children}
    </main>
  );
}

function DashboardSkeleton() {
  return (
    <Shell>
      <div className="mt-8 space-y-5">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------------ control

function HostControls({
  snapshot,
  action,
  onControl,
}: {
  snapshot: HostSnapshot;
  action: string | null;
  onControl: (name: string, url: string) => Promise<void>;
}) {
  const { room } = snapshot;
  const roomId = room.id;
  const approved = room.challenges.filter((q) => q.status === 'APPROVED').length;
  const players = Object.keys(room.players).length;

  const cannotStart =
    players === 0
      ? 'Wait for at least one player'
      : approved < room.config.questionCount
        ? `Approve ${room.config.questionCount - approved} more question${room.config.questionCount - approved === 1 ? '' : 's'}`
        : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {room.status === 'LOBBY' && (
        <>
          {cannotStart && <span className="text-xs text-amber-500">{cannotStart}</span>}
          <Button
            size="md"
            loading={action === 'start'}
            disabled={Boolean(cannotStart)}
            onClick={() => onControl('start', `/api/rooms/${roomId}/start`)}
          >
            Start game
          </Button>
        </>
      )}

      {room.status === 'RUNNING' && (
        <>
          <Button
            size="md"
            variant="secondary"
            loading={action === 'skip'}
            onClick={() => onControl('skip', `/api/rooms/${roomId}/skip`)}
          >
            Skip round
          </Button>
          <Button
            size="md"
            variant="secondary"
            loading={action === 'pause'}
            onClick={() => onControl('pause', `/api/rooms/${roomId}/pause`)}
          >
            Pause
          </Button>
        </>
      )}

      {room.status === 'PAUSED' && (
        <Button
          size="md"
          loading={action === 'resume'}
          onClick={() => onControl('resume', `/api/rooms/${roomId}/resume`)}
        >
          Resume
        </Button>
      )}

      {(room.status === 'RUNNING' || room.status === 'PAUSED' || room.status === 'LOBBY') && (
        <Button
          size="md"
          variant="danger"
          loading={action === 'end'}
          onClick={() => onControl('end', `/api/rooms/${roomId}/end`)}
        >
          {room.status === 'LOBBY' ? 'Cancel room' : 'End game'}
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------- live monitor

function LiveMonitor({
  snapshot,
  answersHidden,
}: {
  snapshot: HostSnapshot;
  answersHidden: boolean;
}) {
  const { room, liveCounts, currentChallenge } = snapshot;
  const round = room.rounds.find((entry) => entry.roundNumber === room.currentRound);
  const deadline =
    room.phase === 'ROUND_ACTIVE' ? (round?.endsAt ?? null) : room.phaseEndsAt;
  const remaining = useCountdown(deadline, snapshot.serverTime);
  const seconds = Math.ceil(remaining / 1000);

  const active = Object.values(room.players).filter((player) => !player.eliminated).length;

  return (
    <Card>
      <CardHeader
        title="Live game"
        subtitle={
          room.status === 'LOBBY'
            ? 'Waiting in the lobby'
            : `Round ${room.currentRound} of ${room.config.questionCount} · ${room.phase.replace('_', ' ').toLowerCase()}`
        }
        action={
          room.status === 'RUNNING' && (
            <span
              className={cx(
                'tnum text-2xl font-semibold',
                seconds <= 3 && room.phase === 'ROUND_ACTIVE' ? 'text-rose-500' : 'text-ink-50',
              )}
            >
              {String(Math.max(0, seconds)).padStart(2, '0')}s
            </span>
          )
        }
      />

      <div className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
        <Stat label="Active" value={active} hint={`of ${Object.keys(room.players).length}`} />
        <Stat label="Answered" value={liveCounts.answered} hint={`${liveCounts.pending} pending`} />
        <Stat
          label="Correct"
          value={liveCounts.correct}
          hint={`${liveCounts.wrong} wrong`}
          tone="mint"
        />
        <Stat
          label="Prize pool"
          value={formatMon(room.prizePoolWei)}
          hint="MON"
          tone="volt"
        />
      </div>

      {currentChallenge && room.status !== 'LOBBY' && (
        <div className="border-t border-[var(--hairline)] p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
            On screen now
          </p>
          <p className="mt-1.5 text-sm font-medium leading-snug text-ink-50">
            {currentChallenge.question}
          </p>
          <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {currentChallenge.options.map((option, index) => (
              <li
                key={index}
                className={cx(
                  'rounded-lg border px-3 py-2 text-sm',
                  // The answer key is masked in presentation mode: this panel is
                  // the one most likely to be facing the room mid-round.
                  !answersHidden && index === currentChallenge.correctAnswerIndex
                    ? 'border-mint-500/35 bg-mint-500/8 text-mint-400'
                    : 'border-[var(--hairline)] bg-ink-850 text-ink-300',
                )}
              >
                <span className="mr-2 text-xs text-ink-500">
                  {String.fromCharCode(65 + index)}
                </span>
                {option}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}

// -------------------------------------------------------------- leaderboard

function LeaderboardPanel({ snapshot }: { snapshot: HostSnapshot }) {
  const entries = snapshot.room.leaderboard;
  return (
    <Card>
      <CardHeader title="Leaderboard" subtitle={`${entries.length} players ranked`} />
      {entries.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-500">
          Rankings appear after the first round.
        </p>
      ) : (
        <ul className="max-h-[340px] divide-y divide-[var(--hairline)] overflow-y-auto scroll-thin">
          {entries.map((entry) => (
            <li key={entry.playerId} className="flex items-center gap-3 px-5 py-2.5">
              <span
                className={cx(
                  'tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold',
                  entry.rank === 1
                    ? 'bg-amber-500/20 text-amber-500'
                    : entry.rank <= 5
                      ? 'bg-ink-700 text-ink-100'
                      : 'bg-transparent text-ink-500',
                )}
              >
                {entry.rank}
              </span>
              <span
                className={cx(
                  'min-w-0 flex-1 truncate text-sm',
                  entry.eliminated ? 'text-ink-500 line-through' : 'text-ink-100',
                )}
              >
                {entry.displayName}
              </span>
              <span className="tnum text-xs text-ink-500">
                {formatMon(entry.balanceWei)}
              </span>
              {entry.delta !== 0 && (
                <span
                  className={cx(
                    'tnum text-[11px]',
                    entry.delta > 0 ? 'text-mint-400' : 'text-rose-500',
                  )}
                >
                  {entry.delta > 0 ? '▲' : '▼'}
                  {Math.abs(entry.delta)}
                </span>
              )}
              <span className="tnum w-12 shrink-0 text-right text-sm font-semibold text-ink-50">
                {entry.score}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
