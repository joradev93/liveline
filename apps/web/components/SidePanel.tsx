'use client';

import { useState } from 'react';
import { useSlipLegs } from '@/lib/ui-context';
import { Betslip } from './Betslip';

/** Right column on desktop; a bottom sheet with a toggle bar on small screens. */
export function SidePanel() {
  const [open, setOpen] = useState(false);
  const legs = useSlipLegs();
  return (
    <aside className="side" data-open={open || undefined}>
      <button
        type="button"
        className="sheet-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>
          Betslip <span className="count">{legs.length}</span>
        </span>
        <span aria-hidden="true">{open ? '▾' : '▴'}</span>
      </button>
      <div className="side-content">
        <Betslip />
      </div>
    </aside>
  );
}
