import type { CountsMessage } from '@liveline/protocol';
import type { MarketState } from './state.js';

/**
 * Turns the per-sport event counts into a `counts` message, and reports when it changed.
 * Called on every flush; counts change only when an event is added or removed.
 */
export class CountsTracker {
  private last: string | null = null;

  constructor(private readonly state: MarketState) {}

  /** Latest serialized message; null until the feed delivered its first snapshot. */
  get payload(): string | null {
    return this.last;
  }

  /** The new serialized message if the counts changed since the last call, else null. */
  poll(): string | null {
    if (this.state.eventCount === 0) return null; // feed not connected yet
    const payload = JSON.stringify({
      t: 'counts',
      counts: this.state.sportCounts(),
    } satisfies CountsMessage);
    if (payload === this.last) return null;
    this.last = payload;
    return payload;
  }
}
