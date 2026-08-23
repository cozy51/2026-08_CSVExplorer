import { describe, expect, it } from 'vitest';
import { buildNiceTickIndexes, buildTooltipMarkup, buildYZoomBatch, computeZoomWindow, formatTooltipValue, wheelZoomAxis } from './chart';

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

  it('lists Boolean panels under the analog series in the tooltip', () => {
    const markup = buildTooltipMarkup([
      { seriesIndex: 2, seriesName: '/S-ON(#1)', axisValueLabel: '13.840', value: [13.84, 0] },
      { seriesIndex: 0, seriesName: 'フィードバック速度(#1)', axisValueLabel: '13.840', value: [13.84, 2249.816895] },
      { seriesIndex: 1, seriesName: 'トルク指令(#1)', axisValueLabel: '13.840', value: [13.84, -19.719788] },
    ]);
    expect(markup.indexOf('フィードバック速度(#1)')).toBeLessThan(markup.indexOf('トルク指令(#1)'));
    expect(markup.indexOf('トルク指令(#1)')).toBeLessThan(markup.indexOf('/S-ON(#1)'));
    expect(markup.match(/13\.840/g)).toHaveLength(1);
  });

  it('keeps the full precision of tooltip values and escapes series names', () => {
    expect(formatTooltipValue([13.84, 2249.816895])).toBe('2,249.816895');
    expect(formatTooltipValue([13.84, -19.719788])).toBe('-19.719788');
    expect(formatTooltipValue([13.84, null])).toBe('-');
    expect(formatTooltipValue(59.99999999999991)).toBe('60');
    expect(buildTooltipMarkup([{ seriesIndex: 0, seriesName: '<b>x</b>', axisValueLabel: '1', value: 2 }]))
      .toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
