import { cx } from '@/lib/util/cx';

/**
 * The button style system, in a module both server and client components can
 * import.
 *
 * It lives here rather than beside the `Button` component because that file is
 * `'use client'`, and calling a function exported from a client module inside a
 * server component fails at render time — the landing page is a server
 * component and its call sites are links, not buttons. Keeping the classes here
 * means there is still exactly one definition, shared by `Button` and by every
 * link that should look like one.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * The motion is deliberately small: a one-pixel lift on hover and a press back
 * down on active. Buttons here are tapped fast and repeatedly during a round,
 * and anything larger reads as wobble rather than feedback.
 */
export const BUTTON_BASE =
  'group relative inline-flex items-center justify-center gap-2 rounded-full font-medium ' +
  'transition-[transform,background-color,border-color,color,opacity,box-shadow] ' +
  'duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-volt-400/70 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-[var(--color-ink-950)] ' +
  'disabled:pointer-events-none disabled:opacity-40 disabled:saturate-50 ' +
  'select-none whitespace-nowrap';

export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // A top-lit gradient with a hairline rim and an inner highlight. The rim is
  // what keeps it crisp against both the dark UI and the landing photograph.
  primary:
    'text-white bg-gradient-to-b from-volt-400 to-volt-600 ' +
    'ring-1 ring-inset ring-white/15 ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_1px_2px_rgba(0,0,0,0.35),0_10px_30px_-12px_var(--color-volt-500)] ' +
    'hover:-translate-y-px hover:brightness-[1.07] ' +
    'hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_2px_4px_rgba(0,0,0,0.35),0_16px_40px_-12px_var(--color-volt-500)] ' +
    'active:translate-y-0 active:brightness-95 ' +
    'active:shadow-[inset_0_2px_5px_rgba(0,0,0,0.28),0_1px_2px_rgba(0,0,0,0.3)]',
  secondary:
    'text-ink-100 bg-ink-850/70 backdrop-blur-md ' +
    'ring-1 ring-inset ring-[var(--hairline-strong)] ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.25)] ' +
    'hover:-translate-y-px hover:bg-ink-800/90 hover:text-ink-50 hover:ring-volt-500/35 ' +
    'hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_8px_22px_-14px_rgba(0,0,0,0.9)] ' +
    'active:translate-y-0 active:bg-ink-850',
  ghost: 'text-ink-300 hover:bg-ink-800/60 hover:text-ink-50 active:bg-ink-800/80',
  danger:
    'text-rose-400 bg-rose-500/10 ring-1 ring-inset ring-rose-500/25 ' +
    'hover:-translate-y-px hover:bg-rose-500/16 hover:text-rose-300 hover:ring-rose-500/40 ' +
    'active:translate-y-0 active:bg-rose-500/22',
};

export const BUTTON_SIZES: Record<ButtonSize, string> = {
  // Pills need more horizontal padding than rectangles to look balanced, and
  // the tracking tightens slightly as the label grows.
  sm: 'h-9 px-4 text-[13px]',
  md: 'h-11 px-5 text-[15px] tracking-[-0.005em]',
  lg: 'h-12 min-h-[48px] px-7 text-[15px] tracking-[-0.01em] sm:h-13 sm:min-h-[52px] sm:text-base',
};

/**
 * Button classes for elements that are not `<button>` — chiefly next/link.
 *
 * The landing page previously hand-rolled its own pill styles, which then
 * drifted from the real buttons. Anything that should look like a button calls
 * this instead of restating the classes.
 */
export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
}
