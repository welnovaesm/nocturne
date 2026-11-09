import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, isThemeApplied, removeTheme, THEME_STYLE_ID, toggleTheme } from './theme';

function themeStyles() {
  return document.querySelectorAll(`style#${THEME_STYLE_ID}`);
}

describe('theme injection', () => {
  afterEach(() => {
    removeTheme();
    document.head.innerHTML = '';
    document.body.removeAttribute('style');
  });

  it('injects a single stylesheet containing the palette', () => {
    expect(applyTheme()).toBe(true);
    expect(themeStyles()).toHaveLength(1);
    expect(themeStyles()[0]?.textContent).toContain('color-scheme: dark');
  });

  it('is idempotent', () => {
    applyTheme();
    expect(applyTheme()).toBe(false);
    expect(themeStyles()).toHaveLength(1);
  });

  it('removes the stylesheet and leaves page styles untouched', () => {
    document.head.innerHTML = '<style id="page">body { color: red; }</style>';
    document.body.setAttribute('style', 'margin: 0');
    const headBefore = document.head.innerHTML;

    applyTheme();
    expect(removeTheme()).toBe(true);

    expect(isThemeApplied()).toBe(false);
    expect(document.head.innerHTML).toBe(headBefore);
    expect(document.body.getAttribute('style')).toBe('margin: 0');
    expect(removeTheme()).toBe(false);
  });

  it('falls back to <html> when <head> does not exist (document_start)', () => {
    const doc = document.implementation.createHTMLDocument();
    doc.head.remove();

    expect(applyTheme(doc)).toBe(true);
    expect(doc.getElementById(THEME_STYLE_ID)?.parentElement).toBe(doc.documentElement);
  });

  it('toggles', () => {
    expect(toggleTheme()).toBe(true);
    expect(toggleTheme()).toBe(false);
    expect(themeStyles()).toHaveLength(0);
  });
});
