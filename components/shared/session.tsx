'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Client-side session state.
 *
 * The browser holds a cached copy of who it is purely to render the right UI —
 * every privileged action is still authorised server-side from the signed
 * http-only cookie, which this code cannot read or forge.
 */

export interface ClientUser {
  id: string;
  displayName: string;
  email: string | null;
  walletAddress: string;
  /** Provider-hosted picture URL, or null for guests. */
  avatarUrl: string | null;
  provider: 'google' | 'guest';
  role: 'PLAYER' | 'HOST' | 'ADMIN';
}

export interface ClientConfig {
  googleClientId: string;
  googleAuthEnabled: boolean;
  aiEnabled: boolean;
  chainEnabled: boolean;
  durableStore: boolean;
  demoMode: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  chain: {
    rpcUrl: string;
    chainId: number;
    explorerUrl: string;
    settlementContract: string;
    currencySymbol: string;
    networkName: string;
  };
}

interface SessionState {
  user: ClientUser | null;
  config: ClientConfig | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signInWithGoogle: (credential: string) => Promise<ClientUser>;
  signInAsGuest: (displayName: string) => Promise<ClientUser>;
  setDisplayName: (displayName: string) => Promise<ClientUser>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error ?? 'Request failed');
  return data as T;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ClientUser | null>(null);
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      const data = (await response.json()) as { user: ClientUser | null; config: ClientConfig };
      setUser(data.user);
      setConfig(data.config);
      setError(null);
    } catch {
      setError('Could not reach the server. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signInWithGoogle = useCallback(async (credential: string) => {
    const data = await postJson<{ user: ClientUser }>('/api/auth/google', { credential });
    setUser(data.user);
    return data.user;
  }, []);

  const signInAsGuest = useCallback(async (displayName: string) => {
    const data = await postJson<{ user: ClientUser }>('/api/auth/guest', { displayName });
    setUser(data.user);
    return data.user;
  }, []);

  const setDisplayName = useCallback(async (displayName: string) => {
    const data = await postJson<{ user: ClientUser }>('/api/auth/name', { displayName });
    setUser(data.user);
    return data.user;
  }, []);

  const signOut = useCallback(async () => {
    await postJson('/api/auth/logout');
    setUser(null);
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      user,
      config,
      loading,
      error,
      refresh,
      signInWithGoogle,
      signInAsGuest,
      setDisplayName,
      signOut,
    }),
    [user, config, loading, error, refresh, signInWithGoogle, signInAsGuest, setDisplayName, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}
