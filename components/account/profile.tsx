'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDemoDateLong } from '@/lib/util/demo-date';
import { AccountShell } from '@/components/account/shell';
import { Avatar } from '@/components/account/avatar';
import { SignInPanel } from '@/components/shared/sign-in';
import { useSession } from '@/components/shared/session';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Skeleton,
  Stat,
} from '@/components/shared/ui';
import { formatMon } from '@/lib/util/money';
import type { AccountOverview } from '@/server/account';

/**
 * Profile.
 *
 * Identity, not money — the dashboard next door owns the balance. The one
 * thing editable here is the display name, because that is the only field the
 * player owns: the picture and email come from Google, and the wallet address
 * is derived, not chosen.
 */
export function AccountProfilePage() {
  const { user, loading: sessionLoading } = useSession();
  const [data, setData] = useState<AccountOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/me/overview', { cache: 'no-store' });
      if (response.status === 401) return;
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Could not load your profile');
      setData(payload as AccountOverview);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your profile');
    }
  }, []);

  useEffect(() => {
    if (!sessionLoading && user) void load();
  }, [sessionLoading, user, load]);

  if (sessionLoading) {
    return (
      <AccountShell>
        <div className="mt-8 space-y-4">
          <Skeleton className="h-56 w-full" />
        </div>
      </AccountShell>
    );
  }

  if (!user) {
    return (
      <AccountShell>
        <Card className="mx-auto mt-16 max-w-md p-6">
          <SignInPanel
            heading="Sign in to see your profile"
            description="Your name, picture and wallet live here."
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

      <IdentityCard profile={data?.profile ?? null} />

      <Card className="mt-5">
        <CardHeader title="Account" subtitle="How you signed in, and what that gives you" />
        <dl className="divide-y divide-[var(--hairline)]">
          <Row label="Email" value={user.email ?? 'Not provided (guest session)'} />
          <Row
            label="Sign-in method"
            value={user.provider === 'google' ? 'Google' : 'Guest display name'}
          />
          <Row
            label="Role"
            value={
              <Badge tone={user.role === 'ADMIN' ? 'volt' : 'neutral'}>
                {user.role.toLowerCase()}
              </Badge>
            }
          />
          <Row
            label="Member since"
            value={
              data ? formatDemoDateLong() : '—'
            }
          />
          <Row
            label="Game wallet"
            value={
              <span className="tnum break-all text-ink-100">{user.walletAddress}</span>
            }
            hint="Created for you automatically. Cash out sends to any address you choose."
          />
        </dl>
      </Card>

      {data && (
        <Card className="mt-5">
          <CardHeader title="At a glance" subtitle="The short version of your record" />
          <div className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
            <Stat label="Games played" value={data.stats.gamesPlayed} />
            <Stat label="Wins" value={data.stats.wins} tone="volt" />
            <Stat
              label="Accuracy"
              value={`${Math.round(data.stats.accuracy * 100)}%`}
              tone="mint"
            />
            <Stat
              label="Won so far"
              value={formatMon(
                (
                  BigInt(data.wallet.claimableWei) + BigInt(data.wallet.cashedOutWei)
                ).toString(),
              )}
              hint="MON"
            />
          </div>
        </Card>
      )}
    </AccountShell>
  );
}

function IdentityCard({ profile }: { profile: AccountOverview['profile'] | null }) {
  const { user, setDisplayName } = useSession();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setDisplayName(name.trim());
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that name');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader
        title="Identity"
        subtitle="What everyone else sees on the leaderboard"
        action={
          !editing && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setName(user.displayName);
                setEditing(true);
              }}
            >
              Edit name
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-5 p-5">
        <Avatar
          name={user.displayName}
          src={profile?.avatarUrl ?? user.avatarUrl}
          seed={user.id}
          size="xl"
        />
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={save} className="max-w-sm space-y-3">
              <Field
                label="Display name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={20}
                autoFocus
                hint="2–20 characters. Shown to every other player."
                error={error}
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={busy} disabled={name.trim().length < 2}>
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p className="font-display truncate text-2xl text-ink-50">
                {user.displayName}
              </p>
              <p className="mt-1 text-sm text-ink-400">
                {user.avatarUrl
                  ? 'Picture from your Google account.'
                  : 'No picture on this account — your initials are used instead.'}
              </p>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3.5">
      <dt className="w-32 shrink-0 text-xs font-medium uppercase tracking-[0.08em] text-ink-400">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm text-ink-100">
        {value}
        {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
      </dd>
    </div>
  );
}
