'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, ErrorState, Field, cx } from '@/components/shared/ui';
import { QrScanner } from '@/components/account/qr-scanner';
import { formatMon, shortAddress } from '@/lib/util/money';
import { monToWei } from '@/lib/config';

/**
 * Send and receive MON from the player's own embedded wallet.
 *
 * Distinct from cashing out, and the copy says so: cash-out moves *winnings*
 * that the settlement contract is holding, while this moves whatever is sitting
 * at the player's own address. Most of the time that balance is zero, because
 * a claim pays straight out to the destination the player names — so the panel
 * leads with Receive, which is the useful half for a demo audience.
 */

interface WalletInfo {
  address: string;
  balanceWei: string;
  sendableWei: string;
  gasReserveWei: string;
  explorerUrl: string | null;
}

export function TransferPanel({ onChanged }: { onChanged?: () => void }) {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [tab, setTab] = useState<'receive' | 'send'>('receive');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/me/wallet', { cache: 'no-store' });
      if (!response.ok) return;
      setWallet((await response.json()) as WalletInfo);
    } catch {
      // The panel degrades to Receive-only, which needs no balance.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked; the address is on screen regardless.
    }
  };

  return (
    <Card>
      <CardHeader
        title="Your wallet"
        subtitle="Send and receive MON at your own address"
        action={
          wallet && (
            <Badge tone={BigInt(wallet.balanceWei) > 0n ? 'mint' : 'neutral'}>
              {formatMon(wallet.balanceWei, 3)} MON
            </Badge>
          )
        }
      />

      <div className="flex gap-1 border-b border-[var(--hairline)] px-3 pt-3">
        {(['receive', 'send'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setTab(option)}
            className={cx(
              'rounded-t-lg px-4 py-2 text-sm capitalize transition-colors',
              tab === option
                ? 'bg-ink-850 text-ink-50'
                : 'text-ink-400 hover:text-ink-200',
            )}
          >
            {option}
          </button>
        ))}
      </div>

      {tab === 'receive' ? (
        <div className="flex flex-col items-center gap-4 p-5 sm:flex-row sm:items-start">
          <div className="shrink-0 rounded-2xl bg-white p-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/api/me/qr"
              alt="QR code for your wallet address"
              width={148}
              height={148}
              className="block h-[148px] w-[148px]"
            />
          </div>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
              Your address
            </p>
            <p className="tnum mt-1.5 break-all rounded-lg border border-[var(--hairline)] bg-ink-850 px-3 py-2 text-xs text-ink-200">
              {wallet?.address ?? '—'}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
              <Button size="sm" variant="secondary" onClick={copy} disabled={!wallet}>
                {copied ? 'Copied' : 'Copy address'}
              </Button>
              {wallet?.explorerUrl && (
                <a
                  href={wallet.explorerUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-9 items-center rounded-full border border-[var(--hairline-strong)] px-4 text-[13px] text-ink-200 transition-colors hover:bg-ink-800"
                >
                  Explorer ↗
                </a>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-500">
              Anything sent here on Monad testnet arrives at this address. Prizes
              you cash out go wherever you choose, so this balance is usually
              zero.
            </p>
          </div>
        </div>
      ) : (
        <SendForm
          wallet={wallet}
          onSent={async () => {
            await load();
            onChanged?.();
          }}
        />
      )}
    </Card>
  );
}

function SendForm({
  wallet,
  onSent,
}: {
  wallet: WalletInfo | null;
  onSent: () => Promise<void>;
}) {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [max, setMax] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ txHash: string; explorerUrl: string; amountWei: string } | null>(null);

  const sendable = wallet ? BigInt(wallet.sendableWei) : 0n;
  const nothingToSend = sendable === 0n;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const body: { to: string; amountWei?: string } = { to: to.trim() };
      if (!max) {
        let wei: bigint;
        try {
          wei = monToWei(amount.trim());
        } catch {
          throw new Error('Enter a valid amount');
        }
        if (wei <= 0n) throw new Error('Enter an amount greater than zero');
        body.amountWei = wei.toString();
      }
      const response = await fetch('/api/me/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Send failed');
      setSent(data);
      setTo('');
      setAmount('');
      setMax(false);
      await onSent();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Send failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">
          Available to send
        </span>
        <span className="tnum text-sm text-ink-100">
          {wallet ? `${formatMon(wallet.sendableWei, 4)} MON` : '—'}
        </span>
      </div>

      {nothingToSend && wallet && (
        <p className="rounded-xl border border-[var(--hairline)] bg-ink-850 px-4 py-3 text-xs leading-relaxed text-ink-400">
          {BigInt(wallet.balanceWei) === 0n
            ? 'This wallet is empty. Cash out a prize to it, or have someone send MON to the address on the Receive tab.'
            : 'The balance here is smaller than the network fee, so there is nothing that can be sent.'}
        </p>
      )}

      {/* Scanning sits beside the field rather than inside it: a 42-character
          address already fills the input, and an overlaid button would cover
          the end of the very value the sender needs to check. */}
      <div className="flex items-end gap-2">
        <Field
          label="Destination address"
          placeholder="0x…"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          hint="Any EVM address on Monad testnet, or scan their QR."
        />
        <button
          type="button"
          onClick={() => setScanning(true)}
          aria-label="Scan a QR code with the camera"
          className="mb-[1.6rem] inline-flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border border-[var(--hairline-strong)] px-3.5 text-[13px] text-ink-200 transition-colors hover:border-volt-500/40 hover:bg-ink-800"
        >
          <ScanIcon />
          Scan
        </button>
      </div>

      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onResult={(address) => {
            setTo(address);
            setScanning(false);
            setError(null);
          }}
        />
      )}

      <div>
        <Field
          label="Amount (MON)"
          placeholder="0.00"
          value={max ? formatMon(wallet?.sendableWei ?? '0', 4) : amount}
          onChange={(event) => setAmount(event.target.value)}
          disabled={max}
          inputMode="decimal"
        />
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-ink-400">
          <input
            type="checkbox"
            checked={max}
            onChange={(event) => setMax(event.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-volt-500)]"
          />
          Send everything, less the network fee
        </label>
      </div>

      {error && <ErrorState message={error} />}

      {sent && (
        <div className="rounded-xl border border-mint-500/30 bg-mint-500/8 px-4 py-3">
          <p className="text-sm text-mint-400">
            Sent {formatMon(sent.amountWei, 4)} MON
          </p>
          <a
            href={sent.explorerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="tnum mt-1 block truncate text-xs text-ink-400 underline-offset-2 hover:underline"
          >
            {shortAddress(sent.txHash, 10)} ↗
          </a>
        </div>
      )}

      <Button
        type="submit"
        block
        loading={busy}
        disabled={nothingToSend || to.trim().length !== 42 || (!max && amount.trim() === '')}
      >
        Send MON
      </Button>
    </form>
  );
}

/** Viewfinder corners — the universally understood "scan" affordance. */
function ScanIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1.5 5.5v-3a1 1 0 0 1 1-1h3M10.5 1.5h3a1 1 0 0 1 1 1v3M14.5 10.5v3a1 1 0 0 1-1 1h-3M5.5 14.5h-3a1 1 0 0 1-1-1v-3" />
      <path d="M1.5 8h13" />
    </svg>
  );
}
