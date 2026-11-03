import type { AcceptChanges } from '@liveline/protocol';

export interface SlipLeg {
  eventId: number;
  marketId: number;
  k: string;
  /** Odds when the leg was added or last accepted by the user. */
  odds: number;
  label: string;
  marketName: string;
  eventName: string;
}

export const legKey = (marketId: number, k: string) => `${marketId}:${k}`;

type Listener = () => void;

/** Betslip selections. Small external store so odds buttons can subscribe to "am I selected". */
export class BetslipStore {
  private legs: SlipLeg[] = [];
  private policy: AcceptChanges = 'higher';
  private readonly listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getLegs = (): SlipLeg[] => this.legs;
  getPolicy = (): AcceptChanges => this.policy;
  has = (marketId: number, k: string): boolean =>
    this.legs.some((l) => l.marketId === marketId && l.k === k);

  toggle(leg: SlipLeg): void {
    if (this.has(leg.marketId, leg.k)) {
      this.legs = this.legs.filter((l) => !(l.marketId === leg.marketId && l.k === leg.k));
    } else {
      // One selection per market: picking another outcome replaces the old one.
      this.legs = [...this.legs.filter((l) => l.marketId !== leg.marketId), leg];
    }
    this.emit();
  }

  remove(marketId: number, k: string): void {
    this.legs = this.legs.filter((l) => !(l.marketId === marketId && l.k === k));
    this.emit();
  }

  /** User accepted the current prices. */
  acceptOdds(current: Map<string, number>): void {
    this.legs = this.legs.map((l) => {
      const p = current.get(legKey(l.marketId, l.k));
      return p !== undefined && p !== l.odds ? { ...l, odds: p } : l;
    });
    this.emit();
  }

  setPolicy(policy: AcceptChanges): void {
    this.policy = policy;
    this.emit();
  }

  clear(): void {
    this.legs = [];
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
