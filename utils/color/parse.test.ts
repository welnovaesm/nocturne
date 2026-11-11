import { describe, expect, it } from 'vitest';
import { parseColor } from './parse';

const color = (input: string) => {
  const result = parseColor(input);
  if (!result.ok) throw new Error(`expected ok for "${input}", got ${result.reason}`);
  return result.color;
};
const failure = (input: string) => {
  const result = parseColor(input);
  return result.ok ? 'ok' : result.reason;
};

describe('hex', () => {
  it('parses #rgb', () => {
    expect(color('#f80')).toEqual({ r: 255, g: 136, b: 0, a: 1 });
  });
  it('parses #rgba', () => {
    expect(color('#f808')).toEqual({ r: 255, g: 136, b: 0, a: 0x88 / 255 });
  });
  it('parses #rrggbb, case-insensitively', () => {
    expect(color('#1A2b3C')).toEqual({ r: 0x1a, g: 0x2b, b: 0x3c, a: 1 });
  });
  it('parses #rrggbbaa without rounding alpha', () => {
    expect(color('#11223380')).toEqual({ r: 0x11, g: 0x22, b: 0x33, a: 128 / 255 });
    expect(color('#000000ff').a).toBe(1);
    expect(color('#00000000').a).toBe(0);
  });
  it('tolerates surrounding whitespace', () => {
    expect(color('  #fff\n')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });
  it.each(['#', '#f', '#ff', '#fffff', '#fffffff', '#fffffffff', '#ggg', '#12345z'])(
    'rejects malformed hex %s',
    (input) => expect(failure(input)).toBe('invalid'),
  );
});

describe('rgb legacy syntax', () => {
  it('parses numbers', () => {
    expect(color('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
  });
  it('parses rgba with alpha', () => {
    expect(color('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });
  it('accepts an alpha in rgb() and no alpha in rgba()', () => {
    expect(color('rgb(0,0,0,0.25)').a).toBe(0.25);
    expect(color('rgba(0,0,0)').a).toBe(1);
  });
  it('parses percentages and percentage alpha', () => {
    expect(color('rgb(100%, 50%, 0%, 25%)')).toEqual({ r: 255, g: 127.5, b: 0, a: 0.25 });
  });
  it('is case-insensitive', () => {
    expect(color('RGB(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });
  it.each([
    'rgb(10 20, 30)',
    'rgb(10, 20 30)',
    'rgb(10, 20)',
    'rgb(10, 20, 30, 0.5, 1)',
    'rgb(10, 20, 30,)',
    'rgb(,10, 20, 30)',
    'rgb(10%, 20, 30)',
    'rgb(10, 20, 30 / 0.5)',
    'rgb(none, 20, 30)',
  ])('rejects %s', (input) => expect(failure(input)).toBe('invalid'));
});

describe('rgb modern syntax', () => {
  it('parses space-separated numbers', () => {
    expect(color('rgb(10 20 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
  });
  it('parses slash alpha as number or percentage', () => {
    expect(color('rgb(10 20 30 / 0.5)').a).toBe(0.5);
    expect(color('rgb(10 20 30 / 50%)').a).toBe(0.5);
    expect(color('rgba(10 20 30/.5)').a).toBe(0.5);
  });
  it('allows mixing numbers and percentages', () => {
    expect(color('rgb(10 50% 30)')).toEqual({ r: 10, g: 127.5, b: 30, a: 1 });
  });
  it('treats none as 0', () => {
    expect(color('rgb(none 20 none / none)')).toEqual({ r: 0, g: 20, b: 0, a: 0 });
  });
  it('preserves fractional values and exponents', () => {
    expect(color('rgb(0.5 1.25 +2e1)')).toEqual({ r: 0.5, g: 1.25, b: 20, a: 1 });
  });
  it.each([
    'rgb(10 20)',
    'rgb(10 20 30 40)',
    'rgb(10 20 30 /)',
    'rgb(10 20 30 / 0.5 0.5)',
    'rgb(10 20 30 0.5)',
    'rgb(10px 20 30)',
    'rgb(10 20 red)',
    'rgb(1..5 2 3)',
    'rgb()',
  ])('rejects %s', (input) => expect(failure(input)).toBe('invalid'));
});

describe('channel limits', () => {
  it('keeps boundary values', () => {
    expect(color('rgb(0 0 0 / 0)')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(color('rgb(255 255 255 / 1)')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });
  it('clamps out-of-range channels and alpha', () => {
    expect(color('rgb(-5, 300, 255.5)')).toEqual({ r: 0, g: 255, b: 255, a: 1 });
    expect(color('rgb(-10% 150% 0% / 2)')).toEqual({ r: 0, g: 255, b: 0, a: 1 });
    expect(color('rgb(0 0 0 / -1)').a).toBe(0);
    expect(color('rgb(0 0 0 / 200%)').a).toBe(1);
  });
});

describe('unsupported and invalid input', () => {
  it.each([
    'red',
    'fff', // bare identifiers cannot be validated without a named-color table
    'notacolor',
    'rgb',
    'transparent',
    'currentcolor',
    'hsl(0 100% 50%)',
    'oklch(0.5 0.1 200)',
    'color(srgb 1 0 0)',
    'color-mix(in srgb, red, blue)',
    'rgb(from red r g b)',
    'rgb(var(--r) 0 0)',
    'rgb(calc(1 + 2) 0 0)',
  ])('reports %s as unsupported', (input) => expect(failure(input)).toBe('unsupported'));

  it.each(['', '   ', '123', 'rgb 1 2 3', 'foo(1 2 3)', 'rgb(1 2 3))', '(1 2 3)'])(
    'reports "%s" as invalid',
    (input) => expect(failure(input)).toBe('invalid'),
  );

  it('never throws', () => {
    for (const input of ['\u0000', 'rgb(\u00e9)', '#\u00e9\u00e9\u00e9', 'rgb(1e999 0 0)']) {
      expect(() => parseColor(input)).not.toThrow();
    }
  });
});
