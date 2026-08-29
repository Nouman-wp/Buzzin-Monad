'use client';

import Link from 'next/link';
import { TransferPanel } from '@/components/account/transfer';
import { formatDemoDateShort } from '@/lib/util/demo-date';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccountShell } from '@/components/account/shell';
import { SignInPanel } from '@/components/shared/sign-in';
import { useSession } from '@/components/shared/session';
import { useWallet } from '@/components/shared/use-wallet';
import { StatusBadge } from '@/components/host/host-home';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Skeleton,
  Stat,
  cx,
} from '@/components/shared/ui';
import { formatMon, shortAddress } from '@/lib/util/money';
import { MODE_LABELS } from '@/lib/content';
import type { AccountGame, AccountOverview, CashOutResult } from '@/server/account';

/**
 * The player's own dashboard.
 *
 * Two questions, answered in that order: what am I owed, and where has it come
 * from. The wallet card is the whole point of the page — everything below it is
 * the audit trail for the number at the top.
 */

type Filter = 'all' | 'played' | 'hosted';

export function AccountDashboard() {
  const { user, loading: sessionLoading } = useSession();
  const [data, setData] = useState<AccountOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/me/overview', { cache: 'no-store' });
      if (response.status === 401) {
        setData(null);
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Could not load your dashboard');
      setData(payload as AccountOverview);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your dashboard');
    }
  }, []);

  useEffect(() => {
    if (!sessionLoading && user) void load();
  }, [sessionLoading, user, load]);

  const games = useMemo(() => {
    if (!data) return [];
    if (filter === 'played') return data.games.filter((game) => game.played);
    if (filter === 'hosted') return data.games.filter((game) => game.hosted);
    return data.games;
  }, [data, filter]);

  if (sessionLoading) {
    return (
      <AccountShell>
        <div className="mt-8 space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AccountShell>
    );
  }

  if (!user) {
    return (
      <AccountShell>
        <Card className="mx-auto mt-16 max-w-md p-6">
          <SignInPanel
            heading="Sign in to see your dashboard"
            description="Your games, your balance, and cash-out — all in one place."
          />
        </Card>
      </AccountShell>
    );
  }

  return (
    <AccountShell>
      {error && (
        <div className="mt-6 max-w-lg">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      )}

      {!data ? (
        <div className="mt-6 space-y-4">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <WalletCard wallet={data.wallet} onCashedOut={load} />
          <div className="mt-5">
            <TransferPanel onChanged={load} />
          </div>
          <StatsCard stats={data.stats} />

          <Card className="mt-5">
            <CardHeader
              title="Your games"
              subtitle={`${data.stats.gamesPlayed} played · ${data.stats.gamesHosted} hosted`}
              action={
                <div className="flex gap-1 rounded-full border border-[var(--hairline-strong)] bg-ink-850/60 p-0.5">
                  {(['all', 'played', 'hosted'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setFilter(option)}
                      className={cx(
                        'rounded-full px-2.5 py-1 text-xs capitalize transition-colors',
                        filter === option
                          ? 'bg-volt-500/20 text-volt-300'
                          : 'text-ink-400 hover:text-ink-100',
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              }
            />
            {games.length === 0 ? (
              <EmptyState
                title="Nothing here yet"
                description={
                  filter === 'hosted'
                    ? 'Rooms you create appear here.'
                    : 'Join a game with a room code and it shows up here the moment you do.'
                }
                action={
                  <Link
                    href={filter === 'hosted' ? '/host' : '/'}
                    className="rounded-full border border-[var(--hairline-strong)] bg-ink-850/60 px-4 py-2 text-sm text-ink-200 transition-colors hover:border-volt-500/40 hover:bg-ink-800"
                  >
                    {filter === 'hosted' ? 'Create a room' : 'Join a game'}
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-[var(--hairline)]">
                {games.map((game) => (
                  <GameRow key={game.roomId} game={game} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </AccountShell>
  );
}

// ------------------------------------------------------------------- wallet

function WalletCard({
  wallet,
  onCashedOut,
}: {
  wallet: AccountOverview['wallet'];
  onCashedOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const claimable = BigInt(wallet.claimableWei);

  return (
    <Card className="mt-6 border-volt-500/25 bg-volt-500/[0.06]">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-volt-300">
            Ready to cash out
          </p>
          <p className="tnum font-display mt-1.5 text-5xl text-ink-50">
            {formatMon(wallet.claimableWei)}
            <span className="ml-2 text-lg text-ink-400">MON</span>
          </p>
          <p className="mt-1.5 text-xs text-ink-400">
            {claimable > 0n
              ? `From ${wallet.claimableGames} settled game${wallet.claimableGames === 1 ? '' : 's'}`
              : 'Payouts appear here once a game you played is settled'}
          </p>
        </div>

        <Button
          size="lg"
          disabled={claimable <= 0n}
          onClick={() => setOpen((current) => !current)}
        >
          Send to my wallet
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-5 border-t border-[var(--hairline)] p-5 sm:grid-cols-4">
        <Stat label="Locked in games" value={formatMon(wallet.lockedWei)} hint="MON" />
        <Stat
          label="Cashed out"
          value={formatMon(wallet.cashedOutWei)}
          hint="MON"
          tone="mint"
        />
        <Stat
          label="On chain"
          value={wallet.onChainBalanceWei === null ? '—' : formatMon(wallet.onChainBalanceWei, 4)}
          hint="MON at your address"
        />
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
            Game wallet
          </p>
          <CopyAddress address={wallet.address} />
          <a
            href={wallet.explorerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-0.5 block truncate text-xs text-ink-400 underline-offset-2 hover:text-ink-200 hover:underline"
          >
            View on explorer ↗
          </a>
        </div>
      </div>

      {open && claimable > 0n && (
        <CashOutPanel
          wallet={wallet}
          onDone={async () => {
            await onCashedOut();
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </Card>
  );
}

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied; the address is on screen either way.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={address}
      className="tnum mt-1 flex items-center gap-1.5 text-base font-semibold tracking-tight text-ink-50 transition-colors hover:text-volt-300"
    >
      {shortAddress(address, 5)}
      <span className="text-[10px] font-normal text-ink-400">{copied ? 'copied' : 'copy'}</span>
    </button>
  );
}

/**
 * Cash-out.
 *
 * The destination defaults to the player's own custodial address, which is
 * safe but not very useful — the point of this panel is the other two options:
 * a browser wallet they actually control, or an address they paste. The claim
 * itself is still submitted by the treasury, so the player never needs gas.
 */
function CashOutPanel({
  wallet,
  onDone,
  onClose,
}: {
  wallet: AccountOverview['wallet'];
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const { config } = useSession();
  const chain = config?.chain ?? null;
  const injected = useWallet(chain);

  const [mode, setMode] = useState<'connected' | 'custom' | 'game'>('connected');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CashOutResult | null>(null);

  const wrongChain =
    injected.address !== null && chain !== null && injected.chainId !== chain.chainId;

  const destination =
    mode === 'connected' ? injected.address : mode === 'custom' ? custom.trim() : wallet.address;

  const valid = /^0x[a-fA-F0-9]{40}$/.test(destination ?? '');

  const send = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/me/cashout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ destination }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'Cash-out failed');
      setResult(payload as CashOutResult);
      await onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cash-out failed');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const failed = result.entries.filter((entry) => !entry.ok);
    return (
      <div className="border-t border-[var(--hairline)] p-5">
        <p className="text-sm font-medium text-mint-400">
          Sent {formatMon(result.sentWei)} MON to {shortAddress(result.destination, 6)}
          {result.onChain ? '' : ' (off-chain settlement)'}
        </p>
        <ul className="mt-3 space-y-1.5">
          {result.entries.map((entry) => (
            <li key={entry.roomId} className="flex items-center gap-2 text-xs">
              <span className={entry.ok ? 'text-mint-400' : 'text-rose-500'}>
                {entry.ok ? '✓' : '✕'}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-300">{entry.name}</span>
              <span className="tnum text-ink-400">{formatMon(entry.amountWei)} MON</span>
              {entry.explorerUrl && (
                <a
                  href={entry.explorerUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-volt-300 underline-offset-2 hover:underline"
                >
                  tx ↗
                </a>
              )}
            </li>
          ))}
        </ul>
        {failed.length > 0 && (
          <p className="mt-3 text-xs text-rose-500">
            {failed.length} game{failed.length === 1 ? '' : 's'} could not be cashed out:{' '}
            {failed[0].error}. Try again from here.
          </p>
        )}
        <Button size="sm" variant="ghost" className="mt-4" onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t border-[var(--hairline)] p-5">
      <p className="text-sm text-ink-300">
        Sending{' '}
        <span className="tnum font-semibold text-ink-50">
          {formatMon(wallet.claimableWei)} MON
        </span>{' '}
        from {wallet.claimableGames} game{wallet.claimableGames === 1 ? '' : 's'}. Gas is
        paid by the operator — you do not need any MON to receive this.
      </p>

      <div className="space-y-2">
        <DestinationOption
          selected={mode === 'connected'}
          onSelect={() => setMode('connected')}
          title={
            injected.address
              ? `${injected.walletName} · ${shortAddress(injected.address, 6)}`
              : `Connect ${injected.walletName}`
          }
          detail={
            injected.address
              ? wrongChain
                ? `Connected to another network — switch to ${chain?.networkName} to see the funds arrive`
                : 'Your own wallet. You hold the keys.'
              : injected.available
                ? 'Send straight to a wallet you control.'
                : 'No browser wallet detected. Install MetaMask, or paste an address below.'
          }
          action={
            !injected.address ? (
              <Button
                size="sm"
                variant="secondary"
                loading={injected.connecting}
                disabled={!injected.available}
                onClick={() => void injected.connect()}
              >
                Connect
              </Button>
            ) : wrongChain ? (
              <Button
                size="sm"
                variant="secondary"
                loading={injected.switching}
                onClick={() => void injected.switchChain()}
              >
                Switch network
              </Button>
            ) : (
              <Badge tone="mint">connected</Badge>
            )
          }
        />

        <DestinationOption
          selected={mode === 'custom'}
          onSelect={() => setMode('custom')}
          title="Another address"
          detail="Any EVM address on Monad testnet."
        >
          {mode === 'custom' && (
            <div className="mt-3">
              <Field
                label="Destination address"
                placeholder="0x…"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                spellCheck={false}
                autoComplete="off"
                error={
                  custom.trim().length > 0 && !/^0x[a-fA-F0-9]{40}$/.test(custom.trim())
                    ? 'That is not a valid EVM address'
                    : null
                }
              />
            </div>
          )}
        </DestinationOption>

        <DestinationOption
          selected={mode === 'game'}
          onSelect={() => setMode('game')}
          title={`Keep it in my game wallet · ${shortAddress(wallet.address, 6)}`}
          detail="Custodial — held by the server for this demo."
        />
      </div>

      {injected.error && <ErrorState message={injected.error} />}
      {error && <ErrorState message={error} />}

      <div className="flex flex-wrap gap-2">
        <Button size="lg" loading={busy} disabled={!valid} onClick={() => void send()}>
          {valid
            ? `Send ${formatMon(wallet.claimableWei)} MON to ${shortAddress(destination, 4)}`
            : 'Choose a destination'}
        </Button>
        <Button size="lg" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function DestinationOption({
  selected,
  onSelect,
  title,
  detail,
  action,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        'rounded-xl border p-3.5 transition-colors',
        selected ? 'border-volt-500 bg-volt-500/8' : 'border-[var(--hairline-strong)] bg-ink-850',
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-sm font-medium text-ink-50">{title}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">{detail}</span>
        </button>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}

// -------------------------------------------------------------------- stats

function StatsCard({ stats }: { stats: AccountOverview['stats'] }) {
  return (
    <Card className="mt-5">
      <CardHeader title="Your record" subtitle="Across every game you have played" />
      <div className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Games" value={stats.gamesPlayed} hint={`${stats.gamesHosted} hosted`} />
        <Stat label="Wins" value={stats.wins} tone="volt" hint={`${stats.podiums} top-3`} />
        <Stat
          label="Best rank"
          value={stats.bestRank === null ? '—' : `#${stats.bestRank}`}
        />
        <Stat label="Total score" value={stats.totalScore} />
        <Stat
          label="Accuracy"
          value={`${Math.round(stats.accuracy * 100)}%`}
          hint={`${stats.correct} correct`}
          tone="mint"
        />
        <Stat
          label="Missed"
          value={stats.wrong + stats.timeouts}
          hint={`${stats.timeouts} timeouts`}
          tone="rose"
        />
      </div>
    </Card>
  );
}

// -------------------------------------------------------------------- games

function GameRow({ game }: { game: AccountGame }) {
  const me = game.me;
  const href = game.hosted ? `/host/${game.roomId}` : `/play/${game.roomId}`;

  return (
    <li>
      <Link
        href={href}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 transition-colors hover:bg-ink-850"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-ink-50">{game.name}</p>
            {game.hosted && <Badge tone="volt">host</Badge>}
            {me?.claimable && <Badge tone="mint">cash out ready</Badge>}
          </div>
          <p className="tnum mt-0.5 truncate text-xs text-ink-400">
            {game.code} · {MODE_LABELS[game.mode]} · {game.playerCount} players ·{' '}
            {formatDemoDateShort()}
          </p>
        </div>

        {me && me.rank > 0 && (
          <div className="text-right">
            <p className="tnum text-sm font-semibold text-ink-50">#{me.rank}</p>
            <p className="tnum text-xs text-ink-400">{me.score} pts</p>
          </div>
        )}

        {me && BigInt(me.payoutWei) > 0n && (
          <div className="w-24 text-right">
            <p
              className={cx(
                'tnum text-sm font-semibold',
                me.claimed ? 'text-ink-300' : 'text-mint-400',
              )}
            >
              {formatMon(me.payoutWei)} MON
            </p>
            <p className="text-xs text-ink-500">{me.claimed ? 'cashed out' : 'unclaimed'}</p>
          </div>
        )}

        <StatusBadge status={game.status} />
      </Link>
    </li>
  );
}
