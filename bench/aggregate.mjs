// Pure helpers to combine independent browser sessions (rounds) of the same scenario.

import { summarize } from './stats.mjs';

export const METRIC_KEYS = ['domInteractive', 'domContentLoaded', 'load', 'fcp'];

/**
 * Order of scenarios for a given round (0-based), balanced against position and first-order
 * carry-over effects. Uses the Williams design: sequence 0, 1, n-1, 2, n-2, ... shifted by
 * `round`. For an even number of scenarios, n consecutive rounds balance both effects. For an
 * odd number, the sequence is reversed on alternate blocks of n rounds (2n rounds to balance).
 */
export function scenarioOrder(names, round) {
  const n = names.length;
  const seq = [0];
  for (let i = 1; i < n; i++) seq.push(i % 2 === 1 ? (i + 1) / 2 : n - i / 2);
  if (n % 2 === 1 && Math.floor(round / n) % 2 === 1) seq.reverse();
  return seq.map((x) => names[(x + round) % n]);
}

/**
 * Pools the valid measured runs of each scenario across its sessions. Sessions whose
 * verification failed (wrong add-on, missing console lines, incomplete session) contribute
 * nothing to the aggregates but still make the scenario invalid.
 */
export function mergeSessions(sessions, names, sizes, runsPerSession) {
  return names.map((name) => {
    const mine = sessions.filter((s) => s.name === name);
    const trusted = mine.filter((s) => s.verification.ok);
    const problems = mine.flatMap((s) => s.verification.problems.map((p) => `round ${s.round + 1}: ${p}`));

    return {
      name,
      sessionCount: mine.length,
      verification: { ok: problems.length === 0, problems },
      sizes: sizes.map((size) => {
        const perSession = trusted.map((s) => ({ s, sz: s.sizes.find((z) => z.size === size) })).filter((x) => x.sz);
        const valid = perSession.flatMap(({ sz }) => sz.records.filter((r) => r.phase === 'measured' && r.valid));
        const expectedRuns = mine.length * runsPerSession;
        return {
          size,
          status: valid.length === expectedRuns && trusted.length === mine.length ? 'valid' : 'invalid',
          validRuns: valid.length,
          expectedRuns,
          aggregates: Object.fromEntries(METRIC_KEYS.map((k) => [k, summarize(valid.map((r) => r[k]))])),
          sessionMedians: perSession.map(({ s, sz }) => ({
            round: s.round,
            position: s.position,
            validRuns: sz.validRuns,
            medians: Object.fromEntries(METRIC_KEYS.map((k) => [k, sz.aggregates[k]?.median ?? null])),
          })),
        };
      }),
    };
  });
}

/** candidate − reference, one value per round in which both sessions are trustworthy. */
export function pairedDeltas(scenarios, reference, candidate, size, metric) {
  const get = (name) => scenarios.find((s) => s.name === name)?.sizes.find((z) => z.size === size)?.sessionMedians ?? [];
  const ref = get(reference);
  const out = [];
  for (const c of get(candidate)) {
    const r = ref.find((x) => x.round === c.round);
    if (r && r.medians[metric] !== null && c.medians[metric] !== null) {
      out.push({ round: c.round, delta: c.medians[metric] - r.medians[metric] });
    }
  }
  return out;
}

export const COMPARISON_PAIRS = [
  ['baseline', 'bootstrap'],
  ['bootstrap', 'injection'],
  ['injection', 'nocturne'],
  ['baseline', 'injection'],
  ['baseline', 'nocturne'],
];

/** Pooled difference of medians plus the per-round paired differences. No significance test. */
export function buildComparisons(scenarios) {
  const out = [];
  for (const [reference, candidate] of COMPARISON_PAIRS) {
    const ref = scenarios.find((s) => s.name === reference);
    const cand = scenarios.find((s) => s.name === candidate);
    if (!ref || !cand) continue;
    for (const csz of cand.sizes) {
      const rsz = ref.sizes.find((z) => z.size === csz.size);
      if (!rsz) continue;
      for (const metric of METRIC_KEYS) {
        const a = rsz.aggregates[metric];
        const b = csz.aggregates[metric];
        if (!a || !b) continue;
        const paired = pairedDeltas(scenarios, reference, candidate, csz.size, metric);
        out.push({
          reference,
          candidate,
          size: csz.size,
          metric,
          referenceMedian: a.median,
          candidateMedian: b.median,
          pooledDeltaMedian: b.median - a.median,
          pairedDeltas: paired,
          pairedPositive: paired.filter((p) => p.delta > 0).length,
          bothValid: ref.verification.ok && cand.verification.ok && rsz.status === 'valid' && csz.status === 'valid',
        });
      }
    }
  }
  return out;
}
