'use client';

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '@/lib/util/cx';
import {
  BUTTON_BASE,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  buttonClass,
  type ButtonSize,
  type ButtonVariant,
} from '@/lib/util/button-class';

/**
 * The shared primitive set.
 *
 * Small on purpose: one button, one card, one field, one badge. Both the player
 * and host surfaces are built from these, which is what makes two very
 * different densities still read as one product.
 */

// Re-exported so component files have a single import for everything they use.
// The button styles live outside this module because it is a client component
// and server components need them too; see lib/util/button-class.ts.
export { cx, buttonClass };
export type { ButtonSize, ButtonVariant };

// ------------------------------------------------------------------- button

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        BUTTON_BASE,
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70',
        className,
      )}
    />
  );
}

// --------------------------------------------------------------------- card

export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'aside';
}) {
  return (
    <Tag
      className={cx(
        'panel-lit rounded-[var(--radius-card)] border border-[var(--hairline)] bg-ink-900/60 backdrop-blur-md',
        'shadow-[0_24px_60px_-40px_rgba(0,0,0,0.9)]',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex items-start justify-between gap-4 border-b border-[var(--hairline)] px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold tracking-tight text-ink-50">{title}</h2>
        {subtitle && <p className="mt-0.5 truncate text-xs text-ink-300">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// -------------------------------------------------------------------- badge

type BadgeTone = 'neutral' | 'volt' | 'mint' | 'amber' | 'rose' | 'sky';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-800 text-ink-200 border-[var(--hairline-strong)]',
  volt: 'bg-volt-500/12 text-volt-300 border-volt-500/30',
  mint: 'bg-mint-500/12 text-mint-400 border-mint-500/30',
  amber: 'bg-amber-500/12 text-amber-500 border-amber-500/30',
  rose: 'bg-rose-500/12 text-rose-500 border-rose-500/30',
  sky: 'bg-sky-500/12 text-sky-500 border-sky-500/30',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = 'mint' }: { tone?: BadgeTone }) {
  const colours: Record<BadgeTone, string> = {
    neutral: 'bg-ink-400',
    volt: 'bg-volt-400',
    mint: 'bg-mint-400',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
    sky: 'bg-sky-500',
  };
  return <span aria-hidden className={cx('h-1.5 w-1.5 rounded-full', colours[tone])} />;
}

// -------------------------------------------------------------------- field

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | null;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const inputId = id ?? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="w-full">
      <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-ink-300">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        className={cx(
          'h-11 w-full rounded-2xl border bg-ink-850/80 px-4 text-[15px] text-ink-50 outline-none',
          'placeholder:text-ink-400 transition-[border-color,box-shadow]',
          error
            ? 'border-rose-500/60 focus:border-rose-500'
            : 'border-[var(--hairline-strong)] focus:border-volt-500 focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-volt-500)_18%,transparent)]',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-xs text-rose-500">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-ink-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export function Select({
  label,
  children,
  className,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = rest.id ?? `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="w-full">
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-ink-300">
        {label}
      </label>
      <select
        id={id}
        className={cx(
          'h-11 w-full appearance-none rounded-2xl border border-[var(--hairline-strong)] bg-ink-850/80 px-4 text-[15px]',
          'text-ink-50 outline-none transition-colors focus:border-volt-500',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
    </div>
  );
}

// ------------------------------------------------------------------- states

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-ink-500">{icon}</div>}
      <p className="text-sm font-medium text-ink-100">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-400">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/8 px-4 py-3"
    >
      <p className="text-sm text-rose-500">{message}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded-lg', className)} />;
}

/** Small labelled statistic. The building block of every metric strip. */
export function Stat({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'volt' | 'mint' | 'rose';
  className?: string;
}) {
  const tones = {
    default: 'text-ink-50',
    volt: 'text-volt-300',
    mint: 'text-mint-400',
    rose: 'text-rose-500',
  } as const;
  return (
    <div className={cx('min-w-0', className)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">{label}</p>
      <p className={cx('tnum mt-1 truncate text-xl font-semibold tracking-tight', tones[tone ?? 'default'])}>
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-xs text-ink-400">{hint}</p>}
    </div>
  );
}
