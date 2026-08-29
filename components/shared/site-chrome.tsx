import Link from 'next/link';
import { Wordmark } from '@/components/shared/brand';
import { cx } from '@/lib/util/cx';

/**
 * Global chrome: the frosted sticky navbar and the site footer.
 * Server components — keep client-only imports out of this file.
 */

const NAV_LINKS = [
  { href: '/#modes', label: 'Game modes' },
  { href: '/#stake', label: 'The stake' },
  { href: '/dashboard', label: 'Dashboard' },
];

export function SiteHeader({ className }: { className?: string }) {
  return (
    <header
      className={cx(
        'glass sticky top-0 z-40 border-b border-[var(--hairline)]',
        className,
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Wordmark />
        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-ink-200 transition-colors hover:text-ink-50"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2.5">
          <Link
            href="/dashboard"
            className="hidden h-10 items-center rounded-full border border-[var(--hairline-strong)] bg-ink-850/60 px-4 text-sm font-medium text-ink-100 backdrop-blur-sm transition-colors hover:border-volt-500/40 hover:bg-ink-800 sm:inline-flex"
          >
            My account
          </Link>
          <Link
            href="/host"
            className="inline-flex h-10 items-center rounded-full bg-gradient-to-b from-volt-400 to-volt-600 px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_28px_-10px_var(--color-volt-500)] transition-[box-shadow,filter] hover:brightness-110"
          >
            Host a game
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-[var(--hairline)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-xs">
            <Wordmark href="/" />
            <p className="mt-3 text-sm leading-relaxed text-ink-200">
              Live multiplayer game nights with an AI Game Master, a real
              leaderboard, and settlement on Monad.
            </p>
          </div>
          <nav className="flex gap-14 text-sm" aria-label="Footer">
            <div className="flex flex-col gap-2.5">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-ink-300">
                Play
              </p>
              <Link href="/" className="text-ink-200 transition-colors hover:text-ink-50">
                Join a game
              </Link>
              <Link href="/dashboard" className="text-ink-200 transition-colors hover:text-ink-50">
                Dashboard
              </Link>
              <Link href="/profile" className="text-ink-200 transition-colors hover:text-ink-50">
                Profile
              </Link>
            </div>
            <div className="flex flex-col gap-2.5">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-ink-300">
                Run
              </p>
              <Link href="/host" className="text-ink-200 transition-colors hover:text-ink-50">
                Host a game
              </Link>
              <Link href="/admin" className="text-ink-200 transition-colors hover:text-ink-50">
                Admin
              </Link>
            </div>
          </nav>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--hairline)] pt-6 text-xs text-ink-300">
          <p>© {new Date().getFullYear()} BuzzIn</p>
          <p>Monad testnet demo · testnet MON has no monetary value</p>
        </div>
      </div>
    </footer>
  );
}
