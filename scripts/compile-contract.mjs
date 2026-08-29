/**
 * Compiles contracts/BlitzPlaySettlement.sol with solc-js.
 *
 * Emits contracts/out/BlitzPlaySettlement.json containing the ABI and bytecode,
 * which is what the deploy script and the runtime chain client read. Using
 * solc-js avoids requiring a native Foundry install on the demo machine.
 *
 * Run: npm run contract:build
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const solc = require('solc');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SOURCE = join(ROOT, 'contracts', 'BlitzPlaySettlement.sol');
const OUT_DIR = join(ROOT, 'contracts', 'out');

const input = {
  language: 'Solidity',
  sources: {
    'BlitzPlaySettlement.sol': { content: readFileSync(SOURCE, 'utf8') },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'cancun',
    outputSelection: {
      '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

const errors = (output.errors ?? []).filter((entry) => entry.severity === 'error');
for (const entry of output.errors ?? []) {
  console.log(`${entry.severity}: ${entry.formattedMessage ?? entry.message}`);
}
if (errors.length > 0) {
  console.error(`\nCompilation failed with ${errors.length} error(s).`);
  process.exit(1);
}

const artifact = output.contracts['BlitzPlaySettlement.sol'].BlitzPlaySettlement;
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  join(OUT_DIR, 'BlitzPlaySettlement.json'),
  `${JSON.stringify(
    {
      contractName: 'BlitzPlaySettlement',
      compiler: solc.version(),
      abi: artifact.abi,
      bytecode: `0x${artifact.evm.bytecode.object}`,
      deployedBytecode: `0x${artifact.evm.deployedBytecode.object}`,
    },
    null,
    2,
  )}\n`,
);

const sizeKb = (artifact.evm.deployedBytecode.object.length / 2 / 1024).toFixed(2);
console.log(`compiled with ${solc.version()}`);
console.log(`deployed size: ${sizeKb} KB`);
console.log(`artifact: contracts/out/BlitzPlaySettlement.json`);
