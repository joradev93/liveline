import { describe, expect, it } from 'vitest';
import { GRADE, gradeHigh, gradeLow } from './metric-grade';

describe('gradeLow', () => {
  it('is good at the limit, bad above the bad limit, neutral between', () => {
    expect(gradeLow(200, 200, 500)).toBe('good');
    expect(gradeLow(201, 200, 500)).toBeUndefined();
    expect(gradeLow(500, 200, 500)).toBeUndefined();
    expect(gradeLow(501, 200, 500)).toBe('bad');
  });

  it('has no grade without a value', () => {
    expect(gradeLow(null, 200, 500)).toBeUndefined();
    expect(gradeLow(undefined, 200, 500)).toBeUndefined();
  });
});

describe('gradeHigh', () => {
  it('is good at the limit, bad below the bad limit, neutral between', () => {
    expect(gradeHigh(55, 55, 50)).toBe('good');
    expect(gradeHigh(52, 55, 50)).toBeUndefined();
    expect(gradeHigh(49, 55, 50)).toBe('bad');
  });
});

describe('GRADE', () => {
  it('gives no colour to 0 FPS (hidden tab)', () => {
    expect(GRADE.fps(0)).toBeUndefined();
    expect(GRADE.fps(60)).toBe('good');
  });

  it('turns any slow frame red and none green', () => {
    expect(GRADE.slowFrames(0)).toBe('good');
    expect(GRADE.slowFrames(1)).toBe('bad');
  });

  it('never turns long tasks or reconnects red', () => {
    expect(GRADE.longTasks(0)).toBe('good');
    expect(GRADE.longTasks(3)).toBeUndefined();
    expect(GRADE.reconnects(0)).toBe('good');
    expect(GRADE.reconnects(2)).toBeUndefined();
  });

  it('uses the web.dev limits for INP and LCP', () => {
    expect(GRADE.inp(200)).toBe('good');
    expect(GRADE.inp(501)).toBe('bad');
    expect(GRADE.lcp(2500)).toBe('good');
    expect(GRADE.lcp(4001)).toBe('bad');
  });
});
