import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  MAX_TICK_RATE,
  MIN_TICK_RATE,
  type FeedBatchMessage,
  type FeedChange,
  type FeedSnapshotMessage,
} from '@liveline/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import type { FeedSimulator } from './simulator.js';

export interface FeedServerOptions {
  port: number;
  rate: number;
  /** How often generated ticks are sent as one batch. */
  batchIntervalMs?: number;
  /** How often the lifecycle (start, goals, settle) runs. */
  lifecycleIntervalMs?: number;
  onBatch?: (changes: FeedChange[]) => void;
}

/** Internal consumers must keep up; one that falls this far behind is dropped and must reconnect. */
const MAX_CONSUMER_BUFFER = 64 * 1024 * 1024;

export const clampRate = (rate: number): number =>
  Math.round(Math.min(MAX_TICK_RATE, Math.max(MIN_TICK_RATE, rate)));

/**
 * Serves the feed bus over WebSocket (snapshot on connect, then ordered batches)
 * and a tiny HTTP API to read and change the tick rate.
 */
export class FeedServer {
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private readonly consumers = new Set<WebSocket>();
  private timer: NodeJS.Timeout | undefined;
  private seq = 0;
  private rate: number;
  private ticksDue = 0;
  private lastLoopAt = 0;
  private lastLifecycleAt = 0;
  readonly counters = { ticks: 0, batches: 0, bytes: 0 };

  constructor(
    private readonly sim: FeedSimulator,
    private readonly opts: FeedServerOptions,
  ) {
    this.rate = clampRate(opts.rate);
    this.http = createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.http, path: '/feed' });
    this.wss.on('connection', (ws) => this.onConsumer(ws));
  }

  get tickRate(): number {
    return this.rate;
  }

  /** Bound port (useful when started with port 0 in tests). */
  get port(): number {
    const address = this.http.address();
    return typeof address === 'object' && address ? address.port : this.opts.port;
  }

  get consumerCount(): number {
    return this.consumers.size;
  }

  setRate(rate: number): number {
    this.rate = clampRate(rate);
    return this.rate;
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.http.listen(this.opts.port, resolve));
    this.lastLoopAt = this.lastLifecycleAt = Date.now();
    this.timer = setInterval(() => this.loop(), this.opts.batchIntervalMs ?? 10);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    for (const ws of this.consumers) ws.terminate();
    this.wss.close();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  private loop(): void {
    const now = Date.now();
    const changes: FeedChange[] = [];

    // Accumulate fractional ticks so the long-run rate is exact even with timer jitter.
    this.ticksDue += (this.rate * (now - this.lastLoopAt)) / 1000;
    this.lastLoopAt = now;
    const due = Math.min(Math.floor(this.ticksDue), Math.ceil(this.rate / 5));
    this.ticksDue -= Math.floor(this.ticksDue);
    for (let i = 0; i < due; i++) {
      const change = this.sim.tick(now);
      if (change) changes.push(change);
    }
    this.counters.ticks += changes.length;

    if (now - this.lastLifecycleAt >= (this.opts.lifecycleIntervalMs ?? 100)) {
      this.lastLifecycleAt = now;
      changes.push(...this.sim.advance(now));
    }

    if (changes.length === 0) return;
    const batch: FeedBatchMessage = { t: 'feed:batch', seq: ++this.seq, ts: now, changes };
    this.broadcast(JSON.stringify(batch));
    this.opts.onBatch?.(changes);
  }

  private broadcast(payload: string): void {
    this.counters.batches++;
    for (const ws of this.consumers) {
      if (ws.bufferedAmount > MAX_CONSUMER_BUFFER) {
        ws.terminate();
        continue;
      }
      ws.send(payload);
      this.counters.bytes += payload.length;
    }
  }

  private onConsumer(ws: WebSocket): void {
    const snapshot: FeedSnapshotMessage = {
      t: 'feed:snapshot',
      seq: this.seq,
      events: this.sim.snapshot(),
    };
    ws.send(JSON.stringify(snapshot));
    this.consumers.add(ws);
    ws.on('close', () => this.consumers.delete(ws));
    ws.on('error', () => this.consumers.delete(ws));
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const url = req.url?.split('?')[0];

    if (req.method === 'GET' && url === '/health') return send(200, { ok: true });
    if (req.method === 'GET' && url === '/rate') return send(200, { rate: this.rate });
    if (req.method === 'GET' && url === '/stats') {
      return send(200, {
        rate: this.rate,
        seq: this.seq,
        consumers: this.consumers.size,
        events: this.sim.countByStatus(),
        markets: this.sim.marketCount,
        ...this.counters,
      });
    }
    if (req.method === 'POST' && url === '/rate') {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
        if (body.length > 1024) req.destroy();
      });
      req.on('end', () => {
        try {
          const rate = Number((JSON.parse(body) as { rate?: unknown }).rate);
          if (!Number.isFinite(rate)) return send(400, { error: 'rate must be a number' });
          return send(200, { rate: this.setRate(rate) });
        } catch {
          return send(400, { error: 'invalid JSON' });
        }
      });
      return;
    }
    send(404, { error: 'not found' });
  }
}
