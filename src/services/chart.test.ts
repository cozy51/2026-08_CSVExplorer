import { describe, expect, it } from 'vitest';
import { buildNiceTickIndexes } from './chart';

describe('chart axis labels', () => {
  it('always includes the first and final sample', () => {
    const values = Array.from({ length: 1024 }, (_, index) => index * 0.02);
    const indexes = buildNiceTickIndexes(values);
    expect(indexes.has(0)).toBe(true);
    expect(indexes.has(values.length - 1)).toBe(true);
  });

  it('chooses round intermediate values', () => {
    const values = Array.from({ length: 1024 }, (_, index) => index * 0.02);
    const labels = [...buildNiceTickIndexes(values)].map((index) => values[index]);
    expect(labels).toEqual(expect.arrayContaining([0, 5, 10, 15, 20, 20.46]));
  });
});
