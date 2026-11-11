# Nocturne benchmark

A minimal, reproducible environment for measuring the browser-level cost of dark
mode extensions. It is independent from the extension code and has no dependencies
beyond Node.js.

> No results are recorded here yet. Fill in the template at the end only with
> measured data.

## What it contains

| File | Purpose |
|------|---------|
| `page.mjs` | Deterministic page generator. Same `n` produces a byte-identical page. |
| `serve.mjs` | Local HTTP server using only `node:http`. |

Each generated "card" contains exactly 20 elements: a heading, a paragraph with two links and
`<strong>`, a two-row table, two buttons and a note. Some of these elements use inline
`style` attributes (4 per card). The page has its own light stylesheet with classes, `:hover`,
`:visited`, `nth-child`, shadows and borders. `n` counts only the elements inside `<main>`.
It is rounded up to a multiple of 20, with a maximum of 20,000. A fixed header and the
metrics script are added outside `<main>`.

The page is served over `http://` because the content script matches only
`http://*/*` and `https://*/*`. It does not match `file://`.

## Running

```bash
pnpm bench                      # http://127.0.0.1:4173/
BENCH_PORT=5000 pnpm bench      # custom port
```

| URL | Description |
|-----|-------------|
| `/page?n=100`, `/page?n=1000`, `/page?n=5000` | Preset sizes |
| `/page?n=1000&delay=1000` | Sends `<head>` and the header immediately and the rest 1 s later. Use this to observe the initial-load flash. The maximum delay is 10 s. |

Responses use `Cache-Control: no-store` so that every load parses the page again.

After `load`, the page logs a single line:

```
[bench] elements=1000 | domInteractive=… | domContentLoaded=… | load=… | fcp=…
```

These are Navigation and Paint Timing values reported by the browser. They are useful for
comparing scenarios at a coarse level. They are **not** a measure of style, layout or paint
cost. Use the Firefox Profiler for those.

## Automated runner (Selenium + geckodriver)

```bash
pnpm bench:run                                      # full run: 100/1000/5000 elements
pnpm bench:run --sizes 100 --runs 3 --warmup 1      # quick smoke test
```

The script builds the production extension (`wxt zip -b firefox`) and then runs
`bench/run.mjs`. Options: `--sizes 100,1000,5000`, `--runs 10`, `--warmup 2`,
`--scenarios baseline,nocturne`, `--port 4173`, `--out <dir>`, `--headed`,
`--geckodriver <path>` (or `GECKODRIVER`). Default is headless.

**Requirements on another machine:** Node.js 26 and pnpm (`mise install`, `pnpm install`),
Firefox, and a `geckodriver` on `PATH` (on Ubuntu with Snap Firefox, `/snap/bin/geckodriver`
is provided by the Firefox snap and works with its confinement). Nothing else.

**What it does**
- Reuses the server on the port if it is already running; otherwise starts `serve.mjs`
  and stops it at the end.
- Starts a separate Firefox session per scenario. geckodriver creates a fresh temporary
  profile and deletes it on exit. The runner refuses profiles under `.mozilla`. The personal
  profile is never used. No security preference is changed.
- `nocturne` installs the production zip as a temporary add-on. `baseline` installs nothing.
- Per size: 2 warm-up + 10 measured navigations, each preceded by `about:blank`.
  Navigations use `no-store` responses.
- Collects `domInteractive`, `domContentLoaded` (end), `load` (end) and First Contentful Paint
  from Navigation/Paint Timing after waiting for both to be available. (The page's own
  `[bench]` console line can print `fcp=n/a` because it runs before FCP is reported; the
  runner does not use it.)
- Takes one viewport screenshot per scenario and size after the measured runs.
- Captures console warnings/errors through WebDriver BiDi.

**Run validation.** A run is invalid if the load did not complete, the element count differs,
or `#nocturne-theme` is not exactly as expected (exactly one with Nocturne, none in the
baseline). A scenario is invalid if the add-on id is missing, if any measured run is invalid,
if `[Nocturne]` console lines appear in the baseline or none appear with the extension.
Invalid runs are kept in `results.json` with their reasons and listed in the report. They are
excluded from the aggregates and make the command exit with code 1.

**Statistics.** Median (mean of the two middle values for even n), min, max and nearest-rank
p95 (`rank = ceil(0.95·n)`, an observed value, no interpolation; with 10 runs it equals the
max). The report also shows the raw difference of medians and whether the min–max ranges
overlap. There is no significance test.

**Output** (in `bench/results/<timestamp>/`, git-ignored): `results.json` (raw runs, aggregates,
environment, extension hash, git commit), `report.md` and `screenshots/`.

**Not verifiable in this setup.** Confirming the installed add-ons through Firefox's privileged
chrome context requires `-remote-allow-system-access`, which the runner deliberately does not
use. The baseline is therefore verified by construction (fresh profile, nothing installed),
the absence of the theme tag and the absence of `[Nocturne]` console lines.

**Limitations specific to the runner**
- Timing values are Navigation/Paint Timing only. Extension CPU time, style recalculation,
  layout, paint, memory and time-to-dark are **not** measured. Use the Firefox Profiler for those.
- Each scenario is one browser session, so session effects and the extension effect are not
  separated. Repeat the whole run (ideally alternating `--scenarios`) before drawing conclusions.
- Selenium/Marionette itself, headless mode and the BiDi log subscription can influence timing.
  They apply to both scenarios, but absolute numbers are not comparable with manual sessions.
- Early runs can show large variance (a cold first session). Check min/max in the report.
- Always inspect the screenshots: a visually incomplete dark theme does less work.

## Isolation experiment (baseline / bootstrap / injection / nocturne)

```bash
pnpm bench:isolate                     # builds all variants, then 4 scenarios x 4 rounds
pnpm bench:isolate --sizes 100 --runs 3 --warmup 1 --rounds 2   # quick check
pnpm bench:build                       # only (re)build the zips
```

Goal: find out which part of the overhead seen with Nocturne comes from what.

| Scenario | What is installed | What differs from the previous step |
|----------|-------------------|--------------------------------------|
| `baseline` | nothing | n/a |
| `bootstrap` | the production extension, but `applyTheme()` is a no-op | the extension and its content script exist; the page is never touched |
| `injection` | the production extension with a tiny stylesheet (`bench/variants/minimal.css`, one rule on `html`) | same code path as production, one `<style>` tag, almost no rules |
| `nocturne` | the regular production build | the full stylesheet (`utils/theme.css`) |

**How the variants are built.** `bench/wxt.variants.config.ts` is a second WXT config (used with
`wxt zip -c`) that reuses *all* production entrypoints (content script, background, popup) and
only swaps one module at resolution time with a small Vite plugin: `utils/theme` becomes the
no-op module for `bootstrap`, `./theme.css?raw` becomes `minimal.css` for `injection`. Production
sources are not modified, the manifest differs only in `name`, and `.output/` is untouched.
`bench/build-variants.mjs` builds both variants into `.output-bench/<variant>/` and fails if
the bundle does not contain what the variant must (or still contains the production palette).
It also runs `wxt prepare` at the end, because variant builds rewrite `.wxt/tsconfig.json`.

**Identity checks (per run, per session).** Every navigation hashes the text of
`#nocturne-theme` in the page and compares it with the SHA-256 of the expected stylesheet file;
scenarios without a stylesheet must have no such tag. Each session also checks the number of
`[Nocturne] initialized` console lines (one per navigation) and their `themeApplied=` value,
the manifest name of the build, and that the add-on was installed. The build zips' SHA-256 and
the `content.js` sizes are recorded in `results.json`. A stale or wrong build is reported as
invalid (verified by deliberately changing `minimal.css` without rebuilding).

**Sessions and order.** Each (scenario, round) is a fresh Firefox session with a fresh profile.
`--rounds N` repeats the whole set; the scenario order changes every round following a
Williams design (`scenarioOrder` in `bench/aggregate.mjs`). With four scenarios, four rounds put every
scenario in every position once and every ordered pair of neighbours once. Statistics pool the
measured runs of all rounds. The report also lists per-session medians and *paired* differences
(candidate − reference within the same round) to expose session-to-session variation.
Previous result directories are never overwritten (`results.json` existing in `--out` is an error).

**Caveats specific to these variants**
- `bootstrap` still runs the WXT content-script wrapper, reads `document.readyState` and calls
  `console.log`. Everything done by `main()` except `applyTheme()` is therefore included in
  its cost; the console call is observed by the BiDi log subscription that the runner
  uses in every scenario (including the baseline, where only the page's own logs exist).
- `injection` is nearly invisible: the page's own `body` background hides the dark `html`
  background, so mostly the scroll-bar gutter changes. It measures the mechanism of injecting a
  stylesheet, not the cost of painting a dark page.
- The baseline has no extension at all, so *any* cost of having a document_start content script
  at all shows up in `bootstrap`.
- None of this is CPU time, style recalculation, layout or paint cost (see below).

## Scenarios

Use one dedicated Firefox profile per scenario for **manual** profiling. This keeps the extension set, settings and
caches isolated from each other.

1. `bench-baseline`: no extensions.
2. `bench-nocturne`: only Nocturne, using a **production build**.
3. `bench-darkreader`: only Dark Reader from addons.mozilla.org, with **Dynamic** mode
   selected and `127.0.0.1` not on its disabled list.

You can create the profiles in `about:profiles`. With Snap, you can also run
`firefox -P --no-remote`.

To load Nocturne in `bench-nocturne`:

```bash
pnpm build:firefox
```

Then open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…** and
select `.output/firefox-mv2/manifest.json`. Temporary add-ons are removed when Firefox
restarts, so you need to reload it in every session.

Do **not** benchmark `pnpm dev:firefox`. The dev build includes WXT's reload client and
the Alt+Shift+N listener.

## Controlled conditions

Keep these constant across scenarios and record them with the results:

- Firefox version and installation type (Snap), OS and kernel, CPU, RAM.
- AC power, the same CPU power profile and no heavy background work.
- One window of the same size, with only the benchmark tab open.
- `privacy.resistFingerprinting` left at its default value (off). It changes timer resolution.
- The same URL list and the same `n` values.

Procedure for each scenario and each `n`:

1. Start Firefox with the scenario's profile and wait about 30 s after startup.
2. Make 2 warm-up loads and discard them.
3. Make 10 measured loads. Type the URL into a fresh tab, or press Enter in the address
   bar. Do not use reload buttons inconsistently.
4. Record the median and the range, not single values.
5. Across sessions, alternate the order of the scenarios to reduce drift effects such as
   thermals.

## Collecting measurements with Firefox Profiler

1. Open `about:profiling`. Select the **Web Developer** preset, or **Graphics** for more
   detail on painting. Enable the **Screenshots** feature when studying visual flashes.
   You can add the profiler toolbar button from the same page.
2. Open a new tab. Start recording with **Ctrl+Shift+1**, load the bench URL, wait until
   the `[bench]` line appears, then capture with **Ctrl+Shift+2**.
3. In the profile, select the content process that hosts `127.0.0.1`.

| Question | Where to look |
|----------|---------------|
| Extension JS cost | Call Tree or Flame Graph. Search for `moz-extension://`. Nocturne's code is in `content-scripts/content.js`. |
| Style recalculation | Marker Chart: style markers (`Styles`) and their durations. Compare their total and count between scenarios. |
| Layout | Marker Chart: reflow/layout markers. |
| Paint and compositing | Marker Chart: paint and composite markers. Use the Graphics preset for more detail. |
| Main-thread blocking | Long contiguous CPU blocks in the thread activity graph. Firefox may not expose the Long Tasks API to pages, so use the profile instead. |
| Load milestones | `DOMContentLoaded`, `Load` and contentful-paint markers in the Marker Chart. |
| Visual flash / time to dark | The Screenshots track. Find the first frame that shows the page and check whether it is light or dark. Use the `delay=1000` URL to make this window long enough to observe. |

Marker names can change between Firefox versions. Check them in your profiles rather than
relying on the names listed here.

Profiles can be uploaded or saved as local files. Store the files you use for any reported
number so the analysis can be reproduced.

### Memory

- `about:memory` → **Measure**. Compare the web content process for `127.0.0.1` and the
  extension process across scenarios. Measure after the page has finished loading and after
  **Minimize memory usage**, and report both values.
- The profiler's memory track shows allocation over time but not totals per extension.

## Limitations

- **The page is synthetic.** It does not cover images, SVG, iframes, Shadow DOM, CSS
  variables, web fonts, cross-origin stylesheets or dynamic DOM changes. Results from it do
  not generalize to real sites. Add real-site captures later.
- **There is no network latency on localhost.** That changes the timing between parsing and
  extension injection compared with real browsing. The `delay` parameter only simulates a
  slow body, not a slow head.
- **`performance.now()` inside the content script** measures only its own synchronous work.
  It does not include the style recalculation, layout and paint that the injected CSS causes
  later. Firefox also reduces timer precision by default, so very short intervals may read as
  0 or appear quantized.
- **Navigation and Paint Timing** reflect the whole page. Differences between scenarios are
  indirect evidence and should be confirmed in a profile.
- **FCP does not mean "visually dark".** Use screenshots for time-to-dark.
- **The profiler adds overhead.** Compare profiles only with other profiles recorded under the
  same settings.
- **Dark Reader does much more work** (dynamic analysis) and produces a different visual result.
  Performance comparisons must be paired with a visual-correctness check. Otherwise a
  cheaper result may just be a worse one.
- **Dark Reader may load configuration on first run.** Warm-up loads mitigate this.
- **Temporary add-on vs. signed add-on.** Loading behavior could differ slightly. Note which one
  was used.
- **Single-machine variance** (thermals, GC timing, Snap confinement). Use repeated runs and
  medians, and avoid drawing conclusions from small differences.

## Results template

Record only measured values. Leave cells empty otherwise.

| Date | Firefox | Scenario | n | Runs | Ext JS (median) | Styles total (median) | Reflow total | Paint/Composite | Time to dark | Content proc. memory | Notes |
|------|---------|----------|---|------|-----------------|-----------------------|--------------|-----------------|--------------|----------------------|-------|
| | | baseline | 1000 | | n/a | | | | n/a | | |
| | | nocturne | 1000 | | | | | | | | |
| | | darkreader | 1000 | | | | | | | | |
