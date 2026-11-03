import { FeedClient } from '@liveline/feed-sim/client';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildApp } from './app.js';
import { BetRepository } from './db.js';
import { PriceBook } from './price-book.js';

const config = {
  port: Number(process.env.BET_PORT ?? process.env.PORT ?? 7003),
  host: process.env.BET_HOST ?? '0.0.0.0',
  feedUrl: process.env.FEED_URL ?? 'ws://127.0.0.1:7001/feed',
  dbFile: process.env.BET_DB ?? './data/bets.db',
  corsOrigins: (process.env.WEB_ORIGIN ?? 'http://localhost:3000,http://127.0.0.1:3000').split(','),
};

if (config.dbFile !== ':memory:') mkdirSync(dirname(config.dbFile), { recursive: true });
const repo = new BetRepository(config.dbFile);
const book = new PriceBook();
const feed = new FeedClient(config.feedUrl, {
  onSnapshot: (events) => book.reset(events),
  onChanges: (changes) => {
    for (const change of changes) book.apply(change);
  },
});
feed.start();

const app = await buildApp({
  repo,
  book,
  feedReady: () => feed.connected,
  corsOrigins: config.corsOrigins,
});
await app.listen({ port: config.port, host: config.host });
console.log(
  `[bet-api] http://localhost:${config.port}  feed=${config.feedUrl} db=${config.dbFile}`,
);

const shutdown = async () => {
  feed.stop();
  await app.close();
  repo.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
