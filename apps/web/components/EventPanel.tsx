'use client';

import { eventTopic } from '@liveline/protocol';
import { useEffect, useRef } from 'react';
import { formatStart, sportName } from '@/lib/format';
import { useEvent, useMarketShape, useTopic } from '@/lib/hooks';
import { OddsButton } from './OddsButton';

/** Side panel with every market of one event, from the `event:{id}` topic. */
export function EventPanel({ eventId, onClose }: { eventId: number; onClose: () => void }) {
  useTopic(eventTopic(eventId));
  const event = useEvent(eventId);
  const seen = useRef(false);
  if (event) seen.current = true;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const locked = !event || (event.status !== 'live' && event.status !== 'prematch');
  const isLive = event?.status === 'live' || event?.status === 'suspended';

  return (
    <div className="panel-backdrop" onClick={onClose}>
      <aside
        className="panel"
        role="dialog"
        aria-label="Event markets"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="panel-head">
          <div>
            <div className="panel-meta">
              {event
                ? `${sportName(event.sportId)} · ${event.league}`
                : seen.current
                  ? 'This event has ended.'
                  : 'Loading…'}
            </div>
            <h2 className="panel-title">{event ? `${event.home} v ${event.away}` : ''}</h2>
            {event && (
              <div className="panel-status">
                {isLive ? (
                  <>
                    <span className="badge-live">
                      {event.status === 'suspended' ? 'SUSPENDED' : 'LIVE'}
                    </span>
                    <span className="score">
                      {event.score?.[0] ?? 0}:{event.score?.[1] ?? 0}
                    </span>
                  </>
                ) : (
                  <span className="starts">
                    {event.status === 'settled'
                      ? 'Ended'
                      : `Starts ${formatStart(event.start, Date.now())}`}
                  </span>
                )}
              </div>
            )}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="panel-body">
          {(event?.all ?? event?.main ?? []).map((marketId) => (
            <MarketBlock key={marketId} marketId={marketId} locked={locked} />
          ))}
          {!event?.all && event && <div className="muted">Loading all markets…</div>}
        </div>
      </aside>
    </div>
  );
}

function MarketBlock({ marketId, locked }: { marketId: number; locked: boolean }) {
  const market = useMarketShape(marketId);
  if (!market) return null;
  return (
    <section className="market-block">
      <h3>{market.name}</h3>
      <div className="market-grid" data-count={market.sel.length}>
        {market.sel.map((s) => (
          <OddsButton
            key={s.k}
            marketId={marketId}
            k={s.k}
            label={s.name}
            locked={locked}
            showLabel
          />
        ))}
      </div>
    </section>
  );
}
