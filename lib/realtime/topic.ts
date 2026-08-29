/**
 * The Supabase Realtime channel name for a room.
 *
 * Lives in its own module with no imports because both sides of the push need
 * it: the server broadcaster (which also reads the service-role key) and the
 * browser subscriber (which must never import that config). They used to
 * hardcode the string separately, which is a silent-failure waiting to happen —
 * a typo on one side just stops the accelerator without any error.
 *
 * The name is ephemeral pub/sub addressing, so renaming it is safe as long as
 * both sides ship together.
 */
export function roomTopic(roomId: string): string {
  return `buzzin:room:${roomId}`;
}
