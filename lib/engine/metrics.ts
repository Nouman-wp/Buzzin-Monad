import type { GameMetrics, PlayerGameState, RoundRecord } from '@/lib/types';
import type { PlayerRoundOutcome } from '@/lib/engine/scoring';
import type { AnswerRecord } from '@/lib/types';

/**
 * Summarise a finished round into the metric packet the AI Game Master reasons
 * over. Everything here is derived from authoritative server state.
 */
export function computeRoundMetrics(params: {
  round: RoundRecord;
  outcomes: PlayerRoundOutcome[];
  answers: AnswerRecord[];
  players: Record<string, PlayerGameState>;
  prizePoolWei: bigint;
}): GameMetrics {
  const { round, outcomes, answers, players, prizePoolWei } = params;

  // Only players who were alive at the start of the round count as active.
  const participants = outcomes.filter((outcome) => outcome.correct !== null);
  const correct = participants.filter((outcome) => outcome.correct === true).length;
  const answered = participants.filter((outcome) => outcome.answered).length;
  const wrong = participants.filter((outcome) => outcome.answered && !outcome.correct).length;
  const timeouts = participants.filter((outcome) => !outcome.answered).length;

  const latencies = answers
    .filter((answer) => answer.roundNumber === round.roundNumber)
    .map((answer) => Math.max(0, answer.receivedAt - round.startedAt))
    .sort((a, b) => a - b);

  const average =
    latencies.length > 0
      ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length)
      : 0;

  const median =
    latencies.length === 0
      ? 0
      : latencies.length % 2 === 1
        ? latencies[(latencies.length - 1) / 2]
        : Math.round((latencies[latencies.length / 2 - 1] + latencies[latencies.length / 2]) / 2);

  const scores = Object.values(players).map((player) => player.score);
  const scoreSpread = scores.length > 0 ? Math.max(...scores) - Math.min(...scores) : 0;

  return {
    roundNumber: round.roundNumber,
    activePlayers: participants.length,
    answers: answered,
    correct,
    wrong,
    timeouts,
    accuracy: participants.length > 0 ? Number((correct / participants.length).toFixed(3)) : 0,
    averageResponseTimeMs: average,
    medianResponseTimeMs: median,
    difficulty: round.difficulty,
    eliminatedPlayers: Object.values(players).filter((player) => player.eliminated).length,
    prizePoolWei: prizePoolWei.toString(),
    scoreSpread,
  };
}
