import { readWallet } from '@/server/wallet';
import { handle, ok, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The caller's own wallet: balance, and what is actually sendable once the
 * network fee is reserved. Separate from the dashboard overview so the Send
 * panel can refresh just this after a transfer.
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    return ok(await readWallet(user));
  });
}
