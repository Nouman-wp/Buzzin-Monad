'use client';

import { useState } from 'react';
import { cx } from '@/components/shared/ui';

/**
 * Profile picture, with a deterministic initials fallback.
 *
 * Guests have no picture, and Google's CDN URLs expire, so the fallback is the
 * common case rather than an edge case — it is a real avatar, not a grey box.
 * The colour is derived from the user id so the same person is always the same
 * colour, in the lobby and on their dashboard alike.
 *
 * A plain `<img>` is deliberate: these are 32–96px remote thumbnails that
 * Google already serves at the right size, so `next/image` would add an
 * optimiser hop and a failure mode (a 500 from the optimiser when Google
 * expires the URL) for no benefit.
 */

const TINTS = [
  'bg-volt-500/18 text-volt-300',
  'bg-mint-500/18 text-mint-400',
  'bg-sky-500/18 text-sky-500',
  'bg-amber-500/18 text-amber-500',
  'bg-rose-500/18 text-rose-500',
] as const;

const SIZES = {
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-10 w-10 text-sm',
  lg: 'h-16 w-16 text-lg',
  xl: 'h-24 w-24 text-2xl',
} as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function tintFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return TINTS[hash % TINTS.length];
}

export function Avatar({
  name,
  src,
  seed,
  size = 'md',
  className,
}: {
  name: string;
  src?: string | null;
  /** Stable value the fallback colour is derived from. Defaults to the name. */
  seed?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const shell = cx(
    'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full',
    'border border-[var(--hairline-strong)] font-semibold',
    SIZES[size],
    className,
  );

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- see module note
      <img
        src={src}
        alt={`${name}'s profile picture`}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cx(shell, 'bg-ink-850 object-cover')}
      />
    );
  }

  return (
    <span aria-hidden className={cx(shell, tintFor(seed ?? name))}>
      {initials(name)}
    </span>
  );
}
