/**
 * Shared type contracts between server and client.
 *
 * All monetary values crossing a boundary are decimal-string wei so they stay
 * exact through JSON. Convert with `BigInt(value)` on the server.
 */

export type GameMode = 'QUIZ' | 'SONGLESS' | 'WORDLESS';

export type RoomStatus =
  | 'DRAFT'
  | 'LOBBY'
  | 'RUNNING'
  | 'PAUSED'
  | 'FINALIZING'
  | 'COMPLETED'
  | 'CANCELLED';

export type EnginePhase =
  | 'LOBBY'
  | 'STARTING'
  | 'ROUND_ACTIVE'
  | 'ROUND_LOCKED'
  | 'INTERMISSION'
  | 'COMPLETED';

export type Role = 'PLAYER' | 'HOST' | 'ADMIN';

export type QuestionStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export type ChallengeSource = 'ai' | 'seed' | 'host';

/** A single round's content. Shared shape across all three game modes. */
export interface Challenge {
  id: string;
  gameType: GameMode;
  /** Prompt text. For Songless this is the instruction shown above the player. */
  question: string;
  options: string[];
  correctAnswerIndex: number;
  difficulty: number;
  topic: string;
  explanation: string;
  source: ChallengeSource;
  status: QuestionStatus;
  /** Songless only: public path to the audio clip. */
  audioUrl?: string;
  /** Wordless only: short hint rendered as a monospace pattern. */
  pattern?: string;
}

/** Challenge with the answer key stripped — the only shape sent mid-round. */
export type PublicChallenge = Omit<
  Challenge,
  'correctAnswerIndex' | 'explanation' | 'status'
>;

export interface RoomConfig {
  name: string;
  mode: GameMode;
  topic: string;
  difficulty: number;
  questionCount: number;
  questionType: 'MULTIPLE_CHOICE';
  maxPlayers: number;
  /** When false the host advances rounds manually. */
  aiGameMasterEnabled: boolean;
}

export interface PlayerPublic {
  id: string;
  displayName: string;
  walletAddress: string;
  /** Provider picture, or null. The lobby falls back to initials. */
  avatarUrl: string | null;
  joinedAt: number;
}

export interface PlayerGameState {
  playerId: string;
  displayName: string;
  walletAddress: string;
  /** Snapshotted at join so the lobby and results do not refetch profiles. */
  avatarUrl: string | null;
  score: number;
  correctCount: number;
  wrongCount: number;
  timeoutCount: number;
  /** Accumulated penalties, wei string. */
  penaltyTotalWei: string;
  /** Locked starting balance for this game, wei string. */
  startingGameBalanceWei: string;
  /** Remaining locked balance, wei string. Never negative. */
  currentGameBalanceWei: string;
  eliminated: boolean;
  eliminatedAtRound: number | null;
  rank: number;
  joinedAt: number;
}

export interface RoundRecord {
  roundNumber: number;
  challengeId: string;
  startedAt: number;
  endsAt: number;
  gradedAt: number | null;
  difficulty: number;
  topic: string;
}

export interface AnswerRecord {
  roundNumber: number;
  playerId: string;
  answerIndex: number;
  /** Server receipt time — the only timing the engine trusts. */
  receivedAt: number;
  clientTs: number | null;
  correct: boolean | null;
  scoreAwarded: number;
  penaltyWei: string;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  displayName: string;
  walletAddress: string;
  score: number;
  balanceWei: string;
  eliminated: boolean;
  correctCount: number;
  wrongCount: number;
  timeoutCount: number;
  /** Rank change since the previous round; positive means moved up. */
  delta: number;
}

export interface GameMetrics {
  roundNumber: number;
  activePlayers: number;
  answers: number;
  correct: number;
  wrong: number;
  timeouts: number;
  accuracy: number;
  averageResponseTimeMs: number;
  medianResponseTimeMs: number;
  difficulty: number;
  eliminatedPlayers: number;
  prizePoolWei: string;
  scoreSpread: number;
}

export interface AiDecision {
  id: string;
  roundNumber: number;
  nextDifficulty: number;
  nextTopic: string;
  reason: string;
  questionSelectionStrategy: 'easier' | 'same' | 'harder';
  decisionConfidence: number;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  metrics: GameMetrics | null;
  createdAt: number;
}

export type EventLevel =
  | 'INFO'
  | 'SUCCESS'
  | 'WARN'
  | 'ERROR'
  | 'AI'
  | 'CHAIN'
  | 'GAME'
  | 'PLAYER';

export type GameEventType =
  | 'ROOM_CREATED'
  | 'PLAYER_JOINED'
  | 'PLAYER_LEFT'
  | 'LOBBY_UPDATED'
  | 'GAME_STARTING'
  | 'ROUND_STARTED'
  | 'QUESTION_REVEALED'
  | 'ANSWER_SUBMITTED'
  | 'ANSWER_LOCKED'
  | 'ROUND_ENDED'
  | 'LEADERBOARD_UPDATED'
  | 'AI_DECISION'
  | 'PLAYER_ELIMINATED'
  | 'GAME_PAUSED'
  | 'GAME_RESUMED'
  | 'GAME_FINALIZING'
  | 'SETTLEMENT_STARTED'
  | 'SETTLEMENT_CONFIRMED'
  | 'SETTLEMENT_FAILED'
  | 'CLAIM_SUBMITTED'
  | 'GAME_COMPLETED'
  | 'DEMO_RESET';

export interface GameEvent {
  id: string;
  roomId: string;
  seq: number;
  type: GameEventType;
  level: EventLevel;
  message: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export type SettlementStatus =
  | 'NOT_STARTED'
  | 'PREPARED'
  | 'SUBMITTING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'OFF_CHAIN';

export interface SettlementItem {
  playerId: string;
  displayName: string;
  walletAddress: string;
  rank: number;
  score: number;
  /** Prize share for a top-5 finisher, wei string. Zero otherwise. */
  prizeWei: string;
  /** Unspent locked game balance returned to the player, wei string. */
  refundWei: string;
  /** prizeWei + refundWei. */
  totalPayoutWei: string;
  claimed: boolean;
  claimTxHash: string | null;
  claimedTo: string | null;
}

export interface Settlement {
  status: SettlementStatus;
  /** Total prize pool available to the top 5, wei string. */
  prizePoolWei: string;
  /** Sum of prize components actually allocated, wei string. */
  totalPrizeAllocatedWei: string;
  /** Sum of refunds returned to players, wei string. */
  totalRefundWei: string;
  /** prize + refunds; must equal total locked funds. */
  totalAllocatedWei: string;
  items: SettlementItem[];
  txHash: string | null;
  error: string | null;
  preparedAt: number | null;
  finalizedAt: number | null;
}

/** The full authoritative room document. Server-side source of truth. */
export interface RoomState {
  id: string;
  code: string;
  hostId: string;
  hostName: string;
  status: RoomStatus;
  phase: EnginePhase;
  config: RoomConfig;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  /** Wei reserved from the demo treasury for this room. */
  reservedTreasuryWei: string;
  prizePoolWei: string;
  players: Record<string, PlayerGameState>;
  challenges: Challenge[];
  rounds: RoundRecord[];
  currentRound: number;
  /** Ends the STARTING countdown / INTERMISSION. */
  phaseEndsAt: number | null;
  leaderboard: LeaderboardEntry[];
  aiDecisions: AiDecision[];
  settlement: Settlement;
  /** Optimistic-concurrency guard. */
  version: number;
  pausedAt: number | null;
}

/** What a player's device receives. Never contains an answer key. */
export interface PlayerSnapshot {
  room: {
    id: string;
    code: string;
    name: string;
    mode: GameMode;
    status: RoomStatus;
    phase: EnginePhase;
    hostName: string;
    maxPlayers: number;
    playerCount: number;
    prizePoolWei: string;
    totalRounds: number;
    currentRound: number;
    serverTime: number;
    phaseEndsAt: number | null;
  };
  players: PlayerPublic[];
  me: PlayerGameState | null;
  challenge: PublicChallenge | null;
  round: { roundNumber: number; startedAt: number; endsAt: number } | null;
  /** Present only after the round is graded. */
  lastResult: {
    roundNumber: number;
    correctAnswerIndex: number;
    explanation: string;
    myAnswerIndex: number | null;
    myCorrect: boolean | null;
    scoreAwarded: number;
    penaltyWei: string;
  } | null;
  myAnswerIndex: number | null;
  leaderboard: LeaderboardEntry[];
  myRank: number;
  settlement: {
    status: SettlementStatus;
    myItem: SettlementItem | null;
    txHash: string | null;
    explorerUrl: string | null;
  } | null;
}

/** What the host/admin dashboard receives. */
export interface HostSnapshot {
  room: RoomState;
  serverTime: number;
  metrics: GameMetrics | null;
  currentChallenge: Challenge | null;
  joinUrl: string;
  liveCounts: { correct: number; wrong: number; answered: number; pending: number };
  treasury: {
    totalWei: string;
    reservedWei: string;
    availableWei: string;
    onChainBalanceWei: string | null;
    address: string | null;
  };
}
