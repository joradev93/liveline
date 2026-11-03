import type { FeedChange, FeedMessage, SportEvent } from '@liveline/protocol';

export interface FeedClientHandlers {
  onSnapshot(events: SportEvent[]): void;
  onChanges(changes: FeedChange[]): void;
  onStatus?(connected: boolean): void;
}

/**
 * Consumes the feed bus (used by the gateway and the bet API). Reconnects with backoff; a gap in `seq` forces a reconnect,
 * which delivers a fresh snapshot.
 */
export class FeedClient {
  private ws: WebSocket | undefined;
  private seq = -1;
  private retryMs = 250;
  private stopped = false;
  readonly counters = { batches: 0, changes: 0, reconnects: 0, gaps: 0, lastBatchTs: 0 };

  constructor(
    private readonly url: string,
    private readonly handlers: FeedClientHandlers,
  ) {}

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.seq >= 0;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
  }

  private connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.seq = -1;
    let retried = false;
    // Node's built-in WebSocket fires only `error` (no `close`) when the handshake fails, and
    // calling close() then re-enters onerror. So reconnect from whichever event comes first.
    const retry = () => {
      if (retried) return;
      retried = true;
      this.handlers.onStatus?.(false);
      if (this.stopped) return;
      this.counters.reconnects++;
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 5_000);
    };
    ws.onmessage = (ev) => this.onMessage(JSON.parse(String(ev.data)) as FeedMessage);
    ws.onclose = retry;
    ws.onerror = retry;
  }

  private onMessage(msg: FeedMessage): void {
    if (msg.t === 'feed:snapshot') {
      this.seq = msg.seq;
      this.retryMs = 250;
      this.handlers.onSnapshot(msg.events);
      this.handlers.onStatus?.(true);
      return;
    }
    if (this.seq < 0) return;
    if (msg.seq !== this.seq + 1) {
      this.counters.gaps++;
      this.ws?.close();
      return;
    }
    this.seq = msg.seq;
    this.counters.batches++;
    this.counters.changes += msg.changes.length;
    this.counters.lastBatchTs = msg.ts;
    this.handlers.onChanges(msg.changes);
  }
}
