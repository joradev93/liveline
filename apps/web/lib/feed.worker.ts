/// <reference lib="webworker" />
/**
 * Feed worker: owns the WebSocket, parses JSON and checks versions off the main thread.
 * Applied items are sent to the main thread in batches, at most one batch per ~16 ms.
 */
import type { ServerMessage, Topic } from '@liveline/protocol';
import { TopicSync } from './topic-sync';
import type { FeedItem, FeedMetrics, FromWorker, ToWorker } from './worker-protocol';

declare const self: DedicatedWorkerGlobalScope;

const BATCH_MS = 16;
const LATENCY_WINDOW_MS = 5_000;

const sync = new TopicSync();
let url = '';
let ws: WebSocket | null = null;
let retryMs = 500;
let outbox: FeedItem[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

const counters = { msgs: 0, bytes: 0, ops: 0, reconnects: 0 };
let latencies: { at: number; ms: number }[] = [];

const post = (msg: FromWorker) => self.postMessage(msg);

function send(msg: { t: 'sub' | 'unsub'; topics: Topic[] }) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  ws = new WebSocket(url);
  ws.onopen = () => {
    retryMs = 500;
    const topics = sync.resetAll();
    if (topics.length) send({ t: 'sub', topics });
  };
  ws.onmessage = (ev: MessageEvent<string>) => onMessage(ev.data);
  ws.onclose = () => {
    ws = null;
    counters.reconnects++;
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 10_000);
  };
}

function onMessage(text: string) {
  counters.msgs++;
  counters.bytes += text.length;
  const now = Date.now();
  const result = sync.handle(JSON.parse(text) as ServerMessage, now);
  if (result.action === 'resubscribe') send({ t: 'sub', topics: [result.topic] });
  if (result.action !== 'apply') return;
  if (result.item.kind === 'delta') counters.ops += result.item.ops.length;
  if (result.latencyMs !== undefined) latencies.push({ at: now, ms: result.latencyMs });
  outbox.push(result.item);
  batchTimer ??= setTimeout(flush, BATCH_MS);
}

function flush() {
  batchTimer = null;
  if (outbox.length === 0) return;
  post({ type: 'batch', items: outbox });
  outbox = [];
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
}

setInterval(() => {
  const now = Date.now();
  latencies = latencies.filter((l) => now - l.at < LATENCY_WINDOW_MS);
  const sorted = latencies.map((l) => l.ms).sort((a, b) => a - b);
  const metrics: FeedMetrics = {
    connected: ws?.readyState === WebSocket.OPEN,
    msgsPerSec: counters.msgs,
    kbPerSec: Math.round(counters.bytes / 102.4) / 10,
    opsPerSec: counters.ops,
    latencyP50: percentile(sorted, 0.5),
    latencyP99: percentile(sorted, 0.99),
    gaps: sync.gaps,
    reconnects: counters.reconnects,
  };
  counters.msgs = counters.bytes = counters.ops = 0;
  post({ type: 'metrics', metrics });
}, 1_000);

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'connect':
      if (!ws) {
        url = msg.url;
        connect();
      }
      break;
    case 'sub':
      if (sync.want(msg.topic)) send({ t: 'sub', topics: [msg.topic] });
      break;
    case 'unsub':
      sync.drop(msg.topic);
      send({ t: 'unsub', topics: [msg.topic] });
      break;
  }
};
