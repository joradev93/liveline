'use client';

import { memo } from 'react';
import { formatStart, selectionLabel } from '@/lib/format';
import { useEvent, useMarketShape } from '@/lib/hooks';
import { renderStats } from '@/lib/render-stats';
import { useSelectEvent } from '@/lib/ui-context';
import { OddsButton } from './OddsButton';

/** Row header re-renders only on event changes (status, score); odds cells update on their own. */
export const EventRow = memo(function EventRow({ eventId }: { eventId: number }) {
  const event = useEvent(eventId);
  const selectEvent = useSelectEvent();
  renderStats.rows++;
  if (!event) return null;
  const locked = event.status !== 'live' && event.status !== 'prematch';
  const isLive = event.status === 'live' || event.status === 'suspended';

  return (
    <div className="row" data-status={event.status}>
      <div className="row-time">
        {isLive ? (
          <>
            <span className="badge-live">{event.status === 'suspended' ? 'SUSP' : 'LIVE'}</span>
            <span className="score">
              {event.score?.[0] ?? 0}:{event.score?.[1] ?? 0}
            </span>
          </>
        ) : (
          <span className="starts" suppressHydrationWarning>
            {event.status === 'settled' ? 'ended' : formatStart(event.start, Date.now())}
          </span>
        )}
      </div>
      <button type="button" className="row-teams" onClick={() => selectEvent(event.id)}>
        <span className="team">{event.home}</span>
        <span className="team">{event.away}</span>
        <span className="league">{event.league}</span>
      </button>
      <div className="row-markets">
        {event.main.map((marketId) => (
          <MainMarket key={marketId} marketId={marketId} locked={locked} />
        ))}
      </div>
    </div>
  );
});

/** Uses the market shape only (selection keys), so price ticks do not re-render it. */
const MainMarket = memo(function MainMarket({
  marketId,
  locked,
}: {
  marketId: number;
  locked: boolean;
}) {
  const market = useMarketShape(marketId);
  if (!market) return <div className="market" />;
  return (
    <div className="market" data-type={market.type}>
      {market.sel.map((s) => (
        <div key={s.k} className="cell">
          <span className="cell-label">{selectionLabel(market.type, s.k, market.line)}</span>
          <OddsButton marketId={marketId} k={s.k} label={s.name} locked={locked} />
        </div>
      ))}
    </div>
  );
});
