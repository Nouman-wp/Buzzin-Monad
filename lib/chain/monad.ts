import { defineChain } from 'viem';
import { chainConfig } from '@/lib/config';

/**
 * Monad chain definition, driven entirely by environment values so the same
 * build can target testnet or another Monad network without a code change.
 *
 * Defaults match the official Monad testnet parameters:
 *   chain id 10143, RPC https://testnet-rpc.monad.xyz, native token MON.
 */
export const monadChain = defineChain({
  id: chainConfig.chainId,
  name: chainConfig.networkName,
  nativeCurrency: { name: 'Monad', symbol: chainConfig.currencySymbol, decimals: 18 },
  rpcUrls: {
    default: { http: [chainConfig.rpcUrl] },
  },
  blockExplorers: {
    default: { name: 'Monad Explorer', url: chainConfig.explorerUrl },
  },
  testnet: chainConfig.chainId !== 143,
});

export function explorerTxUrl(hash: string): string {
  return `${chainConfig.explorerUrl.replace(/\/$/, '')}/tx/${hash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${chainConfig.explorerUrl.replace(/\/$/, '')}/address/${address}`;
}
