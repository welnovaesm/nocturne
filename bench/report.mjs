// Markdown report generator for results.json (schema 2). See run.mjs.

import { METRIC_KEYS } from './aggregate.mjs';

const LABELS = {
  domInteractive: 'domInteractive',
  domContentLoaded: 'DOMContentLoaded (end)',
  load: 'load (end)',
  fcp: 'First Contentful Paint',
};

const fmt = (v) => (v === null || v === undefined ? 'n/a' : Number.isInteger(v) ? String(v) : v.toFixed(1));
const signed = (v) => (v > 0 ? `+${fmt(v)}` : fmt(v));
const table = (header, rows) => [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

function environmentSection(r) {
  const e = r.environment;
  const browsers = [...new Set(r.sessions.map((s) => s.browser?.version ?? '?'))].join(', ');
  return table(
    ['Item', 'Value'],
    [
      ['Date (start)', r.startedAt],
      ['Firefox', browsers],
      ['geckodriver', e.geckodriver],
      ['selenium-webdriver', e.seleniumWebdriver],
      ['Headless / window', `${r.config.headless} / ${r.config.window}`],
      ['OS', `${e.platform} ${e.release} (${e.arch})`],
      ['CPU', `${e.cpuModel} × ${e.cpuCount}`],
      ['CPU governor', e.cpuGovernor ?? 'unavailable'],
      ['RAM', `${(e.totalMemBytes / 2 ** 30).toFixed(1)} GiB`],
      ['Node.js', e.node],
      ['Git', `${e.git.commit}${e.git.dirty ? ' (uncommitted changes)' : ''}`],
      ['Server', r.config.serverStartedByRunner ? 'started by the runner' : 'already running'],
      ['Design', `${r.config.rounds} round(s) × ${r.config.scenarios.length} scenario(s); each (scenario, round) is a fresh Firefox session; ${r.config.warmup} warm-up + ${r.config.runs} measured navigations per size`],
    ],
  );
}

function buildsSection(r) {
  const rows = r.config.scenarios.map((name) => {
    const x = r.extensions[name];
    return [
      name,
      x.description,
      x.zip ? `\`${x.zip}\`` : 'none',
      x.sha256 ? `\`${x.sha256.slice(0, 16)}…\`` : 'n/a',
      x.manifestName ?? 'n/a',
      x.contentScriptBytes ?? 'n/a',
      x.cssFile ? `\`${x.cssFile}\` (\`${x.expectedCssSha256.slice(0, 12)}…\`)` : 'none',
    ];
  });
  return table(['Scenario', 'Meaning', 'Zip', 'Zip SHA-256', 'Manifest name', 'content.js (bytes)', 'Expected `<style>` content'], rows);
}

function ordersSection(r) {
  return table(
    ['Round', ...r.config.orders[0].map((_, i) => `Position ${i + 1}`)],
    r.config.orders.map((o, i) => [String(i + 1), ...o]),
  );
}

function sessionsSection(r) {
  const rows = r.sessions.map((s) => {
    const v = s.verification;
    return [
      String(s.round + 1),
      String(s.position + 1),
      s.name,
      v.addonId ?? 'none',
      `${v.consoleLines} (applied=${v.consoleLinesThemeApplied}, not applied=${v.consoleLinesThemeNotApplied})`,
      v.ok ? 'OK' : `**FAILED**: ${v.problems.join('; ')}`,
      s.loadavg.map((x) => x.toFixed(2)).join(' / '),
    ];
  });
  return table(['Round', 'Pos.', 'Scenario', 'Add-on id', '[Nocturne] console lines', 'Verification', 'Load avg at start'], rows);
}

function sizeSection(r, size) {
  const out = [`### ${size} elements`, ''];

  const rows = [];
  for (const key of METRIC_KEYS) {
    for (const s of r.scenarios) {
      const sz = s.sizes.find((z) => z.size === size);
      const a = sz?.aggregates[key];
      rows.push([
        LABELS[key],
        s.name,
        sz ? (s.verification.ok ? sz.status : `${sz.status} (scenario failed verification)`) : 'missing',
        a ? String(a.n) : '0',
        fmt(a?.median),
        `${fmt(a?.p25)}–${fmt(a?.p75)}`,
        fmt(a?.min),
        fmt(a?.max),
        fmt(a?.p95),
      ]);
    }
  }
  out.push(table(['Metric (ms)', 'Scenario', 'Status', 'n', 'Median', 'P25–P75', 'Min', 'Max', 'p95'], rows));

  const cmp = r.comparisons.filter((c) => c.size === size);
  if (cmp.length > 0) {
    out.push('', 'Differences (candidate − reference, ms). *Paired* = difference of session medians within the same round.', '');
    out.push(
      table(
        ['Reference → candidate', 'Metric', 'Δ pooled median', 'Paired Δ per round', 'Rounds with Δ > 0', 'Valid?'],
        cmp.map((c) => [
          `${c.reference} → ${c.candidate}`,
          LABELS[c.metric],
          signed(c.pooledDeltaMedian),
          c.pairedDeltas.map((p) => signed(p.delta)).join(', ') || 'n/a',
          `${c.pairedPositive}/${c.pairedDeltas.length}`,
          c.bothValid ? 'yes' : '**no**',
        ]),
      ),
    );
  }

  out.push('', 'Per-session median of First Contentful Paint (ms), as `value (position in round)`:', '');
  const rounds = Array.from({ length: r.config.rounds }, (_, i) => i);
  out.push(
    table(
      ['Scenario', ...rounds.map((i) => `Round ${i + 1}`)],
      r.scenarios.map((s) => {
        const sz = s.sizes.find((z) => z.size === size);
        return [
          s.name,
          ...rounds.map((i) => {
            const m = sz?.sessionMedians.find((x) => x.round === i);
            return m ? `${fmt(m.medians.fcp)} (${m.position + 1})` : 'n/a';
          }),
        ];
      }),
    ),
  );

  const first = r.config.scenarios.map((name) => r.sessions.find((s) => s.name === name && s.round === 0)?.sizes.find((z) => z.size === size)?.screenshot);
  if (first.some(Boolean)) {
    out.push('', `Screenshots (round 1, viewport ${r.config.window}):`, '');
    out.push(table(r.config.scenarios, [first.map((f, i) => (f ? `![${r.config.scenarios[i]} ${size}](${f})` : 'n/a'))]));
  }
  return out.join('\n');
}

function problemsSection(r) {
  const bad = [];
  for (const s of r.sessions) {
    for (const sz of s.sizes) {
      for (const rec of sz.records) {
        if (rec.reasons.length > 0) bad.push(`- ${s.name} / round ${s.round + 1} / n=${sz.size} / ${rec.phase} #${rec.index}: ${rec.reasons.join('; ')}`);
      }
    }
    for (const err of s.sessionErrors) bad.push(`- ${s.name} / round ${s.round + 1}: ${err}`);
    for (const p of s.verification.problems) bad.push(`- ${s.name} / round ${s.round + 1}: verification: ${p}`);
  }
  const out = ['#### Invalid or failed runs', '', bad.length > 0 ? bad.join('\n') : 'None. Every warm-up and measured run passed validation.'];

  out.push('', '#### Browser console warnings and errors', '');
  const entries = r.sessions.flatMap((s) => s.consoleProblems.map((p) => ({ scenario: s.name, ...p })));
  if (entries.length === 0) {
    out.push('None captured (BiDi log inspector, levels `warning` and `error`).');
  } else {
    const counts = new Map();
    for (const e of entries) {
      const k = `${e.scenario} | ${e.level} | ${e.text}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const [k, c] of counts) out.push(`- ×${c} ${k}`);
  }
  const fileSecurity = entries.filter((e) => /file:\/\/\//.test(e.text));
  out.push('', '`Security Error: … may not load or link to file:///`: ' + (fileSecurity.length === 0 ? 'not observed in any session of this run.' : '**observed**; see the list above and compare scenarios to locate the source.'));
  return out.join('\n');
}

export function renderReport(r) {
  const allValid = r.scenarios.every((s) => s.verification.ok && s.sizes.every((z) => z.status === 'valid'));
  return `# Nocturne automated benchmark report

${allValid ? 'All scenarios passed validation.' : '**Some scenarios or runs are INVALID. Do not use the affected numbers. See "Invalid or failed runs".**'}

Raw data: \`results.json\` (same directory). Everything below is generated from it.

## Environment

${environmentSection(r)}

## Builds under test

${buildsSection(r)}

Identity check: every navigation hashes the \`<style id="nocturne-theme">\` text in the page and compares it with the SHA-256 of the stylesheet file listed above. Scenarios without a stylesheet must have no such tag.

## Scenario order per round

${ordersSection(r)}

## Session verification

${sessionsSection(r)}

## Results

All values are in milliseconds, from the Navigation Timing and Paint Timing entries of the page, relative to the start of the navigation. Only runs that passed validation, from sessions that passed verification, are aggregated.

${r.config.sizes.map((s) => sizeSection(r, s)).join('\n\n')}

## Validation details

${problemsSection(r)}

## How to read this

- **Statistics.** \`median\`: middle value (mean of the two middle values when n is even). \`P25–P75\`, \`p95\`: nearest-rank percentiles (the observed value at rank ceil(p·n) of the sorted samples). With few samples p95 equals the max. All statistics pool the measured runs of all rounds of a scenario.
- **Dispersion across sessions** is visible in the per-session medians and in the paired differences. If the per-session medians of one scenario span more than the difference between scenarios, the data does not separate them.
- **Paired Δ** compares sessions of the same round, which were run close in time. The scenario order is rotated between rounds (Williams design) to spread position and carry-over effects, but a handful of rounds cannot remove them.
- No significance test is applied.
- **Directly measured here:** the four navigation/paint timestamps, the presence and exact content of the theme tag, element counts and the \`[Nocturne]\` console lines.
- **Not measured here:** extension CPU time, style recalculation, layout, paint/composite cost, memory, long tasks and time-to-dark. These require the Firefox Profiler and \`about:memory\` (see \`bench/README.md\`). Navigation and paint timestamps must not be interpreted as those costs.
- Timer precision is reduced by Firefox by default, so values are quantized (often integer milliseconds).
- **Compare against the screenshots.** A cheaper result can simply mean less work was done.
`;
}
