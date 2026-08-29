/**
 * Prints the treasury and settlement-contract status on the configured network.
 * Useful right before a live demo to confirm funds and wiring.
 *
 * Run: npm run treasury:status
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, defineChain, formatEther, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
loadEnvFile(join(ROOT, '.env.local'));

const rpcUrl = process.env.NEXT_PUBLIC_MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz';
const chainId = Number(process.env.NEXT_PUBLIC_MONAD_CHAIN_ID || 10143);
const explorer =
  process.env.NEXT_PUBLIC_MONAD_EXPLORER_URL || 'https://testnet.monadvision.com';
const contract = (process.env.NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS || '').trim();

const chain = defineChain({
  id: chainId,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  testnet: true,
});

const client = createPublicClient({ chain, transport: http(rpcUrl) });

console.log(`network    ${chain.name} (${chainId})`);
console.log(`rpc        ${rpcUrl}`);

try {
  const block = await client.getBlockNumber();
  console.log(`block      ${block}`);
} catch (error) {
  console.log(`block      unreachable (${error.shortMessage ?? error.message})`);
  process.exit(1);
}

const rawKey = (process.env.TREASURY_PRIVATE_KEY || '').trim();
if (rawKey) {
  const key = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
  const account = privateKeyToAccount(key);
  const balance = await client.getBalance({ address: account.address });
  const budget = Number(process.env.DEMO_TOTAL_TREASURY || 25);
  console.log(`treasury   ${account.address}`);
  console.log(`balance    ${formatEther(balance)} MON`);
  console.log(`budget     ${budget} MON`);
  if (balance < BigInt(budget) * 10n ** 18n) {
    console.log(`\n! Balance is below the configured demo budget of ${budget} MON.`);
    console.log('  Top up at https://faucet.monad.xyz or lower DEMO_TOTAL_TREASURY.');
  }
} else {
  console.log('treasury   not configured (settlement will run off-chain)');
}

if (contract) {
  const code = await client.getCode({ address: contract });
  const deployed = Boolean(code && code !== '0x');
  console.log(`contract   ${contract} ${deployed ? '(deployed)' : '(NO CODE AT ADDRESS)'}`);
  console.log(`explorer   ${explorer.replace(/\/$/, '')}/address/${contract}`);
} else {
  console.log('contract   not configured (settlement will run off-chain)');
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
