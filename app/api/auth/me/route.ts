import { publicRuntimeConfig, featureFlags, serverConfig } from '@/lib/config';
import { getSessionUser } from '@/lib/auth/session';
import { getStore } from '@/lib/store';
import { handle, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Current session plus the capability flags the UI adapts to. */
export async function GET() {
  return handle(async () => {
    const user = await getSessionUser();
    return ok({
      user,
      config: {
        googleClientId: publicRuntimeConfig.googleClientId,
        googleAuthEnabled: featureFlags.googleAuthEnabled,
        aiEnabled: featureFlags.aiEnabled,
        chainEnabled: featureFlags.chainEnabled,
        durableStore: getStore().durable,
        demoMode: publicRuntimeConfig.demoMode,
        chain: publicRuntimeConfig.chain,
        // Public anon key only — safe in the browser and used purely to
        // subscribe to realtime broadcasts. RLS blocks all table access.
        supabaseUrl: serverConfig.supabaseUrl,
        supabaseAnonKey: serverConfig.supabaseAnonKey,
      },
    });
  });
}
