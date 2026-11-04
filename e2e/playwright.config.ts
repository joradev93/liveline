import { defineConfig } from '@playwright/test';

/**
 * Runs against production builds (`pnpm build` first). Uses the installed Google Chrome,
 * so no browser download is needed. Servers already running on the ports are reused.
 */
const quiet = { FEED_LOG: 'quiet', GW_LOG: 'quiet' };
// WEB_PORT: run against a web server on another port (when 3000 is taken by something else).
const webPort = process.env.WEB_PORT ?? '3000';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${webPort}`,
    channel: process.env.PW_CHANNEL || 'chrome',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node ../apps/feed-sim/dist/index.js',
      url: 'http://127.0.0.1:7001/health',
      env: { ...quiet, FEED_RATE: '500' },
      reuseExistingServer: true,
    },
    {
      command: 'node ../apps/gateway/dist/index.js',
      url: 'http://127.0.0.1:7002/health',
      env: quiet,
      reuseExistingServer: true,
    },
    {
      command: 'node ../apps/bet-api/dist/index.js',
      url: 'http://127.0.0.1:7003/health',
      env: { BET_DB: ':memory:' },
      reuseExistingServer: true,
    },
    {
      command: `pnpm --filter @liveline/web exec next start -p ${webPort}`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: true,
    },
  ],
});
