import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverConfig } from '@/lib/config';
import type { AnswerRecord, GameEvent, RoomState } from '@/lib/types';
import type {
  AnswerInsert,
  AnswerInsertResult,
  Profile,
  RoomStore,
} from '@/lib/store/types';

/**
 * Durable store backed by Supabase Postgres.
 *
 * Uses the service-role key, so this module must only ever be imported from
 * server code. Room state is one JSONB document guarded by a `version` column;
 * answers and events are append-only tables, which is what lets 25 players
 * submit simultaneously without contending on a single row.
 */

const ROOMS = 'rooms';
const ANSWERS = 'answers';
const EVENTS = 'event_logs';
const PROFILES = 'profiles';

/** Postgres unique-violation. Used to detect a duplicate answer. */
const UNIQUE_VIOLATION = '23505';

const MAX_UPDATE_ATTEMPTS = 5;

interface RoomRow {
  id: string;
  code: string;
  host_id: string;
  status: string;
  version: number;
  reserved_treasury_wei: string;
  created_at: string;
  state: RoomState;
}

export class SupabaseStore implements RoomStore {
  readonly name = 'supabase';
  readonly durable = true;
  private readonly client: SupabaseClient;
  /** Cleared the first time Postgres says migration 0002 has not been run. */
  private avatarColumn = true;

  constructor(url = serverConfig.supabaseUrl, serviceKey = serverConfig.supabaseServiceRoleKey) {
    this.client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'buzzin' } },
    });
  }

  /** Exposed so the realtime broadcaster can reuse one authenticated client. */
  get raw(): SupabaseClient {
    return this.client;
  }

  private toRow(state: RoomState): RoomRow {
    return {
      id: state.id,
      code: state.code,
      host_id: state.hostId,
      status: state.status,
      version: state.version,
      reserved_treasury_wei: state.reservedTreasuryWei,
      created_at: new Date(state.createdAt).toISOString(),
      state,
    };
  }

  async createRoom(state: RoomState): Promise<RoomState> {
    const { error } = await this.client.from(ROOMS).insert(this.toRow(state));
    if (error) {
      if (error.code === UNIQUE_VIOLATION) throw new Error('Room code already in use');
      throw new Error(`Failed to create room: ${error.message}`);
    }
    return state;
  }

  async getRoomById(roomId: string): Promise<RoomState | null> {
    const { data, error } = await this.client
      .from(ROOMS)
      .select('state')
      .eq('id', roomId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load room: ${error.message}`);
    return (data?.state as RoomState) ?? null;
  }

  async getRoomByCode(code: string): Promise<RoomState | null> {
    const { data, error } = await this.client
      .from(ROOMS)
      .select('state')
      .eq('code', code.toUpperCase())
      .maybeSingle();
    if (error) throw new Error(`Failed to load room: ${error.message}`);
    return (data?.state as RoomState) ?? null;
  }

  async listRoomsByHost(hostId: string): Promise<RoomState[]> {
    const { data, error } = await this.client
      .from(ROOMS)
      .select('state')
      .eq('host_id', hostId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(`Failed to list rooms: ${error.message}`);
    return (data ?? []).map((row) => row.state as RoomState);
  }

  /**
   * Rooms this user played in.
   *
   * `players` is a map keyed by user id inside the room document, so jsonb
   * containment answers the question directly: `{"players":{"<id>":{}}}` is
   * contained by any document that has that key, whatever the value. The GIN
   * index added in migration 0002 is what keeps this off a sequential scan.
   */
  async listRoomsByPlayer(playerId: string, limit = 50): Promise<RoomState[]> {
    const { data, error } = await this.client
      .from(ROOMS)
      .select('state')
      .contains('state', { players: { [playerId]: {} } })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Failed to list rooms: ${error.message}`);
    return (data ?? []).map((row) => row.state as RoomState);
  }

  async listRooms(limit = 50): Promise<RoomState[]> {
    const { data, error } = await this.client
      .from(ROOMS)
      .select('state')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Failed to list rooms: ${error.message}`);
    return (data ?? []).map((row) => row.state as RoomState);
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.client.from(ANSWERS).delete().eq('room_id', roomId);
    await this.client.from(EVENTS).delete().eq('room_id', roomId);
    const { error } = await this.client.from(ROOMS).delete().eq('id', roomId);
    if (error) throw new Error(`Failed to delete room: ${error.message}`);
  }

  /**
   * Compare-and-swap on `version`. If another writer committed first the read
   * is repeated and the mutator re-applied, which is why mutators must be pure.
   */
  async updateRoom(
    roomId: string,
    mutate: (state: RoomState) => RoomState | null,
  ): Promise<RoomState | null> {
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt += 1) {
      const current = await this.getRoomById(roomId);
      if (!current) return null;

      const next = mutate(structuredClone(current));
      if (!next) return null;
      next.version = current.version + 1;

      const { data, error } = await this.client
        .from(ROOMS)
        .update({
          state: next,
          status: next.status,
          version: next.version,
          reserved_treasury_wei: next.reservedTreasuryWei,
        })
        .eq('id', roomId)
        .eq('version', current.version)
        .select('state');

      if (error) throw new Error(`Failed to update room: ${error.message}`);
      if (data && data.length > 0) return data[0].state as RoomState;

      // Lost the race — back off briefly and retry with fresh state.
      await new Promise((resolve) => setTimeout(resolve, 25 + attempt * 40));
    }
    throw new Error('Room update failed after repeated write conflicts');
  }

  async insertAnswer(answer: AnswerInsert): Promise<AnswerInsertResult> {
    const { error } = await this.client.from(ANSWERS).insert({
      room_id: answer.roomId,
      round_number: answer.roundNumber,
      player_id: answer.playerId,
      answer_index: answer.answerIndex,
      received_at: answer.receivedAt,
      client_ts: answer.clientTs,
    });
    if (!error) return 'inserted';
    // The (room_id, round_number, player_id) unique index is what enforces
    // one-answer-per-round, atomically, under concurrency.
    if (error.code === UNIQUE_VIOLATION) return 'duplicate';
    throw new Error(`Failed to record answer: ${error.message}`);
  }

  async listAnswers(roomId: string, roundNumber?: number): Promise<AnswerRecord[]> {
    let query = this.client
      .from(ANSWERS)
      .select('round_number, player_id, answer_index, received_at, client_ts')
      .eq('room_id', roomId);
    if (roundNumber !== undefined) query = query.eq('round_number', roundNumber);
    const { data, error } = await query.order('received_at', { ascending: true }).limit(5000);
    if (error) throw new Error(`Failed to load answers: ${error.message}`);
    return (data ?? []).map((row) => ({
      roundNumber: row.round_number as number,
      playerId: row.player_id as string,
      answerIndex: row.answer_index as number,
      receivedAt: Number(row.received_at),
      clientTs: row.client_ts === null ? null : Number(row.client_ts),
      correct: null,
      scoreAwarded: 0,
      penaltyWei: '0',
    }));
  }

  async appendEvents(events: Array<Omit<GameEvent, 'seq'>>): Promise<GameEvent[]> {
    if (events.length === 0) return [];
    const { data, error } = await this.client
      .from(EVENTS)
      .insert(
        events.map((event) => ({
          id: event.id,
          room_id: event.roomId,
          type: event.type,
          level: event.level,
          message: event.message,
          payload: event.payload,
          created_at_ms: event.createdAt,
        })),
      )
      .select('id, room_id, seq, type, level, message, payload, created_at_ms');
    if (error) throw new Error(`Failed to append events: ${error.message}`);
    return (data ?? []).map(rowToEvent).sort((a, b) => a.seq - b.seq);
  }

  async listEvents(roomId: string, sinceSeq = 0, limit = 200): Promise<GameEvent[]> {
    const { data, error } = await this.client
      .from(EVENTS)
      .select('id, room_id, seq, type, level, message, payload, created_at_ms')
      .eq('room_id', roomId)
      .gt('seq', sinceSeq)
      .order('seq', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Failed to load events: ${error.message}`);
    return (data ?? []).map(rowToEvent).sort((a, b) => a.seq - b.seq);
  }

  async upsertProfile(profile: Profile): Promise<Profile> {
    const row: Record<string, unknown> = {
      id: profile.id,
      email: profile.email,
      display_name: profile.displayName,
      wallet_address: profile.walletAddress,
      provider: profile.provider,
      role: profile.role,
    };
    if (this.avatarColumn) row.avatar_url = profile.avatarUrl;

    const { error } = await this.client.from(PROFILES).upsert(row, { onConflict: 'id' });
    if (error) {
      if (isMissingAvatarColumn(error)) return this.withoutAvatarColumn(profile);
      throw new Error(`Failed to save profile: ${error.message}`);
    }
    return profile;
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const columns = 'id, email, display_name, wallet_address, provider, role, created_at';
    const { data, error } = await this.client
      .from(PROFILES)
      .select(this.avatarColumn ? `${columns}, avatar_url` : columns)
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      if (isMissingAvatarColumn(error)) {
        this.avatarColumn = false;
        return this.getProfile(userId);
      }
      throw new Error(`Failed to load profile: ${error.message}`);
    }
    if (!data) return null;
    // `data` is typed from a literal select string; ours is dynamic, so the
    // parser yields an error type rather than a row. The runtime shape is a row.
    const row = data as unknown as Record<string, unknown>;
    return {
      id: row.id as string,
      email: (row.email as string) ?? null,
      displayName: row.display_name as string,
      walletAddress: row.wallet_address as string,
      avatarUrl: (row.avatar_url as string) ?? null,
      provider: row.provider as string,
      role: row.role as Profile['role'],
      createdAt: new Date(row.created_at as string).getTime(),
    };
  }

  /**
   * Retry the write without the avatar column, once.
   *
   * Migration 0002 adds `profiles.avatar_url`. A deployment that has not run it
   * yet must keep working — a missing picture is cosmetic, and a profile write
   * that fails would otherwise take the display name and wallet with it.
   */
  private async withoutAvatarColumn(profile: Profile): Promise<Profile> {
    this.avatarColumn = false;
    console.warn(
      '[buzzin] profiles.avatar_url is missing — run supabase/migrations/0002_profile_avatar.sql to store profile pictures',
    );
    return this.upsertProfile(profile);
  }

  /**
   * The demo budget currently committed to rooms.
   *
   * `syncReservation` already zeroes the column the moment a game finishes, so
   * this filter is belt-and-braces for rooms written before it existed —
   * FINALIZING is in the list because a settlement that never lands used to
   * leave a room holding its full reservation indefinitely.
   */
  async reservedTreasuryWei(): Promise<bigint> {
    const { data, error } = await this.client
      .from(ROOMS)
      .select('reserved_treasury_wei')
      .not('status', 'in', '("COMPLETED","CANCELLED","FINALIZING")');
    if (error) throw new Error(`Failed to read treasury reservations: ${error.message}`);
    return (data ?? []).reduce<bigint>(
      (total, row) => total + BigInt((row.reserved_treasury_wei as string) || '0'),
      0n,
    );
  }

  async resetAll(): Promise<void> {
    await this.client.from(ANSWERS).delete().neq('room_id', '');
    await this.client.from(EVENTS).delete().neq('room_id', '');
    await this.client.from(ROOMS).delete().neq('id', '');
  }
}

/** PostgREST reports an unknown column as 42703, or PGRST204 on a write. */
function isMissingAvatarColumn(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? '';
  if (code !== '42703' && code !== 'PGRST204') return false;
  return (error.message ?? '').includes('avatar_url');
}

function rowToEvent(row: Record<string, unknown>): GameEvent {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    seq: Number(row.seq),
    type: row.type as GameEvent['type'],
    level: row.level as GameEvent['level'],
    message: row.message as string,
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: Number(row.created_at_ms),
  };
}
