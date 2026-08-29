import { randomBytes, randomUUID } from 'node:crypto';

/** Ambiguous glyphs (0/O, 1/I/L) removed so room codes survive being read aloud. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * Six-character room code with ~30 bits of entropy — enough that codes cannot
 * be usefully enumerated during a live event.
 */
export function newRoomCode(length = 6): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/** Normalises user-typed codes (lowercase, spaces, dashes). */
export function normaliseRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('hex');
}
