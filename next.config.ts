import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This project ships without AI-assistant scaffolding of any kind.
  agentRules: false,
  typescript: { ignoreBuildErrors: false },
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
