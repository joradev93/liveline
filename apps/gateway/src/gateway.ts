import { FeedClient } from '@liveline/feed-sim/client';
import { CountsTracker } from './counts.js';
import { TopicHub } from './hub.js';
import { GatewayServer } from './server.js';
import { MarketState } from './state.js';

export interface GatewayConfig {
  port: number;
  feedUrl: string;
  flushMs: number;
  highWaterMark: number;
  maxBackpressure: number;
  maxTopicsPerClient: number;
  compression: boolean;
}

export const defaultConfig = (): GatewayConfig => ({
  port: Number(process.env.GW_PORT ?? process.env.PORT ?? 7002),
  feedUrl: process.env.FEED_URL ?? 'ws://127.0.0.1:7001/feed',
  flushMs: Number(process.env.GW_FLUSH_MS ?? 100),
  highWaterMark: Number(process.env.GW_HIGH_WATER ?? 512 * 1024),
  maxBackpressure: Number(process.env.GW_MAX_BACKPRESSURE ?? 8 * 1024 * 1024),
  maxTopicsPerClient: Number(process.env.GW_MAX_TOPICS ?? 50),
  compression: process.env.GW_COMPRESSION === '1',
});

/** Wires feed -> state -> hub -> uWS server, and runs the flush timer. */
export async function startGateway(config: GatewayConfig) {
  const state = new MarketState();
  const hub = new TopicHub(state, {
    highWaterMark: config.highWaterMark,
    maxTopicsPerClient: config.maxTopicsPerClient,
  });
  let ready = false;
  const feed = new FeedClient(config.feedUrl, {
    onSnapshot: (events) => {
      state.reset(events);
      if (ready) hub.resyncAll();
      ready = true;
    },
    onChanges: (changes) => {
      for (const change of changes) state.apply(change, hub.record);
    },
  });
  const server = new GatewayServer(hub, feed, {
    port: config.port,
    compression: config.compression,
    maxBackpressure: config.maxBackpressure,
  });

  const counts = new CountsTracker(state);

  feed.start();
  await server.listen();
  const timer = setInterval(() => {
    hub.flush();
    const changed = counts.poll();
    if (changed) server.publishCounts(changed);
  }, config.flushMs);

  return {
    hub,
    feed,
    server,
    state,
    stop() {
      clearInterval(timer);
      feed.stop();
      server.close();
    },
  };
}
