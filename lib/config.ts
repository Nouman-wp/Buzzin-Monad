/**
 * Central runtime configuration.
 *
 * Every value is read from the environment with a safe demo default so the app
 * boots and is fully playable with an empty `.env`. Server-only secrets are
 * never referenced from files that run in the browser.
 */

const num = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (raw: string | undefined, fallback: boolean): boolean => {
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
};

/** 1 MON expressed in wei. */
export const WEI = 10n ** 18n;

/** Convert a decimal MON amount (e.g. "0.1") to wei without float drift. */
export function monToWei(amount: string | number): bigint {
  const text = typeof amount === 'number' ? amount.toString() : amount.trim();
  const negative = text.startsWith('-');
  const clean = negative ? text.slice(1) : text;
  const [whole = '0', frac = ''] = clean.split('.');
  const padded = (frac + '0'.repeat(18)).slice(0, 18);
  const value = BigInt(whole || '0') * WEI + BigInt(padded || '0');
  return negative ? -value : value;
}

export const economy = {
  /** Total MON reserved for the whole demo, in wei. */
  totalTreasuryWei: monToWei(process.env.DEMO_TOTAL_TREASURY ?? '25'),
  /** Full allocation handed to each player on join. */
  playerAllocationWei: monToWei(process.env.DEFAULT_PLAYER_ALLOCATION ?? '1'),
  /** Half of the allocation that becomes the player's locked game balance. */
  startingGameBalanceWei: monToWei(process.env.DEFAULT_GAME_BALANCE ?? '0.5'),
  /** Half of the allocation that seeds the room prize pool. */
  prizePoolContributionWei: monToWei(process.env.DEFAULT_PRIZE_POOL_ALLOCATION ?? '0.5'),
  /** Charged for every wrong answer or timeout. */
  penaltyWei: monToWei(process.env.WRONG_ANSWER_PENALTY ?? '0.1'),
  /** Penalties before elimination. */
  maxWrongAnswers: num(process.env.MAX_WRONG_ANSWERS, 5),
  /** Default player cap for a new room. */
  defaultRoomCap: num(process.env.DEFAULT_ROOM_CAP, 25),
} as const;

export const gameRules = {
  /** Answer window per round in milliseconds. */
  roundDurationMs: 10_000,
  /** Result screen shown between rounds. */
  intermissionMs: 5_000,
  /** Synchronised countdown before round 1. */
  countdownMs: 3_000,
  /** Points for any correct answer. */
  baseScore: 100,
  /** Additional points awarded proportional to remaining time. */
  maxSpeedBonus: 50,
  /** Grace window for network latency on late submissions. */
  submissionGraceMs: 750,
  /** Wall-clock budget for a live Game Master decision. It runs after the
   *  round has already advanced, so this never delays what players see. */
  aiDecisionTimeoutMs: 4_000,
  /** Host-initiated generation can afford to wait longer. */
  aiGenerationTimeoutMs: 45_000,
  minQuestions: 3,
  maxQuestions: 30,
} as const;

export const chainConfig = {
  rpcUrl: process.env.NEXT_PUBLIC_MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz',
  chainId: num(process.env.NEXT_PUBLIC_MONAD_CHAIN_ID, 10143),
  explorerUrl:
    process.env.NEXT_PUBLIC_MONAD_EXPLORER_URL || 'https://testnet.monadvision.com',
  settlementContract: (process.env.NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS || '') as string,
  currencySymbol: 'MON',
  networkName: 'Monad Testnet',
} as const;

export const appConfig = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  demoMode: bool(process.env.DEMO_MODE, true),
} as const;

export const publicRuntimeConfig = {
  appUrl: appConfig.appUrl,
  demoMode: appConfig.demoMode,
  chain: chainConfig,
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
} as const;

/** Server-only. Never import from a `'use client'` module. */
export const serverConfig = {
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
  authSessionSecret:
    process.env.AUTH_SESSION_SECRET || 'buzzin-insecure-development-secret',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  aiProvider: (process.env.AI_PROVIDER || 'gemini').toLowerCase(),
  aiModel: process.env.AI_MODEL || 'gemini-2.0-flash',
  aiApiKey: process.env.AI_API_KEY || '',
  treasuryPrivateKey: process.env.TREASURY_PRIVATE_KEY || '',
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
  adminApiToken: process.env.ADMIN_API_TOKEN || '',
  /**
   * Pins the primary admin's in-app wallet to a real address they control,
   * instead of the server-derived one. Defaults to the treasury address so the
   * operator sees the wallet they already hold in MetaMask.
   */
  adminWalletAddress: (process.env.ADMIN_WALLET_ADDRESS || '').trim(),
} as const;

export const featureFlags = {
  googleAuthEnabled: Boolean(serverConfig.googleClientId),
  supabaseEnabled: Boolean(serverConfig.supabaseUrl && serverConfig.supabaseServiceRoleKey),
  aiEnabled: Boolean(serverConfig.aiApiKey),
  chainEnabled: Boolean(serverConfig.treasuryPrivateKey && chainConfig.settlementContract),
} as const;
