import { describe, expect, it } from 'vitest';
import { median, percentile, summarize } from './stats.mjs';

describe('stats', () => {
  it('computes the median for odd and even sample counts', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('uses nearest-rank percentiles', () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(ten, 95)).toBe(10);
    expect(percentile(ten, 50)).toBe(5);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 95)).toBe(95);
    expect(percentile([7], 95)).toBe(7);
  });

  it('summarizes unsorted input and ignores missing values', () => {
    expect(summarize([30, null, 10, undefined, 20, NaN])).toEqual({
      n: 3,
      median: 20,
      min: 10,
      max: 30,
      p25: 10,
      p75: 30,
      p95: 30,
    });
    expect(summarize([null])).toBeNull();
  });
});
