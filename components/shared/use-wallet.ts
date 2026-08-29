'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Browser wallet connection — MetaMask and anything else that speaks EIP-1193.
 *
 * This is deliberately dependency-free. The app already has an embedded wallet
 * for every player (`lib/auth/wallet.ts`), so the browser never needs to sign
 * anything: the only job here is to learn the address of a wallet the player
 * actually controls, so a payout can be sent there instead of to the custodial
 * address. That is one `eth_requestAccounts` call, and a chain switch so the
 * funds land somewhere the player can already see.
 *
 * A connect-kit (RainbowKit, Web3Modal) would bring wagmi, a query client, a
 * WalletConnect project id and a provider around the whole tree to deliver the
 * same address. If WalletConnect QR pairing for mobile wallets is ever wanted,
 * this hook is the seam to replace — nothing else in the app touches
 * `window.ethereum`.
 *
 * Discovery follows EIP-6963 where the wallet supports it, which is what makes
 * "connect MetaMask" pick MetaMask on a machine with several extensions
 * installed, instead of whichever one won the race to define `window.ethereum`.
 */

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: any[]) => void): void;
  removeListener?(event: string, handler: (...args: any[]) => void): void;
}

interface ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface AnnouncedProvider {
  info: ProviderInfo;
  provider: Eip1193Provider;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { isMetaMask?: boolean };
  }
  interface WindowEventMap {
    'eip6963:announceProvider': CustomEvent<AnnouncedProvider>;
  }
}

/** User rejected the request. Not an error worth shouting about. */
const USER_REJECTED = 4001;
/** The wallet does not know this chain yet, so it must be added first. */
const CHAIN_NOT_ADDED = 4902;

function errorCode(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'number') return code;
  }
  return null;
}

function errorMessage(error: unknown, fallback: string): string {
  if (errorCode(error) === USER_REJECTED) return 'Request cancelled in your wallet';
  if (error instanceof Error && error.message) return error.message.split('\n')[0].slice(0, 180);
  return fallback;
}

export interface MonadChainInfo {
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  networkName: string;
  currencySymbol: string;
}

export interface WalletState {
  /** True once at least one injected provider has been found. */
  available: boolean;
  /** Display name of the wallet that will be used, e.g. "MetaMask". */
  walletName: string;
  address: string | null;
  chainId: number | null;
  connecting: boolean;
  switching: boolean;
  error: string | null;
  connect: () => Promise<string | null>;
  switchChain: () => Promise<boolean>;
  disconnect: () => void;
  clearError: () => void;
}

export function useWallet(chain: MonadChainInfo | null): WalletState {
  const [providers, setProviders] = useState<AnnouncedProvider[]>([]);
  const [legacy, setLegacy] = useState<{ provider: Eip1193Provider; name: string } | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so the event handlers registered below always talk to the
  // provider the user actually connected through.
  const activeRef = useRef<Eip1193Provider | null>(null);

  // EIP-6963 discovery. Wallets announce themselves in response to our request
  // event, and late-loading extensions announce whenever they are ready.
  useEffect(() => {
    const onAnnounce = (event: CustomEvent<AnnouncedProvider>) => {
      const detail = event.detail;
      setProviders((current) =>
        current.some((entry) => entry.info.uuid === detail.info.uuid)
          ? current
          : [...current, detail],
      );
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    // Pre-EIP-6963 wallets only define the legacy global. Reading it in an
    // effect rather than during render keeps the first client render identical
    // to the server's, which has no window at all.
    if (window.ethereum) {
      setLegacy({
        provider: window.ethereum,
        name: window.ethereum.isMetaMask ? 'MetaMask' : 'your wallet',
      });
    }

    return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
  }, []);

  const pick = useCallback((): { provider: Eip1193Provider; name: string } | null => {
    const metaMask = providers.find((entry) => entry.info.rdns === 'io.metamask');
    const chosen = metaMask ?? providers[0];
    if (chosen) return { provider: chosen.provider, name: chosen.info.name };
    return legacy;
  }, [providers, legacy]);

  const selected = pick();

  const readChain = useCallback(async (provider: Eip1193Provider) => {
    try {
      const hex = (await provider.request({ method: 'eth_chainId' })) as string;
      setChainId(Number.parseInt(hex, 16));
    } catch {
      setChainId(null);
    }
  }, []);

  const connect = useCallback(async (): Promise<string | null> => {
    const target = pick();
    if (!target) {
      setError('No browser wallet found. Install MetaMask to connect one.');
      return null;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = (await target.provider.request({
        method: 'eth_requestAccounts',
      })) as string[];
      const account = accounts?.[0] ?? null;
      if (!account) {
        setError('Your wallet returned no account');
        return null;
      }
      activeRef.current = target.provider;
      setAddress(account);
      await readChain(target.provider);
      return account;
    } catch (cause) {
      setError(errorMessage(cause, 'Could not connect your wallet'));
      return null;
    } finally {
      setConnecting(false);
    }
  }, [pick, readChain]);

  /**
   * Point the wallet at Monad, adding the network if the wallet has never seen
   * it. Returns true when the wallet ends up on the right chain.
   */
  const switchChain = useCallback(async (): Promise<boolean> => {
    const provider = activeRef.current ?? pick()?.provider ?? null;
    if (!provider || !chain) return false;
    const hexChainId = `0x${chain.chainId.toString(16)}`;

    setSwitching(true);
    setError(null);
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }],
      });
      setChainId(chain.chainId);
      return true;
    } catch (cause) {
      if (errorCode(cause) !== CHAIN_NOT_ADDED) {
        setError(errorMessage(cause, 'Could not switch network'));
        return false;
      }
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: hexChainId,
              chainName: chain.networkName,
              nativeCurrency: {
                name: chain.currencySymbol,
                symbol: chain.currencySymbol,
                decimals: 18,
              },
              rpcUrls: [chain.rpcUrl],
              blockExplorerUrls: [chain.explorerUrl],
            },
          ],
        });
        setChainId(chain.chainId);
        return true;
      } catch (addError) {
        setError(errorMessage(addError, 'Could not add the Monad network'));
        return false;
      }
    } finally {
      setSwitching(false);
    }
  }, [chain, pick]);

  // Track the wallet after connection: the player can switch account or network
  // from the extension at any time, and the destination shown must follow.
  useEffect(() => {
    const provider = activeRef.current;
    if (!provider?.on || !provider.removeListener) return;

    const onAccounts = (accounts: string[]) => setAddress(accounts?.[0] ?? null);
    const onChain = (hex: string) => setChainId(Number.parseInt(hex, 16));

    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  }, [address]);

  const disconnect = useCallback(() => {
    // EIP-1193 has no disconnect; the app forgets the account, and the wallet
    // keeps its own permission until the user revokes it in the extension.
    activeRef.current = null;
    setAddress(null);
    setChainId(null);
    setError(null);
  }, []);

  return {
    available: selected !== null,
    walletName: selected?.name ?? 'MetaMask',
    address,
    chainId,
    connecting,
    switching,
    error,
    connect,
    switchChain,
    disconnect,
    clearError: useCallback(() => setError(null), []),
  };
}
