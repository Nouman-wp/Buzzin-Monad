'use client';

import { Spinner, cx } from '@/components/shared/ui';

/**
 * The answer cards.
 *
 * Sized for a thumb on a phone held one-handed in a crowded room: full-width
 * targets, generous vertical padding, and a letter prefix so the option is
 * identifiable even when the label wraps. Selecting is a single tap and the
 * lock is immediate — the state change never waits on the network round trip
 * to feel responsive.
 */

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function AnswerGrid({
  options,
  locked,
  submitting,
  disabled,
  onAnswer,
}: {
  options: string[];
  locked: number | null;
  submitting: number | null;
  disabled: boolean;
  onAnswer: (index: number) => void;
}) {
  return (
    <div className="mt-4 grid gap-2.5" role="group" aria-label="Answer options">
      {options.map((option, index) => {
        const isLocked = locked === index;
        const isSubmitting = submitting === index;
        const dimmed = locked !== null && !isLocked;

        return (
          <button
            key={`${index}-${option}`}
            type="button"
            disabled={disabled}
            aria-pressed={isLocked}
            onClick={() => onAnswer(index)}
            className={cx(
              'flex min-h-[60px] w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left',
              'transition-[background-color,border-color,transform,opacity,box-shadow] duration-150',
              'active:scale-[0.985] disabled:cursor-default',
              isLocked
                ? 'glow-volt border-volt-500 bg-volt-500/15'
                : dimmed
                  ? 'border-[var(--hairline)] bg-ink-900/40 opacity-45'
                  : 'border-[var(--hairline-strong)] bg-ink-850/80 backdrop-blur-sm hover:border-volt-500/60 hover:bg-ink-800',
            )}
          >
            <span
              className={cx(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                isLocked ? 'bg-volt-500 text-white' : 'bg-ink-700 text-ink-300',
              )}
              aria-hidden
            >
              {LETTERS[index] ?? index + 1}
            </span>
            <span className="min-w-0 flex-1 text-[15px] leading-snug text-ink-50">
              {option}
            </span>
            {isSubmitting && <Spinner className="text-volt-300" />}
          </button>
        );
      })}
    </div>
  );
}
