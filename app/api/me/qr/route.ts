import QRCode from 'qrcode';
import { getSessionUser } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * QR for the caller's own wallet address, so someone can scan to send them MON.
 *
 * Encodes the bare address rather than an EIP-681 `ethereum:` URI: wallet
 * support for the URI form is uneven, and every wallet can read an address.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user || !/^0x[0-9a-fA-F]{40}$/.test(user.walletAddress)) {
    return new Response('Not found', { status: 404 });
  }
  const svg = await QRCode.toString(user.walletAddress, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    color: { dark: '#07080b', light: '#ffffff' },
  });
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      // Private: this is the caller's own address, not shared cache material.
      'cache-control': 'private, max-age=300',
    },
  });
}
