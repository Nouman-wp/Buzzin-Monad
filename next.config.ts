import type { NextConfig } from 'next';

/**
 * The one hostname the app is allowed to live on.
 *
 * Three hosts currently serve this deployment — the apex, `www`, and the
 * project's `.vercel.app` name. Serving the same app on several origins is not
 * merely untidy: the session cookie is host-scoped, so a player who joins on
 * one host and then follows a link built from `NEXT_PUBLIC_APP_URL` (which is
 * always the apex — see `server/snapshots.ts`, where the join URL and QR code
 * come from) arrives signed out. Google's origin allowlist has the same
 * problem in reverse.
 *
 * The alternates are listed explicitly rather than matched with a
 * "everything that is not canonical" rule. A negated host pattern that fails
 * to match its own target redirects the canonical host to itself, and a
 * permanent redirect loop is not something you can take back from browsers
 * that have cached it. An explicit list cannot loop, and it leaves preview
 * deployments (`buzzin-monad-<hash>.vercel.app`) and localhost reachable on
 * their own hostnames, which is what you want when testing a branch.
 */
const CANONICAL_HOST = 'buzzin.site';

const ALTERNATE_HOSTS = ['www.buzzin.site', 'buzzin-monad.vercel.app'];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This project ships without AI-assistant scaffolding of any kind.
  agentRules: false,
  typescript: { ignoreBuildErrors: false },
  async redirects() {
    return ALTERNATE_HOSTS.map((host) => ({
      source: '/:path*',
      has: [{ type: 'host' as const, value: host }],
      destination: `https://${CANONICAL_HOST}/:path*`,
      permanent: true,
    }));
  },
  images: {
    // AVIF first: at the same file size it holds detail noticeably better than
    // WebP on photographic content, which is all we serve through the
    // optimiser. Browsers that cannot take it fall back to WebP, then to the
    // original.
    formats: ['image/avif', 'image/webp'],
    // Next 16 only honours qualities declared here; anything else silently
    // falls back to 75. The landing backdrop asks for 90.
    qualities: [75, 90],
  },
};

export default nextConfig;
