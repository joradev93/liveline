'use client';

import { useFeedLoad, useLiveMetrics } from '@/lib/live-metrics';
import { GRADE, type Grade } from '@/lib/metric-grade';

/** Four key numbers for the bottom bar on small screens. The full panel opens on tap. */
export function MetricsStrip() {
  const { net, main } = useLiveMetrics();
  const { rate } = useFeedLoad();
  return (
    <span className="strip">
      <Mini label="updates/s" value={rate} />
      <Mini label="ops/s" value={net?.opsPerSec} />
      <Mini
        label="p50/p99 ms"
        value={net?.latencyP50 != null ? `${net.latencyP50}/${net.latencyP99}` : undefined}
        grade={GRADE.latencyP99(net?.latencyP99)}
      />
      <Mini label="FPS" value={main?.fps} grade={GRADE.fps(main?.fps)} />
    </span>
  );
}

function Mini({
  label,
  value,
  grade,
}: {
  label: string;
  value: string | number | null | undefined;
  grade?: Grade;
}) {
  return (
    <span className="mini">
      <span className="mini-value" data-grade={grade}>
        {value ?? '—'}
      </span>
      <span className="mini-label">{label}</span>
    </span>
  );
}
