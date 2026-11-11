// Builds the benchmark-only variants (bootstrap, injection) next to the production build.
//
//   node bench/build-variants.mjs
//
// Output: .output-bench/<variant>/wxt-starter-<version>-firefox.zip (git-ignored).
// The production build (.output/) is produced separately by `wxt zip -b firefox`.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WXT = path.join(ROOT, 'node_modules/.bin/wxt');

// Guards against a silent no-op swap: each variant's bundle must (not) contain the
// production palette. Strings come from utils/theme.css and bench/variants/minimal.css.
const BUNDLE_EXPECTATIONS = {
  bootstrap: { present: [], absent: ['color-scheme', '#121212', '#e0e0e0'] },
  injection: { present: ['#121212'], absent: ['color-scheme', '#e0e0e0'] },
};

for (const [variant, expected] of Object.entries(BUNDLE_EXPECTATIONS)) {
  console.log(`Building variant: ${variant}`);
  execFileSync(WXT, ['zip', '-b', 'firefox', '-c', 'bench/wxt.variants.config.ts'], {
    cwd: ROOT,
    env: { ...process.env, BENCH_VARIANT: variant },
    stdio: 'ignore',
  });

  const bundle = readFileSync(path.join(ROOT, `.output-bench/${variant}/firefox-mv2/content-scripts/content.js`), 'utf8');
  for (const s of expected.present) if (!bundle.includes(s)) throw new Error(`${variant}: bundle should contain "${s}"`);
  for (const s of expected.absent) if (bundle.includes(s)) throw new Error(`${variant}: bundle should not contain "${s}"`);
}

// The variant builds rewrite .wxt/tsconfig.json (outDir exclude); restore the default.
execFileSync(WXT, ['prepare'], { cwd: ROOT, stdio: 'ignore' });
console.log('Variants built and verified.');
