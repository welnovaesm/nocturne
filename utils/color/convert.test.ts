import { describe, expect, it } from 'vitest';
import {
  ACHROMATIC_EPSILON,
  isInSrgbGamut,
  linearToOklab,
  linearToSrgb,
  oklabToLinear,
  oklabToOklch,
  oklchToOklab,
  oklchToSrgb,
  rgbaToSrgb,
  srgbToLinear,
  srgbToOklch,
  srgbToRgba,
} from './convert';
import { parseColor } from './parse';
import type { LinearRgb, Oklab, Oklch, Srgb } from './types';

// Reference values and where they come from:
// - [FF] Firefox 156.0.1, computed values of `color-mix(in <space>, X, X)` read with
//   getComputedStyle (2026-11-11). Firefox serializes 6 significant digits and computes
//   in float32, so tolerances are ~1e-6 (1e-3 degrees for hue).
// - [SPEC] numbers printed in CSS Color Module Level 4.
// - [MATH] well-known closed-form values of the sRGB transfer function.
// None of them were produced by the code under test.

const srgb = (r: number, g: number, b: number, alpha = 1): Srgb => ({ space: 'srgb', r, g, b, alpha });
const linear = (r: number, g: number, b: number, alpha = 1): LinearRgb => ({
  space: 'srgb-linear',
  r,
  g,
  b,
  alpha,
});
const oklab = (l: number, a: number, b: number, alpha = 1): Oklab => ({ space: 'oklab', l, a, b, alpha });
const oklch = (l: number, c: number, h: number, alpha = 1): Oklch => ({ space: 'oklch', l, c, h, alpha });
const from8bit = (r: number, g: number, b: number, alpha = 1): Srgb => srgb(r / 255, g / 255, b / 255, alpha);

function close(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
}

function closeTriple(actual: readonly number[], expected: readonly number[], tolerance: number): void {
  expected.forEach((e, i) => close(actual[i] as number, e, tolerance));
}

describe('sRGB transfer function', () => {
  it('maps 0 and 1 to themselves', () => {
    expect(srgbToLinear(srgb(0, 0, 0))).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(srgbToLinear(srgb(1, 1, 1))).toMatchObject({ r: 1, g: 1, b: 1 });
    close(linearToSrgb(linear(1, 1, 1)).r, 1, 1e-15);
  });

  it('[MATH] decodes 0.5 to 0.2140411404 (not 0.5: encoded is not linear)', () => {
    close(srgbToLinear(srgb(0.5, 0.5, 0.5)).g, 0.2140411404, 1e-10);
    close(linearToSrgb(linear(0.2140411404, 0, 0)).r, 0.5, 1e-9);
  });

  it('[MATH] uses the linear segment below the 0.04045 threshold', () => {
    close(srgbToLinear(srgb(0.04, 0, 0)).r, 0.04 / 12.92, 1e-15);
    close(srgbToLinear(srgb(0.04045, 0, 0)).r, 0.04045 / 12.92, 1e-15);
    close(linearToSrgb(linear(0.003, 0, 0)).r, 0.003 * 12.92, 1e-15);
  });

  it('[MATH] is continuous across both thresholds up to the known gap of the published constants', () => {
    // CSS Color 4 uses 0.04045 for decoding and 0.0031308 for encoding. They are not exact
    // inverses (0.04045 / 12.92 = 0.00313080495), which leaves a ~2.4e-9 step at the decode
    // threshold. The spec formulas are kept as published.
    const justBelow = srgbToLinear(srgb(0.04045, 0, 0)).r;
    const justAbove = srgbToLinear(srgb(0.04045 + 1e-9, 0, 0)).r;
    close(justAbove, justBelow, 5e-9);
    close(linearToSrgb(linear(0.0031308, 0, 0)).r, 0.0031308 * 12.92, 1e-6);
  });

  it('[FF] matches Firefox for srgb-linear', () => {
    const blue = srgbToLinear(from8bit(51, 102, 204));
    closeTriple([blue.r, blue.g, blue.b], [0.0331047, 0.132868, 0.603828], 1e-6);
    close(srgbToLinear(from8bit(128, 128, 128)).r, 0.215861, 1e-6);
    const warm = srgbToLinear(from8bit(255, 200, 10));
    closeTriple([warm.r, warm.g, warm.b], [1, 0.57758, 0.00303528], 1e-6);
  });

  it('extends symmetrically to negative values and to values above 1 without clamping', () => {
    close(srgbToLinear(srgb(-0.5, 0, 0)).r, -0.2140411404, 1e-10);
    close(linearToSrgb(linear(-0.2140411404, 0, 0)).r, -0.5, 1e-9);
    expect(srgbToLinear(srgb(2, 0, 0)).r).toBeGreaterThan(1);
    expect(linearToSrgb(linear(2, 0, 0)).r).toBeGreaterThan(1);
  });

  it('[FF] converts out-of-gamut values like Firefox', () => {
    const a = srgbToLinear(srgb(1, 1, -0.3463));
    closeTriple([a.r, a.g, a.b], [1, 1, -0.0982924], 1e-6);
    const b = srgbToLinear(srgb(1.2, -0.1, 0.5));
    // 1.51684 is printed with 6 significant digits, so its rounding error is up to 5e-6.
    closeTriple([b.r, b.g, b.b], [1.51684, -0.0100229, 0.214041], 5e-6);
  });

  it('round-trips encoded -> linear -> encoded, including out of gamut', () => {
    for (const v of [-1.5, -0.3463, -0.05, -1e-9, 0, 1e-9, 0.003, 0.04, 0.5, 1, 1.0001, 1.2, 3]) {
      close(linearToSrgb(srgbToLinear(srgb(v, v, v))).r, v, 1e-12);
    }
  });

  it('round-trips within 3e-8 at the 0.04045 threshold (known gap of the published constants)', () => {
    for (const v of [0.04045, -0.04045, 0.04046, 0.0404]) {
      close(linearToSrgb(srgbToLinear(srgb(v, v, v))).r, v, 3e-8 + 1e-12);
    }
  });
});

describe('Rgba <-> Srgb scale bridge', () => {
  it('maps 0-255 to 0-1 and keeps alpha untouched', () => {
    expect(rgbaToSrgb({ r: 0, g: 255, b: 127.5, a: 0.25 })).toEqual(srgb(0, 1, 0.5, 0.25));
  });

  it('does not round or clamp', () => {
    close(rgbaToSrgb({ r: 0.4, g: 300, b: -5, a: 1 }).r, 0.4 / 255, 1e-18);
    expect(rgbaToSrgb({ r: 0, g: 300, b: -5, a: 1 }).g).toBeGreaterThan(1);
    expect(rgbaToSrgb({ r: 0, g: 300, b: -5, a: 1 }).b).toBeLessThan(0);
  });

  it('round-trips every 8-bit value', () => {
    for (let v = 0; v <= 255; v++) {
      close(srgbToRgba(rgbaToSrgb({ r: v, g: v, b: v, a: 1 })).r, v, 1e-12);
    }
  });

  it('works with the parser output', () => {
    const parsed = parseColor('rgb(51 102 204 / 0.4)');
    if (!parsed.ok) throw new Error('parse failed');
    expect(rgbaToSrgb(parsed.color)).toEqual(srgb(0.2, 0.4, 0.8, 0.4));
  });
});

describe('linear sRGB <-> OKLab', () => {
  it('[FF] black is exactly L=0 with no chroma', () => {
    const black = linearToOklab(linear(0, 0, 0));
    close(black.l, 0, 0);
    close(black.a, 0, 0);
    close(black.b, 0, 0);
  });

  it('[FF][SPEC] white is L=1 with no chroma', () => {
    const white = linearToOklab(linear(1, 1, 1));
    close(white.l, 1, 1e-9);
    close(white.a, 0, 1e-6);
    close(white.b, 0, 1e-6);
  });

  it.each([
    ['red', [255, 0, 0], [0.627955, 0.224863, 0.125846]],
    ['green', [0, 255, 0], [0.86644, -0.233888, 0.179499]],
    ['blue', [0, 0, 255], [0.452014, -0.032457, -0.311528]],
    ['mid grey', [128, 128, 128], [0.599871, 0, 0]],
    ['#3366cc', [51, 102, 204], [0.532483, -0.0225119, -0.166349]],
    ['amber', [255, 200, 10], [0.8576, 0.00510094, 0.17401]],
  ] as const)('[FF] %s matches Firefox', (_name, rgb, expected) => {
    const lab = linearToOklab(srgbToLinear(from8bit(rgb[0], rgb[1], rgb[2])));
    closeTriple([lab.l, lab.a, lab.b], expected, 1e-6);
  });

  it('[FF] out-of-gamut colors keep their (unclamped) OKLab coordinates', () => {
    const a = linearToOklab(srgbToLinear(srgb(1, 1, -0.3463)));
    closeTriple([a.l, a.a, a.b], [0.964764, -0.0847314, 0.229923], 1e-6);
    const b = linearToOklab(srgbToLinear(srgb(1.2, -0.1, 0.5)));
    closeTriple([b.l, b.a, b.b], [0.730478, 0.295224, 0.0472097], 1e-6);
  });

  it('is inverted by oklabToLinear, including out of gamut', () => {
    const samples: LinearRgb[] = [
      linear(0, 0, 0),
      linear(1, 1, 1),
      linear(1, 0, 0),
      linear(0, 1, 0),
      linear(0, 0, 1),
      linear(0.2, 0.4, 0.6),
      linear(1e-6, 1e-6, 1e-6),
      linear(1, 1, -0.0982924),
      linear(1.51684, -0.0100229, 0.214041),
      linear(-0.2, -0.2, -0.2),
      linear(5, 0.1, 0),
    ];
    for (const c of samples) {
      const back = oklabToLinear(linearToOklab(c));
      closeTriple([back.r, back.g, back.b], [c.r, c.g, c.b], 1e-9);
    }
  });
});

describe('OKLab <-> OKLCH', () => {
  it('[FF] matches Firefox for chromatic colors', () => {
    const blue = oklabToOklch(linearToOklab(srgbToLinear(from8bit(51, 102, 204))));
    closeTriple([blue.l, blue.c], [0.532483, 0.167866], 1e-6);
    close(blue.h, 262.293, 1e-3);

    const amber = oklabToOklch(linearToOklab(srgbToLinear(from8bit(255, 200, 10))));
    closeTriple([amber.l, amber.c], [0.8576, 0.174085], 1e-6);
    close(amber.h, 88.3209, 1e-3);
  });

  it('[SPEC] sRGB blue and yellow in OKLCH', () => {
    const blue = srgbToOklch(srgb(0, 0, 1));
    closeTriple([blue.l, blue.c], [0.452, 0.313], 5e-4);
    close(blue.h, 264.1, 0.05);
    const yellow = srgbToOklch(srgb(1, 1, 0));
    closeTriple([yellow.l, yellow.c], [0.968, 0.211], 5e-4);
    close(yellow.h, 109.8, 0.05);
  });

  it('[SPEC][FF] an out-of-gamut color keeps its OKLCH coordinates', () => {
    // CSS Color 4: color(srgb 1 1 -0.3463) is oklch(0.96476 0.24503 110.23).
    const c = srgbToOklch(srgb(1, 1, -0.3463));
    closeTriple([c.l, c.c], [0.964764, 0.245039], 1e-6);
    close(c.h, 110.23, 1e-3);
  });

  it('[SPEC] a gamut-mapped OKLCH color converts to the sRGB value printed in the spec', () => {
    // CSS Color 4: oklch(0.96476 0.21094 110.23) is color(srgb 0.99116 0.99733 0.00001).
    const c = oklchToSrgb(oklch(0.96476, 0.21094, 110.23));
    closeTriple([c.r, c.g, c.b], [0.99116, 0.99733, 0.00001], 2e-5);
  });

  it('computes the hue in [0, 360) from the axis directions', () => {
    close(oklabToOklch(oklab(0.5, 0.1, 0)).h, 0, 0);
    close(oklabToOklch(oklab(0.5, 0, 0.1)).h, 90, 1e-12);
    close(oklabToOklch(oklab(0.5, -0.1, 0)).h, 180, 1e-12);
    close(oklabToOklch(oklab(0.5, 0, -0.1)).h, 270, 1e-12);
    close(oklabToOklch(oklab(0.5, 0.1, 0.1)).c, Math.SQRT2 / 10, 1e-15);
  });

  it('never returns a hue of 360 or -0', () => {
    const justBelowZero = oklabToOklch(oklab(0.5, 1, -1e-20));
    expect(justBelowZero.h).toBe(0);
    expect(Object.is(oklabToOklch(oklab(0.5, 0.1, -0)).h, 0)).toBe(true);
  });

  it('round-trips OKLab -> OKLCH -> OKLab', () => {
    const samples = [oklab(0.5, 0.1, -0.1), oklab(0.9, -0.05, 0.2), oklab(0.2, 0.3, 0), oklab(0.7, 0, -0.3), oklab(1.1, 0.5, 0.5)];
    for (const lab of samples) {
      const back = oklchToOklab(oklabToOklch(lab));
      closeTriple([back.l, back.a, back.b], [lab.l, lab.a, lab.b], 1e-12);
    }
  });

  it('round-trips OKLCH -> OKLab -> OKLCH away from the achromatic axis', () => {
    for (const [l, c, h] of [[0.5, 0.1, 10], [0.8, 0.2, 200], [0.3, 0.05, 359.5], [0.6, 0.4, 90]] as const) {
      const back = oklabToOklch(oklchToOklab(oklch(l, c, h)));
      closeTriple([back.l, back.c, back.h], [l, c, h], 1e-10);
    }
  });
});

describe('achromatic colors', () => {
  it('[SPEC] chroma at or below the epsilon makes the hue powerless (NaN)', () => {
    expect(ACHROMATIC_EPSILON).toBe(0.000004);
    expect(oklabToOklch(oklab(0.5, 0, 0)).h).toBeNaN();
    expect(oklabToOklch(oklab(0.5, ACHROMATIC_EPSILON, 0)).h).toBeNaN();
    expect(oklabToOklch(oklab(0.5, 0.000005, 0)).h).toBe(0);
    expect(oklabToOklch(oklab(0.5, 0, -0.00001)).h).toBe(270);
  });

  it('every 8-bit gray has a powerless hue and negligible chroma', () => {
    for (let v = 0; v <= 255; v++) {
      const c = srgbToOklch(from8bit(v, v, v));
      expect(c.c, `gray ${v}`).toBeLessThan(ACHROMATIC_EPSILON);
      expect(c.h, `gray ${v}`).toBeNaN();
    }
  });

  it('[FF] mid gray matches Firefox: L=0.599871 and a powerless hue', () => {
    const c = srgbToOklch(from8bit(128, 128, 128));
    close(c.l, 0.599871, 1e-6);
    expect(c.h).toBeNaN();
  });

  it('does not force the chroma to 0 when the hue is powerless', () => {
    const c = oklabToOklch(oklab(0.5, 0.000001, 0));
    expect(c.c).toBe(0.000001);
    expect(c.h).toBeNaN();
  });

  it('treats a NaN hue as 0 degrees when converting back', () => {
    expect(oklchToOklab(oklch(0.5, 0, NaN))).toEqual(oklab(0.5, 0, 0));
    const tiny = oklchToOklab(oklch(0.5, 0.000001, NaN));
    expect(tiny.a).toBe(0.000001);
    expect(tiny.b).toBe(0);
  });

  it('[SPEC] oklch(50% 0 40) and oklch(50% 0 200) are the same color', () => {
    const x = oklchToSrgb(oklch(0.5, 0, 40));
    const y = oklchToSrgb(oklch(0.5, 0, 200));
    closeTriple([x.r, x.g, x.b], [y.r, y.g, y.b], 1e-15);
    close(x.r, x.g, 1e-7);
    close(x.g, x.b, 1e-7);
  });
});

describe('alpha', () => {
  const alphas = [0, 1 / 3, 0.5, 1, -1, 2]; // out-of-range alpha is passed through, not clamped

  it('is copied bit-for-bit by every conversion', () => {
    for (const alpha of alphas) {
      const s = srgb(0.2, 0.4, 0.6, alpha);
      const l = srgbToLinear(s);
      const lab = linearToOklab(l);
      const lch = oklabToOklch(lab);
      expect(l.alpha).toBe(alpha);
      expect(linearToSrgb(l).alpha).toBe(alpha);
      expect(lab.alpha).toBe(alpha);
      expect(oklabToLinear(lab).alpha).toBe(alpha);
      expect(lch.alpha).toBe(alpha);
      expect(oklchToOklab(lch).alpha).toBe(alpha);
      expect(srgbToOklch(s).alpha).toBe(alpha);
      expect(oklchToSrgb(lch).alpha).toBe(alpha);
      expect(srgbToRgba(s).a).toBe(alpha);
      expect(rgbaToSrgb({ r: 1, g: 2, b: 3, a: alpha }).alpha).toBe(alpha);
    }
  });

  it('does not premultiply the color channels', () => {
    const opaque = srgbToOklch(srgb(0.2, 0.4, 0.6, 1));
    const translucent = srgbToOklch(srgb(0.2, 0.4, 0.6, 0.25));
    expect([translucent.l, translucent.c, translucent.h]).toEqual([opaque.l, opaque.c, opaque.h]);
  });
});

describe('round trips on a grid', () => {
  const edge = [0, 1 / 255, 0.04045, 0.5, 254 / 255, 1];

  it('encoded sRGB -> OKLCH -> encoded sRGB, in gamut', () => {
    for (const r of edge) {
      for (const g of edge) {
        for (const b of edge) {
          const back = oklchToSrgb(srgbToOklch(srgb(r, g, b, 0.5)));
          // 1e-7 covers the 3e-8 transfer-function gap at the 0.04045 threshold.
          closeTriple([back.r, back.g, back.b], [r, g, b], 1e-7);
        }
      }
    }
  });

  it('encoded sRGB -> OKLCH -> encoded sRGB, out of gamut', () => {
    for (const v of [-0.3463, -0.1, 1.0001, 1.2, 2]) {
      for (const w of [-0.1, 0.5, 1.2]) {
        const back = oklchToSrgb(srgbToOklch(srgb(v, w, 0.3)));
        closeTriple([back.r, back.g, back.b], [v, w, 0.3], 1e-9);
      }
    }
  });

  it('every 8-bit channel value survives the full trip once rounded', () => {
    for (let v = 0; v <= 255; v++) {
      for (const [r, g, b] of [[v, v, v], [v, 255 - v, 0], [0, v, 255 - v]] as const) {
        const back = srgbToRgba(oklchToSrgb(srgbToOklch(from8bit(r, g, b))));
        // `+ 0` turns the -0 produced by Math.round(-1e-14) into 0.
        expect([Math.round(back.r) + 0, Math.round(back.g) + 0, Math.round(back.b) + 0]).toEqual([r, g, b]);
        closeTriple([back.r, back.g, back.b], [r, g, b], 1e-6);
      }
    }
  });
});

describe('out-of-gamut contract', () => {
  it('does not clamp or gamut map any conversion', () => {
    const c = oklchToSrgb(oklch(0.65, 0.4, 150));
    expect(isInSrgbGamut(c)).toBe(false);
    expect(Math.min(c.r, c.g, c.b)).toBeLessThan(0);
    const back = srgbToOklch(c);
    closeTriple([back.l, back.c, back.h], [0.65, 0.4, 150], 1e-9);
  });

  it('isInSrgbGamut reports membership with an optional tolerance', () => {
    expect(isInSrgbGamut(srgb(0, 0.5, 1))).toBe(true);
    expect(isInSrgbGamut(srgb(1.0000001, 0.5, 1))).toBe(false);
    expect(isInSrgbGamut(srgb(-1e-7, 0.5, 1))).toBe(false);
    expect(isInSrgbGamut(srgb(-1e-7, 0.5, 1.0000001), 1e-6)).toBe(true);
    expect(isInSrgbGamut(linear(0.5, 0.5, 1.2))).toBe(false);
  });
});

describe('type safety', () => {
  it('does not accept encoded sRGB where linear RGB is expected', () => {
    // @ts-expect-error encoded sRGB is not linear RGB
    expect(() => linearToOklab(srgb(0, 0, 0))).not.toThrow();
    // @ts-expect-error linear RGB is not encoded sRGB
    expect(() => srgbToLinear(linear(0, 0, 0))).not.toThrow();
  });
});
