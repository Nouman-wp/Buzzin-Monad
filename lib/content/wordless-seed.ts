import type { Challenge } from '@/lib/types';

type Seed = Omit<Challenge, 'id' | 'gameType' | 'source' | 'status'>;

/**
 * Wordless: a clue plus a masked letter pattern, answered from four candidate
 * words. It reuses the shared round engine unchanged — same 10 second window,
 * same scoring, same penalties — so no mode-specific game logic is needed.
 *
 * `pattern` shows the answer length only. It is a real hint without leaking a
 * single letter, so the answer key never reaches the device before grading.
 */
function mask(word: string): string {
  return `${'▢ '.repeat(word.length).trim()}  ${word.length}`;
}

const RAW: Array<{
  clue: string;
  answer: string;
  decoys: [string, string, string];
  difficulty: number;
  topic: string;
  explanation: string;
}> = [
  { clue: 'The fee you pay to run a transaction', answer: 'GAS', decoys: ['TAX', 'BID', 'FEE'], difficulty: 1, topic: 'Web3 Basics', explanation: 'Gas is the unit that meters and prices EVM computation.' },
  { clue: 'A group of transactions added to the chain together', answer: 'BLOCK', decoys: ['BATCH', 'STACK', 'CHUNK'], difficulty: 1, topic: 'Web3 Basics', explanation: 'Transactions are committed to the chain one block at a time.' },
  { clue: 'Secret value that controls an account', answer: 'KEY', decoys: ['PIN', 'TAG', 'HEX'], difficulty: 1, topic: 'Wallets', explanation: 'The private key is the only thing that authorises spending from an account.' },
  { clue: 'Software that stores your keys and signs transactions', answer: 'WALLET', decoys: ['LEDGER', 'VAULT', 'LOCKER'], difficulty: 1, topic: 'Wallets', explanation: 'A wallet manages keys and produces signatures; it does not hold tokens itself.' },
  { clue: 'Self-executing code deployed on a chain', answer: 'CONTRACT', decoys: ['PROTOCOL', 'FUNCTION', 'DATABASE'], difficulty: 2, topic: 'Solidity', explanation: 'A smart contract is program code with its own address and storage.' },
  { clue: 'Counter that orders each account transaction', answer: 'NONCE', decoys: ['INDEX', 'STAMP', 'TOKEN'], difficulty: 3, topic: 'Ethereum', explanation: 'The nonce increments per transaction and blocks replays.' },
  { clue: 'Log record emitted by a contract', answer: 'EVENT', decoys: ['TRACE', 'ALERT', 'ENTRY'], difficulty: 2, topic: 'Solidity', explanation: 'Events write cheap indexed logs that off-chain services can follow.' },
  { clue: 'Putting up tokens to help secure a network', answer: 'STAKING', decoys: ['MINTING', 'BURNING', 'BRIDGING'], difficulty: 2, topic: 'Layer 1s', explanation: 'Validators stake tokens as collateral against misbehaviour.' },
  { clue: 'Permanently removing tokens from supply', answer: 'BURN', decoys: ['MINT', 'LOCK', 'SWAP'], difficulty: 2, topic: 'DeFi', explanation: 'Burning sends tokens somewhere unspendable, shrinking supply.' },
  { clue: 'Creating brand new tokens', answer: 'MINT', decoys: ['BURN', 'FORK', 'SIGN'], difficulty: 1, topic: 'NFTs', explanation: 'Minting issues a new token and assigns its first owner.' },
  { clue: 'Pool of funds traders swap against', answer: 'LIQUIDITY', decoys: ['TREASURY', 'COLLATERAL', 'RESERVOIR'], difficulty: 3, topic: 'DeFi', explanation: 'Liquidity providers deposit pairs of assets that an AMM prices against.' },
  { clue: 'Moving assets between two chains', answer: 'BRIDGE', decoys: ['TUNNEL', 'ROUTER', 'PORTAL'], difficulty: 2, topic: 'Layer 2s', explanation: 'A bridge locks assets on one chain and represents them on another.' },
  { clue: 'Attack where a contract calls back before state updates', answer: 'REENTRANCY', decoys: ['OVERFLOW', 'FRONTRUN', 'REPLAY'], difficulty: 4, topic: 'Smart Contract Security', explanation: 'Reentrancy exploits an external call made before internal state is written.' },
  { clue: 'Ordering your transaction ahead of someone else for profit', answer: 'FRONTRUNNING', decoys: ['BACKSTOPPING', 'REBALANCING', 'OVERCLOCKING'], difficulty: 4, topic: 'Smart Contract Security', explanation: 'Observing the mempool lets a searcher place a transaction ahead of a known trade.' },
  { clue: 'Point after which a transaction cannot be reversed', answer: 'FINALITY', decoys: ['DURABILITY', 'CONSENSUS', 'SETTLEMENT'], difficulty: 3, topic: 'Layer 1s', explanation: 'Finality is the guarantee against reorganisation.' },
  { clue: 'Guessing-free fixed-length output of a one-way function', answer: 'HASH', decoys: ['SALT', 'SEED', 'CODE'], difficulty: 2, topic: 'Web3 Basics', explanation: 'A hash is a deterministic fixed-size digest of arbitrary input.' },
  { clue: 'Interface standard for fungible tokens', answer: 'ERC20', decoys: ['ERC721', 'ERC1155', 'ERC4337'], difficulty: 2, topic: 'DeFi', explanation: 'ERC-20 is the fungible token interface every exchange understands.' },
  { clue: 'Machine that runs contract bytecode', answer: 'EVM', decoys: ['JVM', 'VMM', 'CPU'], difficulty: 1, topic: 'Ethereum', explanation: 'The EVM is the deterministic execution environment for Ethereum-style chains.' },
  { clue: 'Network used for free testing with valueless tokens', answer: 'TESTNET', decoys: ['MAINNET', 'DEVCHAIN', 'SIDENET'], difficulty: 1, topic: 'Web3 Basics', explanation: 'A testnet mirrors mainnet behaviour without real economic value.' },
  { clue: 'Service that hands out free test tokens', answer: 'FAUCET', decoys: ['HYDRANT', 'SPIGOT', 'FOUNTAIN'], difficulty: 1, topic: 'Web3 Basics', explanation: 'A faucet drips testnet tokens to developers.' },
  { clue: 'Endpoint your app talks to when reading the chain', answer: 'RPC', decoys: ['API', 'SDK', 'CDN'], difficulty: 2, topic: 'Web3 Basics', explanation: 'JSON-RPC is the standard transport for querying and submitting to a node.' },
  { clue: 'Loss a liquidity provider takes when pool prices diverge', answer: 'IMPERMANENT', decoys: ['IRREVERSIBLE', 'INTERMITTENT', 'INSTITUTIONAL'], difficulty: 4, topic: 'DeFi', explanation: 'Impermanent loss is the gap between providing liquidity and simply holding.' },
  { clue: 'Splitting a chain into two incompatible versions', answer: 'FORK', decoys: ['MERGE', 'SHARD', 'PATCH'], difficulty: 2, topic: 'Layer 1s', explanation: 'A hard fork produces rules that older nodes will not accept.' },
  { clue: 'Human-readable name that resolves to an address', answer: 'ENS', decoys: ['DNS', 'URI', 'UID'], difficulty: 3, topic: 'Web3 Basics', explanation: 'Naming services map friendly names onto raw addresses.' },
  { clue: 'Penalty burning part of a misbehaving validator stake', answer: 'SLASHING', decoys: ['FREEZING', 'THROTTLE', 'CLAWBACK'], difficulty: 3, topic: 'Layer 1s', explanation: 'Slashing makes provable misbehaviour economically irrational.' },
  { clue: 'Layer 1 built for parallel EVM execution', answer: 'MONAD', decoys: ['NOMAD', 'MODAL', 'MONAT'], difficulty: 2, topic: 'Monad', explanation: 'Monad executes EVM transactions optimistically in parallel.' },
  { clue: 'Data region holding the arguments of a call', answer: 'CALLDATA', decoys: ['MEMORYMAP', 'STACKTOP', 'HEAPZONE'], difficulty: 4, topic: 'Solidity', explanation: 'Calldata is the read-only input buffer of a message call.' },
  { clue: 'Withdrawing what you are owed yourself, rather than being paid', answer: 'CLAIM', decoys: ['CLEAR', 'CHARGE', 'CREDIT'], difficulty: 2, topic: 'Smart Contract Security', explanation: 'Pull payments have each recipient claim, so one failure cannot block everyone.' },
];

function shuffleDeterministic<T>(items: T[], seed: number): T[] {
  // Small LCG so option order is stable per challenge but not always A-first.
  const output = items.slice();
  let state = (seed * 1103515245 + 12345) >>> 0;
  for (let i = output.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    const j = state % (i + 1);
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

export const WORDLESS_SEED: Seed[] = RAW.map((entry, index) => {
  const options = shuffleDeterministic([entry.answer, ...entry.decoys], index + 7);
  return {
    question: entry.clue,
    options,
    correctAnswerIndex: options.indexOf(entry.answer),
    difficulty: entry.difficulty,
    topic: entry.topic,
    explanation: entry.explanation,
    pattern: mask(entry.answer),
  };
});

export const WORDLESS_TOPICS = Array.from(new Set(RAW.map((entry) => entry.topic))).sort();
