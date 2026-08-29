'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSession } from '@/components/shared/session';
import { useWallet } from '@/components/shared/use-wallet';
import { Badge, Button, Card, ErrorState, Field, cx } from '@/components/shared/ui';
import { formatMon, shortAddress } from '@/lib/util/money';
import type { PlayerSnapshot, SettlementItem } from '@/lib/types';

/**
 * Final standings and cash-out.
 *
 * Cash-out is deliberately gated: it only appears once settlement is finalised,
 * which is also exactly when the contract will accept a claim. Before that the
 * player sees why they are waiting instead of a button that would fail.
 */
export function ResultsScreen({
  gameId,
  snapshot,
  onRefresh,
}: {
  gameId: string;
  snapshot: PlayerSnapshot;
  onRefresh: () => Promise<void>;
}) {
  const { user } = useSession();
  const settlement = snapshot.settlement;
  const myItem = settlement?.myItem ?? null;
  const settled = settlement?.status === 'CONFIRMED' || settlement?.status === 'OFF_CHAIN';

  const podium = snapshot.leaderboard.slice(0, 5);
  const mine = snapshot.leaderboard.find((entry) => entry.playerId === snapshot.me?.playerId);

  return (
    <div className="mt-6 animate-rise pb-4">
      <Badge tone={settled ? 'mint' : 'amber'}>
        {settled ? 'Settled' : 'Finalising'}
      </Badge>
      <h1 className="font-display mt-3 text-3xl text-ink-50">
        Final standings
      </h1>
      <p className="mt-1.5 text-sm text-ink-400">
        {snapshot.room.name} · {snapshot.room.totalRounds} rounds ·{' '}
        {formatMon(snapshot.room.prizePoolWei)} MON pool
      </p>

      {mine && (
        <Card className="mt-6 border-volt-500/25 bg-volt-500/6 p-5">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-volt-300">
            You finished
          </p>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="tnum text-4xl font-semibold tracking-tight text-ink-50">
              #{mine.rank}
            </span>
            <span className="tnum text-lg text-ink-300">{mine.score} pts</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-[var(--hairline)] pt-4">
            <MiniStat label="Correct" value={mine.correctCount} />
            <MiniStat label="Wrong" value={mine.wrongCount} />
            <MiniStat label="Timeouts" value={mine.timeoutCount} />
          </div>
        </Card>
      )}

      <Card className="mt-4">
        <div className="border-b border-[var(--hairline)] px-4 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-400">
            Top 5 — prize winners
          </h2>
        </div>
        <ul className="divide-y divide-[var(--hairline)]">
          {podium.map((entry) => {
            const prize = settlement?.myItem && entry.playerId === snapshot.me?.playerId
              ? settlement.myItem.prizeWei
              : null;
            return (
              <li
                key={entry.playerId}
                className={cx(
                  'flex items-center gap-3 px-4 py-3',
                  entry.playerId === snapshot.me?.playerId && 'bg-volt-500/8',
                )}
              >
                <span
                  className={cx(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
                    entry.rank === 1
                      ? 'bg-amber-500/20 text-amber-500'
                      : entry.rank <= 3
                        ? 'bg-ink-700 text-ink-100'
                        : 'bg-ink-800 text-ink-400',
                  )}
                >
                  {entry.rank}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-100">
                  {entry.displayName}
                </span>
                {prize !== null && (
                  <span className="tnum text-xs font-medium text-mint-400">
                    +{formatMon(prize)} MON
                  </span>
                )}
                <span className="tnum shrink-0 text-sm font-semibold text-ink-50">
                  {entry.score}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      {myItem ? (
        <CashOut
          gameId={gameId}
          item={myItem}
          settled={settled}
          defaultAddress={user?.walletAddress ?? ''}
          onRefresh={onRefresh}
        />
      ) : (
        <Card className="mt-4 p-5 text-center">
          <p className="text-sm text-ink-300">
            The host is finalising the settlement. Your payout will appear here.
          </p>
        </Card>
      )}

      <Link
        href="/dashboard"
        className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-[var(--hairline-strong)] px-4 py-3 text-sm text-ink-200 transition-colors hover:bg-ink-800"
      >
        All your games and balance →
      </Link>

      {settlement?.explorerUrl && (
        <a
          href={settlement.explorerUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-[var(--hairline-strong)] px-4 py-3 text-sm text-ink-200 transition-colors hover:bg-ink-800"
        >
          View settlement on the explorer ↗
        </a>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-400">{label}</p>
      <p className="tnum mt-0.5 text-base font-semibold text-ink-50">{value}</p>
    </div>
  );
}

function CashOut({
  gameId,
  item,
  settled,
  defaultAddress,
  onRefresh,
}: {
  gameId: string;
  item: SettlementItem;
  settled: boolean;
  defaultAddress: string;
  onRefresh: () => Promise<void>;
}) {
  const { config } = useSession();
  const wallet = useWallet(config?.chain ?? null);
  const [expanded, setExpanded] = useState(false);
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(item.claimTxHash);
  const [claimed, setClaimed] = useState(item.claimed);

  const payout = BigInt(item.totalPayoutWei);
  const hasPayout = payout > 0n;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = destination.trim() ? { destination: destination.trim() } : {};
      const response = await fetch(`/api/games/${gameId}/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? 'Cash-out failed');
      }
      setClaimed(true);
      setTxHash((data as { txHash: string | null }).txHash);
      void onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cash-out failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-400">
            Your payout
          </p>
          <p className="tnum mt-1 text-3xl font-semibold tracking-tight text-mint-400">
            {formatMon(item.totalPayoutWei)}
            <span className="ml-1.5 text-base font-normal text-ink-400">MON</span>
          </p>
          <p className="mt-1.5 text-xs text-ink-500">
            {formatMon(item.prizeWei)} prize + {formatMon(item.refundWei)} returned balance
          </p>
        </div>
        {claimed && <Badge tone="mint">Cashed out</Badge>}
      </div>

      {!hasPayout && (
        <p className="mt-4 text-sm text-ink-400">
          Your balance was fully spent on penalties, so there is nothing to withdraw.
        </p>
      )}

      {hasPayout && !claimed && (
        <div className="mt-5">
          {!settled ? (
            <p className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-sm text-amber-500">
              Cash-out opens as soon as the host submits the settlement.
            </p>
          ) : (
            <>
              {!expanded ? (
                <div className="space-y-2.5">
                  <Button block size="lg" loading={busy} onClick={submit}>
                    Cash out to my wallet
                  </Button>
                  <p className="text-center text-xs text-ink-500">
                    Sending to {shortAddress(defaultAddress, 6)}
                  </p>
                  <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="w-full rounded-lg py-1 text-center text-xs text-ink-300 underline-offset-2 hover:underline"
                  >
                    Use a different address
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Field
                    label="Destination address"
                    placeholder="0x…"
                    value={destination}
                    onChange={(event) => setDestination(event.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    hint="Any EVM address on Monad testnet."
                  />
                  {wallet.available && (
                    // Saves typing 42 characters on a phone, and removes the
                    // chance of a typo sending the payout into a dead address.
                    <Button
                      block
                      size="md"
                      variant="secondary"
                      loading={wallet.connecting}
                      onClick={async () => {
                        const connected = await wallet.connect();
                        if (connected) setDestination(connected);
                      }}
                    >
                      Use my {wallet.walletName} address
                    </Button>
                  )}
                  {wallet.error && <ErrorState message={wallet.error} />}
                  <Button block size="lg" loading={busy} onClick={submit}>
                    Send my payout
                  </Button>
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="w-full rounded-lg py-1 text-center text-xs text-ink-300 underline-offset-2 hover:underline"
                  >
                    Use my own wallet instead
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {claimed && (
        <p className="mt-4 text-sm text-ink-300">
          Sent to {shortAddress(item.claimedTo ?? defaultAddress, 6)}.
        </p>
      )}

      {txHash && (
        <p className="tnum mt-2 truncate text-xs text-ink-500">tx {shortAddress(txHash, 8)}</p>
      )}

      {error && (
        <div className="mt-4">
          <ErrorState message={error} />
        </div>
      )}
    </Card>
  );
}
