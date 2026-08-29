'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Wordmark } from '@/components/shared/brand';
import { Avatar } from '@/components/account/avatar';
import { useSession } from '@/components/shared/session';
import { cx } from '@/components/shared/ui';

/**
 * Chrome shared by the two account pages.
 *
 * Dashboard and profile are the same account seen two ways — money and history
 * on one, identity on the other — so they share a header and a two-tab switch
 * rather than being two unrelated screens.
 */

const TABS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/profile', label: 'Profile' },
] as const;

export function AccountShell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useSession();
  const pathname = usePathname();

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <Wordmark />
        <nav className="flex items-center gap-2">
          <Link
            href="/host"
            className="rounded-full border border-[var(--hairline-strong)] bg-ink-850/60 px-4 py-2 text-sm text-ink-200 backdrop-blur-sm transition-colors hover:border-volt-500/40 hover:bg-ink-800"
          >
            Host
          </Link>
          {user?.role === 'ADMIN' && (
            <Link
              href="/admin"
              className="rounded-full border border-[var(--hairline-strong)] bg-ink-850/60 px-4 py-2 text-sm text-ink-200 backdrop-blur-sm transition-colors hover:border-volt-500/40 hover:bg-ink-800"
            >
              Admin
            </Link>
          )}
          {user && (
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-full px-3.5 py-2 text-sm text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
            >
              Sign out
            </button>
          )}
        </nav>
      </header>

      {user && (
        <div className="mt-9 flex flex-wrap items-center gap-4">
          <Avatar
            name={user.displayName}
            src={user.avatarUrl}
            seed={user.id}
            size="lg"
          />
          <div className="min-w-0">
            <h1 className="font-display truncate text-3xl text-ink-50">
              {user.displayName}
            </h1>
            <p className="truncate text-sm text-ink-400">
              {user.email ?? 'Guest session'}
            </p>
          </div>
        </div>
      )}

      {user && (
        <div className="mt-6 flex gap-1 border-b border-[var(--hairline)]">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  '-mb-px border-b-2 px-3.5 py-2.5 text-sm transition-colors',
                  active
                    ? 'border-volt-500 text-ink-50'
                    : 'border-transparent text-ink-400 hover:text-ink-100',
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      )}

      {children}
    </main>
  );
}
