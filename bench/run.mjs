// Automated Firefox benchmark: baseline (no extensions) vs. Nocturne variants.
//
//   pnpm bench:run                                      # baseline vs. nocturne, 1 round
//   pnpm bench:run --sizes 100 --runs 3 --warmup 1      # quick smoke test
//   pnpm bench:isolate                                  # 4 scenarios x 4 rounds (see README)
//
// Every (scenario, round) is a separate Firefox session with a fresh temporary profile created
// by geckodriver (the personal profile is never touched). See bench/README.md.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import LogInspector from 'selenium-webdriver/bidi/logInspector.js';
import { METRIC_KEYS, buildComparisons, mergeSessions, scenarioOrder } from './aggregate.mjs';
import { renderReport } from './report.mjs';
import { summarize } from './stats.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WINDOW = { width: 1280, height: 900 };

// What each scenario must look like. `cssFile` is the stylesheet whose exact content the
// injected <style> must have; the runner compares SHA-256 hashes, so a wrong build is detected.
const SCENARIOS = {
  baseline: { description: 'no extension', buildDir: null, themeTags: 0, themeApplied: null },
  bootstrap: {
    description: 'content script runs, page untouched',
    buildDir: '.output-bench/bootstrap',
    manifestName: 'Nocturne bench (bootstrap)',
    themeTags: 0,
    themeApplied: false,
  },
  injection: {
    description: 'content script + minimal stylesheet',
    buildDir: '.output-bench/injection',
    manifestName: 'Nocturne bench (injection)',
    themeTags: 1,
    themeApplied: true,
    cssFile: 'bench/variants/minimal.css',
  },
  nocturne: {
    description: 'production build, full stylesheet',
    buildDir: '.output',
    manifestName: 'wxt-starter',
    themeTags: 1,
    themeApplied: true,
    cssFile: 'utils/theme.css',
  },
};

// Runs inside the page after navigation. Polls (up to 5 s) until the load event has finished
// and FCP has been reported; both are recorded by the browser, so polling does not change them.
const COLLECT = `
const done = arguments[arguments.length - 1];
const deadline = performance.now() + 5000;
async function sha256(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return null;
  }
}
(function poll() {
  const nav = performance.getEntriesByType('navigation')[0];
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  if ((nav && nav.loadEventEnd > 0 && fcp) || performance.now() > deadline) {
    const main = document.querySelector('main');
    const tags = document.querySelectorAll('#nocturne-theme');
    const result = {
      domInteractive: nav ? nav.domInteractive : null,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
      load: nav && nav.loadEventEnd > 0 ? nav.loadEventEnd : null,
      fcp: fcp ? fcp.startTime : null,
      elements: main ? main.querySelectorAll('*').length : null,
      themeCount: tags.length,
      themeCssSha256: null,
      readyState: document.readyState,
    };
    if (tags.length === 1) sha256(tags[0].textContent).then((h) => { result.themeCssSha256 = h; done(result); });
    else done(result);
  } else {
    setTimeout(poll, 20);
  }
})();`;

function parseOptions() {
  const { values } = parseArgs({
    options: {
      sizes: { type: 'string', default: '100,1000,5000' },
      runs: { type: 'string', default: '10' },
      warmup: { type: 'string', default: '2' },
      rounds: { type: 'string', default: '1' },
      scenarios: { type: 'string', default: 'baseline,nocturne' },
      port: { type: 'string', default: process.env.BENCH_PORT ?? '4173' },
      out: { type: 'string' },
      geckodriver: { type: 'string', default: process.env.GECKODRIVER ?? 'geckodriver' },
      headed: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  const ints = (s, name) => {
    const list = s.split(',').map((x) => Number.parseInt(x, 10));
    if (list.some((n) => !Number.isInteger(n) || n < 0)) throw new Error(`Invalid --${name}: ${s}`);
    return list;
  };
  const scenarios = values.scenarios.split(',');
  for (const s of scenarios) if (!(s in SCENARIOS)) throw new Error(`Unknown scenario: ${s} (known: ${Object.keys(SCENARIOS).join(', ')})`);
  if (new Set(scenarios).size !== scenarios.length) throw new Error('Duplicate scenario in --scenarios');
  const runs = ints(values.runs, 'runs')[0];
  const rounds = ints(values.rounds, 'rounds')[0];
  if (runs < 1) throw new Error('--runs must be >= 1');
  if (rounds < 1) throw new Error('--rounds must be >= 1');
  return {
    sizes: ints(values.sizes, 'sizes').filter((n) => n > 0),
    runs,
    rounds,
    warmup: ints(values.warmup, 'warmup')[0],
    scenarios,
    port: Number(values.port),
    out: values.out,
    geckodriver: values.geckodriver,
    headless: !values.headed,
  };
}

async function serverUp(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return res.ok && (await res.text()).includes('Nocturne bench');
  } catch {
    return false;
  }
}

async function ensureServer(port) {
  if (await serverUp(port)) return { startedByRunner: false, stop: async () => {} };
  const child = spawn(process.execPath, [path.join(ROOT, 'bench/serve.mjs')], {
    env: { ...process.env, BENCH_PORT: String(port) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    if (await serverUp(port)) return { startedByRunner: true, stop: async () => void child.kill() };
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error(`Benchmark server did not start on port ${port}`);
}

const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Resolves the zip and the expected stylesheet of a scenario and checks the build's identity. */
function resolveExtension(name) {
  const spec = SCENARIOS[name];
  const info = { description: spec.description, expectedThemeTags: spec.themeTags, expectedThemeApplied: spec.themeApplied };
  if (spec.cssFile) {
    info.cssFile = spec.cssFile;
    info.expectedCssSha256 = sha256File(path.join(ROOT, spec.cssFile));
  }
  if (!spec.buildDir) return info;

  const dir = path.join(ROOT, spec.buildDir);
  const zips = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('-firefox.zip'))
        .map((f) => ({ f, t: statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
    : [];
  if (zips.length === 0) throw new Error(`No *-firefox.zip in ${spec.buildDir}. Run \`pnpm bench:build\` first.`);

  const manifest = JSON.parse(readFileSync(path.join(dir, 'firefox-mv2/manifest.json'), 'utf8'));
  if (manifest.name !== spec.manifestName) {
    throw new Error(`${name}: manifest name is "${manifest.name}", expected "${spec.manifestName}" (stale or wrong build in ${spec.buildDir})`);
  }
  const file = path.join(dir, zips[0].f);
  return {
    ...info,
    file,
    zip: path.relative(ROOT, file),
    version: manifest.version,
    manifestName: manifest.name,
    sha256: sha256File(file),
    contentScriptBytes: statSync(path.join(dir, 'firefox-mv2/content-scripts/content.js')).size,
  };
}

function tryRead(file) {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

function tryExec(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function collectEnvironment(geckodriver) {
  const cpus = os.cpus();
  const seleniumPkg = JSON.parse(readFileSync(path.join(ROOT, 'node_modules/selenium-webdriver/package.json'), 'utf8'));
  return {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model ?? 'unknown',
    cpuCount: cpus.length,
    cpuGovernor: tryRead('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor'),
    totalMemBytes: os.totalmem(),
    node: process.version,
    geckodriver: tryExec(geckodriver, ['--version'])?.split('\n')[0] ?? 'unknown',
    seleniumWebdriver: seleniumPkg.version,
    git: {
      commit: tryExec('git', ['rev-parse', '--short', 'HEAD']) ?? 'no-commit',
      dirty: (tryExec('git', ['status', '--porcelain']) ?? '') !== '',
    },
  };
}

function validateRun(rec, ext, size) {
  const reasons = [];
  if (rec.load === null) reasons.push('load event did not complete');
  if (rec.elements !== size) reasons.push(`expected ${size} elements, found ${rec.elements}`);
  if (rec.themeCount !== ext.expectedThemeTags) {
    reasons.push(`expected ${ext.expectedThemeTags} #nocturne-theme tag(s), found ${rec.themeCount}`);
  } else if (ext.expectedCssSha256 && rec.themeCssSha256 !== ext.expectedCssSha256) {
    reasons.push(`theme stylesheet does not match ${ext.cssFile} (sha256 ${rec.themeCssSha256 ?? 'unavailable'})`);
  }
  return reasons;
}

async function runSession(name, round, position, opts, ext, outDir) {
  const options = new firefox.Options().enableBidi();
  if (opts.headless) options.addArguments('-headless');
  const service = new firefox.ServiceBuilder(opts.geckodriver);
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();

  const session = {
    name,
    round,
    position,
    loadavg: os.loadavg(),
    browser: null,
    verification: { addonId: null, ok: false, problems: [] },
    consoleProblems: [],
    sessionErrors: [],
    sizes: [],
  };
  const logs = { total: 0, themeApplied: 0, notApplied: 0 };
  let inspector = null;

  try {
    const caps = await driver.getCapabilities();
    session.browser = {
      version: caps.get('browserVersion'),
      geckodriverVersion: caps.get('moz:geckodriverVersion') ?? null,
      profile: caps.get('moz:profile') ?? null,
    };
    if (session.browser.profile?.includes('.mozilla')) {
      throw new Error(`Refusing to run: profile looks like a personal one (${session.browser.profile})`);
    }

    await driver.manage().window().setRect({ x: 0, y: 0, ...WINDOW });

    try {
      inspector = await LogInspector(driver);
      await inspector.onLog((entry) => {
        if (entry.text?.startsWith('[Nocturne] initialized')) {
          logs.total++;
          if (entry.text.includes('themeApplied=true')) logs.themeApplied++;
          if (entry.text.includes('themeApplied=false')) logs.notApplied++;
        }
        if (entry.level === 'warning' || entry.level === 'error') {
          session.consoleProblems.push({ level: entry.level, type: entry.type, text: entry.text });
        }
      });
    } catch (e) {
      session.sessionErrors.push(`console capture unavailable: ${e.message}`);
    }

    if (ext.file) {
      await driver.get('about:blank');
      session.verification.addonId = await driver.installAddon(ext.file, true);
    }

    for (const size of opts.sizes) {
      const url = `http://127.0.0.1:${opts.port}/page?n=${size}`;
      const records = [];
      for (let i = 0; i < opts.warmup + opts.runs; i++) {
        const phase = i < opts.warmup ? 'warmup' : 'measured';
        const rec = { phase, index: phase === 'warmup' ? i + 1 : i - opts.warmup + 1, reasons: [] };
        try {
          await driver.get('about:blank');
          await driver.get(url);
          Object.assign(rec, await driver.executeAsyncScript(COLLECT));
          rec.reasons.push(...validateRun(rec, ext, size));
        } catch (e) {
          rec.reasons.push(`exception: ${e.message}`);
        }
        rec.valid = rec.reasons.length === 0;
        records.push(rec);
        console.log(
          `  [${name} r${round + 1}] n=${size} ${phase} #${rec.index}: ${rec.valid ? `load=${rec.load}ms fcp=${rec.fcp ?? 'n/a'}ms` : `INVALID (${rec.reasons.join('; ')})`}`,
        );
      }

      let screenshot = null;
      try {
        const file = `${name}-${size}-r${round + 1}.png`;
        mkdirSync(path.join(outDir, 'screenshots'), { recursive: true });
        writeFileSync(path.join(outDir, 'screenshots', file), await driver.takeScreenshot(), 'base64');
        screenshot = `screenshots/${file}`;
      } catch (e) {
        session.sessionErrors.push(`screenshot n=${size} failed: ${e.message}`);
      }

      const valid = records.filter((r) => r.phase === 'measured' && r.valid);
      session.sizes.push({
        size,
        status: valid.length === opts.runs ? 'valid' : 'invalid',
        validRuns: valid.length,
        screenshot,
        aggregates: Object.fromEntries(METRIC_KEYS.map((k) => [k, summarize(valid.map((r) => r[k]))])),
        records,
      });
    }

    await new Promise((r) => setTimeout(r, 300)); // let late console entries arrive
  } catch (e) {
    session.sessionErrors.push(`session failed: ${e.message}`);
  } finally {
    try {
      await inspector?.close();
    } catch {}
    await driver.quit();
  }

  // Session-level identity checks. Run-level failures are tracked per size, not here.
  const v = session.verification;
  const spec = SCENARIOS[name];
  const loads = opts.sizes.length * (opts.warmup + opts.runs);
  Object.assign(v, { consoleLines: logs.total, consoleLinesThemeApplied: logs.themeApplied, consoleLinesThemeNotApplied: logs.notApplied });
  if (session.sessionErrors.some((e) => e.startsWith('session failed'))) v.problems.push('session aborted');
  if (session.sizes.length !== opts.sizes.length) v.problems.push('session did not complete all sizes');
  if (ext.file && !v.addonId) v.problems.push('add-on installation did not return an id');
  if (!ext.file && logs.total > 0) v.problems.push(`${logs.total} [Nocturne] console line(s) seen with no extension installed`);
  if (ext.file && inspector) {
    if (logs.total !== loads) v.problems.push(`expected ${loads} [Nocturne] console lines (one per navigation), saw ${logs.total}`);
    if (spec.themeApplied === true && logs.notApplied > 0) v.problems.push('console reports themeApplied=false but the theme was expected');
    if (spec.themeApplied === false && logs.themeApplied > 0) v.problems.push('console reports themeApplied=true but no theme was expected');
  }
  v.ok = v.problems.length === 0;
  return session;
}

async function main() {
  const opts = parseOptions();
  const startedAt = new Date();
  const outDir = opts.out
    ? path.resolve(opts.out)
    : path.join(ROOT, 'bench/results', startedAt.toISOString().replace(/[:.]/g, '-'));
  if (existsSync(path.join(outDir, 'results.json'))) throw new Error(`Refusing to overwrite existing results in ${outDir}`);
  mkdirSync(outDir, { recursive: true });

  const extensions = Object.fromEntries(opts.scenarios.map((name) => [name, resolveExtension(name)]));
  const server = await ensureServer(opts.port);
  const cleanup = async () => void (await server.stop());
  process.once('SIGINT', async () => {
    await cleanup();
    process.exit(130);
  });

  const orders = Array.from({ length: opts.rounds }, (_, r) => scenarioOrder(opts.scenarios, r));
  const sessions = [];
  try {
    for (let round = 0; round < opts.rounds; round++) {
      console.log(`Round ${round + 1}/${opts.rounds}: ${orders[round].join(' > ')}`);
      for (let position = 0; position < orders[round].length; position++) {
        const name = orders[round][position];
        sessions.push(await runSession(name, round, position, opts, extensions[name], outDir));
      }
    }
  } finally {
    await cleanup();
  }

  const scenarios = mergeSessions(sessions, opts.scenarios, opts.sizes, opts.runs);
  const results = {
    schema: 2,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    config: {
      sizes: opts.sizes,
      runs: opts.runs,
      warmup: opts.warmup,
      rounds: opts.rounds,
      scenarios: opts.scenarios,
      orders,
      orderMethod: 'williams-design',
      headless: opts.headless,
      window: `${WINDOW.width}x${WINDOW.height}`,
      port: opts.port,
      serverStartedByRunner: server.startedByRunner,
      percentileMethod: 'nearest-rank',
    },
    environment: collectEnvironment(opts.geckodriver),
    extensions: Object.fromEntries(Object.entries(extensions).map(([k, { file, ...rest }]) => [k, rest])),
    sessions,
    scenarios,
    comparisons: buildComparisons(scenarios),
  };
  writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  writeFileSync(path.join(outDir, 'report.md'), renderReport(results));

  const allOk = scenarios.every((s) => s.verification.ok && s.sizes.every((z) => z.status === 'valid'));
  console.log(`\n${allOk ? 'All scenarios valid.' : 'INVALID scenarios or runs detected, see report.'}`);
  console.log(`Report:      ${path.relative(ROOT, path.join(outDir, 'report.md'))}`);
  console.log(`Raw data:    ${path.relative(ROOT, path.join(outDir, 'results.json'))}`);
  console.log(`Screenshots: ${path.relative(ROOT, path.join(outDir, 'screenshots'))}/`);
  process.exitCode = allOk ? 0 : 1;
}

main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
