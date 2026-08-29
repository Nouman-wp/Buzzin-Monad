import { featureFlags } from '@/lib/config';
import type { RoomStore } from '@/lib/store/types';
import { getMemoryStore } from '@/lib/store/memory';
import { SupabaseStore } from '@/lib/store/supabase';

let cached: RoomStore | null = null;

/**
 * The single entry point to persistence. Supabase when configured, otherwise
 * the in-process store so the app is fully playable with an empty `.env`.
 */
export function getStore(): RoomStore {
  if (cached) return cached;
  cached = featureFlags.supabaseEnabled ? new SupabaseStore() : getMemoryStore();
  return cached;
}

/** Test seam. */
export function setStore(store: RoomStore | null): void {
  cached = store;
}

export type { RoomStore, Profile } from '@/lib/store/types';
