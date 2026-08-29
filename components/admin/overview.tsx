'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Wordmark } from '@/components/shared/brand';
import { SignInPanel } from '@/components/shared/sign-in';
import { useSession } from '@/components/shared/session';
import { StatusBadge } from '@/components/host/host-home';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dot,
  EmptyState,
  ErrorState,
  Field,
  Skeleton,
  Stat,
} from '@/components/shared/ui';
import { formatMon, shortAddress } from '@/lib/util/money';
import type { GameMode, RoomStatus, SettlementStatus } from '@/lib/types';

interface AdminRoom {
  id: string;
  code: string;
  name: string;
  mode: GameMode;
  status: RoomStatus;
  phase: string;
  hostName: string;
  players: number;
  maxPlayers: number;
  currentRound: number;
  totalRounds: number;
  prizePoolWei: string;
  settlementStatus: SettlementStatus;
  txHash: string | null;
  createdAt: number;
  joinUrl: string;
}

interface Overview {
  metrics: {
    roomsActive: number;
    roomsTotal: number;
    playersOnline: number;
    aiDecisions: number;
    eliminations: number;
    transactions: number;
    prizePoolWei: string;
  };
  treasury: {
    totalWei: string;
    reservedWei: string;
    availableWei: string;
    address: string | null;
    onChainBalanceWei: string | null;
  };
  capabilities: {
    aiEnabled: boolean;
    chainEnabled: boolean;
    durableStore: boolean;
    storeName: string;
  };
  rooms: AdminRoom[];
}

/**
 * Platform overview.
 *
 * The one screen that answers "is everything actually wired up" during a live
 * event: which rooms exist, how much treasury is committed, and whether AI,
 * chain, and durable storage are really configured — or running on fallbacks.
 */
export function AdminOverview() {
  const { user, loading: sessionLoading } = useSession();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/overview', { cache: 'no-store' });
      if (response.status === 403) {
        setForbidden(true);
        return;
      }
      if (response.status === 401) return;
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Could not load the overview');
      setData(payload as Overview);
      setError(null);
      setForbidden(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the overview');
    }
  }, []);

  useEffect(() => {
    if (sessionLoading || !user) return;
    void load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [sessionLoading, user, load]);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 pb-16 pt-6 sm:px-8">
      <header className="flex items-center justify-between">
        <Wordmark />
        <div className="flex items-center gap-2">
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
            Host
          </Link>
        </div>
      </header>

      {sessionLoading ? (
        <div className="mt-12 space-y-4">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : !user ? (
        <Card className="mx-auto mt-16 max-w-md p-6">
          <SignInPanel heading="Sign in" description="Admin access is allowlisted by email." />
        </Card>
      ) : forbidden ? (
        <ElevatePanel onElevated={load} />
      ) : (
        <>
          <h1 className="font-display mt-10 text-4xl text-ink-50">
            Platform <em className="text-violet-gradient italic">overview</em>
          </h1>

          {error && (
            <div className="mt-5 max-w-lg">
              <ErrorState message={error} onRetry={() => void load()} />
            </div>
          )}

          {!data ? (
            <div className="mt-6 grid gap-5 lg:grid-cols-3">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <>
              <Card className="mt-6">
                <CardHeader title="Live metrics" subtitle="Refreshes every 3 seconds" />
                <div className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4 lg:grid-cols-7">
                  <Stat label="Rooms active" value={data.metrics.roomsActive} tone="volt" />
                  <Stat label="Players online" value={data.metrics.playersOnline} />
                  <Stat label="Rooms total" value={data.metrics.roomsTotal} />
                  <Stat label="AI decisions" value={data.metrics.aiDecisions} />
                  <Stat label="Eliminations" value={data.metrics.eliminations} />
                  <Stat label="Transactions" value={data.metrics.transactions} />
                  <Stat
                    label="Prize pools"
                    value={formatMon(data.metrics.prizePoolWei)}
                    hint="MON"
                    tone="mint"
                  />
                </div>
              </Card>

              <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                <RoomsCard rooms={data.rooms} onChanged={load} />
                <div className="space-y-5">
                  <TreasuryCard treasury={data.treasury} />
                  <CapabilitiesCard capabilities={data.capabilities} />
                  <DemoTools onDone={load} />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}

/**
 * Admin elevation.
 *
 * Hosting never needs admin — room control is authorised by ownership. Admin is
 * only the cross-room overview and the destructive demo tools, so it is gated
 * on an explicit grant: an allowlisted email, or this one-time token exchange
 * for an operator running guest sign-in.
 */
function ElevatePanel({ onElevated }: { onElevated: () => Promise<void> }) {
  const { refresh } = useSession();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Could not verify that token');
      await refresh();
      await onElevated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not verify that token');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto mt-16 max-w-md p-6">
      <h1 className="font-display text-xl text-ink-50">Admin access required</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-400">
        This dashboard is gated separately from hosting — you can still create and
        run rooms from{' '}
        <Link href="/host" className="text-volt-300 underline-offset-2 hover:underline">
          Host
        </Link>
        . To get in here, add your email to <code className="text-ink-200">ADMIN_EMAILS</code>,
        or enter the operator token below.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-3">
        <Field
          label="Operator token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="ADMIN_API_TOKEN"
          autoComplete="off"
          error={error}
        />
        <Button type="submit" block loading={busy} disabled={token.trim().length === 0}>
          Unlock admin
        </Button>
      </form>
    </Card>
  );
}

/** Statuses an admin can still stop. Anything else has already finished. */
const STOPPABLE: ReadonlySet<RoomStatus> = new Set<RoomStatus>([
  'DRAFT',
  'LOBBY',
  'RUNNING',
  'PAUSED',
]);

function RoomsCard({ rooms, onChanged }: { rooms: AdminRoom[]; onChanged: () => Promise<void> }) {
  return (
    <Card>
      <CardHeader title="Rooms" subtitle={`${rooms.length} most recent`} />
      {rooms.length === 0 ? (
        <EmptyState title="No rooms yet" description="Rooms appear here as soon as a host creates one." />
      ) : (
        <ul className="divide-y divide-[var(--hairline)]">
          {rooms.map((room) => (
            <li
              key={room.id}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-ink-850"
            >
              <Link href={`/host/${room.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-50">{room.name}</p>
                  <p className="tnum mt-0.5 text-xs text-ink-400">
                    {room.code} · {room.hostName} · {room.players}/{room.maxPlayers} ·{' '}
                    {room.currentRound}/{room.totalRounds} rounds
                  </p>
                </div>
                <span className="tnum hidden text-xs text-ink-400 sm:block">
                  {formatMon(room.prizePoolWei)} MON
                </span>
                {room.txHash && <Badge tone="sky">settled</Badge>}
                <StatusBadge status={room.status} />
              </Link>
              {STOPPABLE.has(room.status) && <EndGameButton room={room} onChanged={onChanged} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Stop a room from the admin overview.
 *
 * This calls the same endpoint the host's own End game button does —
 * `assertHost` accepts an allowlisted admin as well as the room owner, which is
 * what makes a live event recoverable when a host drops off mid-game. Ending
 * mid-game is not a cancellation: the rounds already played are graded, ranked
 * and settled, so players keep what they earned.
 *
 * It is two taps on purpose. This is the one control on the page that can end
 * a game 25 people are in the middle of.
 */
function EndGameButton({
  room,
  onChanged,
}: {
  room: AdminRoom;
  onChanged: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelling = room.status === 'DRAFT' || room.status === 'LOBBY';

  const end = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/rooms/${room.id}/end`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'Could not end the game');
      setConfirming(false);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not end the game');
    } finally {
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <div className="shrink-0 text-right">
        <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
          {cancelling ? 'Cancel' : 'End game'}
        </Button>
        {error && <p className="mt-1 max-w-[12rem] text-[11px] text-rose-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="hidden text-[11px] text-amber-500 sm:block">
        {cancelling ? 'Cancel this room?' : 'End now and settle?'}
      </span>
      <Button size="sm" variant="danger" loading={busy} onClick={end}>
        Yes
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        No
      </Button>
    </div>
  );
}

function TreasuryCard({ treasury }: { treasury: Overview['treasury'] }) {
  return (
    <Card>
      <CardHeader title="Treasury" subtitle={treasury.address ? shortAddress(treasury.address, 6) : 'No signing key configured'} />
      <div className="grid grid-cols-2 gap-5 p-5">
        <Stat label="Budget" value={formatMon(treasury.totalWei)} hint="MON" />
        <Stat label="Reserved" value={formatMon(treasury.reservedWei)} hint="MON" />
        <Stat label="Available" value={formatMon(treasury.availableWei)} hint="MON" tone="mint" />
        <Stat
          label="On chain"
          value={
            treasury.onChainBalanceWei === null ? '—' : formatMon(treasury.onChainBalanceWei)
          }
          hint="MON"
        />
      </div>
    </Card>
  );
}

function CapabilitiesCard({ capabilities }: { capabilities: Overview['capabilities'] }) {
  const rows: Array<{ label: string; ok: boolean; detail: string }> = [
    {
      label: 'AI Game Master',
      ok: capabilities.aiEnabled,
      detail: capabilities.aiEnabled ? 'model configured' : 'deterministic fallback',
    },
    {
      label: 'Monad settlement',
      ok: capabilities.chainEnabled,
      detail: capabilities.chainEnabled ? 'contract + treasury ready' : 'off-chain accounting only',
    },
    {
      label: 'Durable storage',
      ok: capabilities.durableStore,
      detail: capabilities.durableStore ? capabilities.storeName : 'in-memory (single instance)',
    },
  ];

  return (
    <Card>
      <CardHeader title="Capabilities" subtitle="What this deployment has configured" />
      <ul className="divide-y divide-[var(--hairline)]">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-3 px-5 py-3">
            <Dot tone={row.ok ? 'mint' : 'amber'} />
            <span className="flex-1 text-sm text-ink-100">{row.label}</span>
            <span className="text-xs text-ink-400">{row.detail}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DemoTools({ onDone }: { onDone: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/reset', { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Reset failed');
      setConfirming(false);
      await onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Demo tools" subtitle="Admin only, demo mode only" />
      <div className="space-y-3 p-5">
        {error && <ErrorState message={error} />}
        {!confirming ? (
          <Button variant="danger" block onClick={() => setConfirming(true)}>
            Reset demo data
          </Button>
        ) : (
          <>
            <p className="text-sm text-ink-300">
              This permanently deletes every room, answer and event. Players in a
              live game will be dropped.
            </p>
            <div className="flex gap-2">
              <Button variant="danger" loading={busy} onClick={reset}>
                Yes, reset everything
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
