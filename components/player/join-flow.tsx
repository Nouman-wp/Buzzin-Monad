'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Wordmark } from '@/components/shared/brand';
import { SignInPanel } from '@/components/shared/sign-in';
import { useSession } from '@/components/shared/session';
import { Badge, Button, Card, ErrorState, Field, Skeleton, cx } from '@/components/shared/ui';
import { formatMon, shortAddress } from '@/lib/util/money';
import { MODE_LABELS } from '@/lib/content';
import type { GameMode, RoomStatus } from '@/lib/types';

interface RoomPreview {
  id: string;
  code: string;
  name: string;
  mode: GameMode;
  status: RoomStatus;
  hostName: string;
  topic: string;
  totalRounds: number;
  playerCount: number;
  maxPlayers: number;
  prizePoolWei: string;
  full: boolean;
  joinable: boolean;
}

type Step = 'loading' | 'missing' | 'signin' | 'confirm' | 'joining';

/**
 * The full join path for a scanned room code.
 *
 * Every failure mode here is a dead end for a player standing in a room, so
 * each one gets an explicit state and a way forward: room not found, room full,
 * game already started, sign-in failed, network dropped.
 */
export function JoinFlow({ roomCode }: { roomCode: string }) {
  const router = useRouter();
  const { user, loading: sessionLoading, setDisplayName } = useSession();

  const [room, setRoom] = useState<RoomPreview | null>(null);
  const [missing, setMissing] = useState(false);
  const [joining, setJoining] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // The step is a pure function of what we know, so there is no state to keep
  // in sync and no way for the screen to disagree with the data behind it.
  const step: Step = missing
    ? 'missing'
    : joining
      ? 'joining'
      : sessionLoading || !room
        ? 'loading'
        : !user
          ? 'signin'
          : 'confirm';

  // The player may retype their name; until they do, show the one on file.
  const nameValue = name ?? user?.displayName ?? '';

  const loadRoom = useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/code/${roomCode}`, { cache: 'no-store' });
      if (response.status === 404) {
        setMissing(true);
        return;
      }
      const data = (await response.json()) as { room: RoomPreview };
      setRoom(data.room);
      setError(null);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    }
  }, [roomCode]);

  useEffect(() => {
    void loadRoom();
  }, [loadRoom]);

  // Keep the lobby count live while the player decides.
  useEffect(() => {
    if (step === 'missing') return;
    const id = setInterval(() => void loadRoom(), 3000);
    return () => clearInterval(id);
  }, [loadRoom, step]);

  const join = async () => {
    if (!room || !user) return;
    setJoining(true);
    setJoinError(null);
    try {
      const trimmed = nameValue.trim();
      if (trimmed && trimmed !== user.displayName) {
        await setDisplayName(trimmed);
      }
      const response = await fetch(`/api/rooms/${room.id}/join`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? 'Could not join the room');
      }
      router.push(`/play/${room.id}`);
    } catch (cause) {
      setJoinError(cause instanceof Error ? cause.message : 'Could not join the room');
      setJoining(false);
      void loadRoom();
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-10 pt-6">
      <header className="flex items-center justify-between">
        <Wordmark size="sm" />
        <span className="tnum rounded-lg border border-[var(--hairline-strong)] px-2.5 py-1 text-xs tracking-[0.18em] text-ink-300">
          {roomCode}
        </span>
      </header>

      {step === 'missing' ? (
        <MissingRoom
          code={roomCode}
          onRetry={() => {
            setMissing(false);
            void loadRoom();
          }}
        />
      ) : (
        <>
          <div className="mt-8">
            {room ? <RoomHeadline room={room} /> : <RoomHeadlineSkeleton />}
          </div>

          <Card className="mt-6 p-5">
            {error && <ErrorState message={error} onRetry={() => void loadRoom()} />}

            {!error && step === 'loading' && (
              <div className="space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-13 w-full" />
              </div>
            )}

            {!error && step === 'signin' && (
              <SignInPanel
                heading="Sign in to join"
                description="Takes a second. Your wallet is created for you."
              />
            )}

            {!error && (step === 'confirm' || step === 'joining') && room && user && (
              <div className="animate-rise">
                <h1 className="font-display text-xl text-ink-50">
                  You&apos;re in as
                </h1>
                <div className="mt-4 space-y-4">
                  <Field
                    label="Display name"
                    value={nameValue}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={20}
                    hint="Change it now if you like — this is what the leaderboard shows."
                  />
                  <div className="flex items-center justify-between rounded-xl border border-[var(--hairline)] bg-ink-850 px-3.5 py-3">
                    <div>
                      <p className="text-xs text-ink-400">Your wallet</p>
                      <p className="tnum mt-0.5 text-sm text-ink-100">
                        {shortAddress(user.walletAddress, 6)}
                      </p>
                    </div>
                    <Badge tone="mint">Ready</Badge>
                  </div>

                  {joinError && <ErrorState message={joinError} />}

                  {room.full && !joinError && (
                    <ErrorState message="This room is full. Ask the host to open another one." />
                  )}
                  {!room.joinable && !room.full && (
                    <ErrorState
                      message={
                        room.status === 'LOBBY'
                          ? 'This room is not accepting players right now.'
                          : 'This game has already started. Ask the host for the next room.'
                      }
                    />
                  )}

                  <Button
                    block
                    size="lg"
                    onClick={join}
                    loading={step === 'joining'}
                    disabled={!room.joinable || nameValue.trim().length < 2}
                  >
                    Enter the lobby
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {room && (
            <p className="mt-5 text-center text-xs leading-relaxed text-ink-500">
              You&apos;ll get {formatMon('1000000000000000000', 1)} MON of testnet funds when you
              join. Half seeds the prize pool, half is your game balance.
            </p>
          )}
        </>
      )}
    </main>
  );
}

function RoomHeadline({ room }: { room: RoomPreview }) {
  const fill = room.maxPlayers > 0 ? room.playerCount / room.maxPlayers : 0;
  return (
    <div className="animate-rise">
      <div className="flex items-center gap-2">
        <Badge tone="volt">{MODE_LABELS[room.mode]}</Badge>
        <Badge tone={room.status === 'LOBBY' ? 'mint' : 'amber'}>
          {room.status === 'LOBBY' ? 'Open' : room.status.toLowerCase()}
        </Badge>
      </div>
      <h1 className="font-display mt-3 text-3xl leading-tight text-ink-50">
        {room.name}
      </h1>
      <p className="mt-1.5 text-sm text-ink-400">
        Hosted by {room.hostName} · {room.totalRounds} rounds · {room.topic}
      </p>

      <div className="mt-5 flex items-end justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
            Players
          </p>
          <p className="tnum mt-1 text-xl font-semibold text-ink-50">
            {room.playerCount}
            <span className="text-ink-500"> / {room.maxPlayers}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
            Prize pool
          </p>
          <p className="tnum mt-1 text-xl font-semibold text-volt-300">
            {formatMon(room.prizePoolWei)} MON
          </p>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-800">
        <div
          className={cx(
            'h-full rounded-full transition-[width] duration-500',
            fill >= 1 ? 'bg-amber-500' : 'bg-volt-500',
          )}
          style={{ width: `${Math.min(100, fill * 100)}%` }}
        />
      </div>
    </div>
  );
}

function RoomHeadlineSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-4 w-40" />
    </div>
  );
}

function MissingRoom({ code, onRetry }: { code: string; onRetry: () => void }) {
  const router = useRouter();
  return (
    <div className="mt-16 animate-rise text-center">
      <h1 className="font-display text-3xl text-ink-50">Room not found</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-400">
        No room is using the code <span className="tnum text-ink-200">{code}</span>. Check
        the code on the host&apos;s screen, or scan the QR again.
      </p>
      <div className="mt-7 flex flex-col gap-2.5">
        <Button size="lg" onClick={onRetry}>
          Try again
        </Button>
        <Button variant="ghost" size="lg" onClick={() => router.push('/')}>
          Back to start
        </Button>
      </div>
    </div>
  );
}
