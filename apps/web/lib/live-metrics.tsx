'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFeed } from './hooks';
import { renderStats } from './render-stats';
import type { FeedMetrics } from './worker-protocol';

export interface MainThread {
  fps: number;
  /** Frames slower than 50 ms in the last second. */
  slowFrames: number;
  oddsRenders: number;
  /** Since the page loaded; null where the browser has no `longtask` entries (Safari, Firefox). */
  longTasks: number | null;
}

export interface Vitals {
  inp: number | null;
  lcp: number | null;
}

export interface LiveMetrics {
  net: FeedMetrics | null;
  /** null until the first full second is measured. */
  main: MainThread | null;
  vitals: Vitals;
}

export interface FeedLoad {
  rate: number | null;
  enabled: boolean;
  setRate: (rate: number) => void;
}

const MetricsContext = createContext<LiveMetrics | null>(null);
const LoadContext = createContext<FeedLoad | null>(null);

/**
 * Measures once per page and shares the numbers with the full metrics panel and the compact
 * strip on phones. Only components that read the context re-render every second; `children`
 * (the betslip, for example) do not.
 */
export function LiveMetricsProvider({ children }: { children: ReactNode }) {
  const feed = useFeed();
  const [net, setNet] = useState<FeedMetrics | null>(null);
  const [main, setMain] = useState<MainThread | null>(null);
  const [vitals, setVitals] = useState<Vitals>({ inp: null, lcp: null });
  const load = useFeedLoadState();

  useEffect(() => feed?.onMetrics(setNet), [feed]);

  // FPS and slow frames from requestAnimationFrame; long tasks from PerformanceObserver.
  useEffect(() => {
    let frames = 0;
    let slow = 0;
    let longTasks = 0;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      frames++;
      if (now - last > 50) slow++;
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    let observer: PerformanceObserver | undefined;
    const hasLongTasks = PerformanceObserver.supportedEntryTypes?.includes('longtask') ?? false;
    if (hasLongTasks) {
      observer = new PerformanceObserver((list) => (longTasks += list.getEntries().length));
      observer.observe({ type: 'longtask', buffered: false });
    }
    let renders = renderStats.odds;
    const timer = setInterval(() => {
      setMain({
        fps: frames,
        slowFrames: slow,
        oddsRenders: renderStats.odds - renders,
        longTasks: hasLongTasks ? longTasks : null,
      });
      renders = renderStats.odds;
      frames = slow = 0;
    }, 1_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      observer?.disconnect();
    };
  }, []);

  // Core Web Vitals, loaded after hydration so they do not add to the initial bundle.
  useEffect(() => {
    let cancelled = false;
    void import('web-vitals').then(({ onINP, onLCP }) => {
      if (cancelled) return;
      onINP((m) => setVitals((v) => ({ ...v, inp: Math.round(m.value) })), {
        reportAllChanges: true,
      });
      onLCP((m) => setVitals((v) => ({ ...v, lcp: Math.round(m.value) })), {
        reportAllChanges: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <MetricsContext.Provider value={{ net, main, vitals }}>
      <LoadContext.Provider value={load}>{children}</LoadContext.Provider>
    </MetricsContext.Provider>
  );
}

/** Feed tick rate from `/api/load`; changes are sent 250 ms after the slider stops. */
function useFeedLoadState(): FeedLoad {
  const [rate, setRateState] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    void fetch('/api/load')
      .then((r) => r.json() as Promise<{ rate: number | null; enabled: boolean }>)
      .then((d) => {
        setRateState(d.rate);
        setEnabled(d.enabled && d.rate !== null);
      })
      .catch(() => setEnabled(false));
  }, []);

  const setRate = (value: number) => {
    setRateState(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void fetch('/api/load', { method: 'POST', body: JSON.stringify({ rate: value }) });
    }, 250);
  };

  return { rate, enabled, setRate };
}

export function useLiveMetrics(): LiveMetrics {
  const m = useContext(MetricsContext);
  if (!m) throw new Error('LiveMetricsProvider missing');
  return m;
}

export function useFeedLoad(): FeedLoad {
  const l = useContext(LoadContext);
  if (!l) throw new Error('LiveMetricsProvider missing');
  return l;
}
