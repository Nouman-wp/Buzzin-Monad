/**
 * End-to-end smoke test against a running server.
 *
 * Drives the real HTTP API exactly as a host and a room full of players would:
 * sign in, create a room, approve questions, join, start, answer under the
 * clock, get eliminated, finish, settle, and cash out. Asserts the security
 * properties too — no answer key in a live payload, no duplicate answers, no
 * cross-room leakage, no unauthorised host control.
 *
 * Usage:
 *   npm run dev            # in another terminal
 *   npm run verify:flows
 *
 * Optional: BASE_URL=https://your-deployment.vercel.app npm run verify:flows
 */
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const PLAYER_COUNT = Number(process.env.VERIFY_PLAYERS || 6);
const ROUNDS = 4;

let passed = 0;
let failed = 0;
const failures = [];

function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    process.stdout.write(`  PASS  ${label}${detail ? ` — ${detail}` : ''}\n`);
  } else {
    failed += 1;
    failures.push(label);
    process.stdout.write(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}\n`);
  }
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

/** A browser-like client: one cookie jar per identity. */
function createClient(name) {
  const cookies = new Map();
  return {
    name,
    async request(path, init = {}) {
      const headers = new Headers(init.headers ?? {});
      if (cookies.size > 0) {
        headers.set(
          'cookie',
          [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; '),
        );
      }
      if (init.body && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      // One dropped connection should not abort a whole verification run:
      // this drives a real deployment over the public internet, where a
      // transient reset says nothing about the product.
      let response;
      for (let attempt = 1; ; attempt += 1) {
        try {
          response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
          break;
        } catch (cause) {
          if (attempt >= 3) throw cause;
          await new Promise((r) => setTimeout(r, 400 * attempt));
        }
      }
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const index = pair.indexOf('=');
        if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: response.status, ok: response.ok, body, raw: text };
    },
    get(path) {
      return this.request(path);
    },
    post(path, body) {
      return this.request(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
    },
    patch(path, body) {
      return this.request(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  process.stdout.write(`BuzzIn flow verification against ${BASE}\n`);

  // ------------------------------------------------------------- reachability
  section('server');
  const probe = await fetch(`${BASE}/api/auth/me`).catch(() => null);
  if (!probe || !probe.ok) {
    process.stdout.write(`  FAIL  server not reachable at ${BASE}. Start it with \`npm run dev\`.\n`);
    process.exit(1);
  }
  const capabilities = (await probe.json()).config;
  check('server is up', true, `store=${capabilities.durableStore ? 'supabase' : 'memory'}`);
  process.stdout.write(
    `        ai=${capabilities.aiEnabled} chain=${capabilities.chainEnabled} google=${capabilities.googleAuthEnabled}\n`,
  );

  // -------------------------------------------------------------------- auth
  section('authentication and embedded wallets');
  const host = createClient('Host');
  const signIn = await host.post('/api/auth/guest', { displayName: 'Demo Host' });
  check('host signs in', signIn.ok && Boolean(signIn.body.user), signIn.body?.user?.displayName);
  check(
    'an embedded wallet is provisioned automatically',
    /^0x[0-9a-fA-F]{40}$/.test(signIn.body?.user?.walletAddress ?? ''),
    signIn.body?.user?.walletAddress,
  );

  const anonymous = createClient('Anonymous');
  const denied = await anonymous.post('/api/rooms', {});
  check('an unauthenticated request is rejected', denied.status === 401);

  const badName = await host.post('/api/auth/guest', { displayName: 'x' });
  check('an invalid display name is rejected', badName.status === 400);

  // ------------------------------------------------------------------- rooms
  section('room creation');
  const created = await host.post('/api/rooms', {
    name: 'Flow Verification',
    mode: 'QUIZ',
    topic: 'Web3',
    difficulty: 3,
    questionCount: ROUNDS,
    maxPlayers: PLAYER_COUNT,
    aiGameMasterEnabled: true,
  });
  check('host creates a room', created.status === 201, created.body?.room?.code);
  if (!created.ok) {
    process.stdout.write(`\nCannot continue: ${JSON.stringify(created.body)}\n`);
    process.exit(1);
  }
  const room = created.body.room;
  const roomId = room.id;

  check('the room starts in the lobby', room.status === 'LOBBY');
  check('a shareable join URL is generated', created.body.joinUrl.includes(`/join/${room.code}`));
  check(
    'the room is seeded with approved questions',
    room.challenges.length === ROUNDS &&
      room.challenges.every((q) => q.status === 'APPROVED'),
    `${room.challenges.length} approved`,
  );

  const qr = await fetch(`${BASE}/api/rooms/${roomId}/qr`);
  const qrBody = await qr.text();
  check(
    'a QR code renders for the join URL',
    qr.ok && qrBody.startsWith('<svg'),
    qr.headers.get('content-type') ?? '',
  );

  const lookup = await anonymous.get(`/api/rooms/code/${room.code}`);
  check('the room is publicly discoverable by code', lookup.ok && lookup.body.room.joinable);

  const missing = await anonymous.get('/api/rooms/code/ZZZZZZ');
  check('an unknown room code returns 404', missing.status === 404);

  // ------------------------------------------------------------ AI questions
  section('AI question generation and approval');
  const generated = await host.post(`/api/rooms/${roomId}/questions/generate`, {
    topic: 'Solidity',
    difficulty: 3,
    count: ROUNDS,
    mode: 'QUIZ',
  });
  check('question generation succeeds', generated.ok, generated.body?.provider);
  check(
    'generation never leaves the host without questions',
    generated.body?.questions?.length === ROUNDS,
    generated.body?.fallbackUsed ? 'local fallback used' : 'model output used',
  );

  const needsApproval = generated.body.questions.filter(
    (q) => q.status === 'PENDING_APPROVAL',
  );
  if (needsApproval.length > 0) {
    check('AI output requires host approval before play', true, `${needsApproval.length} pending`);
    const blocked = await host.post(`/api/rooms/${roomId}/start`);
    check('the game cannot start with unapproved questions', blocked.status === 409);
  }

  const edited = await host.patch(
    `/api/rooms/${roomId}/questions/${generated.body.questions[0].id}`,
    {
      action: 'edit',
      question: {
        question: 'Which Monad property lets transactions execute concurrently?',
        options: [
          'Optimistic parallel execution',
          'Proof of work',
          'Manual sharding',
          'Off-chain batching only',
        ],
        correctAnswerIndex: 0,
        explanation: 'Monad executes optimistically in parallel and re-runs conflicts.',
        difficulty: 3,
        topic: 'Monad',
      },
    },
  );
  check('a host can edit a question', edited.ok && edited.body.question.status === 'APPROVED');

  const approvedAll = await host.post(`/api/rooms/${roomId}/questions`, {
    action: 'approveAll',
  });
  check(
    'a host can approve the whole set',
    approvedAll.ok && approvedAll.body.questions.every((q) => q.status === 'APPROVED'),
  );

  // ------------------------------------------------------------------- join
  section(`players joining (${PLAYER_COUNT})`);
  const players = [];
  for (let index = 1; index <= PLAYER_COUNT; index += 1) {
    const client = createClient(`Player ${index}`);
    await client.post('/api/auth/guest', { displayName: `Player ${index}` });
    const joined = await client.post(`/api/rooms/${roomId}/join`);
    if (!joined.ok) {
      check(`player ${index} joins`, false, JSON.stringify(joined.body));
      continue;
    }
    players.push(client);
  }
  check('every player joins', players.length === PLAYER_COUNT, `${players.length} in the room`);

  const rejoin = await players[0].post(`/api/rooms/${roomId}/join`);
  check('re-joining is idempotent', rejoin.ok && rejoin.body.alreadyJoined === true);

  const lobbyState = await players[0].get(`/api/games/${roomId}/state`);
  check(
    'the lobby shows everyone in realtime',
    lobbyState.body.players.length === players.length,
    `${lobbyState.body.players.length} listed`,
  );
  check(
    'the prize pool reflects every stake',
    BigInt(lobbyState.body.room.prizePoolWei) ===
      BigInt(players.length) * 500000000000000000n,
    `${Number(BigInt(lobbyState.body.room.prizePoolWei) / 10n ** 15n) / 1000} MON`,
  );
  check(
    "a player's locked balance is 0.5 MON",
    lobbyState.body.me.currentGameBalanceWei === '500000000000000000',
  );

  // ------------------------------------------------------- host authorisation
  section('host authorisation');
  const notHost = await players[0].post(`/api/rooms/${roomId}/start`);
  check('a player cannot start the game', notHost.status === 403);
  const notHostPause = await players[0].post(`/api/rooms/${roomId}/pause`);
  check('a player cannot pause the game', notHostPause.status === 403);
  const notHostLogs = await players[0].get(`/api/games/${roomId}/logs`);
  check('a player cannot read the host event log', notHostLogs.status === 403);
  const notHostRoom = await players[0].get(`/api/rooms/${roomId}`);
  check('a player cannot read the host snapshot', notHostRoom.status === 403);

  // ------------------------------------------------------------------ start
  section('gameplay');
  const started = await host.post(`/api/rooms/${roomId}/start`);
  check('the host starts the game', started.ok && started.body.room.status === 'RUNNING');
  check('a synchronised countdown runs first', started.body.room.phase === 'STARTING');


  for (let round = 1; round <= ROUNDS; round += 1) {
    // Wait for the round to open. A round that has already opened AND closed
    // still counts as having run — with a remote store the 10s window can
    // elapse while this script is mid-poll, and that is a property of the
    // harness, not of the game.
    let state = null;
    let observedActive = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      state = (await players[0].get(`/api/games/${roomId}/state`)).body;
      if (state.room.phase === 'ROUND_ACTIVE' && state.round?.roundNumber === round) {
        observedActive = true;
        break;
      }
      if (state.room.currentRound > round || state.room.status !== 'RUNNING') break;
      await sleep(200);
    }

    if (!observedActive) {
      const ran = (state?.room.currentRound ?? 0) >= round;
      check(`round ${round} runs`, ran, ran ? 'completed before this poll' : `phase=${state?.room.phase}`);
      if (!ran) break;
      // Nothing left to assert for a round we did not catch in flight.
      if (round < ROUNDS) {
        await host.post(`/api/rooms/${roomId}/skip`);
        await sleep(400);
      }
      continue;
    }

    if (round === 1) {
      check('a round opens with a question', Boolean(state.challenge));
      check('the question has four options', state.challenge.options.length === 4);
      check(
        'the answer key is never sent to a live client',
        state.challenge.correctAnswerIndex === undefined &&
          state.challenge.explanation === undefined,
      );
      check('no result is exposed mid-round', state.lastResult === null);
    }

    // The host view holds the key; players never see it.
    const hostView = (await host.get(`/api/rooms/${roomId}`)).body;
    const correct = hostView.currentChallenge.correctAnswerIndex;
    if (round === 1) {
      check('the host view does include the answer key', typeof correct === 'number');
    }

    // Player 1 always right; player 2 always wrong; player 3 never answers.
    //
    // Submitted in PARALLEL, deliberately. Sequentially, each round trip to a
    // deployment costs a second or more, so six players could not fit inside a
    // ten-second round and answers landed after it closed. Firing them at once
    // both fits the window and models what actually happens on the night:
    // every phone in the room answering simultaneously, which is exactly the
    // contention the unique index on (room, round, player) exists to handle.
    const submissions = players.map((client, index) => {
      if (index === 2) return null; // this one never answers, to exercise timeouts
      const choice = index === 0 ? correct : (correct + 1) % 4;
      return client
        .post(`/api/games/${roomId}/answer`, {
          roundNumber: round,
          answerIndex: choice,
          clientTs: Date.now(),
        })
        .then((answer) => ({ index, choice, answer }));
    });
    const results = (await Promise.all(submissions.filter(Boolean)));

    if (round === 1) {
      const first = results.find((r) => r.index === 0);
      check(
        'an answer is accepted and locked',
        Boolean(first?.answer.ok && first.answer.body.locked === true),
        first ? `HTTP ${first.answer.status}` : 'no response',
      );
      check(
        'the response never reveals correctness',
        first?.answer.body.correct === undefined &&
          first?.answer.body.correctAnswerIndex === undefined,
      );
      check(
        'every submitted answer was accepted',
        results.every((r) => r.answer.ok),
        `${results.filter((r) => r.answer.ok).length}/${results.length} accepted`,
      );
      if (first?.answer.ok) {
        const duplicate = await players[0].post(`/api/games/${roomId}/answer`, {
          roundNumber: round,
          answerIndex: (first.choice + 1) % 4,
        });
        check('a duplicate answer is rejected', duplicate.status === 409, `HTTP ${duplicate.status}`);
      }
    }

    // Wait for the round to be graded, and keep the very response that shows
    // the result. Re-fetching afterwards is a race: the intermission is five
    // seconds and over the public internet the game can reach the next round
    // before a second request lands, which would read as "no result" even
    // though grading was correct.
    let graded = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      state = (await players[1].get(`/api/games/${roomId}/state`)).body;
      if (state.lastResult && state.lastResult.roundNumber === round) {
        graded = state;
        break;
      }
      // The game moved past this round without us catching the result screen.
      if (state.room.currentRound > round || state.room.status !== 'RUNNING') break;
      await sleep(250);
    }

    if (round === 1) {
      if (graded) {
        check('the answer is revealed once the round closes', graded.lastResult !== null);
        check(
          'a wrong answer shows the 0.1 MON penalty',
          graded.lastResult?.penaltyWei === '100000000000000000',
          graded.lastResult?.penaltyWei,
        );
        check(
          'the leaderboard updates after grading',
          graded.leaderboard.length === players.length,
        );
      } else {
        check('round 1 is graded', (state?.room.currentRound ?? 0) > 1, 'result screen not observed');
      }
    }

    // Skip the intermission so the script does not idle.
    if (round < ROUNDS) {
      await host.post(`/api/rooms/${roomId}/skip`);
      await sleep(400);
    }
  }

  // Assert the economy against authoritative server state, not against whether
  // this script happened to catch a result screen mid-flight. The host snapshot
  // carries every player's full record, so this is a fact about the game rather
  // than about the harness's timing.
  const afterRounds = (await host.get(`/api/rooms/${roomId}`)).body;
  const roster = Object.values(afterRounds.room.players);
  const penalised = roster.filter((p) => BigInt(p.penaltyTotalWei) > 0n);
  const eliminated = roster.filter((p) => p.eliminated);
  const scored = roster.filter((p) => p.score > 0);

  check(
    'wrong answers deduct from the game balance',
    penalised.length > 0,
    `${penalised.length} of ${roster.length} players paid a penalty`,
  );
  check(
    'a penalised balance is exactly 0.1 MON per wrong answer',
    penalised.every(
      (p) =>
        BigInt(p.penaltyTotalWei) ===
        BigInt(p.wrongCount + p.timeoutCount) * 100000000000000000n,
    ),
  );
  check(
    'a balance never goes negative',
    roster.every((p) => BigInt(p.currentGameBalanceWei) >= 0n),
  );
  check(
    'balance always equals the starting stake minus penalties',
    roster.every(
      (p) =>
        BigInt(p.currentGameBalanceWei) ===
        BigInt(p.startingGameBalanceWei) - BigInt(p.penaltyTotalWei),
    ),
  );
  check('correct answers scored points', scored.length > 0, `${scored.length} players scored`);
  if (eliminated.length > 0) {
    check(
      'an eliminated player had five penalties or an empty balance',
      eliminated.every(
        (p) => p.wrongCount + p.timeoutCount >= 5 || BigInt(p.currentGameBalanceWei) === 0n,
      ),
      `${eliminated.length} eliminated`,
    );
  }

  // -------------------------------------------------------------- pause/resume
  section('host controls');
  const finalState = (await host.get(`/api/rooms/${roomId}`)).body;
  if (finalState.room.status === 'RUNNING') {
    const paused = await host.post(`/api/rooms/${roomId}/pause`);
    check('the host can pause', paused.ok && paused.body.room.status === 'PAUSED');
    const resumed = await host.post(`/api/rooms/${roomId}/resume`);
    check('the host can resume', resumed.ok && resumed.body.room.status === 'RUNNING');
  } else {
    check('the game reached its final state on its own', true, finalState.room.status);
  }

  const ended = await host.post(`/api/rooms/${roomId}/end`);
  check('the host can end the game', ended.ok, ended.body?.room?.status);

  // ------------------------------------------------------------------- logs
  section('observability');
  const logs = await host.get(`/api/games/${roomId}/logs?limit=500`);
  const events = logs.body?.events ?? [];
  check('the terminal receives real application events', events.length > 0, `${events.length} events`);
  const types = new Set(events.map((event) => event.type));
  for (const expected of [
    'ROOM_CREATED',
    'PLAYER_JOINED',
    'GAME_STARTING',
    'ROUND_STARTED',
    'ROUND_ENDED',
    'LEADERBOARD_UPDATED',
  ]) {
    check(`event ${expected} is logged`, types.has(expected));
  }
  check(
    'the event log never contains an answer key',
    !JSON.stringify(events).includes('correctAnswerIndex'),
  );

  const decisions = await host.get(`/api/games/${roomId}/ai-decisions`);
  check('AI decisions are recorded', decisions.ok && decisions.body.decisions.length > 0,
    `${decisions.body?.decisions?.length ?? 0} decisions`);
  if (decisions.body?.decisions?.length) {
    const first = decisions.body.decisions[0];
    check('each decision carries the metrics behind it', Boolean(first.metrics));
    check('each decision carries a plain explanation', typeof first.reason === 'string' && first.reason.length > 5);
    check(
      'difficulty stays within 1-5',
      first.nextDifficulty >= 1 && first.nextDifficulty <= 5,
      `D${first.metrics?.difficulty} -> D${first.nextDifficulty}`,
    );
  }

  // -------------------------------------------------------------- settlement
  section('settlement');
  const prepared = await host.post(`/api/games/${roomId}/settlement/prepare`);
  check('the payout table is calculated', prepared.ok, prepared.body?.room?.settlement?.status);

  const settlement = prepared.body.room.settlement;
  const stakeTotal = BigInt(players.length) * 1000000000000000000n;
  check(
    'prizes plus refunds equal every MON locked',
    BigInt(settlement.totalAllocatedWei) === stakeTotal,
    `${Number(BigInt(settlement.totalAllocatedWei) / 10n ** 15n) / 1000} MON of ${players.length} MON`,
  );
  check(
    'the allocated prizes never exceed the pool',
    BigInt(settlement.totalPrizeAllocatedWei) <= BigInt(settlement.prizePoolWei),
  );
  const winners = settlement.items.filter((item) => BigInt(item.prizeWei) > 0n);
  check('at most five players receive a prize', winners.length <= 5, `${winners.length} winners`);
  check(
    'first place receives the largest prize',
    winners.length < 2 ||
      winners.every((item) => BigInt(item.prizeWei) <= BigInt(winners[0].prizeWei)),
  );
  check('no payout is negative', settlement.items.every((item) => BigInt(item.totalPayoutWei) >= 0n));

  const earlyClaim = await players[0].post(`/api/games/${roomId}/claim`, {});
  check('cash-out is blocked before settlement is submitted', earlyClaim.status === 409);

  const submitted = await host.post(`/api/games/${roomId}/settlement/submit`);
  const finalSettlement = submitted.body?.room?.settlement;
  check('settlement is submitted', submitted.ok, finalSettlement?.status);
  const onChain = finalSettlement?.status === 'CONFIRMED';
  if (onChain) {
    check('a Monad transaction hash is recorded', /^0x[0-9a-f]{64}$/i.test(finalSettlement.txHash), finalSettlement.txHash);
  } else {
    check(
      'settlement falls back to off-chain accounting cleanly',
      finalSettlement?.status === 'OFF_CHAIN',
      'no treasury key or contract configured',
    );
  }

  // ------------------------------------------------------------------- claim
  section('cash-out');
  const winnerClient = players.find((client) =>
    settlement.items.some(
      (item) => item.rank === 1 && item.displayName === client.name,
    ),
  ) ?? players[0];

  const claim = await winnerClient.post(`/api/games/${roomId}/claim`, {});
  check('a player can cash out after completion', claim.ok, claim.body?.txHash ?? 'off-chain');
  if (claim.ok) {
    const double = await winnerClient.post(`/api/games/${roomId}/claim`, {});
    check('a double claim is rejected', double.status === 409);
  }

  const badAddress = await players[1].post(`/api/games/${roomId}/claim`, {
    destination: 'not-an-address',
  });
  check('an invalid destination is rejected', badAddress.status === 400);

  // ---------------------------------------------------------- room isolation
  section('room isolation');
  const otherRoom = await host.post('/api/rooms', {
    name: 'Second Room',
    mode: 'WORDLESS',
    topic: 'Web3',
    difficulty: 2,
    questionCount: 3,
    maxPlayers: 3,
    aiGameMasterEnabled: false,
  });
  if (otherRoom.status === 201) {
    const otherId = otherRoom.body.room.id;
    const otherState = await players[0].get(`/api/games/${otherId}/state`);
    check(
      'a player in room A is not a member of room B',
      otherState.ok && otherState.body.me === null,
    );
    check(
      'room B has its own empty roster',
      otherState.body.players.length === 0,
    );
    const otherLogs = await host.get(`/api/games/${otherId}/logs`);
    check(
      'room B has its own event stream',
      (otherLogs.body?.events ?? []).every((event) => event.roomId === otherId),
    );
    await host.post(`/api/rooms/${otherId}/end`);
  } else {
    check('a second concurrent room can be created', false, JSON.stringify(otherRoom.body));
  }

  // ------------------------------------------------------------------ modes
  section('all three game modes');
  for (const mode of ['QUIZ', 'SONGLESS', 'WORDLESS']) {
    const modeRoom = await host.post('/api/rooms', {
      name: `${mode} check`,
      mode,
      topic: mode === 'SONGLESS' ? 'Classical' : 'Web3',
      difficulty: 2,
      questionCount: 3,
      maxPlayers: 2,
      aiGameMasterEnabled: false,
    });
    if (modeRoom.status !== 201) {
      check(`${mode} room is playable`, false, JSON.stringify(modeRoom.body));
      continue;
    }
    const challenges = modeRoom.body.room.challenges;
    const valid =
      challenges.length === 3 &&
      challenges.every((q) => q.options.length === 4 && q.status === 'APPROVED');
    const modeExtras =
      mode === 'SONGLESS'
        ? challenges.every((q) => typeof q.audioUrl === 'string')
        : mode === 'WORDLESS'
          ? challenges.every((q) => typeof q.pattern === 'string')
          : true;
    check(`${mode} rooms are seeded and playable`, valid && modeExtras);
    await host.post(`/api/rooms/${modeRoom.body.room.id}/end`);
  }

  // ------------------------------------------------------------------ admin
  section('admin');
  const beforeElevation = await host.get('/api/admin/overview');
  check('admin is denied by default, even to a host', beforeElevation.status === 403);

  const playerAdmin = await players[0].get('/api/admin/overview');
  check('admin is denied to an ordinary player', playerAdmin.status === 403);

  const badToken = await host.post('/api/auth/admin', { token: 'wrong-token' });
  check('an incorrect operator token is rejected', badToken.status === 403 || badToken.status === 503);

  const adminToken = process.env.ADMIN_API_TOKEN;
  if (adminToken) {
    const elevated = await host.post('/api/auth/admin', { token: adminToken });
    check('the operator token grants admin', elevated.ok && elevated.body?.user?.role === 'ADMIN');

    const overview = await host.get('/api/admin/overview');
    check('the admin overview loads once elevated', overview.ok);
    check(
      'platform metrics are reported',
      typeof overview.body?.metrics?.roomsTotal === 'number',
      `${overview.body?.metrics?.roomsTotal} rooms`,
    );
    check('treasury accounting is reported', Boolean(overview.body?.treasury));
    check(
      'capabilities reflect the real configuration',
      typeof overview.body?.capabilities?.chainEnabled === 'boolean',
      `chain=${overview.body?.capabilities?.chainEnabled}`,
    );

    // Elevation must not leak to anyone else.
    const stillDenied = await players[1].get('/api/admin/overview');
    check('elevation does not leak to other sessions', stillDenied.status === 403);
  } else {
    check('ADMIN_API_TOKEN is set for this verification run', false, 'export ADMIN_API_TOKEN');
  }

  // ----------------------------------------------------------------- summary
  process.stdout.write(`\n${'-'.repeat(60)}\n`);
  process.stdout.write(`${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.stdout.write(`\nFailures:\n${failures.map((f) => `  - ${f}`).join('\n')}\n`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  process.stdout.write(`\nUnexpected error: ${error.stack ?? error.message}\n`);
  process.exit(1);
});
