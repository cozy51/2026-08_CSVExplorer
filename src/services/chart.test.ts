import { describe, expect, it } from 'vitest';
import { buildNiceTickIndexes, computeZoomWindow, wheelZoomAxis } from './chart';

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
});
