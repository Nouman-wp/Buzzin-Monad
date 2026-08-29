import Link from 'next/link';
import { SiteHeader, SiteFooter } from '@/components/shared/site-chrome';
import { LandingBackdrop } from '@/components/shared/landing-backdrop';
import { Reveal, Stagger, StaggerItem, HoverLift } from '@/components/shared/motion';
import { JoinByCode } from '@/components/player/join-by-code';
import { buttonClass } from '@/lib/util/button-class';
import { economy, gameRules } from '@/lib/config';
import { formatMon } from '@/lib/util/money';
import { MODE_DESCRIPTIONS, MODE_LABELS } from '@/lib/content';
import type { GameMode } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MODES: GameMode[] = ['QUIZ', 'SONGLESS', 'WORDLESS'];

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* The full violet wash is landing-only — see the note in globals.css. */}
      <div aria-hidden className="ambient-wash" />
      <LandingBackdrop />
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 sm:px-8">
        {/* ------------------------------------------------------------ hero */}
        <section className="flex flex-col items-center pb-20 pt-16 text-center sm:pt-24">
          <Reveal>
            <h1 className="font-display max-w-3xl text-balance text-5xl leading-[1.04] text-ink-50 sm:text-7xl">
              Every event needs an{' '}
              <em className="text-shine italic">icebreaker</em>
            </h1>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="mt-5 max-w-md text-pretty text-sm leading-relaxed text-ink-100 sm:text-[15px]">
              We are that icebreaker. Scan, sign in, play — and everyone walks
              away with something real.
            </p>
          </Reveal>

          <Reveal delay={0.2} className="mt-9 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link href="/host" className={buttonClass('primary', 'lg')}>
              Host a game
            </Link>
            <Link href="/dashboard" className={buttonClass('secondary', 'lg')}>
              View dashboard
            </Link>
          </Reveal>

          <Reveal delay={0.3} className="mt-11 w-full max-w-md">
            <JoinByCode />
          </Reveal>
        </section>

        {/* ----------------------------------------------------------- modes */}
        <section id="modes" className="scroll-mt-24 pb-20">
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-volt-300">
              Three ways to play
            </p>
            <h2 className="font-display mt-3 text-3xl text-ink-50 sm:text-4xl">
              One room, <em className="text-violet-gradient italic">any</em> game
            </h2>
          </Reveal>
          <Stagger className="mt-8 grid gap-4 sm:grid-cols-3">
            {MODES.map((mode) => (
              <StaggerItem key={mode}>
                <HoverLift className="h-full">
                  <div className="panel-lit h-full rounded-[var(--radius-card)] border border-[var(--hairline)] bg-ink-900/60 p-6 backdrop-blur-md transition-colors hover:border-volt-500/30">
                    <h3 className="font-display text-xl text-ink-50">{MODE_LABELS[mode]}</h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-ink-200">
                      {MODE_DESCRIPTIONS[mode]}
                    </p>
                  </div>
                </HoverLift>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* ----------------------------------------------------------- stake */}
        <section id="stake" className="scroll-mt-24 pb-24">
          <Reveal>
            <div className="glow-volt panel-lit rounded-[var(--radius-card)] border border-volt-500/20 bg-ink-900/70 p-7 backdrop-blur-md sm:p-9">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-volt-300">
                The economy
              </p>
              <h2 className="font-display mt-3 text-3xl text-ink-50 sm:text-4xl">
                How the stake works
              </h2>
              <dl className="mt-8 grid gap-7 sm:grid-cols-4">
                <Rule
                  term={`${formatMon(economy.playerAllocationWei, 1)} MON`}
                  detail="allocated to every player who joins"
                />
                <Rule
                  term={`${formatMon(economy.prizePoolContributionWei)} / ${formatMon(economy.startingGameBalanceWei)}`}
                  detail="split between the prize pool and your locked balance"
                />
                <Rule
                  term={`−${formatMon(economy.penaltyWei, 1)} MON`}
                  detail={`per wrong answer or timeout — ${economy.maxWrongAnswers} and you're out`}
                />
                <Rule
                  term="Top 5"
                  detail="share the pool, weighted by rank and by score"
                />
              </dl>
              <p className="mt-8 max-w-2xl text-xs leading-relaxed text-ink-300">
                Balances move instantly in-game and are settled on Monad in a
                single transaction when the game ends. Rounds are{' '}
                {gameRules.roundDurationMs / 1000} seconds and every result is
                decided by the server, never your device.
              </p>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function Rule({ term, detail }: { term: string; detail: string }) {
  return (
    <div>
      <dt className="tnum font-display text-2xl tracking-tight text-volt-300">{term}</dt>
      <dd className="mt-1.5 text-sm leading-relaxed text-ink-200">{detail}</dd>
    </div>
  );
}
