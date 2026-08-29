'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Wordmark } from '@/components/shared/brand';
import { Avatar } from '@/components/account/avatar';
import { SignInPanel } from '@/components/shared/sign-in';
import { useSession } from '@/components/shared/session';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dot,
  EmptyState,
  ErrorState,
  Field,
  Select,
  Skeleton,
  Stat,
  cx,
} from '@/components/shared/ui';
import { formatMon } from '@/lib/util/money';
import { MODE_DESCRIPTIONS, MODE_LABELS, TOPICS_BY_MODE } from '@/lib/content';
import type { GameMode, RoomStatus } from '@/lib/types';

interface RoomRow {
  id: string;
  code: string;
  name: string;
  mode: GameMode;
  status: RoomStatus;
  players: number;
  maxPlayers: number;
  prizePoolWei: string;
  createdAt: number;
  joinUrl: string;
}

interface RoomsResponse {
  rooms: RoomRow[];
  treasury: {
    totalWei: string;
    reservedWei: string;
    availableWei: string;
    maxFundablePlayers: number;
    onChainBalanceWei: string | null;
    address: string | null;
  };
}

const MODES: GameMode[] = ['QUIZ', 'SONGLESS', 'WORDLESS'];
const DIFFICULTY_LABELS = ['Very easy', 'Easy', 'Medium', 'Hard', 'Expert'];

/**
 * Host home: create a room, or jump back into one you already own.
 *
 * The treasury headroom is shown up front because it is the one constraint
 * that can block a room from existing — much better to see it before filling
 * in a form than after submitting it.
 */
export function HostHome() {
  const { user, loading: sessionLoading } = useSession();
  const [data, setData] = useState<RoomsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/rooms', { cache: 'no-store' });
      if (response.status === 401) {
        setData(null);
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Could not load your rooms');
      setData(payload as RoomsResponse);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your rooms');
    }
  }, []);

  useEffect(() => {
    if (!sessionLoading && user) void load();
  }, [sessionLoading, user, load]);

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6 sm:px-8">
      <header className="flex items-center justify-between">
        <Wordmark />
        <div className="flex items-center gap-2">
          {user?.role === 'ADMIN' && (
            <Link
              href="/admin"
              className="rounded-full border border-[var(--hairline-strong)] bg-ink-850/60 px-4 py-2 text-sm text-ink-200 backdrop-blur-sm transition-colors hover:border-volt-500/40 hover:bg-ink-800"
            >
              Admin
            </Link>
          )}
          {user && (
            <Link
              href="/dashboard"
              className="rounded-full border border-[var(--hairline-strong)] bg-ink-850/60 px-4 py-2 text-sm text-ink-200 backdrop-blur-sm transition-colors hover:border-volt-500/40 hover:bg-ink-800"
            >
              My dashboard
            </Link>
          )}
          {user && <SignedInAs />}
        </div>
      </header>

      {sessionLoading ? (
        <div className="mt-12 space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : !user ? (
        <Card className="mx-auto mt-16 max-w-md p-6">
          <SignInPanel
            heading="Sign in to host"
            description="Create rooms, generate questions, and run the night."
          />
        </Card>
      ) : (
        <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <CreateRoomCard
            treasury={data?.treasury ?? null}
            onCreated={load}
          />
          <div className="space-y-4">
            <TreasuryCard treasury={data?.treasury ?? null} />
            <RoomsCard rooms={data?.rooms ?? null} error={error} onRetry={load} />
          </div>
        </div>
      )}
    </main>
  );
}

function SignedInAs() {
  const { user, signOut } = useSession();
  if (!user) return null;
  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--hairline-strong)] bg-ink-850/60 py-1.5 pl-1.5 pr-1.5 backdrop-blur-sm">
      <Link href="/profile" className="flex min-w-0 items-center gap-2">
        <Avatar name={user.displayName} src={user.avatarUrl} seed={user.id} size="sm" className="border-0" />
        <span className="max-w-[9rem] truncate text-sm text-ink-200">{user.displayName}</span>
      </Link>
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded-lg px-2 py-1 text-xs text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
      >
        Sign out
      </button>
    </div>
  );
}

function CreateRoomCard({
  treasury,
  onCreated,
}: {
  treasury: RoomsResponse['treasury'] | null;
  onCreated: () => Promise<void>;
}) {
  const router = useRouter();
  const [name, setName] = useState('Web3 Night');
  const [mode, setMode] = useState<GameMode>('QUIZ');
  const [topic, setTopic] = useState('Web3');
  const [difficulty, setDifficulty] = useState(3);
  const [questionCount, setQuestionCount] = useState(10);
  const [maxPlayers, setMaxPlayers] = useState(25);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cap = treasury?.maxFundablePlayers ?? 25;
  const overCap = maxPlayers > cap;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          mode,
          topic: topic.trim(),
          difficulty,
          questionCount,
          maxPlayers,
          aiGameMasterEnabled: aiEnabled,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Could not create the room');
      await onCreated();
      router.push(`/host/${data.room.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the room');
      setBusy(false);
    }
  };

  return (
    <Card as="section">
      <CardHeader
        title="Create a room"
        subtitle="Configure the game, then share the QR code."
      />
      <form onSubmit={submit} className="space-y-5 p-5">
        <Field
          label="Room name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          placeholder="Web3 Night"
        />

        <div>
          <p className="mb-2 text-xs font-medium text-ink-300">Game mode</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setMode(option);
                  setTopic(TOPICS_BY_MODE[option][0] ?? 'General');
                }}
                className={cx(
                  'rounded-2xl border p-3 text-left transition-[border-color,background-color,box-shadow]',
                  mode === option
                    ? 'glow-volt border-volt-500 bg-volt-500/10'
                    : 'border-[var(--hairline-strong)] bg-ink-850/80 hover:bg-ink-800',
                )}
              >
                <span className="block text-sm font-medium text-ink-50">
                  {MODE_LABELS[option]}
                </span>
                <span className="mt-1 block text-xs leading-snug text-ink-400">
                  {MODE_DESCRIPTIONS[option]}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            maxLength={60}
            list="topic-suggestions"
            hint="Anything you like — the Game Master writes to it."
          />
          <datalist id="topic-suggestions">
            {TOPICS_BY_MODE[mode].map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>

          <Select
            label="Difficulty"
            value={difficulty}
            onChange={(event) => setDifficulty(Number(event.target.value))}
          >
            {DIFFICULTY_LABELS.map((label, index) => (
              <option key={label} value={index + 1}>
                {index + 1} — {label}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Rounds"
            type="number"
            min={3}
            max={30}
            value={questionCount}
            onChange={(event) => setQuestionCount(Number(event.target.value))}
            hint="10 seconds each."
          />
          <Field
            label="Max players"
            type="number"
            min={1}
            max={Math.max(1, cap)}
            value={maxPlayers}
            onChange={(event) => setMaxPlayers(Number(event.target.value))}
            error={overCap ? `The treasury can fund ${cap} players right now` : null}
            hint={overCap ? undefined : `1 MON allocated per player.`}
          />
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--hairline-strong)] bg-ink-850/80 p-3.5">
          <input
            type="checkbox"
            checked={aiEnabled}
            onChange={(event) => setAiEnabled(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--color-volt-500)]"
          />
          <span>
            <span className="block text-sm font-medium text-ink-50">AI Game Master</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">
              Adapts difficulty and picks each next question from live room
              metrics. Falls back to deterministic pacing if the model is
              unavailable.
            </span>
          </span>
        </label>

        {error && <ErrorState message={error} />}

        <Button type="submit" size="lg" block loading={busy} disabled={overCap}>
          Create room
        </Button>
      </form>
    </Card>
  );
}

/**
 * Two different numbers live here, and confusing them is the obvious mistake:
 *
 *   budget — DEMO_TOTAL_TREASURY, a self-imposed cap on what a demo may
 *            commit. Rooms reserve against it the moment they are created.
 *   wallet — what the treasury account actually holds on chain.
 *
 * The budget is deliberately allowed to sit below the wallet: that gap is what
 * stops a runaway demo from draining a real account.
 */
function TreasuryCard({ treasury }: { treasury: RoomsResponse['treasury'] | null }) {
  const overcommitted =
    treasury?.onChainBalanceWei != null &&
    BigInt(treasury.totalWei) > BigInt(treasury.onChainBalanceWei);

  return (
    <Card>
      <CardHeader
        title="Demo budget"
        subtitle="A cap on what rooms may commit — not your wallet balance"
      />
      <div className="grid grid-cols-2 gap-4 p-5">
        <Stat
          label="Free to commit"
          value={treasury ? formatMon(treasury.availableWei) : '—'}
          hint="MON"
          tone="mint"
        />
        <Stat
          label="Held by rooms"
          value={treasury ? formatMon(treasury.reservedWei) : '—'}
          hint="MON"
        />
      </div>
      <div className="space-y-2 border-t border-[var(--hairline)] px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
            Budget cap
          </span>
          <span className="tnum text-sm text-ink-200">
            {treasury ? formatMon(treasury.totalWei) : '—'} MON
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
            Wallet on chain
          </span>
          <span className="tnum text-sm text-ink-200">
            {treasury?.onChainBalanceWei != null
              ? `${formatMon(treasury.onChainBalanceWei)} MON`
              : '—'}
          </span>
        </div>
        {overcommitted && (
          <p className="pt-1 text-xs leading-relaxed text-amber-500">
            The budget is larger than the wallet holds. Lower
            DEMO_TOTAL_TREASURY or top the account up, or a settlement could
            fail part-way through.
          </p>
        )}
      </div>
    </Card>
  );
}

function RoomsCard({
  rooms,
  error,
  onRetry,
}: {
  rooms: RoomRow[] | null;
  error: string | null;
  onRetry: () => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader title="Your rooms" subtitle={rooms ? `${rooms.length} total` : undefined} />
      {error ? (
        <div className="p-5">
          <ErrorState message={error} onRetry={() => void onRetry()} />
        </div>
      ) : !rooms ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : rooms.length === 0 ? (
        <EmptyState
          title="No rooms yet"
          description="Create one and the join link appears instantly."
        />
      ) : (
        <ul className="divide-y divide-[var(--hairline)]">
          {rooms.map((room) => (
            <li key={room.id}>
              <Link
                href={`/host/${room.id}`}
                className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-ink-850"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-50">{room.name}</p>
                  <p className="tnum mt-0.5 text-xs text-ink-400">
                    {room.code} · {room.players}/{room.maxPlayers} ·{' '}
                    {formatMon(room.prizePoolWei)} MON
                  </p>
                </div>
                <StatusBadge status={room.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function StatusBadge({ status }: { status: RoomStatus }) {
  const map: Record<RoomStatus, { tone: 'mint' | 'volt' | 'amber' | 'neutral' | 'rose'; label: string }> = {
    DRAFT: { tone: 'neutral', label: 'Draft' },
    LOBBY: { tone: 'mint', label: 'Lobby' },
    RUNNING: { tone: 'volt', label: 'Live' },
    PAUSED: { tone: 'amber', label: 'Paused' },
    FINALIZING: { tone: 'amber', label: 'Finalising' },
    COMPLETED: { tone: 'neutral', label: 'Complete' },
    CANCELLED: { tone: 'rose', label: 'Cancelled' },
  };
  const { tone, label } = map[status];
  return (
    <Badge tone={tone}>
      {(status === 'RUNNING' || status === 'LOBBY') && <Dot tone={tone} />}
      {label}
    </Badge>
  );
}
