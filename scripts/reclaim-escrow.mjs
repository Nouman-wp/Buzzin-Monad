/**
 * Reclaim testnet MON stranded in the settlement contract.
 *
 * Every rehearsal escrows one full payout table and most throwaway players
 * never cash out, so their entitlements sit in the contract forever — the
 * operator deliberately cannot claw back player funds, because that same power
 * would let it take from real players.
 *
 * The escape hatch the contract does allow is `claimFor`, which pays a player's
 * entitlement out to a destination. This script uses it to send unclaimed
 * *test* payouts back to the treasury.
 *
 * Safety rails, all of them deliberate:
 *
 *   - Guest identities only. Anything signed in with Google is a real person
 *     and is skipped, always. There is no flag to override that.
 *   - The destination is always the treasury address. It is never taken from
 *     an argument.
 *   - Dry run unless --confirm is passed.
 *   - Claims run one at a time: they are treasury-signed transactions from a
 *     single account, and firing them concurrently races the nonce.
 *   - Supabase is updated after each success, so the app's own view of what is
 *     claimable stays true and a later cash-out cannot revert on chain.
 *
 * Usage:
 *   node scripts/reclaim-escrow.mjs             # report only
 *   node scripts/reclaim-escrow.mjs --confirm   # actually send
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
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
loadEnvFile(join(ROOT, '.env.local'));

const confirm = process.argv.includes('--confirm');

const rpcUrl = process.env.NEXT_PUBLIC_MONAD_RPC_URL;
const chainId = Number(process.env.NEXT_PUBLIC_MONAD_CHAIN_ID || 10143);
const contract = (process.env.NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS || '').trim();
const rawKey = (process.env.TREASURY_PRIVATE_KEY || '').trim();
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!contract || !rawKey || !supabaseUrl || !serviceKey) {
  console.error('Needs the contract address, treasury key and Supabase credentials in .env.local.');
  process.exit(1);
}

const abi = JSON.parse(
  readFileSync(join(ROOT, 'contracts', 'out', 'BlitzPlaySettlement.json'), 'utf8'),
).abi;

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

// Keeps the pre-BuzzIn prefix: it must match lib/chain/client.ts exactly, and
// it is hashed into ids the live contract already stores.
const gameIdFor = (roomId) => keccak256(toHex(`blitzplay:${roomId}`));

async function supabase(path, init = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 160)}`);
  }
  return response.status === 204 ? null : response.json();
}

console.log(`\nReclaim stranded escrow${confirm ? '' : '  (dry run — pass --confirm to send)'}`);
console.log(`contract  ${contract}`);
console.log(`treasury  ${account.address}\n`);

const before = await publicClient.getBalance({ address: account.address });
const escrowBefore = await publicClient.getBalance({ address: contract });

const rooms = await supabase('rooms?select=id,version,state');

/** Every unclaimed guest payout, flattened. */
const targets = [];
let skippedReal = 0;

for (const room of rooms) {
  const settlement = room.state?.settlement;
  if (!settlement || settlement.status !== 'CONFIRMED') continue;
  for (const item of settlement.items ?? []) {
    const amount = BigInt(item.totalPayoutWei || 0);
    if (item.claimed || amount <= 0n) continue;
    if (!item.playerId.startsWith('guest:')) {
      skippedReal += 1;
      continue;
    }
    targets.push({ room, item, amount });
  }
}

const total = targets.reduce((sum, t) => sum + t.amount, 0n);
console.log(`unclaimed guest payouts : ${targets.length} across ${new Set(targets.map((t) => t.room.id)).size} rooms`);
console.log(`recoverable             : ${formatEther(total)} MON`);
if (skippedReal > 0) console.log(`skipped (real accounts) : ${skippedReal}`);
console.log(`treasury balance now    : ${formatEther(before)} MON`);
console.log(`contract holds now      : ${formatEther(escrowBefore)} MON\n`);

if (!confirm) {
  console.log('Dry run. Re-run with --confirm to send these claims.\n');
  process.exit(0);
}

let recovered = 0n;
let ok = 0;
let failed = 0;
let alreadyClaimed = 0;

for (const [index, { room, item, amount }] of targets.entries()) {
  const label = `${String(index + 1).padStart(3)}/${targets.length}  ${item.displayName.padEnd(10)} ${formatEther(amount).padStart(8)} MON`;
  const gameId = gameIdFor(room.id);

  try {
    // The contract is the authority on whether this is still owed.
    const claimed = await publicClient.readContract({
      address: contract,
      abi,
      functionName: 'hasClaimed',
      args: [gameId, item.walletAddress],
    });
    if (claimed) {
      alreadyClaimed += 1;
      console.log(`${label}  already claimed on chain — marking locally`);
      await markClaimed(room, item, null);
      continue;
    }

    const hash = await wallet.writeContract({
      address: contract,
      abi,
      functionName: 'claimFor',
      args: [gameId, item.walletAddress, account.address],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== 'success') throw new Error('transaction reverted');

    await markClaimed(room, item, hash);
    recovered += amount;
    ok += 1;
    console.log(`${label}  ok`);
  } catch (error) {
    failed += 1;
    console.log(`${label}  FAILED  ${(error.shortMessage ?? error.message).split('\n')[0].slice(0, 70)}`);
  }
}

const after = await publicClient.getBalance({ address: account.address });
const escrowAfter = await publicClient.getBalance({ address: contract });

console.log(`\n${'-'.repeat(60)}`);
console.log(`claimed        : ${ok}`);
if (alreadyClaimed > 0) console.log(`already claimed: ${alreadyClaimed}`);
if (failed > 0) console.log(`failed         : ${failed}`);
console.log(`recovered      : ${formatEther(recovered)} MON`);
console.log(`treasury       : ${formatEther(before)} -> ${formatEther(after)} MON`);
console.log(`contract       : ${formatEther(escrowBefore)} -> ${formatEther(escrowAfter)} MON\n`);

/** Mark one settlement item claimed in the room document. */
async function markClaimed(room, item, hash) {
  const state = room.state;
  const entry = state.settlement.items.find((candidate) => candidate.playerId === item.playerId);
  if (!entry) return;
  entry.claimed = true;
  entry.claimedTo = account.address;
  entry.claimTxHash = hash;
  room.version += 1;
  await supabase(`rooms?id=eq.${encodeURIComponent(room.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ state, version: room.version }),
  });
}

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
