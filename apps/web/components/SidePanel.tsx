'use client';

import { useState } from 'react';
import { LiveMetricsProvider } from '@/lib/live-metrics';
import { useSlipLegs } from '@/lib/ui-context';
import { Betslip } from './Betslip';
import { MetricsPanel } from './MetricsPanel';
import { MetricsStrip } from './MetricsStrip';

type Sheet = 'slip' | 'metrics';

/**
 * Right column on desktop. On small screens: a bottom bar with the compact metrics strip and the
 * betslip button, each opening its own bottom sheet, so the list stays visible next to the numbers.
 */
export function SidePanel() {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const legs = useSlipLegs();
  const toggle = (s: Sheet) => setSheet((open) => (open === s ? null : s));
  return (
    <LiveMetricsProvider>
      <aside className="side" data-sheet={sheet ?? undefined}>
        <div className="side-content">
          <Betslip />
          <MetricsPanel />
        </div>
        <nav className="dock" aria-label="Betslip and live metrics">
          <button
            type="button"
            className="dock-metrics"
            onClick={() => toggle('metrics')}
            aria-expanded={sheet === 'metrics'}
            aria-label="Live metrics and feed load"
          >
            <MetricsStrip />
            <span className="dock-chevron" aria-hidden="true">
              {sheet === 'metrics' ? '▾' : '▴'}
            </span>
          </button>
          <button
            type="button"
            className="dock-slip"
            onClick={() => toggle('slip')}
            aria-expanded={sheet === 'slip'}
          >
            Betslip <span className="count">{legs.length}</span>
            <span className="dock-chevron" aria-hidden="true">
              {sheet === 'slip' ? '▾' : '▴'}
            </span>
          </button>
        </nav>
      </aside>
    </LiveMetricsProvider>
  );
}
