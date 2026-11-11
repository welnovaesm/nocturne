import { describe, expect, it } from 'vitest';
import { parseColor } from './parse';

// Conformance review for HEX and rgb()/rgba().
//
// Every expectation below was checked against Firefox 156.0.1 (2026-11-11) with
// CSS.supports('color', v), element.style.setProperty('color', v) and
// CSSStyleSheet.replaceSync('#t{color:' + v); all three agreed in every case.
//
// Firefox rounds channels to integers when parsing (e.g. rgb(0.4 0 0) -> rgb(0, 0, 0));
// this module intentionally keeps full precision, so only validity, clamping and
// the unrounded values are compared here.

const color = (input: string) => {
  const result = parseColor(input);
  if (!result.ok) throw new Error(`expected ok for "${input}", got ${result.reason}`);
  return result.color;
};
const failure = (input: string) => {
  const result = parseColor(input);
  return result.ok ? 'ok' : result.reason;
};

describe('conformant behavior (regression)', () => {
  it.each([
    ['RgB(1 2 3)', { r: 1, g: 2, b: 3, a: 1 }],
    ['rgb(1 , 2 , 3)', { r: 1, g: 2, b: 3, a: 1 }],
    ['rgb(1 2 3 / 0.5 )', { r: 1, g: 2, b: 3, a: 0.5 }],
    ['rgba(1 2 3 / 50%)', { r: 1, g: 2, b: 3, a: 0.5 }],
    ['rgb(none 20 30)', { r: 0, g: 20, b: 30, a: 1 }],
    ['rgb(1e2% 0 0)', { r: 255, g: 0, b: 0, a: 1 }],
    ['rgb(1 2 3 / 0.333)', { r: 1, g: 2, b: 3, a: 0.333 }],
  ])('accepts %s', (input, expected) => {
    expect(color(input)).toEqual(expected);
  });

  it.each([
    'rgb(1.5.5 0 0)', // tokenizes as 1.5 .5 0 0: four channels
    'rgb(1 2 3) x',
    'rgb (1 2 3)', // a function token needs "(" right after the name
    '#fff #000',
    'rgb(10, 20, 30, none)', // none is not allowed in the legacy syntax
    'rgb(\u00a01 2 3)', // NBSP is not CSS whitespace
    '#fff\\0',
  ])('rejects %s', (input) => {
    expect(failure(input)).toBe('invalid');
  });

  it('reports var() in a component as unsupported (resolved at computed-value time)', () => {
    expect(failure('rgb(1 2 3 / var(--a))')).toBe('unsupported');
  });
});

describe('contract decisions that differ from the browser', () => {
  // Firefox rejects these. The parser does not validate the arguments of functions
  // it does not support, so they are reported as `unsupported`, not `invalid`.
  it.each(['hsl(garbage)', 'rgb((1 2 3))', 'notacolor'])(
    'reports %s as unsupported',
    (input) => {
      expect(failure(input)).toBe('unsupported');
    },
  );
});

// Known deviations from Firefox. Each test states the browser's behavior and is
// expected to fail until the parser is fixed; `it.fails` turns red once it passes,
// so the marker must then be removed.
describe('known deviations (expected to fail until fixed)', () => {
  it.fails('D1: ignores comments between tokens', () => {
    expect(color('rgb(1/**/2/**/3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });

  it.fails('D1: ignores a comment after a hex color', () => {
    expect(color('#fff/**/')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it.fails('D2: closes an unterminated function at end of input (modern)', () => {
    expect(color('rgb(1 2 3')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });

  it.fails('D2: closes an unterminated function at end of input (legacy)', () => {
    expect(color('rgb(1, 2, 3')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });

  it.fails('D3: clamps numbers that overflow a double', () => {
    expect(color('rgb(1e999 0 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it.fails('D3: clamps negative numbers that overflow a double', () => {
    expect(color('rgb(-1e999 0 0)')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it.fails('D4: accepts escapes in the function name', () => {
    expect(color('r\\67 b(1 2 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });
});

describe('number tokenization (D5, fixed)', () => {
  it('a sign right after a number starts a new number, not a unit', () => {
    expect(color('rgb(1-2-3)')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it.each([
    ['rgb(1-.5-.5)', { r: 1, g: 0, b: 0, a: 1 }],
    ['rgb(1%-2%-3%)', { r: 2.55, g: 0, b: 0, a: 1 }],
    ['rgb(1e-1-2 0)', { r: 0.1, g: 0, b: 0, a: 1 }],
    ['rgb(1%2 3)', { r: 2.55, g: 2, b: 3, a: 1 }],
    ['rgb(1 -2 3)', { r: 1, g: 0, b: 3, a: 1 }],
    ['rgb(1,-2,-3)', { r: 1, g: 0, b: 0, a: 1 }],
  ])('accepts %s', (input, expected) => {
    expect(color(input)).toEqual(expected);
  });

  it.each([
    'rgb(1-a 2 3)', // dimension with unit "-a"
    'rgb(1--2 3 4)', // dimension with unit "--2"
    'rgb(1-_ 2 3)', // dimension with unit "-_"
    'rgb(1e-x 2 3)', // dimension with unit "e-x"
    'rgb(1-2,3)', // legacy syntax with only two comma-separated values
  ])('rejects %s', (input) => {
    expect(failure(input)).toBe('invalid');
  });
});

describe('negative zero (D6, fixed)', () => {
  it.each(['rgb(-0 0 0 / -0)', 'rgb(-0% -0% -0% / -0%)', 'rgba(-0, -0, -0, -0)', 'rgb(-0 0 0 / -1)'])(
    'never exposes -0 for %s',
    (input) => {
      const c = color(input);
      expect(Object.is(c.r, -0) || Object.is(c.g, -0) || Object.is(c.b, -0) || Object.is(c.a, -0)).toBe(false);
    },
  );

  it('returns plain zeros for rgb(-0 0 0 / -0)', () => {
    expect(color('rgb(-0 0 0 / -0)')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});
