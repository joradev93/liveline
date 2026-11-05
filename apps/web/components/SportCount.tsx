'use client';

import { useSportCount } from '@/lib/hooks';

interface Props {
  sportId: number;
  /** Count from the server render; replaced by the live count from the WebSocket. */
  initial: number | undefined;
}

/** Badge with the number of events of a sport (sport tabs). */
export function SportCount({ sportId, initial }: Props) {
  const count = useSportCount(sportId) ?? initial;
  if (count === undefined) return null;
  return (
    <span className="tab-count">
      {count}
      <span className="sr-only"> events</span>
    </span>
  );
}

/** "248 events" next to the sport heading. */
export function EventCount({ sportId, initial }: Props) {
  const count = useSportCount(sportId) ?? initial;
  return <span className="muted">{count === undefined ? '' : `${count} events`}</span>;
}
