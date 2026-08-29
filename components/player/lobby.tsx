'use client';

import { Avatar } from '@/components/account/avatar';
import { Badge, Card, Dot, cx } from '@/components/shared/ui';
import { formatMon } from '@/lib/util/money';
import { MODE_LABELS } from '@/lib/content';
import type { PlayerSnapshot } from '@/lib/types';

/**
 * The waiting room.
 *
 * Its job is to make a wait feel like anticipation rather than a stall: the
 * roster fills in live with real faces, the pool ticks up with every arrival,
 * and the player can see their own stake before a single question is asked.
 *
 * The roster is rows, not tiles. A tile per player looks generous with four
 * people in the room and absurd with twenty-five — the screen it has to work on
 * is a phone, and a 25-player lobby is the case that matters. A row is about a
 * third the height, so a full room reads as a full room instead of a scroll.
 */
export function Lobby({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { room, players, me } = snapshot;
  const fill = room.maxPlayers > 0 ? room.playerCount / room.maxPlayers : 0;
  const nearlyFull = fill >= 0.85;

  // Enough dashed seats to show the room is not full, never so many that they
  // outweigh the people already in it.
  const openSeats = Math.max(0, Math.min(room.maxPlayers - players.length, 4));

  return (
    <div className="animate-rise mt-5">
      <div className="flex items-center gap-2">
        <Badge tone="volt">{MODE_LABELS[room.mode]}</Badge>
        <Badge tone="mint">
          <Dot tone="mint" />
          Live lobby
        </Badge>
      </div>

      <h1 className="font-display mt-3 text-3xl leading-tight text-ink-50">{room.name}</h1>
      <p className="mt-1.5 text-sm text-ink-400">
        Hosted by {room.hostName} · {room.totalRounds} rounds
      </p>

      <div className="mt-6 grid grid-cols-2 gap-2.5">
        <Card className="px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
            Players
          </p>
          <p className="tnum mt-1 text-2xl font-semibold text-ink-50">
            {room.playerCount}
            <span className="text-base text-ink-500"> / {room.maxPlayers}</span>
          </p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
            Prize pool
          </p>
          <p className="tnum mt-1 text-2xl font-semibold text-volt-300">
            {formatMon(room.prizePoolWei)}
            <span className="ml-1 text-base font-normal text-ink-500">MON</span>
          </p>
        </Card>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-800">
        <div
          className={cx(
            'h-full rounded-full transition-[width] duration-500',
            nearlyFull ? 'bg-amber-500' : 'bg-volt-500',
          )}
          style={{ width: `${Math.min(100, fill * 100)}%` }}
        />
      </div>

      {/* Faces first. The roster fills in visibly as people scan, which is the
          whole point of standing in a room waiting to start. */}
      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--hairline)] px-4 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-400">
            In the room
          </h2>
          <span className="tnum text-xs text-ink-500">{players.length}</span>
        </div>

        <ul className="scroll-thin grid max-h-[17rem] grid-cols-1 gap-1.5 overflow-y-auto p-2.5 sm:grid-cols-2">
          {players.map((player, index) => {
            const isMe = player.id === me?.playerId;
            return (
              <li
                key={player.id}
                className={cx(
                  'animate-pop flex items-center gap-2.5 rounded-full border py-1.5 pl-1.5 pr-3',
                  isMe
                    ? 'border-volt-500/45 bg-volt-500/10'
                    : 'border-[var(--hairline)] bg-ink-850/50',
                )}
                // A short stagger so a burst of arrivals reads as several
                // people, not one repaint.
                style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
              >
                <Avatar
                  name={player.displayName}
                  src={player.avatarUrl}
                  seed={player.id}
                  size="sm"
                />
                <span
                  className={cx(
                    'min-w-0 flex-1 truncate text-[13px]',
                    isMe ? 'font-medium text-volt-200' : 'text-ink-200',
                  )}
                >
                  {player.displayName}
                </span>
                {isMe && (
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-volt-400">
                    you
                  </span>
                )}
              </li>
            );
          })}

          {/* Empty seats, so the room reads as filling rather than sparse. */}
          {Array.from({ length: openSeats }).map((_, index) => (
            <li
              key={`seat-${index}`}
              className="flex items-center gap-2.5 rounded-full border border-dashed border-[var(--hairline)] py-1.5 pl-1.5 pr-3 opacity-40"
            >
              <div className="h-8 w-8 shrink-0 rounded-full border border-dashed border-ink-600" />
              <span className="text-[13px] text-ink-600">open</span>
            </li>
          ))}
        </ul>
      </Card>

      {me && (
        <Card className="mt-3 px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-ink-400">Your game balance</p>
              <p className="tnum mt-0.5 text-lg font-semibold text-ink-50">
                {formatMon(me.currentGameBalanceWei)} MON
              </p>
            </div>
            <p className="max-w-[10rem] text-right text-[11px] leading-relaxed text-ink-500">
              Locked for this game. Wrong answers cost 0.1 MON each.
            </p>
          </div>
        </Card>
      )}

      <div className="mt-7 flex items-center justify-center gap-2 pb-4 text-sm text-ink-400">
        <span className="flex gap-1" aria-hidden>
          <Bounce delay="0ms" />
          <Bounce delay="140ms" />
          <Bounce delay="280ms" />
        </span>
        Waiting for the host to start
      </div>
    </div>
  );
}

function Bounce({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-ink-400"
      style={{ animationDelay: delay }}
    />
  );
}
