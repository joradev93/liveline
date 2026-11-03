'use client';

import { MAX_TICK_RATE, MIN_TICK_RATE } from '@liveline/protocol';
import { useEffect, useRef, useState } from 'react';
import { useFeed } from '@/lib/hooks';
import { renderStats } from '@/lib/render-stats';
import type { FeedMetrics } from '@/lib/worker-protocol';

interface MainThread {
  fps: number;
  /** Frames slower than 50 ms in the last second. */
  slowFrames: number;
  oddsRenders: number;
  longTasks: number;
}

interface Vitals {
  inp: number | null;
  lcp: number | null;
}

/** Live numbers measured in this browser, plus the load slider (feed tick rate). */
export function MetricsPanel() {
  const feed = useFeed();
  const [net, setNet] = useState<FeedMetrics | null>(null);
  const [main, setMain] = useState<MainThread>({
    fps: 0,
    slowFrames: 0,
    oddsRenders: 0,
    longTasks: 0,
  });
  const [vitals, setVitals] = useState<Vitals>({ inp: null, lcp: null });

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
    try {
      observer = new PerformanceObserver((list) => (longTasks += list.getEntries().length));
      observer.observe({ type: 'longtask', buffered: false });
    } catch {
      // longtask is Chromium-only
    }
    let renders = renderStats.odds;
    const timer = setInterval(() => {
      setMain({
        fps: frames,
        slowFrames: slow,
        oddsRenders: renderStats.odds - renders,
        longTasks,
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
    <section className="card metrics" aria-label="Live metrics">
      <header className="card-head">
        <span>Live metrics</span>
        <span className="muted small">this browser</span>
      </header>
      <div className="card-body">
        <dl className="stats">
          <Stat label="WS msgs/s" value={net?.msgsPerSec} />
          <Stat label="KB/s" value={net?.kbPerSec} />
          <Stat
            label="ops/s"
            value={net?.opsPerSec}
            hint="Market/event updates applied after coalescing"
          />
          <Stat
            label="tick→client p50 / p99"
            value={net?.latencyP50 != null ? `${net.latencyP50} / ${net.latencyP99} ms` : undefined}
            hint="Feed time of the oldest change in a delta → arrival in the worker, last 5 s"
          />
          <Stat label="FPS" value={main.fps} warn={main.fps > 0 && main.fps < 50} />
          <Stat
            label="slow frames/s"
            value={main.slowFrames}
            hint="Frames longer than 50 ms"
            warn={main.slowFrames > 0}
          />
          <Stat
            label="odds cells rendered/s"
            value={main.oddsRenders}
            hint="React renders of single odds buttons"
          />
          <Stat
            label="long tasks"
            value={main.longTasks}
            hint="Main-thread tasks over 50 ms since load"
          />
          <Stat
            label="INP"
            value={vitals.inp != null ? `${vitals.inp} ms` : '—'}
            hint="Interaction to Next Paint (web-vitals)"
            warn={(vitals.inp ?? 0) > 200}
          />
          <Stat label="LCP" value={vitals.lcp != null ? `${vitals.lcp} ms` : '—'} />
          <Stat
            label="version gaps / reconnects"
            value={net ? `${net.gaps} / ${net.reconnects}` : undefined}
          />
        </dl>
        <LoadSlider />
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string | number | undefined;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="stat" title={hint}>
      <dt>{label}</dt>
      <dd data-warn={warn || undefined}>{value ?? '—'}</dd>
    </div>
  );
}

function LoadSlider() {
  const [rate, setRate] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    void fetch('/api/load')
      .then((r) => r.json() as Promise<{ rate: number | null; enabled: boolean }>)
      .then((d) => {
        setRate(d.rate);
        setEnabled(d.enabled && d.rate !== null);
      })
      .catch(() => setEnabled(false));
  }, []);

  const onChange = (value: number) => {
    setRate(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void fetch('/api/load', { method: 'POST', body: JSON.stringify({ rate: value }) });
    }, 250);
  };

  return (
    <label className="slider">
      <span>
        Feed load <strong>{rate ?? '—'}</strong> ticks/s
      </span>
      <input
        type="range"
        min={MIN_TICK_RATE}
        max={MAX_TICK_RATE}
        step={50}
        value={rate ?? MIN_TICK_RATE}
        disabled={!enabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Feed ticks per second"
      />
      <span className="muted small">Shared demo: the rate applies to every viewer.</span>
    </label>
  );
}
