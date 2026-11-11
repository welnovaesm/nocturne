import type { ParseResult } from './types';

const INVALID: ParseResult = { ok: false, reason: 'invalid' };
const UNSUPPORTED: ParseResult = { ok: false, reason: 'unsupported' };

// `+ 0` turns -0 into 0 and leaves every other value unchanged.
const ok = (r: number, g: number, b: number, a: number): ParseResult => ({
  ok: true,
  color: { r: r + 0, g: g + 0, b: b + 0, a: a + 0 },
});

const clamp = (v: number, min: number, max: number) =>
  v < min ? min : v > max ? max : v;

const isWhitespace = (c: string) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isDigit = (c: string) => c >= '0' && c <= '9';
const isIdentChar = (c: string) =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '-' || c === '_' || isDigit(c);

/**
 * Parses a CSS color string.
 *
 * Supported: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, and `rgb()`/`rgba()` in both
 * the legacy (comma) and modern (space, `/ alpha`) syntaxes, with numbers or
 * percentages, and the `none` keyword in the modern syntax.
 *
 * Out-of-range channel and alpha values are clamped, as CSS specifies. Fractional
 * values are preserved. `none` is treated as 0.
 *
 * Failures are reported, never thrown:
 * - `unsupported`: the input cannot be interpreted with the subset implemented so far
 *   (named colors, hsl(), oklch(), `currentcolor`, `transparent`, `var()`, `calc()`,
 *   relative colors...). It does NOT mean the input is valid CSS: bare identifiers and
 *   the arguments of unsupported functions are not validated, so `notacolor` and
 *   `hsl(garbage)` are `unsupported` too.
 * - `invalid`: the input is malformed for the hex or rgb()/rgba() syntax it uses, or
 *   is not a color at all.
 */
export function parseColor(input: string): ParseResult {
  const s = trim(input);
  if (s.length === 0) return INVALID;
  if (s.charAt(0) === '#') return parseHex(s.slice(1));
  return parseFunctionOrKeyword(s);
}

function trim(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isWhitespace(s.charAt(start))) start++;
  while (end > start && isWhitespace(s.charAt(end - 1))) end--;
  return s.slice(start, end);
}

function hexValue(c: string): number {
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
}

function parseHex(digits: string): ParseResult {
  const n = digits.length;
  if (n !== 3 && n !== 4 && n !== 6 && n !== 8) return INVALID;
  const values: number[] = [];
  for (const c of digits) {
    const v = hexValue(c);
    if (v < 0) return INVALID;
    values.push(v);
  }
  const at = (i: number) => values[i] ?? 0;
  const short = n <= 4;
  const channel = (i: number) => (short ? at(i) * 17 : at(i * 2) * 16 + at(i * 2 + 1));
  const hasAlpha = n === 4 || n === 8;
  return ok(channel(0), channel(1), channel(2), hasAlpha ? channel(3) / 255 : 1);
}

type Token =
  | { kind: 'number'; value: number; percent: boolean }
  | { kind: 'ident'; value: string }
  | { kind: 'comma' }
  | { kind: 'slash' };

type Tokenized = { tokens: Token[] } | { failure: ParseResult };

function parseFunctionOrKeyword(s: string): ParseResult {
  let i = 0;
  while (i < s.length && isIdentChar(s.charAt(i))) i++;
  const name = s.slice(0, i).toLowerCase();
  if (name.length === 0 || isDigit(name.charAt(0))) return INVALID;

  if (i === s.length) {
    // A bare identifier: named colors, `transparent`, `currentcolor`, ... Without a
    // named-color table, unknown names cannot be told apart from valid ones.
    return UNSUPPORTED;
  }
  if (s.charAt(i) !== '(') return INVALID;
  if (s.charAt(s.length - 1) !== ')') return INVALID;

  const body = s.slice(i + 1, -1);
  if (name !== 'rgb' && name !== 'rgba') {
    return isKnownColorFunction(name) ? UNSUPPORTED : INVALID;
  }
  return parseRgbArguments(body);
}

function isKnownColorFunction(name: string): boolean {
  return (
    name === 'hsl' || name === 'hsla' || name === 'hwb' || name === 'lab' ||
    name === 'lch' || name === 'oklab' || name === 'oklch' || name === 'color' ||
    name === 'color-mix' || name === 'light-dark'
  );
}

function tokenize(body: string): Tokenized {
  const tokens: Token[] = [];
  let i = 0;
  while (i < body.length) {
    const c = body.charAt(i);
    if (isWhitespace(c)) {
      i++;
    } else if (c === ',') {
      tokens.push({ kind: 'comma' });
      i++;
    } else if (c === '/') {
      tokens.push({ kind: 'slash' });
      i++;
    } else if (c === '(' || c === ')') {
      // Nested function (var(), calc(), ...) or stray parenthesis.
      return { failure: c === '(' ? UNSUPPORTED : INVALID };
    } else if (isDigit(c) || c === '.' || c === '+' || c === '-') {
      const end = scanNumber(body, i);
      if (end < 0) return { failure: INVALID };
      const value = Number(body.slice(i, end));
      if (!Number.isFinite(value)) return { failure: INVALID };
      i = end;
      let percent = false;
      if (body.charAt(i) === '%') {
        percent = true;
        i++;
      }
      // A unit glued to the number (`10px`, `1e-x`) makes it a dimension, which is
      // invalid here. A sign followed by a digit (`1-2`) starts a new number instead.
      if (wouldStartIdent(body, i)) return { failure: INVALID };
      tokens.push({ kind: 'number', value, percent });
    } else if (isIdentChar(c)) {
      const start = i;
      while (i < body.length && isIdentChar(body.charAt(i))) i++;
      tokens.push({ kind: 'ident', value: body.slice(start, i).toLowerCase() });
    } else {
      return { failure: INVALID };
    }
  }
  return { tokens };
}

const isIdentStart = (c: string) =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c.charCodeAt(0) >= 0x80;

/**
 * CSS Syntax §4.3.9 ("would start an ident sequence"), used after a number to decide
 * between a number and a dimension token.
 */
function wouldStartIdent(s: string, i: number): boolean {
  const c = s.charAt(i);
  if (c === '-') {
    const next = s.charAt(i + 1);
    return next === '-' || next === '\\' || (next !== '' && isIdentStart(next));
  }
  return c === '\\' || (c !== '' && isIdentStart(c));
}

/** Returns the end index of a CSS <number> starting at `start`, or -1. */
function scanNumber(s: string, start: number): number {
  let i = start;
  if (s.charAt(i) === '+' || s.charAt(i) === '-') i++;
  let digits = 0;
  while (i < s.length && isDigit(s.charAt(i))) { i++; digits++; }
  if (s.charAt(i) === '.') {
    i++;
    let frac = 0;
    while (i < s.length && isDigit(s.charAt(i))) { i++; frac++; }
    if (frac === 0) return -1;
    digits += frac;
  }
  if (digits === 0) return -1;
  if (s.charAt(i) === 'e' || s.charAt(i) === 'E') {
    let j = i + 1;
    if (s.charAt(j) === '+' || s.charAt(j) === '-') j++;
    if (j < s.length && isDigit(s.charAt(j))) {
      while (j < s.length && isDigit(s.charAt(j))) j++;
      i = j;
    }
  }
  return i;
}

type Percentable = { value: number; percent: boolean };
type Component = Percentable | 'none';

function parseRgbArguments(body: string): ParseResult {
  const t = tokenize(body);
  if ('failure' in t) return t.failure;
  const tokens = t.tokens;
  if (tokens.length === 0) return INVALID;

  const first = tokens[0];
  if (first?.kind === 'ident' && first.value === 'from') return UNSUPPORTED; // relative color

  const hasComma = tokens.some((x) => x.kind === 'comma');
  return hasComma ? parseLegacy(tokens) : parseModern(tokens);
}

function toComponent(tok: Token | undefined, allowNone: boolean): Component | null {
  if (!tok) return null;
  if (tok.kind === 'number') return { value: tok.value, percent: tok.percent };
  if (tok.kind === 'ident' && tok.value === 'none' && allowNone) return 'none';
  return null;
}

function build(channels: [Component, Component, Component], alpha: Component | null): ParseResult {
  // CSS forbids mixing numbers and percentages only in the legacy syntax; the
  // caller enforces that. Percentages map 100% -> 255.
  const rgb = channels.map((c) =>
    c === 'none' ? 0 : clamp(c.percent ? (c.value * 255) / 100 : c.value, 0, 255),
  );
  let a = 1;
  if (alpha && alpha !== 'none') {
    a = clamp(alpha.percent ? alpha.value / 100 : alpha.value, 0, 1);
  } else if (alpha === 'none') {
    a = 0;
  }
  return ok(rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0, a);
}

/** `rgb(r, g, b)` / `rgba(r, g, b, a)`: commas only, uniform number or percentage. */
function parseLegacy(tokens: Token[]): ParseResult {
  // Expected: value, value, value [, value]
  if (tokens.length !== 5 && tokens.length !== 7) {
    return INVALID;
  }

  const values: Percentable[] = [];

  for (const [index, token] of tokens.entries()) {
    if (index % 2 === 1) {
      if (token.kind !== 'comma') {
        return INVALID;
      }

      continue;
    }

    if (token.kind !== 'number') {
      return INVALID;
    }

    values.push({
      value: token.value,
      percent: token.percent,
    });
  }

  const r = values[0];
  const g = values[1];
  const b = values[2];
  const alpha = values[3];

  if (r === undefined || g === undefined || b === undefined) {
    return INVALID;
  }

  if (r.percent !== g.percent || g.percent !== b.percent) {
    return INVALID;
  }

  return build([r, g, b], alpha ?? null);
}

/** `rgb(r g b [/ a])`: whitespace separated; numbers, percentages and `none` may mix. */
function parseModern(tokens: Token[]): ParseResult {
  // Expected: value value value [/ value]
  if (tokens.length !== 3 && tokens.length !== 5) {
    return INVALID;
  }

  const r = toComponent(tokens[0], true);
  const g = toComponent(tokens[1], true);
  const b = toComponent(tokens[2], true);

  if (r === null || g === null || b === null) {
    return INVALID;
  }

  if (tokens.length === 3) {
    return build([r, g, b], null);
  }

  const separator = tokens[3];

  if (separator?.kind !== 'slash') {
    return INVALID;
  }

  const alpha = toComponent(tokens[4], true);

  if (alpha === null) {
    return INVALID;
  }

  return build([r, g, b], alpha);
}
