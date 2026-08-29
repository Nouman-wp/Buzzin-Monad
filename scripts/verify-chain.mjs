/**
 * Live on-chain verification of the settlement contract.
 *
 * Runs the exact lifecycle a finished game triggers — create+fund, register,
 * finalize, claim — against the deployed contract on Monad testnet, then
 * asserts the guarantees that matter: a double claim reverts, an
 * over-allocation reverts, and the money actually lands in the destination.
 *
 * Uses tiny amounts (~0.005 MON total) so it is safe to run before a demo.
 *
 * Run: node scripts/verify-chain.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  keccak256,
  parseEther,
  toHex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
loadEnvFile(join(ROOT, '.env.local'));

const abi = JSON.parse(
  readFileSync(join(ROOT, 'contracts', 'out', 'BlitzPlaySettlement.json'), 'utf8'),
).abi;

const rpcUrl = process.env.NEXT_PUBLIC_MONAD_RPC_URL;
const chainId = Number(process.env.NEXT_PUBLIC_MONAD_CHAIN_ID || 10143);
const contract = process.env.NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS;
const rawKey = (process.env.TREASURY_PRIVATE_KEY || '').trim();

if (!contract || !rawKey) {
  console.error('Set NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS and TREASURY_PRIVATE_KEY.');
  process.exit(1);
}

const chain = defineChain({
  id: chainId,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  testnet: true,
});

const account = privateKeyToAccount(rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

let passed = 0;
let failed = 0;

function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function send(functionName, args, value = 0n) {
  const hash = await wallet.writeContract({ address: contract, abi, functionName, args, value });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== 'success') throw new Error(`${functionName} reverted`);
  return hash;
}

async function expectRevert(label, functionName, args, value = 0n) {
  try {
    await publicClient.simulateContract({
      address: contract,
      abi,
      functionName,
      args,
      value,
      account,
    });
    check(label, false, 'call succeeded when it should have reverted');
  } catch (error) {
    const reason = error.shortMessage ?? error.message;
    check(label, true, reason.split('\n')[0].slice(0, 60));
  }
}

// Two throwaway addresses stand in for player embedded wallets.
const winner = privateKeyToAccount(generatePrivateKey()).address;
const runnerUp = privateKeyToAccount(generatePrivateKey()).address;

// A unique game id per run, so re-running never collides with a prior test.
const gameId = keccak256(toHex(`blitzplay:verify:${Date.now()}:${winner}`));

const WINNER_PRIZE = parseEther('0.003');
const RUNNER_PRIZE = parseEther('0.001');
const FUNDING = WINNER_PRIZE + RUNNER_PRIZE;

console.log(`\nBlitzPlaySettlement live verification`);
console.log(`contract  ${contract}`);
console.log(`operator  ${account.address}`);
console.log(`gameId    ${gameId}\n`);

try {
  console.log('createGame + fund');
  await send('createGame', [gameId, 25n], FUNDING);
  let game = await publicClient.readContract({
    address: contract,
    abi,
    functionName: 'getGame',
    args: [gameId],
  });
  check('game exists after creation', game[0] === true);
  check('escrow holds the funded amount', game[2] === FUNDING, `${formatEther(game[2])} MON`);
  check('game is not finalized yet', game[1] === false);

  console.log('\nduplicate createGame');
  await expectRevert('a second createGame reverts', 'createGame', [gameId, 25n], 0n);

  console.log('\nregisterPlayers');
  await send('registerPlayers', [gameId, [winner, runnerUp]]);
  check('participants recorded', true);

  console.log('\nover-allocation guard');
  await expectRevert(
    'finalizing above the escrow reverts',
    'finalizeGame',
    [gameId, [winner], [FUNDING + parseEther('1')]],
  );

  console.log('\nclaim before finalize');
  await expectRevert('claiming before finalize reverts', 'claimFor', [gameId, winner, winner]);

  console.log('\nfinalizeGame');
  await send('finalizeGame', [gameId, [winner, runnerUp], [WINNER_PRIZE, RUNNER_PRIZE]]);
  game = await publicClient.readContract({
    address: contract,
    abi,
    functionName: 'getGame',
    args: [gameId],
  });
  check('game is finalized', game[1] === true);
  check('allocation matches the payout table', game[3] === FUNDING, `${formatEther(game[3])} MON`);

  const entitlement = await publicClient.readContract({
    address: contract,
    abi,
    functionName: 'entitlementOf',
    args: [gameId, winner],
  });
  check('winner entitlement is exact', entitlement === WINNER_PRIZE, `${formatEther(entitlement)} MON`);

  console.log('\nduplicate finalize');
  await expectRevert(
    'a second finalize reverts',
    'finalizeGame',
    [gameId, [winner], [WINNER_PRIZE]],
  );

  console.log('\nclaimFor (operator-sponsored, embedded wallet has no gas)');
  const before = await publicClient.getBalance({ address: winner });
  await send('claimFor', [gameId, winner, winner]);
  const after = await publicClient.getBalance({ address: winner });
  check('funds landed in the destination', after - before === WINNER_PRIZE, `+${formatEther(after - before)} MON`);

  const claimed = await publicClient.readContract({
    address: contract,
    abi,
    functionName: 'hasClaimed',
    args: [gameId, winner],
  });
  check('claim is recorded', claimed === true);

  console.log('\ndouble-claim guard');
  await expectRevert('a second claim reverts', 'claimFor', [gameId, winner, winner]);

  console.log('\nnon-participant guard');
  const stranger = privateKeyToAccount(generatePrivateKey()).address;
  await expectRevert('a stranger with no entitlement reverts', 'claimFor', [
    gameId,
    stranger,
    stranger,
  ]);

  game = await publicClient.readContract({
    address: contract,
    abi,
    functionName: 'getGame',
    args: [gameId],
  });
  check('paid never exceeds allocated', game[4] <= game[3], `${formatEther(game[4])} of ${formatEther(game[3])} MON`);
} catch (error) {
  failed += 1;
  console.error(`\nUnexpected failure: ${error.shortMessage ?? error.message}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
