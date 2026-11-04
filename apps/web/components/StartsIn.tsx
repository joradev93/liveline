'use client';

import { useNow } from '@/lib/clock';
import { formatStart } from '@/lib/format';

/** "in 12m" for an upcoming event; updates while the event waits to start. */
export function StartsIn({ start, prefix = '' }: { start: number; prefix?: string }) {
  const now = useNow();
  return (
    // Server and browser clocks differ: the text may change on hydration.
    <span className="starts" suppressHydrationWarning>
      {prefix}
      {formatStart(start, now)}
    </span>
  );
}
