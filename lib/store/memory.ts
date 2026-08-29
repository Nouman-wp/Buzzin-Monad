import type { AnswerRecord, GameEvent, RoomState } from '@/lib/types';
import type {
  AnswerInsert,
  AnswerInsertResult,
  Profile,
  RoomStore,
} from '@/lib/store/types';

/**
 * In-process store used when Supabase is not configured.
 *
 * Intended for local development, the automated tests, and a single-instance
 * demo. It is deliberately NOT durable: on Vercel each serverless instance gets
 * its own copy, so a real deployment must configure Supabase. `durable` is
 * false so the UI can warn about exactly that.
 */
export class MemoryStore implements RoomStore {
  readonly name = 'memory';
  readonly durable = false;

  private rooms = new Map<string, RoomState>();
  private codeIndex = new Map<string, string>();
  private answers = new Map<string, AnswerRecord[]>();
  private events: GameEvent[] = [];
  private profiles = new Map<string, Profile>();
  private seq = 0;

  private clone<T>(value: T): T {
    return structuredClone(value);
  }

  async createRoom(state: RoomState): Promise<RoomState> {
    if (this.codeIndex.has(state.code)) {
      throw new Error('Room code already in use');
    }
    this.rooms.set(state.id, this.clone(state));
    this.codeIndex.set(state.code, state.id);
    this.answers.set(state.id, []);
    return this.clone(state);
  }

  async getRoomById(roomId: string): Promise<RoomState | null> {
    const room = this.rooms.get(roomId);
    return room ? this.clone(room) : null;
  }

  async getRoomByCode(code: string): Promise<RoomState | null> {
    const roomId = this.codeIndex.get(code.toUpperCase());
    return roomId ? this.getRoomById(roomId) : null;
  }

  async listRoomsByHost(hostId: string): Promise<RoomState[]> {
    return Array.from(this.rooms.values())
      .filter((room) => room.hostId === hostId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((room) => this.clone(room));
  }

  async listRoomsByPlayer(playerId: string, limit = 50): Promise<RoomState[]> {
    return Array.from(this.rooms.values())
      .filter((room) => Boolean(room.players[playerId]))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((room) => this.clone(room));
  }

  async listRooms(limit = 50): Promise<RoomState[]> {
    return Array.from(this.rooms.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((room) => this.clone(room));
  }

  async deleteRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.rooms.delete(roomId);
    this.codeIndex.delete(room.code);
    this.answers.delete(roomId);
    this.events = this.events.filter((event) => event.roomId !== roomId);
  }

  async updateRoom(
    roomId: string,
    mutate: (state: RoomState) => RoomState | null,
  ): Promise<RoomState | null> {
    const current = this.rooms.get(roomId);
    if (!current) return null;
    const next = mutate(this.clone(current));
    if (!next) return null;
    next.version = current.version + 1;
    this.rooms.set(roomId, this.clone(next));
    return this.clone(next);
  }

  async insertAnswer(answer: AnswerInsert): Promise<AnswerInsertResult> {
    const list = this.answers.get(answer.roomId) ?? [];
    const duplicate = list.some(
      (existing) =>
        existing.roundNumber === answer.roundNumber && existing.playerId === answer.playerId,
    );
    if (duplicate) return 'duplicate';
    list.push({
      roundNumber: answer.roundNumber,
      playerId: answer.playerId,
      answerIndex: answer.answerIndex,
      receivedAt: answer.receivedAt,
      clientTs: answer.clientTs,
      correct: null,
      scoreAwarded: 0,
      penaltyWei: '0',
    });
    this.answers.set(answer.roomId, list);
    return 'inserted';
  }

  async listAnswers(roomId: string, roundNumber?: number): Promise<AnswerRecord[]> {
    const list = this.answers.get(roomId) ?? [];
    const filtered =
      roundNumber === undefined
        ? list
        : list.filter((answer) => answer.roundNumber === roundNumber);
    return filtered.map((answer) => ({ ...answer }));
  }

  async appendEvents(events: Array<Omit<GameEvent, 'seq'>>): Promise<GameEvent[]> {
    const written = events.map((event) => {
      this.seq += 1;
      return { ...event, seq: this.seq } satisfies GameEvent;
    });
    this.events.push(...written);
    // Keep memory bounded during a long demo session.
    if (this.events.length > 5000) this.events = this.events.slice(-4000);
    return written.map((event) => ({ ...event }));
  }

  async listEvents(roomId: string, sinceSeq = 0, limit = 200): Promise<GameEvent[]> {
    return this.events
      .filter((event) => event.roomId === roomId && event.seq > sinceSeq)
      .slice(-limit)
      .map((event) => ({ ...event }));
  }

  async upsertProfile(profile: Profile): Promise<Profile> {
    const existing = this.profiles.get(profile.id);
    const merged: Profile = existing ? { ...existing, ...profile } : profile;
    this.profiles.set(profile.id, merged);
    return { ...merged };
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const profile = this.profiles.get(userId);
    return profile ? { ...profile } : null;
  }

  async reservedTreasuryWei(): Promise<bigint> {
    let total = 0n;
    for (const room of this.rooms.values()) {
      // A finished game holds nothing, FINALIZING included: settlement pays
      // from the treasury account, not from this budget.
      if (
        room.status === 'COMPLETED' ||
        room.status === 'CANCELLED' ||
        room.status === 'FINALIZING'
      ) {
        continue;
      }
      total += BigInt(room.reservedTreasuryWei);
    }
    return total;
  }

  async resetAll(): Promise<void> {
    this.rooms.clear();
    this.codeIndex.clear();
    this.answers.clear();
    this.events = [];
    this.seq = 0;
  }
}

/**
 * A single instance shared across hot reloads in dev. Without this, every
 * module reload would drop the active room mid-demo.
 */
const globalRef = globalThis as unknown as { __buzzinMemoryStore?: MemoryStore };

export function getMemoryStore(): MemoryStore {
  if (!globalRef.__buzzinMemoryStore) {
    globalRef.__buzzinMemoryStore = new MemoryStore();
  }
  return globalRef.__buzzinMemoryStore;
}
