// WXT config for benchmark-only builds. Usage (see bench/build-variants.mjs):
//
//   BENCH_VARIANT=bootstrap|injection wxt zip -b firefox -c bench/wxt.variants.config.ts
//
// It reuses ALL production entrypoints (content script, background, popup) and only swaps the
// theme module at resolution time, so the variants differ from the production build in
// exactly one thing:
//
//   bootstrap : `utils/theme` -> no-op module (content script runs, page is never touched)
//   injection : `./theme.css?raw` -> bench/variants/minimal.css (same code path, tiny stylesheet)
//
// The production `nocturne` scenario uses the regular build and does not use this file.

import path from 'node:path';
import { defineConfig } from 'wxt';

const variant = process.env.BENCH_VARIANT;
if (variant !== 'bootstrap' && variant !== 'injection') {
  throw new Error(`BENCH_VARIANT must be "bootstrap" or "injection" (got: ${variant})`);
}

const abs = (p: string) => path.resolve(import.meta.dirname, p);

// Vite's alias plugin runs first and rewrites `@/utils/theme` to an absolute path (without
// extension), so that is the specifier this hook actually receives.
const PRODUCTION_THEME_MODULE = abs('../utils/theme');

const swapThemePlugin = {
  name: 'nocturne-bench-variant',
  enforce: 'pre' as const,
  resolveId(source: string) {
    if (variant === 'bootstrap' && source === PRODUCTION_THEME_MODULE) return abs('variants/theme-bootstrap.ts');
    if (variant === 'injection' && source === './theme.css?raw') return `${abs('variants/minimal.css')}?raw`;
    return null;
  },
};

export default defineConfig({
  outDir: `.output-bench/${variant}`,
  manifest: { name: `Nocturne bench (${variant})` },
  zip: { excludeSources: ['.output-bench/**', 'bench/results/**'] },
  vite: () => ({ plugins: [swapThemePlugin] }),
});
