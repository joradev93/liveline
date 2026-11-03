import { clientMessageSchema } from '@liveline/protocol/schemas';
import type { ErrorMessage, Topic } from '@liveline/protocol';
import uWS, { type UWS } from './uws.js';
import type { FeedClient } from './feed-client.js';
import type { Subscriber, TopicHub } from './hub.js';

export interface GatewayServerOptions {
  port: number;
  compression: boolean;
  /** uWS closes a socket whose buffer grows past this (the hub skips deltas well before it). */
  maxBackpressure: number;
}

interface SocketData {
  sub?: Subscriber;
}

const decoder = new TextDecoder();
const errorPayload = (code: ErrorMessage['code'], message: string) =>
  JSON.stringify({ t: 'error', code, message } satisfies ErrorMessage);

/** uWebSockets.js transport: WebSocket endpoint `/ws` plus a few HTTP endpoints. */
export class GatewayServer {
  private readonly app: UWS.TemplatedApp;
  private listenSocket: UWS.us_listen_socket | null = null;
  private clients = 0;
  private boundPort = 0;
  readonly counters = { connections: 0, messagesIn: 0, badMessages: 0 };

  constructor(
    private readonly hub: TopicHub,
    private readonly feed: FeedClient,
    private readonly opts: GatewayServerOptions,
  ) {
    this.app = uWS.App();
    this.routes();
  }

  get port(): number {
    return this.boundPort;
  }

  get clientCount(): number {
    return this.clients;
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.app.listen(this.opts.port, (socket) => {
        if (!socket) return reject(new Error(`cannot listen on port ${this.opts.port}`));
        this.listenSocket = socket;
        this.boundPort = uWS.us_socket_local_port(socket);
        resolve();
      });
    });
  }

  close(): void {
    if (this.listenSocket) uWS.us_listen_socket_close(this.listenSocket);
    this.listenSocket = null;
    this.app.close();
  }

  private routes(): void {
    this.app.ws<SocketData>('/ws', {
      compression: this.opts.compression ? uWS.SHARED_COMPRESSOR : uWS.DISABLED,
      maxPayloadLength: 16 * 1024,
      maxBackpressure: this.opts.maxBackpressure,
      closeOnBackpressureLimit: true,
      idleTimeout: 120,
      sendPingsAutomatically: true,
      open: (ws) => {
        const data = ws.getUserData();
        data.sub = {
          topics: new Map(),
          send: (payload) => void ws.send(payload, false),
          bufferedAmount: () => ws.getBufferedAmount(),
          cork: (fn) => void ws.cork(fn),
        };
        this.clients++;
        this.counters.connections++;
      },
      message: (ws, message) => {
        const sub = ws.getUserData().sub;
        if (!sub) return;
        this.counters.messagesIn++;
        let raw: unknown;
        try {
          raw = JSON.parse(decoder.decode(message));
        } catch {
          raw = undefined;
        }
        const parsed = clientMessageSchema.safeParse(raw);
        if (!parsed.success) {
          this.counters.badMessages++;
          ws.send(errorPayload('BAD_MESSAGE', 'expected {t:"sub"|"unsub", topics:[...]}'), false);
          return;
        }
        const msg = parsed.data;
        for (const topic of msg.topics as Topic[]) {
          if (msg.t === 'unsub') {
            this.hub.unsubscribe(sub, topic);
            continue;
          }
          const result = this.hub.subscribe(sub, topic);
          if (result === 'unknown-topic') ws.send(errorPayload('UNKNOWN_TOPIC', topic), false);
          if (result === 'too-many-topics') ws.send(errorPayload('TOO_MANY_TOPICS', topic), false);
        }
      },
      close: (ws) => {
        const sub = ws.getUserData().sub;
        if (sub) this.hub.drop(sub);
        this.clients--;
      },
    });

    this.app.get('/health', (res) => {
      json(res, this.feed.connected ? 200 : 503, { ok: this.feed.connected });
    });

    // Lets load generators on another clock (e.g. k6 in Docker) measure their clock offset.
    this.app.get('/time', (res) => json(res, 200, { now: Date.now() }));

    this.app.get('/stats', (res) => {
      json(res, 200, {
        clients: this.clients,
        ...this.counters,
        hub: this.hub.stats,
        feed: { connected: this.feed.connected, ...this.feed.counters },
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      });
    });

    this.app.get('/snapshot/:topic', (res, req) => {
      const topic = decodeURIComponent(req.getParameter(0) ?? '') as Topic;
      const payload = this.hub.snapshotPayload(topic);
      if (!payload) return json(res, 404, { error: 'unknown topic' });
      res.cork(() => {
        res.writeHeader('content-type', 'application/json');
        res.writeHeader('access-control-allow-origin', '*');
        res.writeHeader('cache-control', 'no-store');
        res.end(payload);
      });
    });

    this.app.any('/*', (res) => json(res, 404, { error: 'not found' }));
  }
}

function json(res: UWS.HttpResponse, status: number, body: unknown): void {
  res.cork(() => {
    res.writeStatus(
      status === 200 ? '200 OK' : status === 404 ? '404 Not Found' : `${status} Error`,
    );
    res.writeHeader('content-type', 'application/json');
    res.writeHeader('access-control-allow-origin', '*');
    res.end(JSON.stringify(body));
  });
}
