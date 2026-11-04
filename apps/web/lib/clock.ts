import { useSyncExternalStore } from 'react';

/** "Starts in" labels have minute precision; a 15 s tick keeps them at most 15 s behind. */
const TICK_MS = 15_000;

const listeners = new Set<() => void>();
let now = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/**
 * Current time for relative labels, shared by every component: one timer, started while
 * something is mounted. 0 on the server and during hydration, where the caller uses Date.now().
 */
export function useNow(): number {
  const t = useSyncExternalStore(
    subscribe,
    () => now,
    () => 0,
  );
  return t || Date.now();
}
