import { WEI } from '@/lib/config';

/** Absolute value of a bigint. */
export function absBig(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** Sum a list of wei strings. */
export function sumWei(values: Array<string | bigint>): bigint {
  return values.reduce<bigint>((total, value) => total + BigInt(value), 0n);
}

/**
 * Format wei as a human MON string.
 *
 * Truncates (never rounds up) so a displayed balance can never exceed the real
 * one. `decimals` defaults to 2 — the granularity the demo economy uses.
 */
export function formatMon(value: string | bigint, decimals = 2): string {
  const raw = typeof value === 'bigint' ? value : BigInt(value || '0');
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const whole = abs / WEI;
  const frac = abs % WEI;
  const fracText = frac.toString().padStart(18, '0').slice(0, decimals);
  const body = decimals > 0 ? `${whole}.${fracText}` : whole.toString();
  return negative ? `-${body}` : body;
}

/** Format with the MON suffix, e.g. `0.40 MON`. */
export function formatMonLabel(value: string | bigint, decimals = 2): string {
  return `${formatMon(value, decimals)} MON`;
}

/** `0x1234…abcd` — safe for dense leaderboards and terminal lines. */
export function shortAddress(address: string | null | undefined, size = 4): string {
  if (!address) return '—';
  if (address.length <= size * 2 + 2) return address;
  return `${address.slice(0, 2 + size)}…${address.slice(-size)}`;
}
