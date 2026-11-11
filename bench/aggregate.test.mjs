import { describe, expect, it } from 'vitest';
import { buildComparisons, mergeSessions, scenarioOrder } from './aggregate.mjs';

describe('scenarioOrder', () => {
  const names = ['baseline', 'bootstrap', 'injection', 'nocturne'];

  it('rotates every scenario through every position (even n)', () => {
    const rounds = [0, 1, 2, 3].map((r) => scenarioOrder(names, r));
    for (let pos = 0; pos < 4; pos++) expect(new Set(rounds.map((o) => o[pos])).size).toBe(4);
    rounds.forEach((o) => expect([...o].sort()).toEqual([...names].sort()));
  });

  it('balances first-order carry-over (each ordered pair appears once in 4 rounds)', () => {
    const pairs = [0, 1, 2, 3].flatMap((r) => {
      const o = scenarioOrder(names, r);
      return [0, 1, 2].map((i) => `${o[i]}>${o[i + 1]}`);
    });
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('alternates for two scenarios and is stable for one', () => {
    expect(scenarioOrder(['a', 'b'], 0)).toEqual(['a', 'b']);
    expect(scenarioOrder(['a', 'b'], 1)).toEqual(['b', 'a']);
    expect(scenarioOrder(['a'], 3)).toEqual(['a']);
  });
});

function session(name, round, fcp, ok = true) {
  const aggregates = { fcp: { median: fcp } };
  return {
    name,
    round,
    position: 0,
    verification: { ok, problems: ok ? [] : ['bad'] },
    sizes: [
      {
        size: 100,
        validRuns: 2,
        aggregates,
        records: [
          { phase: 'measured', valid: true, fcp },
          { phase: 'measured', valid: true, fcp: fcp + 2 },
        ],
      },
    ],
  };
}

describe('mergeSessions / buildComparisons', () => {
  it('pools runs, keeps per-session medians and computes paired deltas', () => {
    const sessions = [session('baseline', 0, 10), session('baseline', 1, 20), session('nocturne', 0, 30), session('nocturne', 1, 45)];
    const scenarios = mergeSessions(sessions, ['baseline', 'nocturne'], [100], 2);
    expect(scenarios[0].sizes[0].status).toBe('valid');
    expect(scenarios[0].sizes[0].aggregates.fcp.n).toBe(4);
    const [cmp] = buildComparisons(scenarios).filter((c) => c.metric === 'fcp');
    expect(cmp.pairedDeltas.map((d) => d.delta)).toEqual([20, 25]);
    expect(cmp.pairedPositive).toBe(2);
    expect(cmp.bothValid).toBe(true);
  });

  it('excludes sessions that failed verification and marks the scenario invalid', () => {
    const sessions = [session('baseline', 0, 10), session('baseline', 1, 999, false)];
    const [baseline] = mergeSessions(sessions, ['baseline'], [100], 2);
    expect(baseline.verification.ok).toBe(false);
    expect(baseline.sizes[0].status).toBe('invalid');
    expect(baseline.sizes[0].aggregates.fcp.max).toBeLessThan(999);
  });
});
