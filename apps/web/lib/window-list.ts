import { useLayoutEffect, useRef, useState } from 'react';

/** Rows of a list with one row height that intersect the window viewport (may be out of range). */
export function visibleRows(
  rowHeight: number,
  listTop: number,
  scrollY: number,
  viewportHeight: number,
): { first: number; last: number } {
  return {
    first: Math.floor((scrollY - listTop) / rowHeight),
    last: Math.ceil((scrollY + viewportHeight - listTop) / rowHeight),
  };
}

/** Rows to render: the visible ones plus `overscan` on each side, within [0, count). */
export function renderRange(
  count: number,
  first: number,
  last: number,
  overscan: number,
): { start: number; end: number } {
  const clamp = (n: number) => Math.min(count, Math.max(0, n));
  return { start: clamp(first - overscan), end: clamp(last + overscan) };
}

interface Options {
  count: number;
  /** Row height until the CSS value was read (server render and hydration). */
  initialRowHeight: number;
  overscan: number;
  /** Viewport height assumed for the server render. */
  initialViewport: number;
}

/**
 * Window-scrolled virtual list with one row height per breakpoint.
 *
 * The row height is the CSS custom property `--row-h` on the list element. Rows are positioned
 * by CSS (`translateY(var(--row-h) * index)`), so the server HTML is laid out correctly on every
 * screen size before any JavaScript runs; this hook only decides which rows to render.
 * Live reordering moves rows by transform, which does not count as layout shift.
 * A scroll re-renders only when the set of visible rows changes.
 */
export function useWindowList({ count, initialRowHeight, overscan, initialViewport }: Options) {
  const listRef = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState(() => visibleRows(initialRowHeight, 0, 0, initialViewport));
  // The list element exists only when there are rows: start measuring when it appears.
  const hasRows = count > 0;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let top = 0;
    let rowHeight = initialRowHeight;
    const measure = () => {
      top = list.getBoundingClientRect().top + window.scrollY;
      rowHeight = parseFloat(getComputedStyle(list).getPropertyValue('--row-h')) || rowHeight;
    };
    const update = () => {
      const { first, last } = visibleRows(rowHeight, top, window.scrollY, window.innerHeight);
      setWin((w) => (w.first === first && w.last === last ? w : { first, last }));
    };
    let frame = 0;
    const onScroll = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    const onResize = () => {
      measure();
      onScroll();
    };
    measure();
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [initialRowHeight, hasRows]);

  return { listRef, ...renderRange(count, win.first, win.last, overscan) };
}
