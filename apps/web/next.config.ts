import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@liveline/protocol'],
  poweredByHeader: false,
  experimental: {
    // 6 KB of CSS: inlining it removes a render-blocking request (Lighthouse: ~150 ms on mobile).
    inlineCss: true,
  },
};

export default config;
