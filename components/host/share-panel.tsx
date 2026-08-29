'use client';

import { useState } from 'react';
import { Button, Card, CardHeader } from '@/components/shared/ui';
import type { HostSnapshot } from '@/lib/types';

/**
 * The QR panel the room actually points their phones at.
 *
 * The code is set large enough to scan from the back of a room, and the code
 * itself is shown in plain text underneath for anyone whose camera gives up.
 */
export function SharePanel({ snapshot }: { snapshot: HostSnapshot }) {
  const { room, joinUrl } = snapshot;
  const [copied, setCopied] = useState<'url' | 'code' | null>(null);

  const copy = async (value: string, which: 'url' | 'code') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard is unavailable over plain http; the text is selectable anyway.
    }
  };

  return (
    <Card>
      <CardHeader
        title="Invite players"
        subtitle="Scan to join — no app, no wallet setup"
      />
      <div className="flex flex-col items-center gap-6 p-6 sm:flex-row sm:items-center">
        <div className="shrink-0 rounded-2xl bg-white p-3">
          {/* Server-rendered SVG: stays sharp on a projector. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/rooms/${room.id}/qr`}
            alt={`QR code to join room ${room.code}`}
            width={200}
            height={200}
            className="block h-[200px] w-[200px]"
          />
        </div>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
            Room code
          </p>
          <p className="tnum mt-1 text-4xl font-semibold tracking-[0.16em] text-ink-50">
            {room.code}
          </p>

          <p className="mt-4 truncate rounded-lg border border-[var(--hairline)] bg-ink-850 px-3 py-2 text-xs text-ink-300">
            {joinUrl}
          </p>

          <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
            <Button size="sm" variant="secondary" onClick={() => copy(joinUrl, 'url')}>
              {copied === 'url' ? 'Copied' : 'Copy link'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => copy(room.code, 'code')}>
              {copied === 'code' ? 'Copied' : 'Copy code'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
