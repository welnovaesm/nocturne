// Benchmark variant "bootstrap": same API as utils/theme.ts, but never touches the page.
// Swapped in at build time by bench/wxt.variants.config.ts; production code is not modified.

export const THEME_STYLE_ID = 'nocturne-theme';

export function applyTheme(): boolean {
  return false;
}

export function removeTheme(): boolean {
  return false;
}

export function isThemeApplied(): boolean {
  return false;
}

export function toggleTheme(): boolean {
  return false;
}
