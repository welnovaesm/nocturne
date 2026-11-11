/**
 * sRGB color. Channels are kept exactly as parsed (no rounding):
 * r, g, b are in [0, 255] and may be fractional; a is in [0, 1].
 */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type ParseFailureReason =
  /** Not a valid color for the syntax it appears to use. */
  | 'invalid'
  /**
   * Cannot be interpreted with the subset implemented so far. This is not a claim that
   * the input is valid CSS: e.g. `notacolor` and `hsl(garbage)` are `unsupported`.
   */
  | 'unsupported';

export type ParseResult =
  | { ok: true; color: Rgba }
  | { ok: false; reason: ParseFailureReason };

/*
 * Color space types for conversions (see convert.ts).
 *
 * Scale conventions:
 * - `Rgba` (parser output) uses channels 0-255 and alpha 0-1.
 * - `Srgb` and `LinearRgb` use channels on a 0-1 scale (the scale of CSS `color(srgb ...)`),
 *   where in-gamut colors are inside [0, 1]. Out-of-gamut values are kept as they are.
 * - Every type carries alpha as `alpha` in 0-1 (`a` is an axis of OKLab).
 * - Lightness `l` is on a 0-1 scale, not a percentage.
 *
 * `space` makes the types non-interchangeable: passing an encoded sRGB value where a
 * linear one is expected is a compile-time error.
 */

/** Gamma-encoded sRGB, channels on a 0-1 scale. */
export interface Srgb {
  space: 'srgb';
  r: number;
  g: number;
  b: number;
  alpha: number;
}

/** Linear-light sRGB (D65), channels on a 0-1 scale. */
export interface LinearRgb {
  space: 'srgb-linear';
  r: number;
  g: number;
  b: number;
  alpha: number;
}

/** OKLab: `l` lightness (0-1), `a`/`b` opponent axes (roughly -0.4 to 0.4 within sRGB). */
export interface Oklab {
  space: 'oklab';
  l: number;
  a: number;
  b: number;
  alpha: number;
}

/**
 * OKLCH: polar form of OKLab. `h` is in degrees, in [0, 360), or `NaN` when the hue is
 * powerless (chroma is at or below `ACHROMATIC_EPSILON`).
 */
export interface Oklch {
  space: 'oklch';
  l: number;
  c: number;
  h: number;
  alpha: number;
}
