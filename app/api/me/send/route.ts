import { z } from 'zod';
import { sendFromWallet } from '@/server/wallet';
import { handle, ok, parseBody, requireUser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** One transfer, confirmed before responding. */
export const maxDuration = 120;

const bodySchema = z.object({
  to: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Enter a valid EVM address'),
  /** Wei as a decimal string. Omit to send everything after the network fee. */
  amountWei: z
    .string()
    .trim()
    .regex(/^\d+$/, 'Enter a valid amount')
    .optional(),
});

/**
 * Send MON from the caller's own embedded wallet.
 *
 * The only things the request controls are the destination and the amount;
 * the source is always the signed-in user's derived address, taken from the
 * session cookie and never from the body.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const { to, amountWei } = await parseBody(request, bodySchema);
    const result = await sendFromWallet(user, to, amountWei ? BigInt(amountWei) : null);
    return ok(result);
  });
}
