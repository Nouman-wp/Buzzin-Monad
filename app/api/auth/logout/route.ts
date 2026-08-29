import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { handle, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return handle(async () => {
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
    return ok({ ok: true });
  });
}
