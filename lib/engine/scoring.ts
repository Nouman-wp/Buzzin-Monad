import { economy, gameRules } from '@/lib/config';
import type { AnswerRecord, PlayerGameState, RoundRecord } from '@/lib/types';

/**
 * Deterministic scoring rules. These functions are pure — they never read the
 * clock, a database, or the network — so the engine is fully testable and a
 * replay of the same inputs always produces the same outputs.
 *
 * Formula (documented per the product spec):
 *   correct  -> 100 base points + up to 50 speed bonus, proportional to the
 *               fraction of the answer window still remaining at the moment
 *               the SERVER received the answer.
 *   wrong    -> 0 points and a 0.1 MON penalty.
 *   timeout  -> 0 points and a 0.1 MON penalty (treated exactly like wrong).
 */

/** Fraction of the round window still remaining, clamped to [0, 1]. */
export function remainingRatio(
  receivedAt: number,
  round: Pick<RoundRecord, 'startedAt' | 'endsAt'>,
): number {
  const window = round.endsAt - round.startedAt;
  if (window <= 0) return 0;
  const remaining = round.endsAt - receivedAt;
  if (remaining <= 0) return 0;
  if (remaining >= window) return 1;
  return remaining / window;
}

/** Points awarded for a correct answer received at `receivedAt`. */
export function scoreForCorrectAnswer(
  receivedAt: number,
  round: Pick<RoundRecord, 'startedAt' | 'endsAt'>,
): number {
  const bonus = Math.round(gameRules.maxSpeedBonus * remainingRatio(receivedAt, round));
  return gameRules.baseScore + bonus;
}

export interface PlayerRoundOutcome {
  playerId: string;
  /** null when the player was already eliminated and did not participate. */
  correct: boolean | null;
  answered: boolean;
  timedOut: boolean;
  scoreAwarded: number;
  /** Amount actually deducted — capped so a balance can never go negative. */
  penaltyAppliedWei: bigint;
  eliminated: boolean;
  answerIndex: number | null;
}

export interface GradeRoundInput {
  round: RoundRecord;
  correctAnswerIndex: number;
  /** Every player in the room, keyed by id. Mutated copies are returned. */
  players: Record<string, PlayerGameState>;
  /** At most one answer per player — enforced upstream by a unique key. */
  answers: AnswerRecord[];
}

export interface GradeRoundResult {
  players: Record<string, PlayerGameState>;
  outcomes: PlayerRoundOutcome[];
  /** Total penalties collected this round, added to the prize pool. */
  penaltyCollectedWei: bigint;
  /** Players eliminated by this round specifically. */
  newlyEliminated: string[];
  gradedAnswers: AnswerRecord[];
}

/**
 * Grade one round for every player in the room.
 *
 * Players who were already eliminated are skipped entirely: they take no
 * penalty and gain no score. Everyone else either answered (correct/wrong) or
 * timed out, and timeouts are penalised identically to wrong answers.
 */
export function gradeRound(input: GradeRoundInput): GradeRoundResult {
  const { round, correctAnswerIndex, answers } = input;
  const penalty = economy.penaltyWei;
  const maxWrong = economy.maxWrongAnswers;

  const answerByPlayer = new Map<string, AnswerRecord>();
  for (const answer of answers) {
    if (answer.roundNumber !== round.roundNumber) continue;
    // Defensive: keep the earliest submission if a duplicate ever slips through.
    const existing = answerByPlayer.get(answer.playerId);
    if (!existing || answer.receivedAt < existing.receivedAt) {
      answerByPlayer.set(answer.playerId, answer);
    }
  }

  const players: Record<string, PlayerGameState> = {};
  const outcomes: PlayerRoundOutcome[] = [];
  const gradedAnswers: AnswerRecord[] = [];
  const newlyEliminated: string[] = [];
  let penaltyCollectedWei = 0n;

  for (const [playerId, original] of Object.entries(input.players)) {
    const player: PlayerGameState = { ...original };

    if (player.eliminated) {
      players[playerId] = player;
      outcomes.push({
        playerId,
        correct: null,
        answered: false,
        timedOut: false,
        scoreAwarded: 0,
        penaltyAppliedWei: 0n,
        eliminated: true,
        answerIndex: null,
      });
      continue;
    }

    const answer = answerByPlayer.get(playerId);
    const answered = Boolean(answer);
    const correct = answered ? answer!.answerIndex === correctAnswerIndex : false;

    let scoreAwarded = 0;
    let penaltyAppliedWei = 0n;

    if (correct) {
      scoreAwarded = scoreForCorrectAnswer(answer!.receivedAt, round);
      player.score += scoreAwarded;
      player.correctCount += 1;
    } else {
      // A wrong answer and a timeout carry the identical economic consequence.
      const balance = BigInt(player.currentGameBalanceWei);
      penaltyAppliedWei = balance < penalty ? balance : penalty;
      player.currentGameBalanceWei = (balance - penaltyAppliedWei).toString();
      player.penaltyTotalWei = (
        BigInt(player.penaltyTotalWei) + penaltyAppliedWei
      ).toString();
      penaltyCollectedWei += penaltyAppliedWei;
      if (answered) player.wrongCount += 1;
      else player.timeoutCount += 1;
    }

    // Elimination triggers on the penalty count OR an exhausted balance —
    // whichever comes first — so a player can never keep playing at 0 MON.
    const penalties = player.wrongCount + player.timeoutCount;
    if (!player.eliminated && (penalties >= maxWrong || BigInt(player.currentGameBalanceWei) <= 0n)) {
      player.eliminated = true;
      player.eliminatedAtRound = round.roundNumber;
      newlyEliminated.push(playerId);
    }

    players[playerId] = player;
    outcomes.push({
      playerId,
      correct,
      answered,
      timedOut: !answered,
      scoreAwarded,
      penaltyAppliedWei,
      eliminated: player.eliminated,
      answerIndex: answer ? answer.answerIndex : null,
    });

    if (answer) {
      gradedAnswers.push({
        ...answer,
        correct,
        scoreAwarded,
        penaltyWei: penaltyAppliedWei.toString(),
      });
    }
  }

  return { players, outcomes, penaltyCollectedWei, newlyEliminated, gradedAnswers };
}

/**
 * Whether a submission arriving at `receivedAt` is still accepted.
 * A small grace window absorbs mobile-network latency without letting a client
 * answer after seeing the result screen.
 */
export function isSubmissionOnTime(
  receivedAt: number,
  round: Pick<RoundRecord, 'startedAt' | 'endsAt'>,
): boolean {
  return receivedAt >= round.startedAt && receivedAt <= round.endsAt + gameRules.submissionGraceMs;
}
