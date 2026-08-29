/**
 * Pull an EVM address out of whatever a QR code actually encoded.
 *
 * Wallets are inconsistent about this. Some encode the bare address, some an
 * EIP-681 payment URI (`ethereum:0x…@10143`), some a block-explorer URL, and
 * some wrap the address in a `?value=` query. All of them are common enough in
 * the wild that refusing anything but a bare address would make the scanner
 * look broken, so the first 0x-prefixed 40-hex run wins.
 *
 * Deliberately separate from the scanner component: this is the part that can
 * be silently wrong, and it is the part worth testing without a camera.
 */

const ADDRESS = /0x[a-fA-F0-9]{40}/;

export function addressFromScan(raw: string): string | null {
  // A 42-hex run would mean the code carried something longer that merely
  // starts like an address — a transaction hash, say — and taking its first 40
  // characters would produce a plausible-looking address that belongs to
  // nobody. Better to decline than to send money into the void.
  const match = raw.match(ADDRESS);
  if (!match) return null;
  const end = (match.index ?? 0) + match[0].length;
  if (/[a-fA-F0-9]/.test(raw.charAt(end))) return null;
  return match[0];
}
