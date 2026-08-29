'use client';

import { useState } from 'react';
import { Badge, Card, CardHeader, EmptyState, cx } from '@/components/shared/ui';
import { formatMon, shortAddress } from '@/lib/util/money';
import type { HostSnapshot, PlayerGameState } from '@/lib/types';

/**
 * Per-player detail.
 *
 * Selecting a row opens their full record: score, wallet, correct/wrong/timeout
 * counts, penalties paid and balance remaining. Deliberately no auth data —
 * the host needs game state, not identity internals.
 */
export function PlayerTable({ snapshot }: { snapshot: HostSnapshot }) {
  const players = Object.values(snapshot.room.players).sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank;
    return a.joinedAt - b.joinedAt;
  });
  const [selected, setSelected] = useState<string | null>(null);
  const active = players.find((player) => player.playerId === selected) ?? null;

  return (
    <Card className="flex h-[380px] flex-col">
      <CardHeader
        title="Players"
        subtitle={`${players.length} joined · ${players.filter((p) => p.eliminated).length} eliminated`}
      />
      {players.length === 0 ? (
        <EmptyState
          title="Nobody has joined yet"
          description="Share the QR code and they'll appear here instantly."
        />
      ) : active ? (
        <PlayerDetail player={active} onBack={() => setSelected(null)} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-[var(--hairline)] overflow-y-auto scroll-thin">
          {players.map((player) => (
            <li key={player.playerId}>
              <button
                type="button"
                onClick={() => setSelected(player.playerId)}
                className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-ink-850"
              >
                <span
                  className={cx(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    player.eliminated ? 'bg-rose-500' : 'bg-mint-400',
                  )}
                  aria-hidden
                />
                <span
                  className={cx(
                    'min-w-0 flex-1 truncate text-sm',
                    player.eliminated ? 'text-ink-500 line-through' : 'text-ink-100',
                  )}
                >
                  {player.displayName}
                </span>
                <span className="tnum shrink-0 text-xs text-ink-500">
                  {formatMon(player.currentGameBalanceWei)}
                </span>
                <span className="tnum w-12 shrink-0 text-right text-sm font-medium text-ink-50">
                  {player.score}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PlayerDetail({
  player,
  onBack,
}: {
  player: PlayerGameState;
  onBack: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5 scroll-thin">
      <button
        type="button"
        onClick={onBack}
        className="text-xs text-ink-400 transition-colors hover:text-ink-200"
      >
        ← All players
      </button>

      <div className="mt-3 flex items-center gap-2">
        <h3 className="truncate text-base font-semibold text-ink-50">{player.displayName}</h3>
        {player.eliminated ? (
          <Badge tone="rose">eliminated R{player.eliminatedAtRound}</Badge>
        ) : (
          <Badge tone="mint">alive</Badge>
        )}
      </div>

      <p className="tnum mt-1 text-xs text-ink-500">
        {shortAddress(player.walletAddress, 6)}
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-4">
        <Detail label="Rank" value={player.rank > 0 ? `#${player.rank}` : '—'} />
        <Detail label="Score" value={player.score} />
        <Detail label="Correct" value={player.correctCount} />
        <Detail label="Wrong" value={player.wrongCount} />
        <Detail label="Timeouts" value={player.timeoutCount} />
        <Detail
          label="Penalties paid"
          value={`${formatMon(player.penaltyTotalWei)} MON`}
        />
        <Detail
          label="Balance"
          value={`${formatMon(player.currentGameBalanceWei)} MON`}
        />
        <Detail
          label="Started with"
          value={`${formatMon(player.startingGameBalanceWei)} MON`}
        />
      </dl>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
        {label}
      </dt>
      <dd className="tnum mt-0.5 text-sm font-medium text-ink-50">{value}</dd>
    </div>
  );
}
