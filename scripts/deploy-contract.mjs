/**
 * Deploys BlitzPlaySettlement to the configured Monad network.
 *
 * Reads TREASURY_PRIVATE_KEY from the environment (never from a file that is
 * committed) and sets that account as the contract operator. Prints the
 * address to put in NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS.
 *
 * Run: npm run contract:deploy
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, formatEther, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

loadEnvFile(join(ROOT, '.env.local'));

const ARTIFACT = join(ROOT, 'contracts', 'out', 'BlitzPlaySettlement.json');
if (!existsSync(ARTIFACT)) {
  console.error('Artifact missing. Run `npm run contract:build` first.');
  process.exit(1);
}

const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8'));

const rpcUrl = process.env.NEXT_PUBLIC_MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz';
const chainId = Number(process.env.NEXT_PUBLIC_MONAD_CHAIN_ID || 10143);
const explorer =
  process.env.NEXT_PUBLIC_MONAD_EXPLORER_URL || 'https://testnet.monadvision.com';

const rawKey = (process.env.TREASURY_PRIVATE_KEY || '').trim();
if (!rawKey) {
  console.error('TREASURY_PRIVATE_KEY is not set. Add it to .env.local.');
  process.exit(1);
}
const privateKey = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error('TREASURY_PRIVATE_KEY is not a valid 32-byte hex key.');
  process.exit(1);
}

const chain = defineChain({
  id: chainId,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: 'Explorer', url: explorer } },
  testnet: true,
});

const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

console.log(`network   ${chain.name} (chain ${chainId})`);
console.log(`rpc       ${rpcUrl}`);
console.log(`operator  ${account.address}`);

const balance = await publicClient.getBalance({ address: account.address });
console.log(`balance   ${formatEther(balance)} MON\n`);

if (balance === 0n) {
  console.error('Operator has no MON. Fund it at https://faucet.monad.xyz first.');
  process.exit(1);
}

console.log('deploying…');
const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [account.address],
});
console.log(`tx        ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
if (receipt.status !== 'success' || !receipt.contractAddress) {
  console.error('Deployment reverted.');
  process.exit(1);
}

console.log(`\ndeployed  ${receipt.contractAddress}`);
console.log(`gas used  ${receipt.gasUsed}`);
console.log(`explorer  ${explorer.replace(/\/$/, '')}/address/${receipt.contractAddress}`);
console.log(`\nAdd this to .env.local and to your Vercel environment variables:`);
console.log(`NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS=${receipt.contractAddress}`);

/** Minimal .env parser so the script needs no extra dependency. */
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
