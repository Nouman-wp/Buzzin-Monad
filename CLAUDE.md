# BuzzIn — working notes

Context for anyone (or any tool) picking this codebase up mid-flight. The
product spec is `ProjectGuide.md`; this file records what was actually built,
what was decided and why, and what is left.

---

## Status

**Shippable.** Every item in the spec's Definition of Done is implemented and
verified. Deployed contract is live on Monad testnet.

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 13 documented warnings |
| `npm test` | 156 passing |
| `npm run build` | clean, 48 routes |
| `npm run verify:flows` | 86/86 against local dev + Supabase |
| `node scripts/verify-chain.mjs` | 16/16 against the live contract |

**Live:** https://buzzin-monad.vercel.app — Vercel project `buzzin-monad`
under `noumanpm-gmailcoms-projects`, connected to the GitHub repo so pushes to
`main` auto-deploy.

**Repo:** https://github.com/Nouman-wp/Buzzin-Monad (git identity is set
**local to this folder only**; the global identity is untouched).

**Deployed contract:** `0xffbc7aa88b3f4d9cbec54899dd08e029456bd700`
(Monad testnet, chain 10143, operator `0xE0C674eFfA666E0C1decf1AA24bCFDE1D1917EFC`)

**Supabase:** project `zhmhedyzwbroupsemxvx`, wired into `.env.local` and
verified end to end:

- all four tables present; both migrations are idempotent
- RLS confirmed working — the anon key is denied on every table (`42501`)
- the `(room_id, round_number, player_id)` unique index rejects a duplicate
  answer with `23505`, which is exactly what `SupabaseStore.insertAnswer`
  maps to `'duplicate'`
- realtime broadcast endpoint returns 202
- migration 0002 applied: `profiles.avatar_url` exists and the `state @> {...}`
  rooms-by-player containment query works
- a full 86-check flow run persisted correctly (rooms, answers, event_logs)

`.env.local` uses the newer `sb_publishable_` / `sb_secret_` key pair. The
older JWT `anon` / `service_role` format also works if you prefer it. Note the
publishable key gets a 401 on `/rest/v1/` itself — that endpoint accepts only
secret keys, and it is not a sign the key is bad; test it against
`/auth/v1/settings` instead.

---

## The five decisions that shape everything

**1. The server is the only authority.** The client never decides correctness,
score, penalty, elimination, rank, prize or settlement — and is not even told
whether its own answer was right until the round closes. `buildPlayerSnapshot`
in `server/snapshots.ts` is the single chokepoint for what leaves the server;
`tests/security.test.ts` asserts the answer key never appears in a live payload,
the event log, or an audio filename.

**2. Time is driven by requests, not a worker.** There is no background process
— that would not survive serverless. Each round carries an absolute server
`endsAt`, and `advanceGame()` is a pure function of "what time is it now" that
*any* request drives: the host dashboard ticks it every 700 ms, and every player
poll drives it too. Each transition re-checks its precondition inside a
compare-and-swap, so concurrent ticks grade a round exactly once. Tested.

**3. Contention is pushed into the database.** Answers are append-only with a
unique index on `(room_id, round_number, player_id)`. *That index* — not
application logic — makes one-answer-per-round atomic with 25 phones firing at
once. Room state is a single JSONB document touched only at round transitions,
under optimistic concurrency on a `version` column.

**4. Polling is the transport; realtime is an accelerator.** Adaptive polling
(700 ms between rounds, 900 ms during one, slower in the lobby) is the
guaranteed path. Supabase Realtime broadcast, when configured, just triggers an
immediate refetch. Countdowns depend on neither — they tick locally toward a
server deadline, corrected for device clock skew.

**5. Every dependency is optional and every fallback is visible.** No Google
client id → guest sign-in. No AI key → deterministic Game Master. No Supabase →
in-memory store. No treasury/contract → `OFF_CHAIN` settlement. The admin
dashboard shows which are actually live, so a fallback is never mistaken for
the real thing.

---

## Deviations from the spec (deliberate)

**Privy → Google Identity Services + server-derived embedded wallets.**
`@privy-io/react-auth` v3 pulls ~200 transitive Solana packages; the install was
unworkable on the build network and it is a large runtime dependency for a
demo. GIS meets the actual requirement — Google auth plus an automatic EVM
wallet, no extension, no seed phrase — with **zero npm dependencies**. ID tokens
are verified server-side against Google's JWKS (signature, issuer, audience,
expiry) in `lib/auth/google.ts`. Wallets are derived deterministically from the
user id and `AUTH_SESSION_SECRET` in `lib/auth/wallet.ts`; the key never leaves
the server. `lib/auth/session.ts` is the documented swap seam if Privy is ever
wanted back.

*Consequence:* wallets are custodial. Acceptable and clearly labelled for a
testnet demo — it is what makes cash-out gasless for players who hold no MON.

**Songless audio is synthesised, not licensed.**
`scripts/generate-audio.mjs` renders 12 public-domain melodies (Beethoven,
Mozart, Pachelbel, Grieg, Rossini, Strauss, plus traditional) as WAVs from note
lists. Nothing is downloaded, nothing is redistributed, and no music API outage
can break the mode. Filenames are opaque (`track-07.wav`) so they cannot leak
answers. `lib/content/songless-seed.ts` is the provider seam.

---

## AI provider notes

`gemini-2.0-flash` was **retired** by Google — the original default silently
fell back to local content forever. Current default is `gemini-3.6-flash`
(Google's own named replacement), verified live. `gemini-2.5-flash` is also
gone; `gemini-3.5-flash` and `gemini-flash-latest` exist but the latter was
returning 503 during testing.

The free tier is **congested**: 503 "high demand" is common and one observed
call needed three attempts. Retries are therefore per-call — four attempts for
host-initiated generation, two for a mid-game decision — each bounded by a
wall-clock budget rather than a per-attempt timeout.

## Bugs found by verification (all fixed)

1. **Every player was an admin.** `resolveRole` granted ADMIN to everyone when
   `ADMIN_EMAILS` was empty and demo mode was on — so in a 25-player room, any
   player could start/pause/end the game and read answer keys via the host
   snapshot. Removed the fallback entirely. Host control is now authorised by
   **room ownership**; admin requires an allowlisted email or the operator
   token. Regression test in `tests/security.test.ts`.

2. **Landing page 500'd in SSR.** `components/shared/brand.tsx` (a server
   component) imported `cx` from a `'use client'` module. Moved to
   `lib/util/cx.ts`. `next build` did not catch this; the HTTP smoke test did.

3. **Demo reset was unusable.** `/api/admin/reset` re-checked `ADMIN_API_TOKEN`
   as a header, which the dashboard button does not send — so the button always
   failed whenever a token was configured. The admin grant already requires
   that token upstream, so the redundant check was removed.

4. **The Game Master blocked the round transition.** Its latency landed as dead
   air after every round, and because grading is usually triggered by an
   ordinary player's state poll, that player's screen froze for seconds while
   everyone else moved on. It now runs after the transition is committed and,
   via `next/server`'s `after()`, after the response is sent. If the decision
   does not land before the next round opens, `beginRound` falls back to the
   room's configured difficulty exactly as before.

5. **Flaky last-round check in the verifier** (harness, not product). With
   Supabase's added latency a 10-second round can open *and* close while the
   script is mid-poll, which read as "round 4 never opened" even though the
   round had run and graded. The wait loop now treats "the game already moved
   past this round" as a pass. Confirmed by inspecting the persisted room —
   all four rounds ran and graded.

6. **Grading result read via a second request** (harness). The verifier detected
   a round closing then re-fetched to read the result; against live production
   the five-second intermission could elapse first, so a correctly graded round
   read as no result. It now keeps the response that carries the result.

---

## The account surface (dashboard + profile)

A signed-in user has two pages of their own, sharing one header
(`components/account/shell.tsx`):

- **`/dashboard`** — what am I owed, and where did it come from. One wallet
  card, a record strip, and every room they hosted or played, filterable.
- **`/profile`** — identity only. Picture, display name (the one editable
  field), email, sign-in method, role, member-since, wallet address.

Both read `GET /api/me/overview`, which is built by `server/account.ts`.

**It introduces no new source of truth.** Every row is derived from room
documents the caller is actually part of, and every number comes from that
room's frozen `SettlementItem` — the same object the results screen and the
contract agree on. What the module adds is aggregation: totals across games,
and a cash-out that clears all of them at once.

**Balances mean three different things**, and the card says which:

| Shown as | Is |
| --- | --- |
| Ready to cash out | settled payouts not yet claimed |
| Locked in games | `currentGameBalanceWei` in rooms that have not finished |
| On chain | native balance of the embedded address |

The on-chain figure is normally zero and that is correct: a claim pays straight
out to whatever destination the player names, so the embedded address is an
identity, not a purse. The exception is the pinned admin wallet, which is a
real funded account.

**`POST /api/me/cashout`** claims every settled game to one address. It loops
through the *same* `claimPayout` used by the single-game endpoint, so the
per-game reservation, the double-claim rejection, and the contract's own guard
all still apply. Claims are sequential on purpose — they are treasury-signed
transactions from one account, and firing them concurrently races the nonce.
One game failing does not abandon the rest; the response reports each game
separately.

**Rooms-by-player** is a jsonb containment query (`state @> {"players":{"<id>":
{}}}`), indexed by the GIN index in migration 0002. Run that migration — it
also adds `profiles.avatar_url`. `SupabaseStore` degrades gracefully if you
have not: it detects the missing column once (42703/PGRST204), warns, and keeps
writing profiles without the picture, because a missing avatar must never take
the display name and wallet down with it.

## Wallet connection — no connect-kit

`components/shared/use-wallet.ts` speaks EIP-1193 directly, with EIP-6963
discovery so "connect MetaMask" picks MetaMask on a machine with several
extensions installed. It connects, reads the chain, and switches (or adds)
Monad — about 200 lines and zero dependencies.

RainbowKit was considered and skipped for the same reason Privy was: it brings
wagmi, a query client, a WalletConnect project id and a provider around the
whole tree, to deliver one thing this app needs — the address of a wallet the
player controls. Nothing here ever signs: the player has no gas, so the
treasury submits the claim on their behalf and the contract enforces that the
funds go to the player's destination. This hook is the seam to replace if
WalletConnect QR pairing for mobile wallets is ever wanted; nothing else in the
app touches `window.ethereum`.

## Presentation mode (do not reveal the answers)

The host dashboard is routinely on a projector behind the host, and a reviewed
question list is a list of answers. Two mechanisms, both purely presentational
— neither changes what the server sends or how it grades:

1. **Approved questions collapse.** A question is expanded by default only
   while it still needs a decision; approving it (individually or via Approve
   all) collapses it to a single line. Any question can be expanded manually.
2. **`hideAnswers` masks the keys.** It drops the correct-answer highlight and
   the explanation in the Questions panel *and* in the Live game panel's "On
   screen now" block, which is the one most likely to be facing the room
   mid-round.

The toggle lives in both the page header and the Questions panel header, and is
remembered per room in `localStorage`. It defaults to **on once the room leaves
the lobby** — the point at which the host no longer needs the keys and the
screen is most likely to be shared — and an explicit choice always wins.

## Ending a game mid-flight

Two places, one endpoint (`POST /api/rooms/:roomId/end`):

- the host's own dashboard, and
- each active row of the admin overview.

`assertHost` accepts an allowlisted admin as well as the room owner, which is
what makes a live event recoverable when a host drops off. Both are two-tap
confirmations. Ending mid-game is **not** a cancellation: the rounds already
played are graded, ranked and settled, so players keep what they earned.

## The rename to BuzzIn, and the three names that did not move

The product is BuzzIn everywhere a person can read it: wordmark, metadata,
footer, package name, log prefixes, the session cookie, the Supabase realtime
topic, the CSS keyframe prefix. Three identifiers deliberately kept their old
spelling, and each one would cost real money to change:

- **`DERIVATION_LABEL`** in `lib/auth/wallet.ts` is hashed into every player's
  private key. Renaming it changes every address, exactly like rotating
  `AUTH_SESSION_SECRET`, and strands whatever the live contract already holds
  for those addresses.
- **`gameIdFor`** in `lib/chain/client.ts` hashes `blitzplay:<roomId>` into the
  on-chain game id. Every already-settled game is stored under an id computed
  that way; a new prefix would orphan that escrow. `scripts/reclaim-escrow.mjs`
  duplicates the same function and must stay in step.
- **`BlitzPlaySettlement.sol`** is the source of the contract deployed at
  `0xffbc7aa8…`. Renaming the contract changes the artifact, which would no
  longer correspond to what is actually on chain.

`NEXT_PUBLIC_APP_URL` and the Vercel project are the fourth item — whatever URL
you deploy to is what every join QR encodes, and the Google OAuth origin
allowlist is pinned to it. Renaming the Vercel project after printing codes
invalidates them. Change all four together or none.

The realtime topic now comes from one place, `lib/realtime/topic.ts`. The
server broadcaster and the browser subscriber used to hardcode the string
separately, which fails silently — a mismatch does not error, it just stops the
push accelerator and leaves polling to carry everything.

## Why the room stream is a watchdog, not a timeout chain

`useRoomStream` used to schedule itself with a chain of `setTimeout`s, each link
scheduled by the previous one's completion, guarded by an `inFlight` boolean.
A chain like that has exactly one live link, and several ordinary things break
it for good: a `fetch` that never settles (which is what a frozen or
backgrounded tab produces) leaves `inFlight` stuck true, so every later call
returns immediately and the room silently stops updating. The only cure
available to the player is reloading the page — which is precisely the symptom
that was reported from the lobby, where an existing player never saw new
arrivals until they refreshed.

It is now a single repeating 250ms interval that re-decides, every tick and
independently, whether a fetch is due — plus a hard `AbortController` deadline
on every request, so the in-flight guard can never outlive the request it is
guarding. The adaptive cadence is unchanged; only the thing that carries it is.
The server side was verified correct before any of this changed: two sessions
polling `/api/games/:id/state` both saw the full roster within one poll.

## Ambient light is landing-only

The three violet radials that used to sit behind `body` on every page are now a
`.ambient-wash` element the landing page opts into. Over a photograph they read
as atmosphere; behind a dashboard they read as wallpaper, and every card ends up
floating on a coloured cloud. Everything else gets near-black with a single
faint halo at the top. The ink scale kept its hue and lost about two thirds of
its saturation at the dark end for the same reason.

## Where to be careful
- `server/snapshots.ts` — anything added here reaches a player's device.
- `lib/engine/*` — must stay pure. No `Date.now()`, no I/O. It is the tested core.
- `server/game.ts` `advanceGame` — every branch must re-check its precondition
  inside the CAS mutator, or concurrent ticks will double-apply.

---

## Economy (matches the spec exactly)

1.00 MON per player → 0.50 to the prize pool, 0.50 locked as game balance.
Correct = 100 pts + up to 50 speed bonus. Wrong/timeout = 0 pts and −0.10 MON.
Five penalties or a zero balance eliminates. Pool = all contributions + all
penalties. Top 5 split it: 50% rank-weighted (35/25/18/13/9%), 50%
score-weighted. All bigint wei, so `Σ prizes == pool` exactly and
`prizes + refunds == every MON locked`. Verified end-to-end: a 6-player game
allocated exactly 6 MON.

---

## Gas on Monad — it bills the LIMIT, not the usage

This is the single most expensive thing to get wrong here. On most EVM chains
an over-generous gas limit is free; Monad charges all of it. Left to itself,
viem takes the node’s `eth_estimateGas` answer, which came back around 5.4M
for a call doing a handful of storage writes — about **0.55 MON per
transaction** at 102 gwei.

`lib/chain/settlement.ts` therefore sets an explicit `gas` on every write.
Measured over a real 6-player settlement: three writes cost **0.09 MON** with
limits set, against roughly **1.67 MON** without. For a 25-player game that is
**0.62 MON instead of ~15**.

If you add a contract write, give it a limit. Size it from what the call
actually does and leave roughly 2x headroom — too low reverts out-of-gas and
still costs the full limit.

## Stranded escrow, and getting it back

Every settled game escrows its whole payout table, and rehearsal players never
cash out, so their entitlements stay in the contract. The operator cannot claw
those back — deliberately, since the same power would let it rob real players.

`npm run reclaim:escrow` sweeps **guest** payouts back to the treasury via
`claimFor`. It skips anything signed in with Google, always, and dry-runs
unless given `--confirm`.

Weigh it against gas first. The first sweep recovered 31.75 MON across 65
claims but predated the gas fix, so it burned ~36 MON getting there — a net
loss. With limits set the same sweep would cost about 0.5 MON. **Rehearse with
`NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS` blank** and none of this arises.

## Operational notes

**Reclaim escrow BEFORE resetting the demo data, never after.**
`scripts/reclaim-escrow.mjs` finds what to sweep by reading room documents out
of Supabase and hashing each id into its on-chain game id
(`keccak256("blitzplay:" + roomId)`). The admin demo reset deletes exactly
those rows. Reset first and the escrow is still in the contract but nothing
knows which game ids to claim against, so `reclaim:escrow` reports
`0 across 0 rooms` while the contract plainly still holds a balance. That has
already happened once here: 2.126 MON is stranded from the production
verification run. It is recoverable in principle by scanning the contract's own
events for game ids and player addresses instead of the database, but the
script does not do that today. The cheap habit is to run `npm run
reclaim:escrow --confirm` before Admin → Demo tools, or to rehearse with
`NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS` blank so no escrow exists at all.

**`vercel.json` pins `framework: nextjs`, and it must stay.** The Vercel
project was first created with Framework Preset **Other**, which builds the app
correctly — the log shows all 48 routes compiling — and then serves the result
as a static site out of `public/`. There are no functions and no router, so
*every* path returns a platform-level `NOT_FOUND`. Nothing in the build output
hints at it; the deployment reads `● Ready` throughout. Pinning the framework in
`vercel.json` rather than the dashboard keeps the fix in version control and
applies it to the GitHub auto-deploys too.


**A finished room releases its demo budget.** The budget is a cap on what may
still be committed, so `syncReservation` in `server/rooms.ts` derives what each
room holds from its status: a full house in the lobby, only the players who
actually joined once it starts, nothing at all from FINALIZING onward. It used
to hold a full house until COMPLETED, so a game whose settlement never landed
parked its whole reservation forever — four abandoned rooms were sitting on 16
of the 30 MON cap. Released at FINALIZING rather than COMPLETED on purpose:
settlement pays out of the treasury account and never consults this number.

**Treasury drains on every on-chain settlement.** Funded at 100 MON; ~93.76
after the contract deploy, `verify-chain`, and one production `verify:flows`
(that last one settles a real 6-player game, so it moves ~6 MON into escrow) — check with
`npm run treasury:status`, the number moves with every rehearsal. Escrow that
no player claims stays locked in the contract — the operator deliberately
cannot claw it back, because that power would also let it take funds players
are owed. **Rehearse with
`NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS` blank** so settlement completes as
`OFF_CHAIN` (identical numbers, nothing spent) and only point at the contract
for the real run. ~25 MON is needed for one full 25-player demo.

**`AUTH_SESSION_SECRET` derives every wallet address.** Changing it changes
every player's address. Set once before the event; never rotate mid-game.

**Google origins are not wildcarded.** Every origin you serve from must be
listed on the OAuth client, or the button silently does not render (the
display-name fallback appears instead).

**Keep credentials out of committed files.** `ProjectGuide.md` used to carry
the treasury private key in plaintext; it has been scrubbed and now only names
the variable. Re-check before publishing — `.env.local` is gitignored, and it
is the only place a key belongs.

---

## Commands worth knowing

`npm run` lists the rest. These two are not obvious from the manifest:

- `npm run verify:flows` needs `ADMIN_API_TOKEN` exported to exercise the admin
  path, and takes `BASE_URL` to run against a deployment.
- `node scripts/verify-chain.mjs` runs 16 live on-chain checks and spends real
  testnet MON (~0.005) — it is not a package script.

---

## Remaining / optional

- **Google origins are not wildcarded.** `https://buzzin-monad.vercel.app` is
  on OAuth client `463522552778-…`; any further origin you serve from needs
  adding explicitly, or the Google button silently does not render and players
  fall back to the display-name form. The client is shared with an earlier
  deployment; adding an origin is additive and does not disturb it.
- **No Gemini key configured**, so the Game Master runs its deterministic path.
  Adding `AI_API_KEY` switches it on with no code change; failures fall back
  automatically.
- The 7 lint warnings are React-Compiler-oriented rules (`purity`,
  `set-state-in-effect`, `refs`) firing on data-fetch effects and the countdown
  hook's clock read. Both patterns are correct here; the rules are kept at
  `warn` rather than off so genuinely accidental cases still surface.
- Contract is unverified on the explorer (cosmetic; source is in `contracts/`).
