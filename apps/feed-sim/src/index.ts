import type { FeedChange } from '@liveline/protocol';
import { FeedServer } from './server.js';
import { FeedSimulator } from './simulator.js';

const env = (name: string, fallback: string): string => process.env[name] ?? fallback;

const config = {
  port: Number(env('FEED_PORT', '7001')),
  seed: Number(env('FEED_SEED', '42')),
  events: Number(env('FEED_EVENTS', '1500')),
  rate: Number(env('FEED_RATE', '200')),
  /** summary | ticks | quiet */
  log: env('FEED_LOG', 'summary'),
};

const sim = new FeedSimulator({ seed: config.seed, eventCount: config.events }, Date.now());
let samples: FeedChange[] = [];

const server = new FeedServer(sim, {
  port: config.port,
  rate: config.rate,
  onBatch: (changes) => {
    if (config.log === 'ticks') for (const c of changes) console.log(formatChange(c));
    else if (samples.length < 3) samples.push(...changes.slice(0, 3 - samples.length));
  },
});

function formatChange(c: FeedChange): string {
  switch (c.k) {
    case 'price':
      return `  price  ev=${c.e} m=${c.m} ${JSON.stringify(c.sel)}`;
    case 'mst':
      return `  market ev=${c.e} m=${c.m} -> ${c.st}`;
    case 'est':
      return `  event  ev=${c.e} -> ${c.st}${c.sc ? ` ${c.sc.join(':')}` : ''}`;
    case 'add':
      return `  add    ev=${c.event.id} ${c.event.home} v ${c.event.away}`;
    case 'rm':
      return `  remove ev=${c.e}`;
  }
}

await server.start();
console.log(
  `[feed-sim] ws://localhost:${config.port}/feed  seed=${config.seed} events=${sim.eventCount} markets=${sim.marketCount} rate=${server.tickRate}/s`,
);

let lastTicks = 0;
setInterval(() => {
  const ticks = server.counters.ticks - lastTicks;
  lastTicks = server.counters.ticks;
  if (config.log === 'quiet') return;
  const s = sim.countByStatus();
  console.log(
    `[feed-sim] ${ticks} ticks/s (target ${server.tickRate}) | live ${s.live} prematch ${s.prematch} suspended ${s.suspended} settled ${s.settled} | consumers ${server.consumerCount}`,
  );
  if (config.log === 'summary') for (const c of samples) console.log(formatChange(c));
  samples = [];
}, 1000).unref();

const shutdown = () => {
  void server.stop().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
