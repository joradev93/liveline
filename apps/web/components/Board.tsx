'use client';

import { sportTopic, type SnapshotMessage } from '@liveline/protocol';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState } from 'react';
import { useStore, useTopic, useTopicEventIds } from '@/lib/hooks';
import { EventRow } from './EventRow';

const ROW_ESTIMATE = 76;

interface Props {
  sportId: number;
  /** Snapshot fetched by the server component; seeds the store for the first paint. */
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

  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => setScrollMargin(listRef.current?.offsetTop ?? 0), []);

  const virtualizer = useWindowVirtualizer({
    count: ids.length,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 8,
    scrollMargin,
    // Server render and first client render use the same viewport guess, so they match.
    initialRect: { width: 1280, height: 1000 },
    getItemKey: (index) => ids[index] ?? index,
  });

  if (ids.length === 0) {
    return (
      <div className="empty">
        {initial ? 'No events right now.' : 'Connecting to the live feed…'}
      </div>
    );
  }

  return (
    <div ref={listRef} className="list" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => (
        <div
          key={item.key}
          ref={virtualizer.measureElement}
          data-index={item.index}
          className="list-item"
          style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
        >
          <EventRow eventId={ids[item.index]!} />
        </div>
      ))}
    </div>
  );
}
