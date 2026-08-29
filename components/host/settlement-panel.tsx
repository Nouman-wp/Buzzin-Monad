'use client';

import { useState } from 'react';
import { Badge, Button, Card, CardHeader, ErrorState, Stat, cx } from '@/components/shared/ui';
import { formatMon, shortAddress } from '@/lib/util/money';
import type { HostSnapshot, SettlementStatus } from '@/lib/types';

/**
 * Settlement and final accounting.
 *
 * Shows the full payout derivation before anything is submitted — prize pool,
 * per-player prize and refund, and the totals that must reconcile — so the
 * host can see the money add up rather than trusting a single number.
 */

const STATUS_TONE: Record<SettlementStatus, 'neutral' | 'volt' | 'mint' | 'amber' | 'rose'> = {
  NOT_STARTED: 'neutral',
  PREPARED: 'volt',
  SUBMITTING: 'amber',
  CONFIRMED: 'mint',
  OFF_CHAIN: 'amber',
  FAILED: 'rose',
};

const STATUS_LABEL: Record<SettlementStatus, string> = {
  NOT_STARTED: 'not started',
  PREPARED: 'prepared',
  SUBMITTING: 'submitting',
  CONFIRMED: 'confirmed on Monad',
  OFF_CHAIN: 'settled off-chain',
  FAILED: 'failed',
};

export function SettlementPanel({
  snapshot,
  onRefresh,
}: {
  snapshot: HostSnapshot;
  onRefresh: () => Promise<void>;
}) {
  const { room, treasury } = snapshot;
  const settlement = room.settlement;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finished = room.status === 'FINALIZING' || room.status === 'COMPLETED';
  const canPrepare = finished && settlement.status !== 'CONFIRMED';
  const canSubmit =
    finished &&
    (settlement.status === 'PREPARED' || settlement.status === 'FAILED') &&
    settlement.items.length > 0;

  const run = async (name: string, path: string) => {
    setBusy(name);
    setError(null);
    try {
      const response = await fetch(`/api/games/${room.id}/settlement/${path}`, {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Settlement request failed');
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Settlement request failed');
    } finally {
      setBusy(null);
    }
  };

  const explorer = snapshot.room.settlement.txHash
    ? `${treasuryExplorerBase(snapshot)}/tx/${snapshot.room.settlement.txHash}`
    : null;

  return (
    <Card>
      <CardHeader
        title="Settlement"
        subtitle={`Prize pool ${formatMon(room.prizePoolWei)} MON`}
        action={<Badge tone={STATUS_TONE[settlement.status]}>{STATUS_LABEL[settlement.status]}</Badge>}
      />

      <div className="grid grid-cols-2 gap-5 p-5">
        <Stat
          label="Treasury on chain"
          value={
            treasury.onChainBalanceWei === null
              ? '—'
              : formatMon(treasury.onChainBalanceWei)
          }
          hint={treasury.address ? shortAddress(treasury.address, 4) : 'no key configured'}
        />
        <Stat
          label="Reserved"
          value={formatMon(treasury.reservedWei)}
          hint={`of ${formatMon(treasury.totalWei)} MON`}
        />
      </div>

      {!finished && (
        <p className="border-t border-[var(--hairline)] px-5 py-4 text-sm text-ink-400">
          The payout table is calculated once the game ends.
        </p>
      )}

      {finished && settlement.items.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-4 border-t border-[var(--hairline)] p-5">
            <Stat
              label="Prizes"
              value={formatMon(settlement.totalPrizeAllocatedWei)}
              hint="MON to top 5"
              tone="volt"
            />
            <Stat
              label="Refunds"
              value={formatMon(settlement.totalRefundWei)}
              hint="unspent balances"
            />
            <Stat
              label="Total"
              value={formatMon(settlement.totalAllocatedWei)}
              hint="MON out"
              tone="mint"
            />
          </div>

          <div className="max-h-72 overflow-y-auto border-t border-[var(--hairline)] scroll-thin">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-ink-900/95 backdrop-blur">
                <tr className="text-[11px] uppercase tracking-[0.06em] text-ink-400">
                  <th className="px-5 py-2 text-left font-medium">#</th>
                  <th className="px-2 py-2 text-left font-medium">Player</th>
                  <th className="px-2 py-2 text-right font-medium">Prize</th>
                  <th className="px-2 py-2 text-right font-medium">Refund</th>
                  <th className="px-5 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hairline)]">
                {settlement.items.map((item) => (
                  <tr key={item.playerId} className={cx(item.rank <= 5 && 'bg-volt-500/5')}>
                    <td className="tnum px-5 py-2 text-ink-400">{item.rank}</td>
                    <td className="max-w-[9rem] truncate px-2 py-2 text-ink-100">
                      {item.displayName}
                      {item.claimed && (
                        <span className="ml-2 text-[10px] text-mint-400">claimed</span>
                      )}
                    </td>
                    <td className="tnum px-2 py-2 text-right text-volt-300">
                      {formatMon(item.prizeWei)}
                    </td>
                    <td className="tnum px-2 py-2 text-right text-ink-400">
                      {formatMon(item.refundWei)}
                    </td>
                    <td className="tnum px-5 py-2 text-right font-medium text-ink-50">
                      {formatMon(item.totalPayoutWei)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {settlement.error && (
        <div className="px-5 pt-4">
          <ErrorState message={settlement.error} />
        </div>
      )}
      {error && (
        <div className="px-5 pt-4">
          <ErrorState message={error} />
        </div>
      )}

      {finished && (
        <div className="flex flex-wrap gap-2 border-t border-[var(--hairline)] p-5">
          {canPrepare && (
            <Button
              size="sm"
              variant="secondary"
              loading={busy === 'prepare'}
              onClick={() => run('prepare', 'prepare')}
            >
              {settlement.items.length > 0 ? 'Recalculate' : 'Calculate payouts'}
            </Button>
          )}
          {canSubmit && (
            <Button size="sm" loading={busy === 'submit'} onClick={() => run('submit', 'submit')}>
              {settlement.status === 'FAILED' ? 'Retry settlement' : 'Submit to Monad'}
            </Button>
          )}
          {explorer && (
            <a
              href={explorer}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-9 items-center rounded-xl border border-[var(--hairline-strong)] px-3 text-sm text-ink-200 transition-colors hover:bg-ink-800"
            >
              View transaction ↗
            </a>
          )}
        </div>
      )}
    </Card>
  );
}

function treasuryExplorerBase(snapshot: HostSnapshot): string {
  void snapshot;
  // The explorer origin is a public build-time value; reading it here keeps the
  // link working without threading config through every panel.
  return (
    process.env.NEXT_PUBLIC_MONAD_EXPLORER_URL || 'https://testnet.monadvision.com'
  ).replace(/\/$/, '');
}
