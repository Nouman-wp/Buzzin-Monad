import { describe, expect, it } from 'vitest';
import { addressFromScan } from '@/lib/util/scan-address';

const ADDRESS = '0x1111111111111111111111111111111111111111';

/**
 * The decoder behind the Send tab's camera scanner. Whatever a wallet chose to
 * encode, the destination field has to end up with an address the send route
 * will accept — or with nothing at all, so the sender types it themselves.
 */
describe('addressFromScan', () => {
  it('takes a bare address', () => {
    expect(addressFromScan(ADDRESS)).toBe(ADDRESS);
  });

  it('takes an EIP-681 payment URI, chain suffix and all', () => {
    expect(addressFromScan(`ethereum:${ADDRESS}@10143`)).toBe(ADDRESS);
    expect(addressFromScan(`ethereum:${ADDRESS}@10143?value=1e18`)).toBe(ADDRESS);
  });

  it('takes an address out of a block-explorer URL', () => {
    expect(addressFromScan(`https://testnet.monadexplorer.com/address/${ADDRESS}`)).toBe(ADDRESS);
  });

  it('preserves the checksum casing exactly', () => {
    // The send route compares the string it is given; re-casing it here would
    // quietly defeat any checksum validation downstream.
    expect(addressFromScan(ADDRESS)).toBe(ADDRESS);
    expect(addressFromScan(ADDRESS.toLowerCase())).toBe(ADDRESS.toLowerCase());
  });

  it('declines a transaction hash that merely starts like an address', () => {
    // 64 hex characters. Taking the first 40 would produce a well-formed
    // address belonging to nobody, which is worse than declining.
    expect(addressFromScan(`0x${'a'.repeat(64)}`)).toBeNull();
  });

  it('declines anything with no address in it', () => {
    expect(addressFromScan('')).toBeNull();
    expect(addressFromScan('https://example.com/not-a-wallet')).toBeNull();
    expect(addressFromScan('0x1234')).toBeNull();
  });
});
