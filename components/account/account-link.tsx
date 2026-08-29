'use client';

import Link from 'next/link';
import { Avatar } from '@/components/account/avatar';
import { useSession } from '@/components/shared/session';
import { cx } from '@/components/shared/ui';

/**
 * The signed-in chip: picture, name, and a way into the account.
 *
 * Renders nothing when nobody is signed in, so it can sit in any header —
 * including the landing page, which has no idea whether the visitor has a
 * session until the client asks.
 */
export function AccountLink({
  compact = false,
  className,
}: {
  /** Picture only. For the player screen, where width is scarce. */
  compact?: boolean;
  className?: string;
}) {
  const { user, loading } = useSession();
  if (loading || !user) return null;

  return (
    <Link
      href="/dashboard"
      aria-label={`${user.displayName} — open your dashboard`}
      className={cx(
        'flex items-center gap-2 rounded-xl border border-[var(--hairline-strong)] transition-colors hover:bg-ink-800',
        compact ? 'p-1' : 'py-1.5 pl-1.5 pr-3',
        className,
      )}
    >
      <Avatar
        name={user.displayName}
        src={user.avatarUrl}
        seed={user.id}
        size="sm"
        className="border-0"
      />
      {!compact && (
        <span className="max-w-[9rem] truncate text-sm text-ink-200">{user.displayName}</span>
      )}
    </Link>
  );
}
