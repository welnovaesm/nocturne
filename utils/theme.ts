import themeCss from './theme.css?raw';

export const THEME_STYLE_ID = 'nocturne-theme';

/**
 * Injects the theme stylesheet. Idempotent: returns false if it is already
 * present (including when injected by a previous content script instance).
 */
export function applyTheme(doc: Document = document): boolean {
  if (isThemeApplied(doc)) return false;

  // At document_start <head> usually does not exist yet; <html> does.
  const parent = doc.head ?? doc.documentElement;
  if (!parent) return false;

  const style = doc.createElement('style');
  style.id = THEME_STYLE_ID;
  style.textContent = themeCss;
  parent.append(style);
  return true;
}

/** Removes the theme stylesheet. The page itself is never modified. */
export function removeTheme(doc: Document = document): boolean {
  const style = doc.getElementById(THEME_STYLE_ID);
  if (!style) return false;
  style.remove();
  return true;
}

export function isThemeApplied(doc: Document = document): boolean {
  return doc.getElementById(THEME_STYLE_ID) !== null;
}

export function toggleTheme(doc: Document = document): boolean {
  if (removeTheme(doc)) return false;
  return applyTheme(doc);
}
