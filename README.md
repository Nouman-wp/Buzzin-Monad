# BuzzIn

A real-time multiplayer game-night platform on Monad. A host creates a room,
players scan a QR code, sign in, and are handed an embedded wallet and a stake
automatically. Everyone answers the same question at the same moment, an AI
Game Master paces the difficulty from live room metrics, and the whole game
settles on Monad in a single transaction at the end.

Three modes ship in v1 — **Quiz**, **Songless** and **Wordless** — all running
on one deterministic round engine.

---

## What it does

**For a player.** Scan → sign in → play. No extension, no seed phrase, no
faucet, no network switching. A wallet is provisioned the moment they sign in,
and they never have to know what an embedded wallet is.

**For a host.** Create a room, pick a mode and topic, generate a question set,
review and approve it, put the QR on a screen, and start. Live leaderboard,
per-player economics, AI decision history and a real event terminal, all on one
dashboard.

**On chain.** Play is fast because the chain is not in the loop: balances and
penalties are authoritative server-side accounting during the game. At the end
the server derives one deterministic payout table, escrows exactly that amount,
freezes it on-chain, and opens pull-based claims.

---

## Game rules

| Rule | Value |
| --- | --- |
| Round length | 10 seconds |
| Correct answer | 100 points + up to 50 speed bonus |
| Wrong answer / timeout | 0 points, −0.10 MON |
| Elimination | after 5 penalties, or at a zero balance |
| Player allocation | 1.00 MON (0.50 to the prize pool, 0.50 locked as game balance) |
| Prize pool | every 0.50 contribution + every penalty collected |
| Payout | top 5, 50% rank-weighted + 50% score-weighted |

Rank weights for places 1–5 are 35 / 25 / 18 / 13 / 9 %.

```
rank_component_i        = pool × 0.50 × rank_weight_i
performance_component_i = pool × 0.50 × (score_i / Σ top5 scores)
final_prize_i           = rank_component_i + performance_component_i
```

All arithmetic is bigint wei, so `Σ prizes == pool` exactly and prizes plus
refunds always equal every MON locked for the game. Whatever is left of a
player's game balance after penalties is refunded to them.

---

## Architecture

```
Browser (player / host)
   │  request
   ▼
Next.js route handler          ── validates with Zod, authorises from the
   │                              signed session cookie
   ▼
Game engine (pure functions)   ── scoring, penalties, elimination, ranking,
   │                              prize maths. No clock, no I/O, fully tested.
   ▼
Store (Supabase / in-memory)   ── one authoritative room document per room,
   │                              guarded by compare-and-swap
   ▼
Monad settlement               ── once per game, never per answer
```

**The client is an input device, not an authority.** It never decides
correctness, score, penalty, elimination, ranking, prize or settlement. It is
not even told whether its own answer was right until the round closes.

### Timing without a server process

There is no background worker — that would not survive serverless. Every round
carries an absolute server `endsAt`, and `advanceGame()` is a pure function of
"what is the time now" that *any* request can drive: the host dashboard ticks
it, and every player poll drives it too. Each transition re-checks its own
precondition inside a compare-and-swap, so a dozen concurrent ticks still grade
a round exactly once.

### Realtime

Adaptive polling is the guaranteed transport — 700 ms between rounds, 900 ms
during one, relaxing in the lobby. When Supabase is configured, a Realtime
broadcast subscription is layered on as a pure accelerator that triggers an
immediate refetch. Countdowns never depend on either: they tick down locally
toward a server-issued deadline, corrected for device clock skew, so the timer
stays smooth between fetches and correct across a reconnect.

### Concurrency

Answers are an append-only table with a unique index on
`(room, round, player)`. That index — not application logic — is what makes
"one answer per player per round" atomic with 25 phones submitting at once.
Room state is a single JSONB document updated only at round transitions, under
optimistic concurrency, so players never contend on it.

---

## Graceful degradation

Every external dependency is optional. The app is fully playable with an empty
`.env`, and each fallback is visible in the admin dashboard rather than hidden.

| Missing | What happens |
| --- | --- |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Guest sign-in; identical sessions and wallets |
| `AI_API_KEY` | Deterministic local Game Master + the approved seed pool |
| Supabase | In-process store (single instance — dev and local demo only) |
| Treasury key / contract | Settlement completes as `OFF_CHAIN`, fully auditable |

The AI is never in the critical path. A timeout, a quota error, malformed JSON
or a schema mismatch all fall through to the deterministic Game Master, and the
round still starts on time.

---

## Repository layout

```
app/                    routes and API handlers
  api/                  typed endpoints (auth, rooms, games, admin)
  join/[roomCode]/      QR landing
  play/[gameId]/        the player's game
  host/[roomId]/        host dashboard
  admin/                platform overview

components/
  player/  host/  admin/  shared/

lib/
  ai/         provider interface, Gemini adapter, deterministic fallback
  auth/       Google ID-token verification, sessions, embedded wallets
  chain/      Monad client, ABI, settlement calls
  content/    seeded Quiz / Songless / Wordless pools
  engine/     scoring, leaderboard, prize maths (pure, heavily tested)
  store/      persistence interface + Supabase and in-memory implementations

server/       room lifecycle, game engine orchestration, settlement, events
contracts/    BuzzInSettlement.sol
supabase/     SQL migration
scripts/      audio generation, contract build/deploy, verification
tests/        129 unit and integration tests
```

---

## Running locally

```bash
npm install
cp .env.example .env.local     # every value is optional to start
npm run dev
```

Open http://localhost:3000. Create a room from **Host a game**, then open the
join link in a second browser profile to play against yourself.

```bash
npm test              # 129 unit + integration tests
npm run typecheck
npm run lint
npm run build

npm run verify:flows  # end-to-end against a running server (86 checks)
```

`verify:flows` drives the real HTTP API as a host plus six players: sign in,
create, approve, join, start, answer under the clock, get eliminated, settle,
cash out — and asserts the security properties along the way.

### Regenerating assets

```bash
npm run gen:audio         # synthesises the Songless clips from public-domain melodies
npm run contract:build    # compiles the Solidity contract with solc-js
npm run contract:deploy   # deploys it to the configured Monad network
npm run treasury:status   # treasury balance + contract wiring check
node scripts/verify-chain.mjs   # 16 live on-chain guarantee checks
```

---

## Deployment

Full step-by-step instructions, including Supabase, Google OAuth, Gemini and
Monad configuration, are in **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

The short version:

1. Create a Supabase project and run `supabase/migrations/0001_init.sql`.
2. Create a Google OAuth web client and add your Vercel URL to its origins.
3. `npm run contract:build && npm run contract:deploy`.
4. Set the environment variables from `.env.example` in Vercel.
5. Deploy, then set `NEXT_PUBLIC_APP_URL` to the real URL and redeploy.

---

## Security notes

- Answer keys never reach a device while a round is open — not in the payload,
  not in the event log, not in an audio filename. Tested explicitly.
- Sessions are signed HTTP-only cookies compared in constant time.
- Host control is authorised by **room ownership**. Admin is a separate,
  explicit grant (allowlisted email or operator token) and is never implied.
- Service-role keys, the treasury key and the AI key are server-only and never
  reach a client bundle.
- Settlement is idempotent: a claim is reserved before the chain is touched, so
  a retry after a timeout cannot pay twice — and the contract independently
  rejects a double claim.
- Room codes are random from a 31-character unambiguous alphabet, so they
  cannot be usefully enumerated during an event.

## Licensing of bundled content

Songless clips are synthesised from scratch by `scripts/generate-audio.mjs` and
render melodies whose copyright has long expired (Beethoven, Mozart, Pachelbel,
Grieg, Rossini, Strauss, plus traditional tunes). Nothing is downloaded and no
third-party recording is redistributed. The provider seam in
`lib/content/songless-seed.ts` is where a licensed catalogue would slot in.
