# ProjectGuide.md — BlitzPlay

The Monad testnet treasury key lives in `.env.local` as `TREASURY_PRIVATE_KEY`
(gitignored, never committed). See `.env.example` for the full variable list.

## Build Brief

Build a production-quality, mobile-first, multiplayer Web3 game platform called **BlitzPlay** for a Monad Blitz hackathon demo.

BlitzPlay is a real-time game-night platform where a host creates a room, players join through a QR code or room link, authenticate with Google, receive a secure embedded Monad-compatible wallet automatically, receive a 1 MON testnet game allocation, and compete in fast games such as Quiz, Songless, and Wordless.

The system should feel like a polished modern multiplayer product first and a Web3 demo second. The blockchain should be visible at meaningful moments without making users understand crypto before they can play.

The primary hackathon objective is a spectacular live demo with 10–25 concurrent players in one or more rooms.

---

# 1. Non-Negotiable Product Requirements

## 1.1 Player onboarding

A player must be able to:

1. Open a public URL on a phone.
2. Tap **Join Game**.
3. Sign in with Google.
4. Automatically receive an embedded EVM wallet associated with their account.
5. Set or confirm their display name.
6. Enter a room from a QR code, room code, or `/join/:roomCode` URL.
7. Enter the lobby and immediately see other players who joined the same room.

Do not require MetaMask, seed phrases, browser extensions, manual RPC configuration, or manual faucet setup for players.

The wallet experience should be invisible/simple enough that a non-Web3 user can play without knowing what an embedded wallet is.

Use Privy or a better current equivalent if there is a materially better choice. Google authentication + embedded EVM wallet creation is required.

---

## 1.2 Host onboarding

A user should eventually be able to become a host.

Implement:

- `Host a Game`
- Create a room
- Configure the game
- Generate shareable room URL
- Generate QR code
- Wait for players
- Start game
- Monitor live state
- End game
- View final settlement

For the hackathon, an existing host/admin account may have elevated permissions, but the architecture must support multiple independent hosts and simultaneous rooms.

Preferred flow:

`Google Login -> Host a Game -> Create Room -> Configure -> Share QR/link -> Players Join`

---

# 2. Game Modes — V1 Must Include All Three

Implement three playable modes behind a common game engine.

## 2.1 Quiz

Multiple-choice questions.

Default timing:

- 10 seconds per question
- 4 options
- One correct answer
- Player can answer once
- Answer locks after submission
- Question automatically ends after 10 seconds

Scoring:

- Correct answer: positive score
- Wrong answer: no score increase and incurs a `0.1 MON` penalty against the player's locked game balance
- Timeout/no answer: treat as wrong and incur `0.1 MON`
- Faster correct answers receive higher score than slower correct answers
- Exact scoring formula must be deterministic and documented in code

Recommended scoring formula:

- Correct base: `100 points`
- Speed bonus: `0–50 points`, proportional to remaining time
- Wrong: `0 points` plus `0.1 MON` penalty
- Timeout: `0 points` plus `0.1 MON` penalty

The score and MON balance are separate concepts.

---

## 2.2 Songless

A music-identification game inspired by song guessing games.

The host can choose a category/topic where practical, then the system plays a short clip and gives players a set of possible answers.

Requirements:

- Prefer locally bundled demo audio that is legally safe to distribute, or a configurable external API/source with a local fallback.
- Do not make the entire game dependent on a third-party music API.
- The data provider must be abstracted behind a service interface.
- Audio clips must preload before a round starts when possible.
- Support a fallback demo playlist packaged with the app.
- Never block the round because an external music API is unavailable.

Do not build a complex licensing system. The hackathon demo should use safe demo/sample audio or sources the developer can legally use.

Songless still uses the same 10-second answer window, scoring, penalties, lock-up, elimination, leaderboard, and final settlement system.

---

## 2.3 Wordless

A word/guessing game inspired by wordless-style games.

The exact mechanic may be chosen by the implementation team as long as it is:

- understandable immediately
- fast
- multiplayer
- mobile-first
- compatible with 10-second rounds
- compatible with scoring, penalties, elimination, leaderboard, and AI Game Master control

Examples include clue-to-word multiple choice or rapid clue/word association.

Do not overbuild this mode. Reuse the common question/round engine wherever possible.

---

# 3. Room System

The backend must support multiple simultaneous rooms.

A room has:

- unique room ID
- short room code
- host user ID
- selected game mode
- game configuration
- player list
- room status
- current round
- current question/challenge
- AI Game Master state
- prize pool state
- event log
- leaderboard
- settlement status

Room states:

```text
DRAFT
LOBBY
RUNNING
PAUSED
FINALIZING
COMPLETED
CANCELLED
```

A player must never receive state/events from another room.

Every realtime event must be room-scoped and authorized.

---

# 4. Player Economics — EXACT DEMO RULES

This is a **Monad testnet demo**.

The project will reserve a maximum of **25 MON** specifically for the demo.

Do not design a production financial system. Design a safe, deterministic testnet game economy.

## 4.1 Player starting allocation

Each eligible player receives:

**1.0 MON total game allocation**

At join/start allocation:

- `0.5 MON` is immediately allocated to the room's prize pool accounting
- `0.5 MON` becomes the player's locked game balance

Important: the player's 0.5 MON game balance is locked for the duration of the active game and cannot be withdrawn or transferred by the player.

The prize-pool half is also locked for that game.

No participant should be able to withdraw their starting allocation before the game completes.

---

## 4.2 Maximum participant count for the demo

The demo treasury is 25 MON total.

Implement a configurable room funding limit, with the default hackathon room limit set to **25 players**.

Do not allow the backend to allocate more starting MON than the configured room treasury supports.

If the room reaches its capacity or its reserved treasury cannot cover another player's allocation, joining must be disabled with a clear message.

Never allow the client to choose or alter the amount of MON allocated.

---

## 4.3 Wrong-answer penalties

Every wrong answer or timeout displays:

```text
-0.1 MON
```

in the player UI.

But the actual blockchain transaction for penalties is **not performed immediately**.

During the game:

- Maintain the player's penalty amount in authoritative server-side game state.
- Display the deduction immediately in the UI.
- Update the player's in-game balance immediately.
- Do not spam the blockchain with one transaction per answer.

After the game, settle meaningful balances on-chain.

Example:

```text
Starting game balance: 0.50 MON
Wrong #1: -0.10 -> 0.40
Wrong #2: -0.10 -> 0.30
Wrong #3: -0.10 -> 0.20
Wrong #4: -0.10 -> 0.10
Wrong #5: -0.10 -> 0.00
```

After the fifth wrong answer/timeout, the player is eliminated from active play.

They remain visible in the leaderboard/lobby results but cannot answer subsequent questions.

A player who reaches 0 MON is eliminated even if the current question is not yet over.

Do not permit a negative game balance.

---

# 5. Prize Pool and Settlement

The prize pool starts with 0.5 MON per player.

Every actual wrong/timeout answer adds 0.1 MON to the eventual prize pool accounting.

The starting contribution and penalties are represented as game accounting during play and are settled on-chain after the game.

At game completion:

1. Final scores are frozen.
2. Final rankings are calculated.
3. Penalties are included in the final prize pool.
4. Top 5 eligible players receive the prize pool.
5. Remaining non-winning player balances are handled according to the deterministic settlement policy below.

Recommended policy:

- A player's locked starting game balance is used to cover their accumulated penalties first.
- Any unused portion of that player's starting game balance after all penalties is returned to that player during final settlement, unless the host explicitly configures a different testnet-only room policy.
- Prize money consists of the initial prize-pool contributions plus all settled penalties.
- Unused non-prize funds must never silently disappear.

This must be visible in the admin accounting view.

---

# 6. Recommended Prize Distribution

Use a **performance-adjusted top-5 payout**, not an arbitrary equal split.

Implement:

### 50% rank-weighted component

Use these weights for places 1–5:

```text
1st: 35%
2nd: 25%
3rd: 18%
4th: 13%
5th: 9%
```

These sum to 100% of the rank component.

### 50% performance component

Within the top 5 only, distribute the remaining 50% proportionally to each player's final score.

Formula:

```text
rank_component_i = prize_pool * 0.50 * rank_weight_i
performance_component_i = prize_pool * 0.50 * (player_score_i / sum_top5_scores)
final_prize_i = rank_component_i + performance_component_i
```

Round for display only. Perform settlement using the chain's smallest practical unit and ensure the total distributed never exceeds the prize pool.

This means the winner always receives the most, but the payout also reflects actual performance.

Show the final payout calculation on the admin screen.

---

# 7. AI Game Master

The AI Game Master is a core feature, not a decorative chatbot.

The AI Game Master controls the game progression once the host starts the game.

The host configures:

- topic
- difficulty
- number of questions/rounds
- question type
- game mode

The host must be able to:

- generate questions
- review them
- approve them
- edit them
- reject/regenerate them
- save a question set

Once the game starts, the AI Game Master should make live decisions using room metrics.

---

# 8. AI Game Master Responsibilities

For Quiz mode, the AI Game Master can:

1. Generate questions.
2. Choose the next approved question.
3. Adjust difficulty.
4. Select topic subareas within the host-approved topic.
5. Avoid repetitive concepts.
6. React to player performance.
7. Keep the game competitive.
8. Detect if questions are too easy or too hard based on live statistics.
9. Produce a structured explanation for each decision.

For Songless and Wordless, the same Game Master should decide the next challenge using the same principle, while the underlying content source changes.

The AI Game Master must never control wallet transfers directly.

AI proposes game decisions.

Deterministic application code validates and executes them.

---

# 9. AI Live Adaptation

After every round, calculate:

- number of active players
- answers received
- correct answers
- wrong answers
- timeout count
- accuracy percentage
- average response time
- median response time if practical
- current difficulty
- score distribution
- number of eliminated players
- current prize pool

Send summarized metrics to the AI Game Master.

Example:

```json
{
  "activePlayers": 18,
  "answers": 17,
  "correct": 15,
  "wrong": 2,
  "timeouts": 0,
  "accuracy": 0.882,
  "averageResponseTimeMs": 3210,
  "difficulty": 2,
  "eliminatedPlayers": 2,
  "prizePool": "2.10"
}
```

The AI should return structured output similar to:

```json
{
  "nextDifficulty": 3,
  "nextTopic": "Smart Contract Security",
  "reason": "88.2% of active players answered correctly and the average response time was only 3.2 seconds, so the game should increase difficulty moderately.",
  "questionSelectionStrategy": "harder",
  "decisionConfidence": 0.91
}
```

Do not expose hidden chain-of-thought.

The admin may see a concise **Decision Explanation**, metrics, signals, and the action chosen. Do not display private chain-of-thought or request it from the model.

---

# 10. AI Failure Handling

The product must work even when the AI API fails.

Implement:

- provider abstraction
- timeout
- retry
- rate-limit handling
- structured-output validation
- fallback question/challenge generator
- cached approved question pool
- deterministic difficulty adjustment fallback

If AI generation fails:

```text
AI unavailable -> use approved local questions
```

The game must never freeze because the AI service is unavailable.

---

# 11. AI Provider Strategy

The developer does **not currently have a paid AI API key**.

The build must prioritize a free or free-tier provider suitable for a hackathon demo.

Prefer a current provider with a genuinely available developer free tier, such as Gemini through Google AI Studio, subject to current limits. Verify current official documentation when implementing rather than assuming a free tier remains unchanged.

Use an adapter interface:

```text
AiProvider
  generateQuestionSet()
  chooseNextRound()
  evaluateGameMetrics()
  generateGameExplanation()
```

Environment variable example:

```env
AI_PROVIDER=gemini
AI_MODEL=...
AI_API_KEY=...
```

Do not hard-code keys.

Do not commit `.env` files.

The application must still run in demo mode with no AI key by using local fallback content.

---

# 12. Question Generation

Host interface:

```text
Topic: [ Web3 ]
Difficulty: [ Medium ]
Questions: [ 10 ]
Question Type: [ Multiple Choice ]
[ Generate with AI ]
```

Generated question schema:

```json
{
  "id": "...",
  "gameType": "QUIZ",
  "question": "...",
  "options": ["A", "B", "C", "D"],
  "correctAnswerIndex": 1,
  "difficulty": 3,
  "topic": "Web3",
  "explanation": "...",
  "source": "ai",
  "status": "PENDING_APPROVAL"
}
```

Validate:

- exactly 4 options for Quiz
- one and only one correct answer
- non-empty explanation
- sensible question length
- no malformed JSON
- no duplicated answers
- no answer leaking into unrelated metadata

Host must approve/edit before the set can be used.

---

# 13. Fairness and Anti-Cheat

The server is authoritative.

The client must never decide:

- whether an answer is correct
- the final score
- the penalty amount
- elimination
- final ranking
- final prize
- settlement amount

Answer submissions must include:

- room ID
- round ID
- player ID
- selected answer
- client timestamp
- server receipt timestamp if practical

The server determines the accepted answer time.

One answer per player per round.

Late answers after round close must be rejected.

Do not expose the correct answer in initial client payloads.

Avoid shipping answer keys in easily inspectable client-side state before the round ends.

For Songless, do not expose the answer in filenames or obvious frontend metadata.

---

# 14. Realtime Architecture

The game must feel instantaneous.

Use Supabase Realtime or another reliable realtime transport if it is the better implementation choice. Supabase Realtime supports low-latency broadcast, presence, database change streaming, and multiplayer use cases.

Prefer broadcast/presence for live game events and database persistence for durable state where appropriate.

Core events:

```text
ROOM_CREATED
PLAYER_JOINED
PLAYER_LEFT
LOBBY_UPDATED
GAME_STARTING
ROUND_STARTED
QUESTION_REVEALED
ANSWER_SUBMITTED
ANSWER_LOCKED
ROUND_ENDED
LEADERBOARD_UPDATED
AI_DECISION
PLAYER_ELIMINATED
GAME_PAUSED
GAME_RESUMED
GAME_FINALIZING
SETTLEMENT_STARTED
SETTLEMENT_CONFIRMED
GAME_COMPLETED
```

All events must contain:

- room ID
- event ID
- server timestamp
- event type
- safe payload

The event system should tolerate reconnects.

A player who reconnects should receive the current room/game snapshot and continue from the current round state if still eligible.

---

# 15. Game Engine

Create a reusable deterministic game engine.

Suggested state machine:

```text
LOBBY
  -> STARTING
  -> ROUND_ACTIVE
  -> ROUND_LOCKED
  -> ROUND_SETTLING
  -> NEXT_ROUND
  -> COMPLETED
```

The engine handles:

- timers
- answer lock
- scoring
- speed bonuses
- penalties
- elimination
- leaderboard updates
- question transitions
- game completion

Do not rely on frontend timers for authoritative state.

Use server timestamps.

Client timers should visually count down based on server-provided end time.

---

# 16. Mobile Player Experience

Player UI must be fully responsive and optimized for phones first.

Assume most participants will be standing in a room using one hand.

The player should always be able to see:

- current question/challenge
- remaining time
- answer choices/input
- their current score
- their game balance
- current rank
- active player count
- whether they are still alive

Keep interactions large and touch-friendly.

Avoid dense dashboards on the player side.

For questions, make the answer cards large enough for fast tapping.

After answering:

```text
Answer Locked

+134 points

Waiting for other players...
```

Do not immediately reveal correctness if doing so would leak answers to slower players unless the game design explicitly supports it. Prefer revealing results when the round closes.

---

# 17. Lobby

The lobby should be realtime.

Show:

- room name
- host name
- game mode
- number of players
- max players
- prize pool
- player names
- ready/joined state

Example:

```text
ROOM: WEB3 NIGHT
Players: 14 / 25
Prize Pool: 7.00 MON

Nouman        ●
Areeb         ●
Kaunain       ●
Rahul         ●
...

Waiting for host...
```

When the host starts:

Show a short synchronized countdown:

```text
3
2
1
GO
```

---

# 18. Admin / Host Dashboard

The host dashboard is desktop/tablet-first but should still be responsive.

The UI design is intentionally not prescribed beyond the reference below. Use the visual quality, restraint, spacing, typography and product polish of **https://resend.com/** as inspiration, but do not copy its UI, layout, branding, or assets. Make original design decisions.

The dashboard must allow the host/admin to:

- create room
- configure room
- generate QR code
- copy room URL
- configure topic
- configure difficulty
- configure number of questions
- configure question type
- generate AI questions
- approve/reject/edit questions
- start game
- pause game
- resume game
- skip question
- end game
- see live leaderboard
- see players
- see player states
- see scores
- see game balances
- see penalties
- see prize pool
- see eliminated players
- see AI Game Master metrics
- see AI decision explanations
- see realtime application logs
- see blockchain settlement status
- see transaction hashes
- see final prize calculation
- retry failed settlement where safe

Once the game starts, the AI Game Master should be the primary controller. Manual host controls still exist as emergency overrides.

---

# 19. Admin Live Monitor

The most visually important admin panel should show the entire game in real time.

Recommended sections:

### Live Game

```text
Question 6 / 10
Time Remaining: 06s
Active Players: 17
Correct: 11
Wrong: 5
Timeout: 1
Prize Pool: 3.10 MON
```

### Leaderboard

```text
1. Nouman      812
2. Areeb       774
3. Rahul       731
4. Sara        692
5. Kaunain     651
```

### AI Game Master

```text
AI GAME MASTER

Accuracy: 84%
Avg Response: 3.8s
Difficulty: 3 -> 4

Decision Explanation:
"Most active players solved the last round quickly,
so the next question should be moderately harder."
```

### Terminal / Event Stream

This should be a real application event stream styled like a clean terminal, not fake hard-coded text.

---

# 20. Real Live Terminal

Implement a live terminal/log panel that receives actual application events.

Example:

```text
[19:42:01.210] ROOM_CREATED room=BLITZ-91A2
[19:42:07.044] PLAYER_JOINED name=Nouman wallet=0x91...AF2
[19:42:07.091] PLAYER_JOINED name=Areeb wallet=0x13...B77
[19:42:12.402] LOBBY_READY players=18
[19:42:15.010] GAME_START room=BLITZ-91A2
[19:42:15.212] AI_GAME_MASTER round=1 difficulty=2
[19:42:15.601] QUESTION_REVEALED id=q_001
[19:42:18.774] ANSWER player=Nouman result=correct latency=3173ms
[19:42:22.012] ROUND_END correct=15 wrong=2 timeout=1
[19:42:22.121] AI_DECISION difficulty=3 reason="High accuracy and fast response time"
[19:42:22.844] LEADERBOARD_UPDATED
[19:42:24.118] NEXT_ROUND question=q_002
```

Logs must be generated by real events.

Use structured logging internally and render human-readable terminal lines in the dashboard.

Useful log levels:

```text
INFO
SUCCESS
WARN
ERROR
AI
CHAIN
GAME
PLAYER
```

---

# 21. Blockchain Architecture

Use Monad testnet/mainnet configuration according to the current official Monad developer documentation and hackathon requirements.

Use Solidity with Foundry or another modern EVM toolchain if Claude determines it is more reliable.

Keep the contract small and auditable.

Do not put realtime game state on-chain.

Do not put every answer on-chain.

Do not send one blockchain transaction per wrong answer.

Use off-chain authoritative accounting and settle meaningful economic events on-chain.

---

# 22. Smart Contract Responsibilities

At minimum, implement a room/settlement contract or a clean equivalent architecture capable of:

- registering a game/room settlement context
- receiving/funding the room treasury
- tracking or receiving player allocation deposits where appropriate
- finalizing prize allocation
- allowing winners to claim/cash out after game completion
- preventing double claims
- emitting settlement events

Possible contract interface:

```solidity
createGame(bytes32 gameId, uint256 playerLimit)
fundGame(bytes32 gameId) payable
registerPlayer(bytes32 gameId, address player)
finalizeGame(bytes32 gameId, Settlement[] calldata settlements)
claim(bytes32 gameId)
```

Exact implementation may differ if Claude finds a safer design.

Do not blindly trust client-submitted settlement amounts.

The backend must generate a deterministic final settlement payload.

Where appropriate, the contract should verify:

- game exists
- game is finalized
- player has not claimed
- total payout does not exceed available prize funds

Use pull-based claiming for winner withdrawals if it improves safety.

---

# 23. External Wallet Cashout

Players may cash out only after the game is completed.

The player should be able to:

1. See final prize.
2. Click `Cash Out`.
3. Provide or select an external wallet address.
4. Confirm.
5. Receive testnet MON after successful settlement/claim.

The game must not allow cashout during an active game.

For embedded-wallet players, support claiming directly to the connected embedded wallet if practical, followed by optional transfer to an external wallet.

The player must never be forced to understand private keys.

---

# 24. Funding Strategy

Because the hackathon demo has a finite 25 MON testnet budget, use a controlled funding model.

Do not attempt to source unlimited faucet funds dynamically.

Build a configurable funding mode:

```text
DEMO_FUNDING_MODE=true
DEMO_TOTAL_TREASURY=25
DEFAULT_PLAYER_ALLOCATION=1
DEFAULT_ROOM_CAP=25
```

The actual implementation of the funding wallet must never expose its private key to the frontend.

Store treasury/private signing credentials only in secure server-side environment variables.

---

# 25. Database

Use Supabase/Postgres unless Claude identifies a materially better option.

Suggested tables:

```text
profiles
wallets
hosts
rooms
room_members
room_settings
games
rounds
questions
question_sets
answers
player_game_state
leaderboard_snapshots
ai_decisions
event_logs
settlements
settlement_items
song_assets
word_assets
```

Important fields to persist:

### profiles

- id
- auth provider ID
- display name
- email if available
- created_at

### wallets

- user ID
- wallet address
- provider
- created_at

### rooms

- id
- short code
- host ID
- status
- max players
- mode
- created_at

### games

- id
- room ID
- game mode
- status
- topic
- difficulty
- question count
- started_at
- ended_at
- prize pool

### player_game_state

- game ID
- player ID
- score
- correct count
- wrong count
- timeout count
- penalty total
- starting_game_balance
- current_game_balance
- eliminated
- rank

### answers

- round ID
- player ID
- answer
- received_at
- correctness
- score_awarded
- penalty_awarded

### ai_decisions

- game ID
- round ID
- metrics JSON
- decision JSON
- explanation
- provider/model
- created_at

### event_logs

- room ID
- game ID
- event type
- severity
- message
- payload JSON
- created_at

### settlements

- game ID
- status
- prize pool
- total allocated
- tx hash
- finalized_at

### settlement_items

- settlement ID
- player ID
- rank
- score
- reward
- destination wallet
- tx/claim state

Use RLS and server-side authorization correctly.

Never expose service-role secrets to the browser.

---

# 26. Authentication and Authorization

Use Google login through Privy or the chosen wallet/auth provider.

Roles:

```text
PLAYER
HOST
ADMIN
```

A user can become a host through `Host a Game`.

Admin access must be allowlisted or role-based.

Do not rely on a hidden frontend route to protect admin functionality.

The backend must validate host/admin access for every privileged mutation.

---

# 27. QR and Room Links

Every room gets:

```text
/join/:roomCode
```

Example:

```text
https://YOUR_DOMAIN/join/BLITZ91
```

Generate a QR code for the exact public URL.

The host dashboard should include:

- QR code
- copy link
- copy room code
- participant count
- room status

The join experience should work directly from the QR scan without forcing the user through the homepage first.

---

# 28. Game Flow

## Host

```text
Google Login
  -> Host a Game
  -> Create Room
  -> Choose Game
  -> Set topic/difficulty/questions/type
  -> Generate with AI
  -> Review/Edit/Approve
  -> Show QR
  -> Players join
  -> Start Game
```

## Player

```text
Scan QR
  -> Google Login
  -> Wallet auto-created
  -> Display name
  -> Join room
  -> Lobby
  -> Game
  -> Answer rounds
  -> Elimination if 5 penalties
  -> Final ranking
  -> Prize result
  -> Cashout after completion
```

## Finalization

```text
GAME ENDS
  -> Freeze scores
  -> Calculate rankings
  -> Calculate penalties
  -> Calculate prize pool
  -> Calculate top-5 payouts
  -> Generate settlement payload
  -> Submit on-chain settlement
  -> Wait for confirmation
  -> Enable claims/cashout
  -> Mark completed
```

---

# 29. Detailed Round Flow

Before the round:

1. AI decides next content/difficulty.
2. Server validates decision.
3. Server chooses an approved question/challenge.
4. Question data is prepared.
5. Round start time and end time are generated.
6. Clients receive round payload without exposing answer.

During round:

1. Countdown runs from server deadline.
2. Players submit answers.
3. Server validates one answer per player.
4. Server records result.
5. Client shows answer locked state.

At round end:

1. Server closes submissions.
2. Server grades all answers.
3. Server awards score.
4. Server records penalties.
5. Server checks elimination.
6. Server recalculates leaderboard.
7. Server broadcasts leaderboard.
8. AI Game Master receives metrics.
9. AI decides the next round.

---

# 30. Reconnection Rules

A user may disconnect because of mobile network changes.

On reconnect:

- restore auth state
- restore room membership
- fetch authoritative game snapshot
- show current question only if still active
- preserve whether an answer has already been submitted
- preserve score and balance
- preserve elimination state

Never allow reconnecting clients to submit a second answer.

---

# 31. Multi-Room Isolation

The same host/admin account may own multiple rooms.

A room must have its own:

- players
- game state
- question set
- AI state
- event stream
- leaderboard
- prize pool
- settlement

No event from room A should appear in room B.

Do not use a global singleton game state.

If in-memory state is used for realtime performance, it must be room-keyed and recoverable from persistent state.

---

# 32. Local Content Fallback

Create seed content for all modes.

Quiz fallback:

- Web3
- Ethereum
- Monad
- Solidity
- blockchain basics
- general tech

Songless fallback:

- a small legally safe demo clip set
- metadata and correct answers stored locally

Wordless fallback:

- a small set of predefined word/clue challenges

This allows the entire demo to run without any external AI/music dependency.

---

# 33. Demo Mode

Implement a `DEMO_MODE` configuration.

When enabled:

- default room capacity = 25
- starting allocation = 1 MON
- penalty = 0.1 MON
- 5 penalties = elimination
- safe seeded question content available
- AI fallback available
- mock/demo audio available
- verbose terminal logging enabled
- blockchain settlement visible
- no production payment assumptions

Provide a simple seed/reset mechanism for the hackathon developer, for example a protected admin action or server script.

Never allow arbitrary users to reset or mint demo funds.

---

# 34. Demo Observability

The terminal/log system is part of the presentation.

Also expose high-level metrics:

```text
ROOMS ACTIVE
PLAYERS ONLINE
CURRENT ROUND
PRIZE POOL
AI DECISIONS
TRANSACTIONS
ELIMINATIONS
```

Admin should be able to click a player and see:

- name
- wallet
- score
- current rank
- correct/wrong/timeout counts
- penalty total
- current balance
- eliminated status
- answer history

Do not expose sensitive auth data.

---

# 35. Error Handling

Handle and display gracefully:

- Google auth failure
- wallet creation failure
- room full
- room not found
- game already started
- duplicate answer
- network disconnect
- database failure
- realtime failure
- AI API failure
- music API failure
- transaction rejection
- transaction timeout
- settlement mismatch

Never leave the UI spinning indefinitely.

Give users a clear recovery path.

---

# 36. Accessibility and UX

Use:

- keyboard navigation where applicable
- sufficient contrast
- clear active/disabled/error states
- large touch targets
- readable countdowns
- reduced-motion consideration

The player should understand every state within one glance.

---

# 37. Visual Design Direction

Do not prescribe a specific component layout.

Use **Resend.com as the quality reference**:

- minimal
- premium
- clean
- restrained
- modern typography
- strong spacing
- subtle motion
- excellent hierarchy
- polished empty/loading/error states

Do NOT clone Resend.

Do NOT use their branding, copy, components, or assets.

Invent an original visual identity suitable for a competitive game platform.

Player interface and admin interface can have distinct density levels, but they must clearly feel like the same product.

Use tasteful animations for:

- room join
- countdown
- question transition
- answer locked
- score changes
- leaderboard movement
- elimination
- final results
- settlement confirmation

Animations must never slow down gameplay.

---

# 38. Suggested Technical Stack

Claude may change any component if there is a clear technical advantage, but the default should be:

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- modern accessible component system

### Auth / Embedded Wallet

- Privy
- Google login
- EVM embedded wallet

### Database / Realtime

- Supabase Postgres
- Supabase Auth only if it makes sense with the chosen wallet/auth approach
- Supabase Realtime Broadcast/Presence where appropriate

### Blockchain

- Solidity
- Foundry
- viem
- Monad

### AI

- provider abstraction
- Gemini free-tier provider as the first candidate if currently available
- local deterministic fallback

### Validation

- Zod or equivalent

### QR

- a well-maintained QR generation library

### Deployment

- Vercel for the web app
- use a suitable server-side runtime/deployment strategy for persistent realtime/settlement services if Next.js serverless constraints make it inappropriate
- Supabase for database/realtime

Claude must not blindly use long-lived in-memory sockets on Vercel if the chosen deployment architecture does not support them correctly. If a separate realtime service is needed, choose a practical low-cost/free hackathon option.

---

# 39. Architecture Principle: Server Authoritative

The architecture must enforce:

```text
Client
  ↓
Request
  ↓
Server
  ↓
Validate
  ↓
Game Engine
  ↓
Database / Realtime
  ↓
Blockchain settlement when required
```

Not:

```text
Client
  ↓
Trust whatever the browser says
```

The client is a presentation layer and input device, not a trusted game authority.

---

# 40. Suggested Monorepo / Repository Structure

Do not create a GitHub repository automatically.

Do not initialize or modify remote Git configuration unless explicitly requested by the human developer.

Suggested structure:

```text
blitzplay/
  app/
    (public)/
    join/[roomCode]/
    play/[gameId]/
    host/
    admin/

  components/
    player/
    host/
    admin/
    game/
    shared/
    terminal/

  lib/
    auth/
    wallet/
    ai/
    game-engine/
    realtime/
    blockchain/
    settlement/
    media/
    validation/

  server/
    rooms/
    rounds/
    answers/
    ai/
    settlement/
    events/

  contracts/
    BlitzPlaySettlement.sol

  prisma-or-supabase/
    migrations/
    seed/

  public/
    audio/
    images/

  scripts/

  tests/
```

Adjust to the chosen framework if necessary.

---

# 41. API / Server Actions

Create typed API endpoints/server actions for at least:

```text
POST /api/rooms
GET  /api/rooms/:roomCode
POST /api/rooms/:roomId/join
POST /api/rooms/:roomId/start
POST /api/rooms/:roomId/pause
POST /api/rooms/:roomId/resume
POST /api/rooms/:roomId/end

POST /api/rooms/:roomId/questions/generate
POST /api/rooms/:roomId/questions/:id/approve
POST /api/rooms/:roomId/questions/:id/reject
POST /api/rooms/:roomId/questions/:id/edit

POST /api/games/:gameId/answer
GET  /api/games/:gameId/state
GET  /api/games/:gameId/leaderboard
GET  /api/games/:gameId/logs
GET  /api/games/:gameId/ai-decisions

POST /api/games/:gameId/settlement/prepare
POST /api/games/:gameId/settlement/submit
POST /api/games/:gameId/claim
```

Exact routing style may use Next.js route handlers/server actions if that is cleaner.

---

# 42. Typed Contracts

Share types between client and server.

Important shared types:

```text
Room
RoomMember
Game
Round
Question
AnswerSubmission
PlayerGameState
LeaderboardEntry
AiDecision
GameMetrics
Settlement
SettlementItem
GameEvent
```

Use runtime validation at API boundaries.

---

# 43. Security Requirements

Never expose:

- private keys
- service-role Supabase keys
- AI API keys
- privileged admin secrets

Never trust:

- client score
- client timer
- client wallet balance
- client winner claim
- client prize calculation

Protect against:

- duplicate submissions
- replayed requests
- joining the same room multiple times
- joining with the same account across conflicting state
- unauthorized host controls
- room ID enumeration if possible
- settlement replay
- double claim
- negative balances
- race conditions around finalization

Use idempotency keys for critical settlement and join mutations where practical.

---

# 44. Testing Requirements

Claude must write tests for critical logic.

At minimum:

### Game engine tests

- correct answer scoring
- speed bonus
- wrong answer penalty
- timeout penalty
- fifth penalty elimination
- ranking
- prize calculation
- ties
- round transition

### Settlement tests

- total payout <= prize pool
- no negative payout
- no double claim
- deterministic settlement
- all top-5 receive correct calculation

### API tests

- unauthorized host request rejected
- player cannot start game
- duplicate answer rejected
- late answer rejected
- room isolation

### Contract tests

- fund game
- register player
- finalize
- claim
- double claim prevented
- over-allocation prevented

---

# 45. Performance Requirements

Target:

- 25 concurrent demo players in one room
- multiple rooms in parallel
- sub-second UI response for normal realtime events
- no full-page reload during gameplay
- questions preloaded before round start where possible
- stable gameplay on mobile Wi-Fi/cellular connections

Do not over-engineer horizontal scale for the hackathon, but avoid architecture that fundamentally breaks under 25 concurrent players.

---

# 46. Deployment

The final project must be deployable to **Vercel** with a public URL.

The deployed experience must support:

- Google login
- embedded wallet creation
- room joining
- mobile gameplay
- host dashboard
- admin dashboard
- realtime multiplayer
- AI generation if an API key is configured
- fallback mode if no AI key is configured
- Monad settlement

The public join URL must look approximately like:

```text
https://YOUR_DOMAIN/join/ABC123
```

Do not require the user to clone the repository or run a development server for the final demo.

Provide a clear deployment guide covering:

- Vercel environment variables
- Supabase project setup
- Privy setup
- Google OAuth setup
- AI API key setup
- Monad RPC/network configuration
- treasury wallet configuration
- contract deployment
- contract address configuration
- production URL

---

# 47. Environment Variables

Generate a `.env.example` with placeholders only.

Likely variables:

```env
NEXT_PUBLIC_APP_URL=

PRIVY_APP_ID=
PRIVY_APP_SECRET=

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DATABASE_URL=

AI_PROVIDER=gemini
AI_MODEL=
AI_API_KEY=

MONAD_RPC_URL=
MONAD_CHAIN_ID=
MONAD_EXPLORER_URL=

SETTLEMENT_CONTRACT_ADDRESS=
TREASURY_PRIVATE_KEY=

DEMO_MODE=true
DEMO_TOTAL_TREASURY=25
DEFAULT_PLAYER_ALLOCATION=1
DEFAULT_GAME_BALANCE=0.5
DEFAULT_PRIZE_POOL_ALLOCATION=0.5
WRONG_ANSWER_PENALTY=0.1
MAX_WRONG_ANSWERS=5
DEFAULT_ROOM_CAP=25
```

Use the correct chain ID/RPC/explorer values based on current official Monad documentation and the actual deployment target.

Do not invent current network values.

---

# 48. Demo Seed Data

Provide seeded demo content so the product can be demonstrated immediately.

Seed:

- 20+ Web3 Quiz questions
- 10+ Songless demo clips/entries if legally safe
- 20+ Wordless challenges
- 3 difficulty tiers
- multiple Web3 topic categories

Example topics:

```text
Ethereum
Monad
Solidity
Wallets
DeFi
NFTs
Smart Contract Security
Layer 1s
Layer 2s
Web3 Basics
```

---

# 49. Demo Script Support

Build small quality-of-life features specifically for the hackathon presentation:

### Host

`Create Demo Room`

### Player

`Quick Join`

### Admin

`Reset Demo`

### Terminal

`Clear Logs`

### Game

`Use Seeded Questions`

### Settlement

`View Explorer`

Do not expose destructive demo controls to normal users.

---

# 50. Final Demo Narrative

The final product should support this live sequence:

1. Host logs in.
2. Host creates a room.
3. Host selects Quiz.
4. Host enters `Web3`, medium, 10 questions, MCQ.
5. AI generates questions.
6. Host edits/approves them.
7. Host displays QR.
8. 10–25 participants scan.
9. Participants sign in with Google.
10. Embedded wallets are automatically available.
11. Lobby fills in realtime.
12. Host starts.
13. Question appears for everyone.
14. Players have 10 seconds.
15. Wrong answers show `-0.1 MON` in the UI.
16. Leaderboard updates.
17. AI Game Master analyzes performance.
18. AI chooses next difficulty/question.
19. Terminal shows the decision and live events.
20. Players continue until final round.
21. Final top 5 is calculated.
22. Prize pool and payout formula are shown.
23. Settlement is submitted to Monad.
24. Transaction is confirmed.
25. Winners can cash out to an external wallet.
26. Terminal shows the settlement transaction.

This should feel smooth enough to perform live without explaining implementation details for every step.

---

# 51. Definition of Done

The build is complete only when all of the following are true:

## Player

- Google login works.
- Embedded wallet is created/available.
- Player can join via QR/link/room code.
- Player enters realtime lobby.
- Player sees other players.
- Player can play Quiz.
- Player can play Songless.
- Player can play Wordless.
- 10-second rounds work.
- Correct + speed scoring works.
- Wrong/timeout penalty works in game accounting.
- Fifth penalty eliminates player.
- Player sees score/rank/balance.
- Player can reconnect.
- Player can see final prize.
- Player can cash out only after completion.

## Host/Admin

- Host can create multiple rooms.
- Host can configure topic/difficulty/question count/question type.
- AI can generate questions.
- Admin can approve/edit/reject.
- Host can create QR.
- Host can start/pause/resume/end.
- Admin can monitor live leaderboard.
- Admin can see player balances/penalties.
- Admin can see AI decisions.
- Admin can see structured decision explanations.
- Admin can see real terminal logs.
- Admin can see final settlement.

## AI

- AI chooses next round based on live metrics.
- AI can adjust difficulty.
- AI can explain decisions concisely.
- AI failures have a fallback.
- AI cannot directly transfer funds.

## Blockchain

- Monad configuration is correct.
- Contract deploys.
- Funding works.
- Final settlement works.
- Top-5 rewards are deterministic.
- Double claim is impossible.
- Explorer transaction can be shown.

## Infrastructure

- Database works.
- Realtime works.
- Room isolation works.
- Multiple rooms work.
- Vercel deployment works.
- Mobile responsive experience works.

---

# 52. Build Order

Claude should implement in this order and keep the app runnable after each major phase.

### Phase 1 — Foundation

- project scaffolding
- TypeScript
- environment validation
- auth/wallet integration
- database schema
- core types

### Phase 2 — Rooms

- host login
- create room
- room code
- QR/link
- player join
- lobby
- presence

### Phase 3 — Core Game Engine

- round lifecycle
- timers
- answer handling
- scoring
- penalty accounting
- elimination
- leaderboard

### Phase 4 — Quiz

- question schema
- AI generation
- approval
- gameplay

### Phase 5 — AI Game Master

- metrics
- decision engine
- explanation panel
- fallback logic

### Phase 6 — Songless + Wordless

- shared game engine integration
- local content fallback
- external content adapter where useful

### Phase 7 — Admin Monitor

- dashboard
- live leaderboard
- logs
- AI monitor
- player details

### Phase 8 — Blockchain

- Solidity contract
- testnet deployment
- settlement
- claims
- explorer links

### Phase 9 — Polish

- animations
- responsive design
- loading/error states
- reconnect UX
- performance

### Phase 10 — Deploy

- Vercel
- environment configuration
- final smoke tests
- public URL

Do not skip foundational correctness to add decorative features.

---

# 53. Git / Attribution Rules — IMPORTANT

The human developer owns this project.

**Do not add Claude, Anthropic, OpenAI, AI, any AI agent, Cursor, Gemini, or any assistant as a contributor, co-author, GitHub contributor, author, or attribution.**

Do not create commits using an AI/assistant identity.

Do not modify Git author settings to insert an AI identity.

Do not create a GitHub repository.

Do not publish code anywhere unless explicitly instructed by the human developer.

Do not add badges such as `Built with Claude` unless explicitly requested.

Do not add a README credit line for AI assistance unless explicitly requested.

Use the human developer's existing Git identity if Git is used locally.

---

# 54. Do Not Overbuild

This is a one-day hackathon project.

Prioritize:

1. Working multiplayer game.
2. Frictionless onboarding.
3. AI Game Master.
4. Realtime leaderboard.
5. Terminal observability.
6. Visible Monad settlement.
7. Beautiful mobile experience.

Do not spend most of the build time on:

- sophisticated microservices
- enterprise authentication
- unnecessary abstractions
- huge media libraries
- production-scale infrastructure
- complicated tokenomics
- complex NFT systems
- unnecessary on-chain state

Make the smallest architecture that reliably delivers the full demo.

---

# 55. Final Instruction to Claude

Act as the senior engineer responsible for shipping this project end-to-end.

Do not merely describe code. Actually create the application, files, database migrations/schema, contracts, tests, environment template, seed data, and deployment configuration.

Before making major architectural decisions, verify current official documentation for the chosen integrations, especially:

- Monad network/tooling
- Privy
- Supabase Realtime
- Vercel deployment constraints
- AI provider free-tier/API availability

When a third-party API is uncertain, build an abstraction and a local fallback rather than making the entire app dependent on it.

Do not use fake hard-coded demo data in places where live application state should be shown. Seeded content is fine; fake realtime logs are not.

Keep blockchain interactions server-authorized and deterministic.

Keep all game rules server authoritative.

Keep the player UX simple enough for a first-time Web3 user.

Make the host/admin experience powerful enough to control a 25-person live room.

Make the final app mobile-first for players and polished on desktop for hosts/admins.

Make the live demo resilient: a broken AI request, temporary realtime disconnect, or unavailable music API must not destroy the game.

The goal is not to build a theoretical platform. The goal is to ship a polished, working, public, mobile-friendly hackathon application that can handle a live 25-player game and visibly demonstrate AI-driven game control, realtime multiplayer, embedded wallets, and meaningful Monad settlement.
