'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ErrorState } from '@/components/shared/ui';
import { addressFromScan } from '@/lib/util/scan-address';

/**
 * Scan a wallet address out of a QR code with the device camera.
 *
 * Typing a 42-character hex address off another phone's screen is the single
 * most error-prone thing this app asks anyone to do, and getting it wrong sends
 * money nowhere. The Receive tab already renders the address as a QR, so the
 * two halves meet: one person shows theirs, the other scans it.
 *
 * Decoding is native `BarcodeDetector` where the browser has it — it is
 * hardware-accelerated and costs nothing to load — falling back to jsQR, pulled
 * in dynamically so the ~30KB only lands on devices that actually open the
 * scanner. Safari still has no BarcodeDetector, so the fallback is the common
 * path on iPhones rather than an edge case.
 *
 * The camera is a resource, not a render: every exit path — success, cancel,
 * unmount, an error mid-stream — runs through `stop()`, because a track left
 * running keeps the recording indicator lit long after the panel is gone.
 */

/** Frames per second to decode at. Faster than this just burns battery. */
const SCAN_INTERVAL_MS = 220;

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

export function QrScanner({
  onResult,
  onClose,
}: {
  onResult: (address: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const finish = useCallback(
    (address: string) => {
      stop();
      onResult(address);
    },
    [onResult, stop],
  );

  const cancel = useCallback(() => {
    stop();
    onClose();
  }, [onClose, stop]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let detector: BarcodeDetectorLike | null = null;
    let decodeFallback: typeof import('jsqr').default | null = null;

    const scan = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < video.HAVE_CURRENT_DATA) return;

      try {
        if (detector) {
          const codes = await detector.detect(video);
          const hit = codes.map((code) => addressFromScan(code.rawValue)).find(Boolean);
          if (hit) return finish(hit);
        } else if (decodeFallback) {
          // jsQR works on raw pixels, so the frame has to land on a canvas
          // first. Kept at the video's native size — downscaling loses the
          // finder patterns on a code held at arm's length.
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) return;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = decodeFallback(frame.data, frame.width, frame.height, {
            inversionAttempts: 'dontInvert',
          });
          const hit = code ? addressFromScan(code.data) : null;
          if (hit) return finish(hit);
        }
      } catch {
        // A single undecodable frame is the normal case, not a failure.
      }
    };

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser cannot open the camera. Paste the address instead.');
        return;
      }

      const native = (window as unknown as { BarcodeDetector?: new (init: { formats: string[] }) => BarcodeDetectorLike })
        .BarcodeDetector;
      if (native) {
        detector = new native({ formats: ['qr_code'] });
      } else {
        try {
          decodeFallback = (await import('jsqr')).default;
        } catch {
          setError('Could not load the QR decoder. Paste the address instead.');
          return;
        }
      }
      if (cancelled) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // The rear camera is the one pointed at someone else's screen.
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        setReady(true);
      } catch (cause) {
        const name = (cause as { name?: string } | null)?.name;
        setError(
          name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow it in your browser settings, or paste the address.'
            : name === 'NotFoundError'
              ? 'No camera found on this device. Paste the address instead.'
              : 'Could not start the camera. Paste the address instead.',
        );
        return;
      }

      const loop = async () => {
        await scan();
        if (cancelled) return;
        timer = setTimeout(() => void loop(), SCAN_INTERVAL_MS);
      };
      void loop();
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stop();
    };
  }, [finish, stop]);

  // Escape closes, the way every other overlay on the web does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan a wallet QR code"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/85 p-4 backdrop-blur-sm"
      onClick={cancel}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-[var(--radius-card)] border border-[var(--hairline-strong)] bg-ink-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--hairline)] px-4 py-3">
          <h2 className="text-sm font-medium text-ink-50">Scan a wallet QR</h2>
          <button
            type="button"
            onClick={cancel}
            className="rounded-full px-2 py-1 text-sm text-ink-400 transition-colors hover:text-ink-100"
          >
            Close
          </button>
        </div>

        <div className="p-4">
          {error ? (
            <ErrorState message={error} />
          ) : (
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-ink-950">
              <video
                ref={videoRef}
                playsInline
                muted
                className="h-full w-full object-cover"
              />
              {/* A frame to aim with. Purely a target — decoding uses the whole
                  image, so a code slightly outside it still reads. */}
              <div className="pointer-events-none absolute inset-[15%] rounded-2xl border-2 border-volt-400/70" />
              {!ready && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-400">
                  Starting the camera…
                </div>
              )}
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" />
          <p className="mt-3 text-xs leading-relaxed text-ink-400">
            Point at the QR on the Receive tab of another wallet. The address
            fills in on its own.
          </p>
          {error && (
            <Button variant="secondary" block className="mt-3" onClick={cancel}>
              Back to the form
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
