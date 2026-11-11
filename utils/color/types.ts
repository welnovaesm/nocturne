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
