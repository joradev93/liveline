import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@liveline/protocol'],
  poweredByHeader: false,
};

export default config;
