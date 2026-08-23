import { describe, expect, it } from 'vitest';
import { chunkStarts, columnWidth, columnWindow, rowWindow } from './virtualRows';

describe('virtual row geometry', () => {
  it('covers the viewport plus overscan on both sides', () => {
    expect(rowWindow(0, 400, 40, 1000, 10)).toEqual({ first: 0, last: 31 });
    expect(rowWindow(4000, 400, 40, 1000, 10)).toEqual({ first: 90, last: 121 });
  });

  it('never leaves the table bounds', () => {
    expect(rowWindow(0, 400, 40, 5, 10)).toEqual({ first: 0, last: 5 });
    expect(rowWindow(100000, 400, 40, 5, 10)).toEqual({ first: 4, last: 5 });
    expect(rowWindow(0, 400, 0, 1000, 10)).toEqual({ first: 0, last: 0 });
    expect(rowWindow(0, 400, 40, 0, 10)).toEqual({ first: 0, last: 0 });
  });

  it('asks for whole chunks around the window', () => {
    expect(chunkStarts(90, 121, 250, 1000)).toEqual([0]);
    expect(chunkStarts(240, 260, 250, 1000)).toEqual([0, 250]);
    expect(chunkStarts(980, 1200, 250, 1000)).toEqual([750]);
    expect(chunkStarts(10, 10, 250, 1000)).toEqual([]);
  });

  it('sizes columns from their title, wide enough for Japanese headers', () => {
    expect(columnWidth('msec')).toBe(112);
    expect(columnWidth('衝突防止センサ(上)-検出エリア')).toBeGreaterThan(200);
    expect(columnWidth('あ'.repeat(80))).toBe(320);
  });

  it('keeps only the columns near the horizontal viewport', () => {
    const offsets = [0, 100, 200, 300, 400, 500, 600];
    expect(columnWindow(offsets, 0, 250, 0)).toEqual({ first: 0, last: 3 });
    expect(columnWindow(offsets, 250, 250, 0)).toEqual({ first: 2, last: 5 });
    expect(columnWindow(offsets, 250, 250, 100)).toEqual({ first: 1, last: 6 });
    expect(columnWindow(offsets, 10000, 250, 0)).toEqual({ first: 5, last: 6 });
    expect(columnWindow([0], 0, 250, 0)).toEqual({ first: 0, last: 0 });
  });
});
