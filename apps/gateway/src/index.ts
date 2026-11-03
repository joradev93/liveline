import { defaultConfig, startGateway } from './gateway.js';

const config = defaultConfig();
const gateway = await startGateway(config);
console.log(
  `[gateway] ws://localhost:${gateway.server.port}/ws  feed=${config.feedUrl} flush=${config.flushMs}ms compression=${config.compression}`,
);

let last = { deltas: 0, bytes: 0 };
setInterval(() => {
  const s = gateway.hub.stats;
  const deltas = s.deltasSent - last.deltas;
  const kb = Math.round((s.bytesSent - last.bytes) / 1024);
  last = { deltas: s.deltasSent, bytes: s.bytesSent };
  if (process.env.GW_LOG === 'quiet') return;
  console.log(
    `[gateway] clients ${gateway.server.clientCount} topics ${s.topics} | ${deltas} deltas/s ${kb} KB/s | skipped ${s.deltasSkipped} resyncs ${s.resyncs} | flush ${s.lastFlushMs.toFixed(2)}ms (max ${s.maxFlushMs.toFixed(2)}) | feed ${gateway.feed.connected ? 'up' : 'down'}`,
  );
}, 5_000).unref();

const shutdown = () => {
  gateway.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
