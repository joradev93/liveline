import type { Topic } from '@liveline/protocol';
import type { LiveStore } from './store';
import type { FeedMetrics, FromWorker, ToWorker } from './worker-protocol';

type MetricsListener = (metrics: FeedMetrics) => void;

/**
 * Main-thread side of the feed: starts the worker, reference-counts topic subscriptions
 * and applies worker batches to the store.
 */
export class FeedClient {
  private readonly worker: Worker;
  private readonly refs = new Map<Topic, number>();
  private readonly pendingDrops = new Map<Topic, ReturnType<typeof setTimeout>>();
  private readonly metricsListeners = new Set<MetricsListener>();
  private readonly countsListeners = new Set<() => void>();
  latest: FeedMetrics | null = null;
  /** Events per sport id from the gateway; null until the first `counts` message. */
  counts: Readonly<Record<string, number>> | null = null;

  constructor(
    private readonly store: LiveStore,
    url: string,
  ) {
    this.worker = new Worker(new URL('./feed.worker.ts', import.meta.url), {
      type: 'module',
      name: 'feed',
    });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const msg = ev.data;
      if (msg.type === 'batch') this.store.applyItems(msg.items);
      else if (msg.type === 'counts') {
        this.counts = msg.counts;
        for (const listener of this.countsListeners) listener();
      } else {
        this.latest = msg.metrics;
        for (const listener of this.metricsListeners) listener(msg.metrics);
      }
    };
    this.post({ type: 'connect', url });
  }

  /** Subscribe to a topic; returns the unsubscribe function. */
  subscribe(topic: Topic): () => void {
    const count = this.refs.get(topic) ?? 0;
    this.refs.set(topic, count + 1);
    const drop = this.pendingDrops.get(topic);
    if (drop) {
      // Unsubscribed and subscribed again right away (StrictMode, fast navigation): keep it.
      clearTimeout(drop);
      this.pendingDrops.delete(topic);
    } else if (count === 0) {
      this.post({ type: 'sub', topic });
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const left = (this.refs.get(topic) ?? 1) - 1;
      if (left > 0) return void this.refs.set(topic, left);
      this.refs.delete(topic);
      this.pendingDrops.set(
        topic,
        setTimeout(() => {
          this.pendingDrops.delete(topic);
          this.post({ type: 'unsub', topic });
          this.store.dropTopic(topic);
        }, 1_000),
      );
    };
  }

  close(): void {
    for (const timer of this.pendingDrops.values()) clearTimeout(timer);
    this.worker.terminate();
  }

  /** For `useSyncExternalStore`: called after `counts` changed. */
  subscribeCounts = (listener: () => void): (() => void) => {
    this.countsListeners.add(listener);
    return () => this.countsListeners.delete(listener);
  };

  onMetrics(listener: MetricsListener): () => void {
    this.metricsListeners.add(listener);
    return () => this.metricsListeners.delete(listener);
  }

  private post(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }
}
