'use client';

import type { MarketStatus, Topic } from '@liveline/protocol';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import type { FeedClient } from './feed-client';
import { eventKey, marketKey, topicKey, type LiveStore } from './store';

export const StoreContext = createContext<LiveStore | null>(null);
export const FeedContext = createContext<FeedClient | null>(null);

export function useStore(): LiveStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreContext missing');
  return store;
}

export const useFeed = (): FeedClient | null => useContext(FeedContext);

function useKey<T>(key: string, get: () => T): T {
  const store = useStore();
  const subscribe = useCallback((cb: () => void) => store.subscribe(key, cb), [store, key]);
  return useSyncExternalStore(subscribe, get, get);
}

/**
 * Price of one selection and the status of its market, with one store subscription (there are
 * hundreds of odds buttons on screen). Only this cell re-renders when one of the two changes:
 * the snapshot is a string, so React compares it by value.
 */
export function useSelection(
  marketId: number,
  k: string,
): { price: number | undefined; status: MarketStatus | undefined } {
  const store = useStore();
  const state = useKey(marketKey(marketId), () => {
    const market = store.getMarket(marketId);
    return market ? `${market.sel.find((s) => s.k === k)?.p ?? ''}|${market.status}` : '';
  });
  const [price = '', status] = state.split('|');
  return {
    price: price === '' ? undefined : Number(price),
    status: status as MarketStatus | undefined,
  };
}

export function useMarketStatus(marketId: number) {
  const store = useStore();
  return useKey(marketKey(marketId), () => store.getMarket(marketId)?.status);
}

export function useMarket(marketId: number) {
  const store = useStore();
  return useKey(marketKey(marketId), () => store.getMarket(marketId));
}

/** Market type, name, line and selection keys: does not change on price ticks. */
export function useMarketShape(marketId: number) {
  const store = useStore();
  return useKey(marketKey(marketId), () => store.getMarketShape(marketId));
}

export function useEvent(eventId: number) {
  const store = useStore();
  return useKey(eventKey(eventId), () => store.getEvent(eventId));
}

export function useTopicEventIds(topic: Topic): number[] {
  const store = useStore();
  return useKey(topicKey(topic), () => store.getTopicEventIds(topic));
}

/**
 * Current prices of several selections, as one array (betslip). The snapshot is a string
 * so React can compare it cheaply; the array is rebuilt only when a price changed.
 */
export function usePrices(
  legs: readonly { marketId: number; k: string }[],
): (number | undefined)[] {
  const store = useStore();
  const subscribe = useCallback(
    (cb: () => void) => {
      const offs = legs.map((l) => store.subscribe(marketKey(l.marketId), cb));
      return () => offs.forEach((off) => off());
    },
    [store, legs],
  );
  const get = useCallback(
    () => legs.map((l) => store.getPrice(l.marketId, l.k) ?? '').join('|'),
    [store, legs],
  );
  const signature = useSyncExternalStore(subscribe, get, get);
  return useMemo(
    () => signature.split('|').map((p) => (p === '' ? undefined : Number(p))),
    [signature],
  );
}

/** Keep a live subscription to a topic while the component is mounted. */
export function useTopic(topic: Topic | null): void {
  const feed = useFeed();
  useEffect(() => {
    if (!feed || !topic) return;
    return feed.subscribe(topic);
  }, [feed, topic]);
}

const noSubscribe = () => () => {};

/**
 * Live number of events of a sport, pushed by the gateway. Undefined until the first `counts`
 * message (and in the server render): callers then show the count from the server render.
 */
export function useSportCount(sportId: number): number | undefined {
  const feed = useFeed();
  return useSyncExternalStore(
    feed?.subscribeCounts ?? noSubscribe,
    () => feed?.counts?.[sportId],
    () => undefined,
  );
}
