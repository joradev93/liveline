'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { BetslipStore } from '@/lib/betslip';
import { GATEWAY_WS_URL } from '@/lib/config';
import { FeedClient } from '@/lib/feed-client';
import { FeedContext, StoreContext } from '@/lib/hooks';
import { LiveStore } from '@/lib/store';
import { BetslipContext, SelectEventContext } from '@/lib/ui-context';
import { EventPanel } from './EventPanel';

/**
 * Client root. Creates one store per page load (per request on the server, so no state
 * leaks between requests) and starts the feed worker in the browser.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [store] = useState(() => new LiveStore());
  const [slip] = useState(() => new BetslipStore());
  const [feed, setFeed] = useState<FeedClient | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);

  useEffect(() => {
    const client = new FeedClient(store, GATEWAY_WS_URL);
    setFeed(client);
    return () => client.close();
  }, [store]);

  return (
    <StoreContext.Provider value={store}>
      <FeedContext.Provider value={feed}>
        <BetslipContext.Provider value={slip}>
          <SelectEventContext.Provider value={setSelectedEvent}>
            {children}
            {selectedEvent !== null && (
              <EventPanel eventId={selectedEvent} onClose={() => setSelectedEvent(null)} />
            )}
          </SelectEventContext.Provider>
        </BetslipContext.Provider>
      </FeedContext.Provider>
    </StoreContext.Provider>
  );
}
