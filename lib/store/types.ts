import type { AnswerRecord, GameEvent, RoomState, Role } from '@/lib/types';

export interface Profile {
  id: string;
  email: string | null;
  displayName: string;
  walletAddress: string;
  /** Provider-hosted picture URL. Null for guests and for accounts with none. */
  avatarUrl: string | null;
  provider: string;
  role: Role;
  createdAt: number;
}

export interface AnswerInsert {
  roomId: string;
  roundNumber: number;
  playerId: string;
  answerIndex: number;
  receivedAt: number;
  clientTs: number | null;
}

export type AnswerInsertResult = 'inserted' | 'duplicate';

/**
 * Persistence seam.
 *
 * Room state is stored as one authoritative document per room; answers and
 * events are append-only so 25 players submitting at once never contend on the
 * same row. Everything the game engine needs is behind this interface, which
 * keeps the engine independent of Supabase.
 */
export interface RoomStore {
  readonly name: string;
  /** True when state survives across serverless instances. */
  readonly durable: boolean;

  createRoom(state: RoomState): Promise<RoomState>;
  getRoomById(roomId: string): Promise<RoomState | null>;
  getRoomByCode(code: string): Promise<RoomState | null>;
  listRoomsByHost(hostId: string): Promise<RoomState[]>;
  /** Rooms this user joined as a player, most recent first. */
  listRoomsByPlayer(playerId: string, limit?: number): Promise<RoomState[]>;
  listRooms(limit?: number): Promise<RoomState[]>;
  deleteRoom(roomId: string): Promise<void>;

  /**
   * Read-modify-write under optimistic concurrency. The mutator may be invoked
   * more than once if another writer wins the race, so it must be pure with
   * respect to its input. Returning `null` aborts without writing.
   */
  updateRoom(
    roomId: string,
    mutate: (state: RoomState) => RoomState | null,
  ): Promise<RoomState | null>;

  /** Idempotent: a second submission for the same round is reported, not stored. */
  insertAnswer(answer: AnswerInsert): Promise<AnswerInsertResult>;
  listAnswers(roomId: string, roundNumber?: number): Promise<AnswerRecord[]>;

  appendEvents(events: Array<Omit<GameEvent, 'seq'>>): Promise<GameEvent[]>;
  listEvents(roomId: string, sinceSeq?: number, limit?: number): Promise<GameEvent[]>;

  upsertProfile(profile: Profile): Promise<Profile>;
  getProfile(userId: string): Promise<Profile | null>;

  /** Total wei reserved by rooms that have not settled or been cancelled. */
  reservedTreasuryWei(): Promise<bigint>;

  /** Demo-only maintenance. Removes every room, answer and event. */
  resetAll(): Promise<void>;
}
