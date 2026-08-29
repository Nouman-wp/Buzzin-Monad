'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/shared/ui';

/**
 * Room-code entry for people who cannot scan the QR — the back row, or a
 * player whose camera app refuses to cooperate. Codes are normalised as typed,
 * so "buzz-91a" and "BUZZ91A" both work.
 */
export function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const normalised = code.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (normalised.length < 4) return;
    setBusy(true);
    router.push(`/join/${normalised}`);
  };

  return (
    <form onSubmit={submit} className="flex gap-2.5">
      <label htmlFor="room-code" className="sr-only">
        Room code
      </label>
      <input
        id="room-code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="ROOM CODE"
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        maxLength={12}
        className="tnum h-13 min-h-[52px] w-full rounded-full border border-[var(--hairline-strong)] bg-ink-850/80 px-5 text-center text-lg font-semibold tracking-[0.18em] text-ink-50 uppercase outline-none backdrop-blur-sm transition-[border-color,box-shadow] placeholder:tracking-normal placeholder:text-ink-400 focus:border-volt-500 focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-volt-500)_18%,transparent)]"
      />
      <Button type="submit" size="lg" loading={busy} disabled={normalised.length < 4}>
        Join
      </Button>
    </form>
  );
}
