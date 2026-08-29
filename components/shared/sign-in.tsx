'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Field, Spinner } from '@/components/shared/ui';
import { useSession } from '@/components/shared/session';

/**
 * Sign-in.
 *
 * Renders Google's official button when a client id is configured, and a
 * one-field guest form when it is not. Either path ends with the player holding
 * an embedded wallet — they never see a seed phrase, an extension prompt, or a
 * network switch.
 */

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: Record<string, unknown>,
          ) => void;
        };
      };
    };
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

function useGoogleScript(enabled: boolean): 'idle' | 'loading' | 'ready' | 'error' {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    if (!enabled) return;
    if (window.google?.accounts?.id) {
      setState('ready');
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const script = existing ?? document.createElement('script');
    const onLoad = () => setState('ready');
    const onError = () => setState('error');
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    if (!existing) {
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    setState('loading');
    return () => {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
  }, [enabled]);

  return state;
}

export function SignInPanel({
  heading = 'Sign in to play',
  description = 'Your wallet is created automatically. Nothing to install.',
  onSignedIn,
}: {
  heading?: string;
  description?: string;
  onSignedIn?: () => void;
}) {
  const { config, signInWithGoogle, signInAsGuest } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  const googleEnabled = Boolean(config?.googleAuthEnabled && config.googleClientId);
  const scriptState = useGoogleScript(googleEnabled);

  const handleCredential = useCallback(
    async (credential: string) => {
      setBusy(true);
      setError(null);
      try {
        await signInWithGoogle(credential);
        onSignedIn?.();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Sign-in failed');
      } finally {
        setBusy(false);
      }
    },
    [signInWithGoogle, onSignedIn],
  );

  useEffect(() => {
    if (!googleEnabled || scriptState !== 'ready' || !buttonRef.current || !config) return;
    const identity = window.google?.accounts.id;
    if (!identity) return;
    identity.initialize({
      client_id: config.googleClientId,
      callback: (response) => void handleCredential(response.credential),
    });
    buttonRef.current.replaceChildren();
    identity.renderButton(buttonRef.current, {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      width: 300,
      logo_alignment: 'left',
    });
  }, [googleEnabled, scriptState, config, handleCredential]);

  const handleGuest = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInAsGuest(name.trim());
      onSignedIn?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full animate-rise">
      <h1 className="font-display text-2xl text-ink-50">{heading}</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-300">{description}</p>

      {googleEnabled && (
        <div className="mt-6">
          {scriptState === 'error' ? (
            <p className="text-sm text-amber-500">
              Google sign-in could not load. Use a display name below instead.
            </p>
          ) : (
            <div className="flex min-h-[44px] items-center">
              {scriptState !== 'ready' ? (
                <div className="flex items-center gap-2 text-sm text-ink-400">
                  <Spinner /> Loading Google sign-in…
                </div>
              ) : null}
              <div ref={buttonRef} />
            </div>
          )}
        </div>
      )}

      {(!googleEnabled || scriptState === 'error') && (
        <form onSubmit={handleGuest} className="mt-6 space-y-4">
          <Field
            label="Display name"
            placeholder="e.g. Nouman"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={20}
            autoComplete="nickname"
            autoFocus
            hint="This is the name everyone sees on the leaderboard."
          />
          <Button type="submit" block size="lg" loading={busy} disabled={name.trim().length < 2}>
            Continue
          </Button>
        </form>
      )}

      {busy && googleEnabled && scriptState === 'ready' && (
        <p className="mt-4 flex items-center gap-2 text-sm text-ink-300">
          <Spinner /> Creating your wallet…
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-rose-500">
          {error}
        </p>
      )}
    </div>
  );
}
