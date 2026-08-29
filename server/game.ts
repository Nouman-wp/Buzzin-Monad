import { after } from 'next/server';
import { gameRules } from '@/lib/config';
import { getStore } from '@/lib/store';
import { emitEvent, emitEvents, type EmitEvent } from '@/server/events';
import { getAiProvider } from '@/lib/ai';
import { gradeRound, isSubmissionOnTime } from '@/lib/engine/scoring';
import { applyRanks, buildLeaderboard } from '@/lib/engine/leaderboard';
import { computeRoundMetrics } from '@/lib/engine/metrics';
import { newId } from '@/lib/util/ids';
import { formatMon } from '@/lib/util/money';
import { RoomError, approvedChallenges, startBlockers, syncReservation } from '@/server/rooms';
import type {
  AiDecision,
  Challenge,
  GameEventType,
  GameMetrics,
  PublicChallenge,
  RoomState,
  RoundRecord,
} from '@/lib/types';
import type { SessionUser } from '@/lib/auth/session';

/**
 * The authoritative game engine.
 *
 * Timing model: there is no long-lived server process. Every round carries an
 * absolute `endsAt` server timestamp, and `advanceGame` is a pure function of
 * "what time is it now" that any request can drive — the host dashboard ticks
 * it, and every player poll drives it too. That means the game keeps moving
 * even if the host's tab is backgrounded, and it works on serverless.
 *
 * Every transition is applied inside a compare-and-swap update that re-checks
 * its own precondition, so concurrent ticks cannot double-grade a round or
 * start the same round twice.
 */

// ------------------------------------------------------------ round content

/** The challenge for a given round number, or null if the set is exhausted. */
export function challengeForRound(room: RoomState, roundNumber: number): Challenge | null {
  const round = room.rounds.find((entry) => entry.roundNumber === roundNumber);
  if (round) {
    return room.challenges.find((challenge) => challenge.id === round.challengeId) ?? null;
  }
  return null;
}

export function currentChallenge(room: RoomState): Challenge | null {
  if (room.currentRound === 0) return null;
  return challengeForRound(room, room.currentRound);
}

/** Strip the answer key. This is the only challenge shape sent mid-round. */
export function toPublicChallenge(challenge: Challenge): PublicChallenge {
  return {
    id: challenge.id,
    gameType: challenge.gameType,
    question: challenge.question,
    options: challenge.options,
    difficulty: challenge.difficulty,
    topic: challenge.topic,
    source: challenge.source,
    audioUrl: challenge.audioUrl,
    pattern: challenge.pattern,
  };
}

/**
 * Pick the challenge for the next round.
 *
 * The AI Game Master proposes a difficulty and topic; this deterministic code
 * decides which approved question actually plays. An unused question is always
 * chosen, scored by how well it matches the proposal — so a bad or hostile AI
 * response can only nudge selection, never inject content or skip approval.
 */
export function selectNextChallenge(
  room: RoomState,
  targetDifficulty: number,
  targetTopic: string,
): Challenge | null {
  const used = new Set(room.rounds.map((round) => round.challengeId));
  const pool = approvedChallenges(room).filter((challenge) => !used.has(challenge.id));
  if (pool.length === 0) return null;

  const wantedTopic = targetTopic.trim().toLowerCase();
  let best = pool[0];
  let bestScore = -Infinity;
  for (const challenge of pool) {
    let score = -Math.abs(challenge.difficulty - targetDifficulty) * 10;
    if (wantedTopic && challenge.topic.toLowerCase() === wantedTopic) score += 5;
    if (score > bestScore) {
      bestScore = score;
      best = challenge;
    }
  }
  return best;
}

// ------------------------------------------------------------------- start

export async function startGame(roomId: string): Promise<RoomState> {
  const store = getStore();
  const room = await store.getRoomById(roomId);
  if (!room) throw new RoomError('Room not found', 404, 'ROOM_NOT_FOUND');

  const blockers = startBlockers(room);
  if (blockers.length > 0) {
    throw new RoomError(blockers[0], 409, 'CANNOT_START');
  }

  const startAt = Date.now();
  const updated = await store.updateRoom(roomId, (state) => {
    // Re-check under the lock: another tab may have started it already.
    if (state.status !== 'LOBBY') return null;
    state.status = 'RUNNING';
    state.phase = 'STARTING';
    state.startedAt = startAt;
    state.phaseEndsAt = startAt + gameRules.countdownMs;
    state.leaderboard = buildLeaderboard(state.players);
    // The door is shut, so the seats nobody took go back to the demo budget.
    syncReservation(state);
    return state;
  });

  if (!updated) throw new RoomError('The game has already started', 409, 'ALREADY_STARTED');

  await emitEvent(
    updated.id,
    {
      type: 'GAME_STARTING',
      level: 'GAME',
      message: `Game starting with ${Object.keys(updated.players).length} players`,
      payload: {
        room: updated.code,
        players: Object.keys(updated.players).length,
        rounds: updated.config.questionCount,
        mode: updated.config.mode,
      },
    },
    { version: updated.version },
  );

  return updated;
}

// ------------------------------------------------------------------ answers

export interface SubmitAnswerResult {
  accepted: boolean;
  reason?: string;
  duplicate?: boolean;
}

/**
 * Record a player's answer.
 *
 * The server timestamp taken here is the only timing that counts toward the
 * speed bonus; the client clock is recorded for observability but never
 * trusted. Correctness is not evaluated and not returned — that would leak the
 * answer to players who have not answered yet.
 */
export async function submitAnswer(
  room: RoomState,
  user: SessionUser,
  input: { roundNumber: number; answerIndex: number; clientTs?: number },
): Promise<SubmitAnswerResult> {
  const receivedAt = Date.now();

  const player = room.players[user.id];
  if (!player) return { accepted: false, reason: 'You are not in this room' };
  if (player.eliminated) return { accepted: false, reason: 'You have been eliminated' };
  if (room.status !== 'RUNNING') return { accepted: false, reason: 'The game is not running' };
  if (room.phase !== 'ROUND_ACTIVE') return { accepted: false, reason: 'This round is closed' };
  if (input.roundNumber !== room.currentRound) {
    return { accepted: false, reason: 'That round has already ended' };
  }

  const round = room.rounds.find((entry) => entry.roundNumber === input.roundNumber);
  if (!round) return { accepted: false, reason: 'Round not found' };
  if (round.gradedAt !== null) return { accepted: false, reason: 'That round has already ended' };
  if (!isSubmissionOnTime(receivedAt, round)) {
    return { accepted: false, reason: 'Time is up for this round' };
  }

  const challenge = challengeForRound(room, input.roundNumber);
  if (!challenge) return { accepted: false, reason: 'Round content unavailable' };
  if (input.answerIndex < 0 || input.answerIndex >= challenge.options.length) {
    return { accepted: false, reason: 'Invalid answer' };
  }

  // The unique index on (room, round, player) is what actually enforces
  // one-answer-per-round, atomically, even across concurrent requests.
  const result = await getStore().insertAnswer({
    roomId: room.id,
    roundNumber: input.roundNumber,
    playerId: user.id,
    answerIndex: input.answerIndex,
    receivedAt,
    clientTs: input.clientTs ?? null,
  });

  if (result === 'duplicate') {
    return { accepted: false, duplicate: true, reason: 'You have already answered' };
  }

  await emitEvent(
    room.id,
    {
      type: 'ANSWER_LOCKED',
      level: 'PLAYER',
      message: `${user.displayName} locked an answer`,
      payload: {
        player: user.displayName,
        round: input.roundNumber,
        latency: `${receivedAt - round.startedAt}ms`,
      },
    },
    { version: room.version },
  );

  return { accepted: true };
}

// ------------------------------------------------------------------ advance

export interface AdvanceResult {
  room: RoomState;
  changed: boolean;
}

/**
 * Drive the state machine to wherever the clock says it should be.
 *
 * Safe to call from anywhere, at any frequency, concurrently. Each step
 * re-validates its precondition inside the compare-and-swap, so a step that
 * another request already performed is a no-op rather than a double-apply.
 */
export async function advanceGame(roomId: string): Promise<AdvanceResult> {
  const store = getStore();
  let room = await store.getRoomById(roomId);
  if (!room) throw new RoomError('Room not found', 404, 'ROOM_NOT_FOUND');

  let changed = false;

  // A bounded loop, because one call may need to close a round and open the
  // next when a request arrives after both deadlines have passed.
  for (let step = 0; step < 3; step += 1) {
    if (room.status !== 'RUNNING') break;
    const now = Date.now();

    if (room.phase === 'STARTING') {
      if (room.phaseEndsAt !== null && now < room.phaseEndsAt) break;
      const opened = await beginRound(room, 1);
      if (opened.status !== 'started') break;
      room = opened.room;
      changed = true;
      continue;
    }

    if (room.phase === 'ROUND_ACTIVE') {
      // Bind to a const so the closure below cannot see a reassigned `room`.
      const active = room;
      const round = active.rounds.find((entry) => entry.roundNumber === active.currentRound);
      if (!round) break;
      if (now <= round.endsAt) break;
      const next = await closeRound(active, round);
      if (!next) break;
      room = next;
      changed = true;
      continue;
    }

    if (room.phase === 'INTERMISSION') {
      if (room.phaseEndsAt !== null && now < room.phaseEndsAt) break;
      const nextRoundNumber = room.currentRound + 1;
      if (nextRoundNumber > room.config.questionCount) {
        const finished = await completeGame(room);
        if (!finished) break;
        room = finished;
        changed = true;
        break;
      }
      const outcome = await beginRound(room, nextRoundNumber);

      if (outcome.status === 'started') {
        room = outcome.room;
        changed = true;
        continue;
      }

      // Another request got there first. That is the normal case with a host
      // ticking and every player polling; yield and let the next call observe
      // whatever they committed. Ending the game here is what previously cut
      // every game short after round one.
      if (outcome.status === 'raced') break;

      // Genuinely out of approved content: end cleanly rather than stalling.
      const finished = await completeGame(room);
      if (!finished) break;
      room = finished;
      changed = true;
      break;
    }

    break;
  }

  return { room, changed };
}

/**
 * Why a round did not open.
 *
 * The distinction matters: `exhausted` means there is no approved content left
 * and the game should finish, while `raced` means another request beat us to
 * the same transition and this one should simply yield. Collapsing the two into
 * a null return ended every game after its first round, because the host
 * dashboard ticks while every player polls, so something loses that race at
 * every single transition.
 */
type BeginRoundOutcome =
  | { status: 'started'; room: RoomState }
  | { status: 'raced' }
  | { status: 'exhausted' };

async function beginRound(
  room: RoomState,
  roundNumber: number,
): Promise<BeginRoundOutcome> {
  const decision = room.aiDecisions.find((entry) => entry.roundNumber === roundNumber - 1);
  const targetDifficulty = decision?.nextDifficulty ?? room.config.difficulty;
  const targetTopic = decision?.nextTopic ?? room.config.topic;

  const challenge = selectNextChallenge(room, targetDifficulty, targetTopic);
  if (!challenge) return { status: 'exhausted' };

  const startedAt = Date.now();
  const round: RoundRecord = {
    roundNumber,
    challengeId: challenge.id,
    startedAt,
    endsAt: startedAt + gameRules.roundDurationMs,
    gradedAt: null,
    difficulty: challenge.difficulty,
    topic: challenge.topic,
  };

  // Every precondition below is a lost race, not a reason to end the game.
  const updated = await getStore().updateRoom(room.id, (state) => {
    if (state.status !== 'RUNNING') return null;
    // Someone else may have opened this round already.
    if (state.rounds.some((entry) => entry.roundNumber === roundNumber)) return null;
    if (state.phase !== 'STARTING' && state.phase !== 'INTERMISSION') return null;
    state.rounds.push(round);
    state.currentRound = roundNumber;
    state.phase = 'ROUND_ACTIVE';
    state.phaseEndsAt = round.endsAt;
    return state;
  });

  if (!updated) return { status: 'raced' };

  await emitEvents(
    updated.id,
    [
      {
        type: 'ROUND_STARTED',
        level: 'GAME',
        message: `Round ${roundNumber} of ${updated.config.questionCount} started`,
        payload: {
          round: roundNumber,
          difficulty: challenge.difficulty,
          topic: challenge.topic,
          duration: `${gameRules.roundDurationMs / 1000}s`,
        },
      },
      {
        type: 'QUESTION_REVEALED',
        level: 'GAME',
        message: 'Question revealed to players',
        // The answer key is never written to the event log.
        payload: { id: challenge.id, source: challenge.source, mode: challenge.gameType },
      },
    ],
    { version: updated.version },
  );

  return { status: 'started', room: updated };
}

/** Grade a round, update the leaderboard, and ask the Game Master what's next. */
async function closeRound(room: RoomState, round: RoundRecord): Promise<RoomState | null> {
  const store = getStore();
  const challenge = challengeForRound(room, round.roundNumber);
  if (!challenge) return null;

  const answers = await store.listAnswers(room.id, round.roundNumber);
  const graded = gradeRound({
    round,
    correctAnswerIndex: challenge.correctAnswerIndex,
    players: room.players,
    answers,
  });

  const metrics = computeRoundMetrics({
    round,
    outcomes: graded.outcomes,
    answers,
    players: graded.players,
    prizePoolWei: BigInt(room.prizePoolWei) + graded.penaltyCollectedWei,
  });

  const isLastRound = round.roundNumber >= room.config.questionCount;
  const gradedAt = Date.now();
  const updated = await store.updateRoom(room.id, (state) => {
    const target = state.rounds.find((entry) => entry.roundNumber === round.roundNumber);
    // Precondition re-check: whoever gets here first does the grading.
    if (!target || target.gradedAt !== null) return null;
    if (state.phase !== 'ROUND_ACTIVE') return null;

    target.gradedAt = gradedAt;
    state.players = applyRanks(graded.players);
    state.prizePoolWei = (
      BigInt(state.prizePoolWei) + graded.penaltyCollectedWei
    ).toString();
    state.leaderboard = buildLeaderboard(state.players, state.leaderboard);
    state.phase = 'INTERMISSION';
    state.phaseEndsAt = gradedAt + gameRules.intermissionMs;
    return state;
  });

  if (!updated) return null;

  const events: EmitEvent[] = [
    {
      type: 'ROUND_ENDED',
      level: 'GAME',
      message: `Round ${round.roundNumber} graded`,
      payload: {
        round: round.roundNumber,
        correct: metrics.correct,
        wrong: metrics.wrong,
        timeout: metrics.timeouts,
        accuracy: `${Math.round(metrics.accuracy * 100)}%`,
        prizePool: `${formatMon(updated.prizePoolWei)} MON`,
      },
    },
  ];

  for (const playerId of graded.newlyEliminated) {
    const player = updated.players[playerId];
    events.push({
      type: 'PLAYER_ELIMINATED',
      level: 'WARN',
      message: `${player?.displayName ?? playerId} eliminated`,
      payload: {
        player: player?.displayName ?? playerId,
        round: round.roundNumber,
        penalties: (player?.wrongCount ?? 0) + (player?.timeoutCount ?? 0),
      },
    });
  }

  events.push({
    type: 'LEADERBOARD_UPDATED',
    level: 'INFO',
    message: 'Leaderboard updated',
    payload: {
      leader: updated.leaderboard[0]?.displayName ?? '—',
      top: updated.leaderboard[0]?.score ?? 0,
      active: Object.values(updated.players).filter((player) => !player.eliminated).length,
    },
  });

  await emitEvents(updated.id, events, { version: updated.version });

  // The Game Master runs after the response has been sent. Grading is often
  // triggered by an ordinary player's state poll, and awaiting a model call
  // inside that request would freeze that one player's screen for seconds
  // while everyone else moved on. Scheduling it after the response keeps the
  // transition instant for whoever happened to trigger it, and the decision
  // still lands comfortably inside the intermission.
  if (room.config.aiGameMasterEnabled && !isLastRound) {
    scheduleAfterResponse(() => recordAiDecision(updated, round, metrics));
  }

  return updated;
}

/**
 * Run background work once the HTTP response is on its way.
 *
 * Outside a request — tests and scripts — there is nothing to defer to, so the
 * task is awaited inline. That keeps those runs deterministic rather than
 * leaving a floating promise.
 */
function scheduleAfterResponse(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

/**
 * Ask the Game Master for the next round's difficulty and topic, then store it.
 *
 * Never throws and never blocks gameplay: if it does not land before the next
 * round opens, `beginRound` simply falls back to the room's configured
 * difficulty and topic. The model proposes; this code clamps and validates.
 */
async function recordAiDecision(
  room: RoomState,
  round: RoundRecord,
  metrics: GameMetrics,
): Promise<void> {
  try {
    const result = await getAiProvider().chooseNextRound({
      mode: room.config.mode,
      topic: room.config.topic,
      currentDifficulty: round.difficulty,
      roundNumber: round.roundNumber,
      totalRounds: room.config.questionCount,
      metrics,
      usedTopics: room.rounds.map((entry) => entry.topic),
    });

    const decision: AiDecision = {
      id: newId('ai'),
      roundNumber: round.roundNumber,
      // Clamp: the engine decides what a legal difficulty is, not the model.
      nextDifficulty: Math.min(5, Math.max(1, Math.round(result.nextDifficulty))),
      nextTopic: result.nextTopic,
      reason: result.reason,
      questionSelectionStrategy: result.questionSelectionStrategy,
      decisionConfidence: result.decisionConfidence,
      provider: result.provider,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
      metrics,
      createdAt: Date.now(),
    };

    const stored = await getStore().updateRoom(room.id, (state) => {
      // One decision per round, even if two instances raced to compute it.
      if (state.aiDecisions.some((entry) => entry.roundNumber === round.roundNumber)) {
        return null;
      }
      state.aiDecisions.push(decision);
      return state;
    });
    if (!stored) return;

    await emitEvent(
      room.id,
      {
        type: 'AI_DECISION',
        level: 'AI',
        message: decision.reason,
        payload: {
          round: round.roundNumber,
          difficulty: `${round.difficulty}->${decision.nextDifficulty}`,
          strategy: decision.questionSelectionStrategy,
          confidence: decision.decisionConfidence,
          provider: decision.fallbackUsed ? `${decision.provider} (fallback)` : decision.provider,
        },
      },
      { version: stored.version },
    );
  } catch (error) {
    // A Game Master failure must never stall a game.
    console.error('[buzzin] Game Master decision failed', error);
  }
}

/** Freeze the game and move it into finalisation. */
export async function completeGame(room: RoomState): Promise<RoomState | null> {
  const endedAt = Date.now();
  const updated = await getStore().updateRoom(room.id, (state) => {
    if (state.status !== 'RUNNING' && state.status !== 'PAUSED') return null;
    state.status = 'FINALIZING';
    state.phase = 'COMPLETED';
    state.endedAt = endedAt;
    state.phaseEndsAt = null;
    // Released here rather than at COMPLETED: a game whose settlement never
    // lands would otherwise hold its whole reservation for good.
    syncReservation(state);
    state.players = applyRanks(state.players);
    state.leaderboard = buildLeaderboard(state.players, state.leaderboard);
    return state;
  });
  if (!updated) return null;

  await emitEvent(
    updated.id,
    {
      type: 'GAME_FINALIZING',
      level: 'GAME',
      message: 'Scores frozen, calculating settlement',
      payload: {
        rounds: updated.rounds.length,
        players: Object.keys(updated.players).length,
        prizePool: `${formatMon(updated.prizePoolWei)} MON`,
      },
    },
    { version: updated.version },
  );
  return updated;
}

// ------------------------------------------------------------- host control

export async function pauseGame(roomId: string): Promise<RoomState> {
  const updated = await getStore().updateRoom(roomId, (state) => {
    if (state.status !== 'RUNNING') return null;
    state.status = 'PAUSED';
    state.pausedAt = Date.now();
    syncReservation(state);
    return state;
  });
  if (!updated) throw new RoomError('The game is not running', 409, 'NOT_RUNNING');
  await emitEvent(
    updated.id,
    { type: 'GAME_PAUSED', level: 'WARN', message: 'Host paused the game', payload: {} },
    { version: updated.version },
  );
  return updated;
}

/**
 * Resume, shifting every live deadline forward by the paused duration so the
 * round the players were in keeps the time it had left.
 */
export async function resumeGame(roomId: string): Promise<RoomState> {
  const updated = await getStore().updateRoom(roomId, (state) => {
    if (state.status !== 'PAUSED' || state.pausedAt === null) return null;
    const pausedFor = Date.now() - state.pausedAt;
    state.status = 'RUNNING';
    state.pausedAt = null;
    syncReservation(state);
    if (state.phaseEndsAt !== null) state.phaseEndsAt += pausedFor;
    const round = state.rounds.find((entry) => entry.roundNumber === state.currentRound);
    if (round && round.gradedAt === null) {
      round.startedAt += pausedFor;
      round.endsAt += pausedFor;
    }
    return state;
  });
  if (!updated) throw new RoomError('The game is not paused', 409, 'NOT_PAUSED');
  await emitEvent(
    updated.id,
    { type: 'GAME_RESUMED', level: 'INFO', message: 'Host resumed the game', payload: {} },
    { version: updated.version },
  );
  return updated;
}

/** Emergency override: close the current round immediately. */
export async function skipRound(roomId: string): Promise<RoomState> {
  const store = getStore();
  const room = await store.getRoomById(roomId);
  if (!room) throw new RoomError('Room not found', 404, 'ROOM_NOT_FOUND');

  if (room.phase === 'ROUND_ACTIVE') {
    // Pull the deadline into the past, then let the normal grading path run so
    // scoring and penalties stay on exactly one code path.
    const shortened = await store.updateRoom(roomId, (state) => {
      const round = state.rounds.find((entry) => entry.roundNumber === state.currentRound);
      if (!round || round.gradedAt !== null) return null;
      round.endsAt = Date.now() - 1;
      state.phaseEndsAt = round.endsAt;
      return state;
    });
    if (shortened) {
      await emitEvent(
        roomId,
        {
          type: 'ROUND_ENDED',
          level: 'WARN',
          message: `Host skipped round ${shortened.currentRound}`,
          payload: { round: shortened.currentRound },
        },
        { version: shortened.version },
      );
    }
  } else if (room.phase === 'INTERMISSION') {
    await store.updateRoom(roomId, (state) => {
      if (state.phase !== 'INTERMISSION') return null;
      state.phaseEndsAt = Date.now() - 1;
      return state;
    });
  }

  const { room: advanced } = await advanceGame(roomId);
  return advanced;
}

/** Host ends the game early. Scores freeze exactly where they are. */
export async function endGame(roomId: string): Promise<RoomState> {
  const room = await getStore().getRoomById(roomId);
  if (!room) throw new RoomError('Room not found', 404, 'ROOM_NOT_FOUND');
  if (room.status === 'COMPLETED' || room.status === 'FINALIZING') return room;
  if (room.status === 'LOBBY') {
    const cancelled = await getStore().updateRoom(roomId, (state) => {
      if (state.status !== 'LOBBY') return null;
      state.status = 'CANCELLED';
      state.endedAt = Date.now();
      syncReservation(state);
      return state;
    });
    if (!cancelled) throw new RoomError('Room could not be cancelled', 409, 'CANNOT_CANCEL');
    await emitEvent(
      roomId,
      { type: 'GAME_COMPLETED', level: 'WARN', message: 'Room cancelled before start', payload: {} },
      { version: cancelled.version },
    );
    return cancelled;
  }
  const finished = await completeGame(room);
  if (!finished) throw new RoomError('Game could not be ended', 409, 'CANNOT_END');
  return finished;
}

// ------------------------------------------------------------------ metrics

/** Live counts for the current round, used by the admin monitor. */
export async function liveRoundCounts(room: RoomState): Promise<{
  correct: number;
  wrong: number;
  answered: number;
  pending: number;
}> {
  const active = Object.values(room.players).filter((player) => !player.eliminated).length;
  if (room.currentRound === 0) {
    return { correct: 0, wrong: 0, answered: 0, pending: active };
  }

  const answers = await getStore().listAnswers(room.id, room.currentRound);
  const challenge = challengeForRound(room, room.currentRound);
  const round = room.rounds.find((entry) => entry.roundNumber === room.currentRound);
  const graded = round?.gradedAt !== null;

  // While a round is live, correctness is deliberately not revealed — only the
  // number of players who have locked in.
  if (!graded || !challenge) {
    return { correct: 0, wrong: 0, answered: answers.length, pending: Math.max(0, active - answers.length) };
  }

  const correct = answers.filter(
    (answer) => answer.answerIndex === challenge.correctAnswerIndex,
  ).length;
  return {
    correct,
    wrong: answers.length - correct,
    answered: answers.length,
    pending: Math.max(0, active - answers.length),
  };
}

export function latestMetrics(room: RoomState): GameMetrics | null {
  for (let index = room.aiDecisions.length - 1; index >= 0; index -= 1) {
    const metrics = room.aiDecisions[index].metrics;
    if (metrics) return metrics;
  }
  return null;
}

export const ROUND_EVENT_TYPES: GameEventType[] = [
  'ROUND_STARTED',
  'QUESTION_REVEALED',
  'ROUND_ENDED',
];
