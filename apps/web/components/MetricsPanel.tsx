'use client';

import { MAX_TICK_RATE, MIN_TICK_RATE } from '@liveline/protocol';
import { useFeedLoad, useLiveMetrics } from '@/lib/live-metrics';
import { GRADE, type Grade } from '@/lib/metric-grade';

/**
 * One text per metric: the tooltip on desktop and the "What do these numbers mean?" list, which
 * also works on touch screens (no hover there). Colour limits are in lib/metric-grade.ts.
 */
export const HELP = {
  msgs: {
    label: 'WS msgs/s',
    text: 'WebSocket messages this browser receives per second. The gateway sends at most one message per topic every 100 ms.',
  },
  kb: {
    label: 'KB/s',
    text: 'Data received per second: the WebSocket payload in UTF-8 bytes. With compression off (the default) the network adds 2–10 bytes of frame header per message.',
  },
  ops: {
    label: 'ops/s',
    text: 'Price, status and score changes applied per second. Several ticks on one market within 100 ms are merged into one change.',
  },
  latency: {
    label: 'tick→client p50 / p99',
    text: 'Time from a price change in the feed to its arrival in this browser, over the last 5 s. p50 is the median: half of the updates arrive faster. p99: 99 of 100 updates arrive faster, so it shows the slow cases. Includes the up to 100 ms the gateway waits to merge changes. Uses the server clock and this device clock, so a device clock that is off shifts the number. Green: p99 up to 250 ms; red: p99 above 500 ms.',
  },
  fps: {
    label: 'FPS',
    text: 'Frames the page draws per second. 60 is smooth. Green from 55; red below 50.',
  },
  slow: {
    label: 'slow frames/s',
    text: 'Frames per second that took longer than 50 ms. These are visible stutters. Green at 0; red from 1.',
  },
  renders: {
    label: 'odds cells rendered/s',
    text: 'Odds buttons React re-rendered per second. A price change re-renders only its own button, not the row or the list.',
  },
  longTasks: {
    label: 'long tasks',
    text: 'Main-thread tasks longer than 50 ms since the page loaded. They delay taps and scrolling. Green at 0. Chrome and Edge only; other browsers show —.',
  },
  inp: {
    label: 'INP',
    text: 'Interaction to Next Paint: the delay from a tap, click or key press to the next frame on screen. Shows about the slowest interaction so far. Green up to 200 ms; red above 500 ms.',
  },
  lcp: {
    label: 'LCP',
    text: 'Largest Contentful Paint: when the biggest element of the first screen appeared, measured from the start of the page load. Green up to 2.5 s; red above 4 s.',
  },
  gaps: {
    label: 'version gaps / reconnects',
    text: 'Gaps: an update did not follow the version this browser had, so it asked for a fresh snapshot (normal after a pause or a slow connection). Reconnects: the WebSocket connection was lost and opened again. Green while there are no reconnects.',
  },
} as const;

const ms = (v: number | null | undefined) => (v != null ? `${v} ms` : undefined);

/** Live numbers measured in this browser, plus the load slider (feed tick rate). */
export function MetricsPanel() {
  const { net, main, vitals } = useLiveMetrics();
  return (
    <section className="card metrics" aria-label="Live metrics">
      <header className="card-head">
        <span>Live metrics</span>
        <span className="muted small">this browser</span>
      </header>
      <div className="card-body">
        <dl className="stats">
          <Stat help={HELP.msgs} value={net?.msgsPerSec} />
          <Stat help={HELP.kb} value={net?.kbPerSec} />
          <Stat help={HELP.ops} value={net?.opsPerSec} />
          <Stat
            help={HELP.latency}
            value={net?.latencyP50 != null ? `${net.latencyP50} / ${net.latencyP99} ms` : undefined}
            grade={GRADE.latencyP99(net?.latencyP99)}
          />
          <Stat help={HELP.fps} value={main?.fps} grade={GRADE.fps(main?.fps)} />
          <Stat
            help={HELP.slow}
            value={main?.slowFrames}
            grade={GRADE.slowFrames(main?.slowFrames)}
          />
          <Stat help={HELP.renders} value={main?.oddsRenders} />
          <Stat
            help={HELP.longTasks}
            value={main?.longTasks ?? undefined}
            grade={GRADE.longTasks(main?.longTasks)}
          />
          <Stat help={HELP.inp} value={ms(vitals.inp)} grade={GRADE.inp(vitals.inp)} />
          <Stat help={HELP.lcp} value={ms(vitals.lcp)} grade={GRADE.lcp(vitals.lcp)} />
          <Stat
            help={HELP.gaps}
            value={net ? `${net.gaps} / ${net.reconnects}` : undefined}
            grade={GRADE.reconnects(net?.reconnects)}
          />
        </dl>
        <details className="metrics-help">
          <summary>What do these numbers mean?</summary>
          <dl>
            {Object.values(HELP).map((h) => (
              <div key={h.label}>
                <dt>{h.label}</dt>
                <dd>{h.text}</dd>
              </div>
            ))}
          </dl>
        </details>
        <LoadSlider />
      </div>
    </section>
  );
}

function Stat({
  help,
  value,
  grade,
}: {
  help: { label: string; text: string };
  value: string | number | undefined;
  grade?: Grade;
}) {
  return (
    <div className="stat" title={help.text}>
      <dt>{help.label}</dt>
      <dd data-grade={grade}>{value ?? '—'}</dd>
    </div>
  );
}

function LoadSlider() {
  const { rate, enabled, setRate } = useFeedLoad();
  return (
    <label className="slider">
      <span>
        Feed load <strong>{rate ?? '—'}</strong> market updates per second
      </span>
      <input
        type="range"
        min={MIN_TICK_RATE}
        max={MAX_TICK_RATE}
        step={50}
        value={rate ?? MIN_TICK_RATE}
        disabled={!enabled}
        onChange={(e) => setRate(Number(e.target.value))}
        aria-label="Feed market updates per second"
      />
      <span className="muted small">Shared demo: the rate applies to every viewer.</span>
    </label>
  );
}
