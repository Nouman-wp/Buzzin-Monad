-- BlitzPlay schema.
--
-- Design notes:
--   * `rooms.state` is the authoritative room document (players, rounds,
--     leaderboard, settlement). One row per room, guarded by `version` for
--     optimistic concurrency.
--   * `answers` and `event_logs` are append-only so concurrent players never
--     contend on a single row. The unique index on answers is what makes
--     "one answer per player per round" atomic.
--   * Every table has RLS enabled with no permissive policy: all access goes
--     through the server using the service-role key, which bypasses RLS. The
--     browser never reads or writes these tables directly.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles --
create table if not exists public.profiles (
  id             text primary key,
  email          text,
  display_name   text        not null,
  wallet_address text        not null default '',
  provider       text        not null default 'demo',
  role           text        not null default 'PLAYER'
                 check (role in ('PLAYER', 'HOST', 'ADMIN')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ------------------------------------------------------------------- rooms --
create table if not exists public.rooms (
  id                    text primary key,
  code                  text        not null unique,
  host_id               text        not null,
  status                text        not null,
  version               integer     not null default 0,
  reserved_treasury_wei numeric(78, 0) not null default 0,
  state                 jsonb       not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists rooms_host_id_idx on public.rooms (host_id, created_at desc);
create index if not exists rooms_status_idx  on public.rooms (status);

-- ----------------------------------------------------------------- answers --
create table if not exists public.answers (
  id           uuid primary key default gen_random_uuid(),
  room_id      text   not null references public.rooms (id) on delete cascade,
  round_number integer not null,
  player_id    text   not null,
  answer_index integer not null,
  received_at  bigint not null,
  client_ts    bigint,
  created_at   timestamptz not null default now()
);

-- Enforces one answer per player per round atomically, under concurrency.
create unique index if not exists answers_one_per_round_idx
  on public.answers (room_id, round_number, player_id);

create index if not exists answers_room_round_idx
  on public.answers (room_id, round_number);

-- -------------------------------------------------------------- event_logs --
create table if not exists public.event_logs (
  id            text   primary key,
  seq           bigserial not null,
  room_id       text   not null references public.rooms (id) on delete cascade,
  type          text   not null,
  level         text   not null,
  message       text   not null,
  payload       jsonb  not null default '{}'::jsonb,
  created_at_ms bigint not null,
  created_at    timestamptz not null default now()
);

create index if not exists event_logs_room_seq_idx on public.event_logs (room_id, seq desc);

-- ------------------------------------------------------------ updated_at ----
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rooms_touch_updated_at on public.rooms;
create trigger rooms_touch_updated_at
  before update on public.rooms
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------- RLS ----
-- No policies are defined on purpose. With RLS enabled and no policy, the anon
-- and authenticated roles can do nothing; the server's service-role key is the
-- only way in. Realtime broadcast is authorised separately.
alter table public.profiles   enable row level security;
alter table public.rooms      enable row level security;
alter table public.answers    enable row level security;
alter table public.event_logs enable row level security;

revoke all on public.profiles   from anon, authenticated;
revoke all on public.rooms      from anon, authenticated;
revoke all on public.answers    from anon, authenticated;
revoke all on public.event_logs from anon, authenticated;
