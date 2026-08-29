'use client';

import { Badge, Card, CardHeader, Stat, cx } from '@/components/shared/ui';
import type { HostSnapshot } from '@/lib/types';

/**
 * The Game Master panel.
 *
 * Shows the metrics that were fed in, the decision that came out, and the
 * concise explanation the model returned — never internal reasoning, which is
 * neither requested from the model nor stored. When the deterministic fallback
 * ran instead, the panel says so plainly rather than passing it off as AI.
 */
export function AiPanel({
  snapshot,
  aiEnabled,
}: {
  snapshot: HostSnapshot;
  aiEnabled: boolean;
}) {
  const decisions = snapshot.room.aiDecisions;
  const latest = decisions.at(-1) ?? null;
  const metrics = latest?.metrics ?? snapshot.metrics;

  return (
    <Card>
      <CardHeader
        title="AI Game Master"
        subtitle={
          snapshot.room.config.aiGameMasterEnabled
            ? aiEnabled
              ? 'Adapting difficulty from live metrics'
              : 'Deterministic pacing — no AI key configured'
            : 'Disabled for this room'
        }
        action={
          latest && (
            <Badge tone={latest.fallbackUsed ? 'amber' : 'volt'}>
              {latest.fallbackUsed ? 'local' : latest.provider}
            </Badge>
          )
        }
      />

      {!latest ? (
        <p className="px-5 py-8 text-center text-sm text-ink-500">
          The Game Master makes its first call after round one.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
            <Stat
              label="Accuracy"
              value={metrics ? `${Math.round(metrics.accuracy * 100)}%` : '—'}
            />
            <Stat
              label="Median"
              value={metrics ? `${(metrics.medianResponseTimeMs / 1000).toFixed(1)}s` : '—'}
            />
            <Stat
              label="Difficulty"
              value={
                <span className="flex items-baseline gap-1.5">
                  {metrics?.difficulty ?? '—'}
                  <span className="text-ink-500">→</span>
                  <span
                    className={cx(
                      latest.questionSelectionStrategy === 'harder'
                        ? 'text-rose-500'
                        : latest.questionSelectionStrategy === 'easier'
                          ? 'text-mint-400'
                          : 'text-ink-300',
                    )}
                  >
                    {latest.nextDifficulty}
                  </span>
                </span>
              }
            />
            <Stat
              label="Confidence"
              value={`${Math.round(latest.decisionConfidence * 100)}%`}
            />
          </div>

          <div className="border-t border-[var(--hairline)] p-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
              Decision explanation
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-200">{latest.reason}</p>
            <p className="mt-3 text-xs text-ink-500">
              Round {latest.roundNumber} · strategy {latest.questionSelectionStrategy} ·
              topic {latest.nextTopic} · {latest.model}
            </p>
          </div>

          {decisions.length > 1 && (
            <details className="border-t border-[var(--hairline)]">
              <summary className="cursor-pointer px-5 py-3 text-xs font-medium text-ink-400 hover:text-ink-200">
                Decision history ({decisions.length})
              </summary>
              <ul className="max-h-64 divide-y divide-[var(--hairline)] overflow-y-auto scroll-thin">
                {decisions
                  .slice()
                  .reverse()
                  .map((decision) => (
                    <li key={decision.id} className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="tnum text-xs text-ink-500">R{decision.roundNumber}</span>
                        <Badge tone={decision.fallbackUsed ? 'amber' : 'volt'}>
                          {decision.questionSelectionStrategy}
                        </Badge>
                        <span className="tnum text-xs text-ink-400">
                          → D{decision.nextDifficulty}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
                        {decision.reason}
                      </p>
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Card>
  );
}
