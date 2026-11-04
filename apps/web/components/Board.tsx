'use client';

import { sportTopic, type SnapshotMessage } from '@liveline/protocol';
import { useState, type CSSProperties } from 'react';
import { useStore, useTopic, useTopicEventIds } from '@/lib/hooks';
import { useWindowList } from '@/lib/window-list';
import { EventRow } from './EventRow';

/** `--row-h` of `.list` on desktop (globals.css); the browser reads the real value per breakpoint. */
const DESKTOP_ROW_HEIGHT = 82;

interface Props {
  sportId: number;
  /** First rows of the snapshot, fetched by the server component; seeds the store for the first paint. */
  initial: SnapshotMessage | null;
}

/**
 * Virtualized list of a sport's events. The server snapshot is rendered first (fast LCP);
 * then the WebSocket subscription takes over.
 */
export function Board({ sportId, initial }: Props) {
  const store = useStore();
  const topic = sportTopic(sportId);

  // Seed once per mount (keyed by sport in the page). Silent: nothing is subscribed yet.
  useState(() => {
    if (initial && !store.hasTopic(topic))
      store.loadSnapshot(topic, initial.events, { silent: true });
    return null;
  });
  useTopic(topic);
  const ids = useTopicEventIds(topic);

  const { listRef, start, end } = useWindowList({
    count: ids.length,
    initialRowHeight: DESKTOP_ROW_HEIGHT,
    overscan: 8,
    // Server render and first client render use the same viewport guess, so they match.
    initialViewport: 1000,
  });

  if (ids.length === 0) {
    return (
      <div className="empty">
        {initial ? 'No events right now.' : 'Connecting to the live feed…'}
      </div>
    );
  }

  return (
    <div ref={listRef} className="list" style={{ height: `calc(var(--row-h) * ${ids.length})` }}>
      {ids.slice(start, end).map((id, i) => (
        <div key={id} className="list-item" style={{ '--i': start + i } as CSSProperties}>
          <EventRow eventId={id} />
        </div>
      ))}
    </div>
  );
}
