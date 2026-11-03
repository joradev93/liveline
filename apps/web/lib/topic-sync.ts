import { hasVersionGap, isStaleDelta, type ServerMessage, type Topic } from '@liveline/protocol';
import type { FeedItem } from './worker-protocol';

export type SyncResult =
  | { action: 'apply'; item: FeedItem; latencyMs?: number }
  | { action: 'resubscribe'; topic: Topic }
  | { action: 'ignore' };

/**
 * Client side of the version protocol, without I/O (runs inside the feed worker).
 *
 * - snapshot: replaces the topic state and sets its version
 * - delta with v <= version: stale, ignored
 * - delta with from > version: gap -> resubscribe (the server answers with a snapshot)
 * - otherwise apply and move to v
 */
export class TopicSync {
  /** topic -> version; -1 while waiting for the first snapshot. */
  private readonly versions = new Map<Topic, number>();
  gaps = 0;

  /** Returns true when a `sub` must be sent (first interest in this topic). */
  want(topic: Topic): boolean {
    if (this.versions.has(topic)) return false;
    this.versions.set(topic, -1);
    return true;
  }

  drop(topic: Topic): void {
    this.versions.delete(topic);
  }

  /** After a reconnect every topic needs a new snapshot. */
  resetAll(): Topic[] {
    for (const topic of this.versions.keys()) this.versions.set(topic, -1);
    return [...this.versions.keys()];
  }

  handle(msg: ServerMessage, now: number): SyncResult {
    if (msg.t === 'error') return { action: 'ignore' };
    const version = this.versions.get(msg.topic);
    if (version === undefined) return { action: 'ignore' }; // unsubscribed meanwhile

    if (msg.t === 'snapshot') {
      this.versions.set(msg.topic, msg.v);
      return { action: 'apply', item: { kind: 'snapshot', topic: msg.topic, events: msg.events } };
    }
    if (version < 0 || isStaleDelta(version, msg)) return { action: 'ignore' };
    if (hasVersionGap(version, msg)) {
      this.gaps++;
      this.versions.set(msg.topic, -1);
      return { action: 'resubscribe', topic: msg.topic };
    }
    this.versions.set(msg.topic, msg.v);
    return {
      action: 'apply',
      item: { kind: 'delta', topic: msg.topic, ops: msg.ops },
      latencyMs: now - msg.ts,
    };
  }
}
