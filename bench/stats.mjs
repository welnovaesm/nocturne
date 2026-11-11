// Descriptive statistics for benchmark samples. Pure functions, no dependencies.

/**
 * Nearest-rank percentile on an ascending-sorted array:
 * rank = ceil(p / 100 * n) (1-based), clamped to [1, n]. The result is always an
 * observed value (no interpolation). With n = 10, p95 is the 10th value (the max).
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.min(Math.max(Math.ceil((p / 100) * sorted.length), 1), sorted.length);
  return sorted[rank - 1];
}

/** Median: middle value, or the mean of the two middle values when n is even. */
export function median(sorted) {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Ignores null/undefined/NaN. Returns null if there are no usable samples. */
export function summarize(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return {
    n: sorted.length,
    median: median(sorted),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p25: percentile(sorted, 25),
    p75: percentile(sorted, 75),
    p95: percentile(sorted, 95),
  };
}
