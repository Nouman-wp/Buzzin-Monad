import QRCode from 'qrcode';
import { getRoomOr404 } from '@/server/rooms';
import { joinUrlFor } from '@/server/snapshots';

export const runtime = 'nodejs';

type Params = { params: Promise<{ roomId: string }> };

/**
 * QR code for the room's public join URL, rendered server-side as SVG.
 *
 * SVG so it stays razor sharp when a host throws it on a projector, and served
 * as an image so the dashboard can simply point an `<img>` at it. Returns an
 * image response rather than the usual JSON envelope, so it handles its own
 * errors instead of going through the shared wrapper.
 */
export async function GET(_request: Request, { params }: Params) {
  const { roomId } = await params;
  try {
    const room = await getRoomOr404(roomId);

    const svg = await QRCode.toString(joinUrlFor(room), {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 512,
      color: { dark: '#07080b', light: '#ffffff' },
    });

    return new Response(svg, {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        // The code never changes for a room, and rooms are short-lived.
        'cache-control': 'public, max-age=300, s-maxage=300',
      },
    });
  } catch {
    return new Response('Room not found', { status: 404 });
  }
}
