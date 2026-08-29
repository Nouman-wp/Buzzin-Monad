# Deploying BuzzIn

Target: a public Vercel URL that a room full of people can scan into.

Nothing below is strictly required to *run* the app — it boots and plays with
an empty environment. Each section adds one production capability, and the
admin dashboard shows you which ones are actually live.

---

## 0. Prerequisites

- Node 20+
- A Vercel account
- A Supabase project (free tier is enough for a 25-player demo)
- A funded Monad testnet account — get MON at https://faucet.monad.xyz

---

## 1. Database and realtime (Supabase)

**Required for any multi-instance deployment.** Without it the app falls back
to an in-process store, which on Vercel means each serverless instance has its
own copy of the room — players would see different games.

1. Create a project at https://supabase.com.
2. Open **SQL Editor** and run `supabase/migrations/0001_init.sql`, then
   `supabase/migrations/0002_profile_avatar.sql`. Both are idempotent — safe to
   re-run. 0002 is not optional: it adds `profiles.avatar_url` and the GIN
   index the account dashboard's rooms-by-player query depends on.
3. From **Project Settings → API**, copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

The migration enables row-level security on every table with **no permissive
policy**, so the anon key can read nothing. All access goes through the server
using the service-role key. The anon key is only ever used in the browser to
subscribe to Realtime broadcasts.

> **Never** put the service-role key in a `NEXT_PUBLIC_*` variable.

### Realtime (optional but recommended)

Under **Database → Realtime**, make sure Realtime is enabled for the project.
BuzzIn uses broadcast only — it does not subscribe to table changes — so no
per-table publication setup is needed. If Realtime is unavailable the app keeps
working on polling alone.

---

## 2. Google sign-in

Leave `NEXT_PUBLIC_GOOGLE_CLIENT_ID` blank and the app uses guest sign-in:
same sessions, same embedded wallets, same gameplay. Configure it to get real
Google accounts on the leaderboard.

1. Go to https://console.cloud.google.com/apis/credentials.
2. **Create Credentials → OAuth client ID → Web application**.
3. Under **Authorised JavaScript origins**, add every origin you will serve
   from — there is no wildcard support, so add each one explicitly:
   - `http://localhost:3000`
   - `https://your-app.vercel.app`
   - your custom domain, if you have one
4. Copy the **Client ID** → `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

No client secret is needed. The browser receives a Google ID token and the
server verifies it against Google's published JWKS — signature, issuer,
audience and expiry — before issuing its own session.

> If the Google button does not appear on the deployed site, the origin is
> almost certainly missing from step 3. The app falls back to a display-name
> form so the demo is never blocked by this.

---

## 3. AI Game Master (optional)

Without a key, the deterministic local Game Master runs and the seeded question
pool is used. The game is fully playable; the admin panel labels decisions as
`local` so nothing is misrepresented as AI.

To enable Gemini's free developer tier:

1. Create a key at https://aistudio.google.com/apikey.
2. Set:
   ```
   AI_PROVIDER=gemini
   AI_MODEL=gemini-3.6-flash
   AI_API_KEY=your-key
   ```

Verify the current free-tier limits before a live event — they change. If the
quota is exhausted mid-game the adapter returns the deterministic decision
instead, and the round starts on time regardless.

---

## 4. Monad and the settlement contract

Current testnet parameters (verify against
https://docs.monad.xyz/developer-essentials/testnet before an event):

```
NEXT_PUBLIC_MONAD_RPC_URL=https://testnet-rpc.monad.xyz
NEXT_PUBLIC_MONAD_CHAIN_ID=10143
NEXT_PUBLIC_MONAD_EXPLORER_URL=https://testnet.monadvision.com
```

### Deploy the contract

```bash
# .env.local must contain TREASURY_PRIVATE_KEY
npm run contract:build
npm run contract:deploy
```

The deployer becomes the contract **operator** — the only account that can fund
a game, finalise a payout table, or submit a sponsored claim. It must be the
same key the server runs with.

Put the printed address in `NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS`.

Confirm the wiring at any time:

```bash
npm run treasury:status
```

### Verify the on-chain guarantees

```bash
node scripts/verify-chain.mjs
```

This runs the real lifecycle against the deployed contract — create, fund,
register, finalise, claim — and asserts that a double claim reverts, an
over-allocation reverts, a claim before finalisation reverts, and the money
lands in the destination. It costs roughly 0.005 MON.

### Treasury sizing

The demo budget is `DEMO_TOTAL_TREASURY` (default 25 MON) and each player is
allocated `DEFAULT_PLAYER_ALLOCATION` (default 1 MON). A room reserves its full
capacity up front, so a 25-player room commits the entire budget and a second
room cannot be created until the first completes or is cancelled. This is
deliberate: it means a join can never fail mid-event for lack of funds.

**Keep the treasury balance at or above the configured budget.** `treasury:status`
warns when it drops below.

Settled games move MON out of the treasury permanently: into the escrow
contract, and from there to whoever claims. Escrow that no player claims stays
locked in the contract — the operator deliberately cannot claw it back, because
that same power would let it take funds a player is still owed.

**So rehearse with the chain switched off.** Leave
`NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS` blank in a preview environment and
settlement completes as `OFF_CHAIN` — every number identical and fully
auditable, but nothing spent. Point at the contract only for the real run.

> Testnet MON has no monetary value. Do not point this at a mainnet key.

---

## 5. Environment variables in Vercel

Set these under **Project → Settings → Environment Variables**. Everything
marked server-only must **not** carry a `NEXT_PUBLIC_` prefix.

| Variable | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | public | Your final URL. QR codes are built from it. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | public | Blank = guest sign-in |
| `AUTH_SESSION_SECRET` | **server** | **Required.** Signs sessions and derives wallets |
| `NEXT_PUBLIC_SUPABASE_URL` | public | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Realtime subscribe only |
| `SUPABASE_SERVICE_ROLE_KEY` | **server** | Full database access |
| `AI_PROVIDER` / `AI_MODEL` / `AI_API_KEY` | **server** | Optional |
| `NEXT_PUBLIC_MONAD_RPC_URL` | public | |
| `NEXT_PUBLIC_MONAD_CHAIN_ID` | public | `10143` for testnet |
| `NEXT_PUBLIC_MONAD_EXPLORER_URL` | public | |
| `NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS` | public | From step 4 |
| `TREASURY_PRIVATE_KEY` | **server** | Operator + funding key |
| `DEMO_MODE` … `DEFAULT_ROOM_CAP` | server | Economy knobs; defaults match the spec |
| `ADMIN_EMAILS` | server | Comma-separated admin allowlist |
| `ADMIN_API_TOKEN` | server | Operator token for admin elevation |

Generate the session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`AUTH_SESSION_SECRET` derives every player's embedded wallet address. **Changing
it changes every wallet address.** Set it once, before the event, and never
rotate it while a game is in flight.

---

## 6. Deploy

```bash
npx vercel --prod
```

Or connect the repository in the Vercel dashboard. The project needs no special
build configuration — the defaults for a Next.js app are correct.

**After the first deploy**, set `NEXT_PUBLIC_APP_URL` to the real URL and
redeploy. Until you do, QR codes point at `localhost` and nobody can join.

### Post-deploy smoke test

```bash
BASE_URL=https://your-app.vercel.app ADMIN_API_TOKEN=... npm run verify:flows
```

86 checks covering sign-in, wallets, room creation, QR, question approval,
joining, host authorisation, gameplay, penalties, elimination, the event
terminal, AI decisions, settlement, cash-out, room isolation and all three game
modes. It creates real rooms and, with the chain configured, submits a real
settlement — run it before the event, not during.

Then reset the demo data from **Admin → Demo tools**.

---

## 7. Admin access

Hosting never requires admin — anyone signed in can create and run their own
rooms, authorised by ownership. Admin is only the cross-room overview and the
destructive demo tools, and is granted two ways:

1. **Allowlist.** Add the email to `ADMIN_EMAILS`. Works with Google sign-in.
2. **Operator token.** Set `ADMIN_API_TOKEN`, open `/admin`, and enter it. This
   is the path when you are running on guest sign-in and have no email.

There is deliberately no "everyone is admin in demo mode" fallback.

---

## 8. Running the event

1. Open `/host`, create the room, pick mode/topic/difficulty/rounds.
2. **Generate** questions, review them, fix anything odd, **Approve all**.
3. Put the QR panel on the big screen. The lobby fills in live.
4. **Start game.** A synchronised 3-2-1 runs on every device.
5. Watch the live monitor, leaderboard, Game Master panel and event terminal.
6. When the last round grades, the game moves to finalising.
7. **Calculate payouts**, check the table reconciles, then **Submit to Monad**.
8. Players see their payout and can cash out to any address they like.

### If something goes wrong

| Symptom | Do this |
| --- | --- |
| A round seems stuck | **Skip round**. It grades through the normal path. |
| The room needs a moment | **Pause**, then **Resume** — the live round keeps the time it had left. |
| A player is on the wrong screen | Ask them to reload. State is server-side; they resume where they were. |
| Google sign-in fails | The display-name fallback appears automatically. |
| Settlement fails | Fix the cause, then **Retry settlement**. It is idempotent. |
| Everything is wedged | **End game** freezes scores; settlement still works from frozen state. |

Keep `/admin` open on a second screen. It shows at a glance whether AI, chain
and durable storage are actually configured, and how much treasury is
committed.
