import { describe, expect, it } from 'vitest';
import { renderRange, visibleRows } from './window-list';

describe('visibleRows', () => {
  it('maps the viewport to row indexes relative to the list top', () => {
    // List starts 200 px down the page, rows are 80 px, viewport 800 px.
    expect(visibleRows(80, 200, 0, 800)).toEqual({ first: -3, last: 8 });
    expect(visibleRows(80, 200, 1_000, 800)).toEqual({ first: 10, last: 20 });
  });

  it('works with fractional row heights', () => {
    expect(visibleRows(78.5, 0, 785, 785)).toEqual({ first: 10, last: 20 });
    expect(visibleRows(78.5, 0, 800, 785)).toEqual({ first: 10, last: 21 });
  });
});

describe('renderRange', () => {
  it('adds overscan and clamps to the list', () => {
    expect(renderRange(100, 10, 20, 5)).toEqual({ start: 5, end: 25 });
    expect(renderRange(100, -3, 8, 5)).toEqual({ start: 0, end: 13 });
    expect(renderRange(12, 10, 20, 5)).toEqual({ start: 5, end: 12 });
  });

  it('is empty for an empty list or a list scrolled far past', () => {
    expect(renderRange(0, 0, 10, 5)).toEqual({ start: 0, end: 0 });
    expect(renderRange(10, 50, 60, 5)).toEqual({ start: 10, end: 10 });
  });
});
