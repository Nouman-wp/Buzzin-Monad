-- Profile avatars and per-player room lookup.
--
-- Idempotent, like 0001: safe to run against a database that already has it.
--
--   * `profiles.avatar_url` stores the picture Google asserts in the ID token.
--     It is a URL on Google's CDN, not an upload — nothing is stored or served
--     by us, and it is null for guest sessions.
--   * The GIN index backs "every room this user played in", which the account
--     dashboard asks for on each load. Without it that is a sequential scan
--     over every room document.

alter table public.profiles
  add column if not exists avatar_url text;

-- jsonb_path_ops is the smaller, faster index for the `@>` containment query
-- the dashboard uses (`state @> {"players": {"<id>": {}}}`). It supports only
-- containment, which is the only operator we need here.
create index if not exists rooms_state_players_idx
  on public.rooms using gin (state jsonb_path_ops);
