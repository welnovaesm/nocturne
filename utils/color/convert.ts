import type { LinearRgb, Oklab, Oklch, Rgba, Srgb } from './types';

/*
 * Pure color space conversions: sRGB <-> linear sRGB <-> OKLab <-> OKLCH.
 *
 * References:
 * - CSS Color Module Level 4, "Sample code for color conversions" (lin_sRGB, gam_sRGB,
 *   lin_sRGB_to_XYZ, XYZ_to_OKLab, OKLab_to_OKLCH, ...): https://www.w3.org/TR/css-color-4/
 * - Bjorn Ottosson, "A perceptual color space for image processing" (OKLab definition);
 *   the matrices below are the high-precision ones published in CSS Color 4.
 *
 * Contract for every function:
 * - No rounding and no clamping, including intermediate values.
 * - No gamut mapping: out-of-gamut colors are converted as they are. The sRGB transfer
 *   function is the sign-symmetric extension from CSS Color 4, so negative and > 1
 *   values round-trip.
 * - `alpha` is copied unchanged (never premultiplied, clamped or validated).
 * - Inputs are not validated; NaN and Infinity propagate.
 * - -0 is not normalized, except for the hue of `oklabToOklch`, which is documented
 *   to be in [0, 360).
 *
 * Known precision limit: the spec's transfer function decodes below 0.04045 but encodes
 * below 0.0031308, and the two are not exact inverses (0.04045 / 12.92 = 0.00313080495).
 * Encoded values near 0.04045 can therefore differ by up to ~3e-8 after a decode/encode
 * round trip. That is far below one 8-bit step (1/255), and the formulas are kept as
 * published to match CSS Color 4 exactly.
 */

/** Chroma at or below this value makes the OKLCH hue powerless (CSS Color 4). */
export const ACHROMATIC_EPSILON = 0.000004;

type Vec3 = readonly [number, number, number];
type Mat3 = readonly [Vec3, Vec3, Vec3];

const multiply = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

// Linear sRGB <-> CIE XYZ (D65), exact rational matrices from CSS Color 4.
const LINEAR_SRGB_TO_XYZ: Mat3 = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];
const XYZ_TO_LINEAR_SRGB: Mat3 = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];

// XYZ (D65) <-> LMS and LMS' <-> OKLab (Ottosson, as published in CSS Color 4).
const XYZ_TO_LMS: Mat3 = [
  [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];
const LMS_TO_OKLAB: Mat3 = [
  [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.42859224204858, 0.450593709617411],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];
const OKLAB_TO_LMS: Mat3 = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];
const LMS_TO_XYZ: Mat3 = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];

/** `Rgba` (channels 0-255) to `Srgb` (channels 0-1). Alpha is unchanged. */
export function rgbaToSrgb(c: Rgba): Srgb {
  return { space: 'srgb', r: c.r / 255, g: c.g / 255, b: c.b / 255, alpha: c.a };
}

/** `Srgb` (channels 0-1) to `Rgba` (channels 0-255). Alpha is unchanged. */
export function srgbToRgba(c: Srgb): Rgba {
  return { r: c.r * 255, g: c.g * 255, b: c.b * 255, a: c.alpha };
}

function decode(v: number): number {
  const abs = Math.abs(v);
  if (abs <= 0.04045) return v / 12.92;
  return Math.sign(v) * ((abs + 0.055) / 1.055) ** 2.4;
}

function encode(v: number): number {
  const abs = Math.abs(v);
  if (abs > 0.0031308) return Math.sign(v) * (1.055 * abs ** (1 / 2.4) - 0.055);
  return 12.92 * v;
}

/** Gamma-encoded sRGB to linear-light sRGB (extended transfer function). */
export function srgbToLinear(c: Srgb): LinearRgb {
  return { space: 'srgb-linear', r: decode(c.r), g: decode(c.g), b: decode(c.b), alpha: c.alpha };
}

/** Linear-light sRGB to gamma-encoded sRGB (extended transfer function). */
export function linearToSrgb(c: LinearRgb): Srgb {
  return { space: 'srgb', r: encode(c.r), g: encode(c.g), b: encode(c.b), alpha: c.alpha };
}

/** Linear-light sRGB to OKLab, through CIE XYZ (D65) and LMS. */
export function linearToOklab(c: LinearRgb): Oklab {
  const xyz = multiply(LINEAR_SRGB_TO_XYZ, [c.r, c.g, c.b]);
  const lms = multiply(XYZ_TO_LMS, xyz);
  // Math.cbrt is sign-preserving, which keeps out-of-gamut (negative LMS) values valid.
  const [l, a, b] = multiply(LMS_TO_OKLAB, [Math.cbrt(lms[0]), Math.cbrt(lms[1]), Math.cbrt(lms[2])]);
  return { space: 'oklab', l, a, b, alpha: c.alpha };
}

/** OKLab to linear-light sRGB. */
export function oklabToLinear(c: Oklab): LinearRgb {
  const lmsNonlinear = multiply(OKLAB_TO_LMS, [c.l, c.a, c.b]);
  const xyz = multiply(LMS_TO_XYZ, [lmsNonlinear[0] ** 3, lmsNonlinear[1] ** 3, lmsNonlinear[2] ** 3]);
  const [r, g, b] = multiply(XYZ_TO_LINEAR_SRGB, xyz);
  return { space: 'srgb-linear', r, g, b, alpha: c.alpha };
}

/**
 * OKLab to OKLCH. The hue is in [0, 360) degrees, or `NaN` (powerless) when the chroma is
 * at or below `ACHROMATIC_EPSILON`. The chroma is returned as computed, never forced to 0.
 */
export function oklabToOklch(c: Oklab): Oklch {
  const chroma = Math.hypot(c.a, c.b);
  let hue = (Math.atan2(c.b, c.a) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  // A tiny negative angle can round up to exactly 360; -0 is mapped to 0 by `+ 0`.
  hue = hue >= 360 ? 0 : hue + 0;
  return { space: 'oklch', l: c.l, c: chroma, h: chroma <= ACHROMATIC_EPSILON ? NaN : hue, alpha: c.alpha };
}

/** OKLCH to OKLab. A powerless (`NaN`) hue is treated as 0, as in CSS Color 4. */
export function oklchToOklab(c: Oklch): Oklab {
  const radians = ((Number.isNaN(c.h) ? 0 : c.h) * Math.PI) / 180;
  return { space: 'oklab', l: c.l, a: c.c * Math.cos(radians), b: c.c * Math.sin(radians), alpha: c.alpha };
}

/** Encoded sRGB to OKLCH. */
export function srgbToOklch(c: Srgb): Oklch {
  return oklabToOklch(linearToOklab(srgbToLinear(c)));
}

/** OKLCH to encoded sRGB. The result may be outside [0, 1]; it is not gamut mapped. */
export function oklchToSrgb(c: Oklch): Srgb {
  return linearToSrgb(oklabToLinear(oklchToOklab(c)));
}

/** Whether every channel is inside [0, 1], allowing `epsilon` slack on both ends. */
export function isInSrgbGamut(c: Srgb | LinearRgb, epsilon = 0): boolean {
  const inside = (v: number) => v >= -epsilon && v <= 1 + epsilon;
  return inside(c.r) && inside(c.g) && inside(c.b);
}
