/**
 * Green / red colours of the live metrics. A metric without a quality meaning (msgs/s, KB/s,
 * ops/s, renders/s, feed load) gets no grade. Between the two limits the value has no colour.
 */
export type Grade = 'good' | 'bad';

type Value = number | null | undefined;

/** Lower is better: good at or under `good`, bad above `bad`. */
export function gradeLow(value: Value, good: number, bad: number): Grade | undefined {
  if (value == null) return undefined;
  if (value <= good) return 'good';
  if (value > bad) return 'bad';
  return undefined;
}

/** Higher is better: good at or above `good`, bad below `bad`. */
export function gradeHigh(value: Value, good: number, bad: number): Grade | undefined {
  if (value == null) return undefined;
  if (value >= good) return 'good';
  if (value < bad) return 'bad';
  return undefined;
}

/**
 * Limits. INP and LCP use the web.dev "good" / "poor" limits. Latency is p99 over the internet,
 * so the limit is wider than the 150 ms gateway target from the load tests (METRICS.md), which
 * were measured on one machine; it includes up to 100 ms of coalescing.
 */
export const GRADE = {
  latencyP99: (ms: Value) => gradeLow(ms, 250, 500),
  /** 0 = the tab draws nothing (hidden or in the background): not a slow page, no colour. */
  fps: (fps: Value) => (fps ? gradeHigh(fps, 55, 50) : undefined),
  slowFrames: (n: Value) => gradeLow(n, 0, 0),
  /** No red: a few long tasks during the first load are normal. */
  longTasks: (n: Value): Grade | undefined => (n === 0 ? 'good' : undefined),
  inp: (ms: Value) => gradeLow(ms, 200, 500),
  lcp: (ms: Value) => gradeLow(ms, 2500, 4000),
  /** Gaps are normal (resync after a pause); a lost connection is not. */
  reconnects: (n: Value): Grade | undefined => (n === 0 ? 'good' : undefined),
} as const;
