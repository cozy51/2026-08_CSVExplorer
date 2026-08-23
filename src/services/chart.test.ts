import { describe, expect, it } from 'vitest';
import { buildNiceTickIndexes, buildYZoomBatch, computeZoomWindow, wheelZoomAxis } from './chart';

describe('chart axis labels', () => {
  it('always includes the first and final sample', () => {
    const values = Array.from({ length: 1024 }, (_, index) => index * 0.02);
    const indexes = buildNiceTickIndexes(values);
    expect(indexes.has(0)).toBe(true);
    expect(indexes.has(values.length - 1)).toBe(true);
  });

  it('chooses roughly one-second labels for a twenty-second recording', () => {
    const values = Array.from({ length: 1024 }, (_, index) => index * 0.02);
    const labels = [...buildNiceTickIndexes(values, 20)].map((index) => values[index]);
    expect(labels).toEqual(expect.arrayContaining([0, 1, 2, 10, 19, 20, 20.46]));
    expect(labels.length).toBeGreaterThanOrEqual(21);
  });

  it('zooms only the requested percentage window', () => {
    expect(computeZoomWindow(0, 100, true)).toEqual({ start: 10, end: 90 });
    expect(computeZoomWindow(10, 90, false)).toEqual({ start: 0, end: 100 });
  });

  it('routes normal wheel to X and Shift+wheel to Y', () => {
    expect(wheelZoomAxis(false)).toBe('x');
    expect(wheelZoomAxis(true)).toBe('y');
  });

  it('builds one Y zoom entry per analog axis from the reported ranges', () => {
    const reported = [
      { id: 'x-wheel-zoom', start: 20, end: 60 },
      { id: 'y-wheel-zoom-0', start: 10, end: 90 },
    ];
    expect(buildYZoomBatch(reported, 2, true)).toEqual([
      { dataZoomId: 'y-wheel-zoom-0', start: 18, end: 82 },
      { dataZoomId: 'y-wheel-zoom-1', start: 10, end: 90 },
    ]);
  });

  it('keeps the Y zoom batch empty when no analog axis is plotted', () => {
    expect(buildYZoomBatch(undefined, 0, true)).toEqual([]);
  });
});
