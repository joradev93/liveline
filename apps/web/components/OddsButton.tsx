'use client';

import { formatOdds } from '@liveline/protocol';
import { memo, useLayoutEffect, useRef } from 'react';
import { useSelection, useStore } from '@/lib/hooks';
import { renderStats } from '@/lib/render-stats';
import { useBetslip, useIsSelected } from '@/lib/ui-context';

interface Props {
  marketId: number;
  k: string;
  label: string;
  /** Event-level lock (event suspended or settled). */
  locked: boolean;
  /** Show the label inside the button (details panel) instead of only above it. */
  showLabel?: boolean;
}

/**
 * One odds cell. Subscribes to exactly one price (and its market status), so a tick re-renders
 * only this button.
 * The up/down flash is a CSS animation started by swapping a class on the DOM node,
 * not React state: no extra render, no forced layout.
 */
export const OddsButton = memo(function OddsButton({
  marketId,
  k,
  label,
  locked,
  showLabel,
}: Props) {
  const store = useStore();
  const slip = useBetslip();
  const { price, status } = useSelection(marketId, k);
  const selected = useIsSelected(marketId, k);
  const ref = useRef<HTMLButtonElement>(null);
  const previous = useRef(price);
  const flip = useRef(false);
  renderStats.odds++;

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = price;
    const el = ref.current;
    if (!el || before === undefined || price === undefined || before === price) return;
    // Two identical keyframe sets (a/b): switching between them restarts the animation.
    flip.current = !flip.current;
    el.classList.remove('flash-up-a', 'flash-up-b', 'flash-down-a', 'flash-down-b');
    el.classList.add(`flash-${price > before ? 'up' : 'down'}-${flip.current ? 'a' : 'b'}`);
  }, [price]);

  const disabled = locked || status !== 'open' || price === undefined;

  const onClick = () => {
    const market = store.getMarket(marketId);
    const event = market && store.getEvent(market.eventId);
    const sel = market?.sel.find((s) => s.k === k);
    if (!market || !event || !sel) return;
    slip.toggle({
      eventId: event.id,
      marketId,
      k,
      odds: sel.p,
      label: sel.name,
      marketName: market.name,
      eventName: `${event.home} v ${event.away}`,
    });
  };

  return (
    <button
      ref={ref}
      type="button"
      className="odds"
      data-selected={selected || undefined}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${label} ${price !== undefined ? formatOdds(price) : 'unavailable'}`}
    >
      {showLabel && <span className="odds-label">{label}</span>}
      <span className="odds-price">{disabled ? <LockIcon /> : formatOdds(price)}</span>
    </button>
  );
});

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" className="lock">
      <path
        fill="currentColor"
        d="M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9h-2Zm-8-2a3 3 0 0 1 6 0v2H9V7Zm8 12H7v-8h10v8Z"
      />
    </svg>
  );
}
