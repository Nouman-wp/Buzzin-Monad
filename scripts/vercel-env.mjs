/**
 * Push the local environment into a Vercel project.
 *
 * Reads `.env.local` (which is gitignored and never committed) and sets every
 * non-empty variable on the chosen Vercel environment. Idempotent: an existing
 * variable is replaced rather than duplicated.
 *
 * Secrets are passed to the Vercel CLI over stdin, never as argv, so they do
 * not land in the process list or your shell history.
 *
 * Usage:
 *   node scripts/vercel-env.mjs                 # production (default)
 *   node scripts/vercel-env.mjs preview
 *   node scripts/vercel-env.mjs production --dry-run
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, '.env.local');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = args.find((a) => !a.startsWith('--')) ?? 'production';

if (!['production', 'preview', 'development'].includes(target)) {
  console.error(`Unknown environment "${target}".`);
  process.exit(1);
}

if (!existsSync(ENV_FILE)) {
  console.error('.env.local not found. Copy .env.example and fill it in first.');
  process.exit(1);
}

/**
 * Variables that must never be shipped to a deployment, either because they
 * are machine-local or because the deployed value has to differ.
 */
const SKIP = new Set([
  // Managed by Vercel itself and injected per-deployment; setting it as a
  // project variable pins a token that is meant to rotate.
  'VERCEL_OIDC_TOKEN',
]);

/** Values that are meaningless in a deployment and are better left unset. */
const LOCAL_ONLY_VALUES = [/^http:\/\/localhost/i];

function parseEnv(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.push([key, value]);
  }
  return out;
}

/** Never print a secret in full. */
function mask(key, value) {
  const isPublic = key.startsWith('NEXT_PUBLIC_') || key.startsWith('DEMO_') ||
    key.startsWith('DEFAULT_') || ['AI_PROVIDER', 'AI_MODEL', 'WRONG_ANSWER_PENALTY', 'MAX_WRONG_ANSWERS'].includes(key);
  if (isPublic) return value.length > 46 ? `${value.slice(0, 43)}…` : value;
  return `${'•'.repeat(Math.min(12, value.length))} (${value.length} chars)`;
}

function vercel(argv, input) {
  return spawnSync('vercel', argv, {
    input,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    cwd: ROOT,
  });
}

const entries = parseEnv(readFileSync(ENV_FILE, 'utf8'));
const applied = [];
const skipped = [];

console.log(`\nTarget environment: ${target}${dryRun ? '  (dry run)' : ''}\n`);

for (const [key, value] of entries) {
  if (!value) {
    skipped.push([key, 'empty']);
    continue;
  }
  if (SKIP.has(key)) {
    skipped.push([key, 'local only']);
    continue;
  }
  if (LOCAL_ONLY_VALUES.some((re) => re.test(value))) {
    skipped.push([key, 'localhost value — set this after the first deploy']);
    continue;
  }

  if (dryRun) {
    console.log(`  would set  ${key.padEnd(40)} ${mask(key, value)}`);
    applied.push(key);
    continue;
  }

  // Replace rather than duplicate. A missing variable makes rm fail, which is
  // fine and expected on a first run.
  vercel(['env', 'rm', key, target, '--yes'], '');
  const result = vercel(['env', 'add', key, target], `${value}\n`);

  if (result.status === 0) {
    console.log(`  set        ${key.padEnd(40)} ${mask(key, value)}`);
    applied.push(key);
  } else {
    const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(-2).join(' ');
    console.log(`  FAILED     ${key.padEnd(40)} ${detail.slice(0, 90)}`);
  }
}

console.log(`\n${applied.length} variable(s) ${dryRun ? 'would be set' : 'set'} on ${target}.`);

if (skipped.length > 0) {
  console.log('\nSkipped:');
  for (const [key, why] of skipped) console.log(`  ${key.padEnd(40)} ${why}`);
}

console.log(
  `\nNext: deploy, then set NEXT_PUBLIC_APP_URL to the real URL and redeploy —\n` +
    `QR codes and join links are built from it.\n`,
);
