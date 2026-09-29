/**
 * Colour maths for the theme generator: OKLCH (perceptually even lightness, so
 * "L 0.42" means the same darkness in every hue) → sRGB hex, with gamut mapping,
 * and WCAG contrast. Pure and dependency-free; it runs at request time on the
 * server and in tests.
 *
 * OKLab: Björn Ottosson, https://bottosson.github.io/posts/oklab/
 */

export type Rgb = [number, number, number]; // 0..255

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const toRad = (deg: number) => (deg * Math.PI) / 180;

function oklchToLinear(L: number, C: number, hDeg: number): [number, number, number] {
  const a = C * Math.cos(toRad(hDeg));
  const b = C * Math.sin(toRad(hDeg));
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = ([r, g, b]: [number, number, number]) =>
  r >= -1e-6 && r <= 1 + 1e-6 && g >= -1e-6 && g <= 1 + 1e-6 && b >= -1e-6 && b <= 1 + 1e-6;

const gamma = (v: number) => {
  const c = clamp01(v);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
};
const degamma = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/**
 * OKLCH → sRGB. A colour the screen cannot show is not clipped (which shifts hue);
 * chroma is reduced until it fits, which keeps the hue and lightness the theme asked for.
 */
export function oklch(L: number, C: number, hDeg: number): Rgb {
  let chroma = C;
  let linear = oklchToLinear(L, chroma, hDeg);
  for (let i = 0; i < 24 && !inGamut(linear); i++) {
    chroma *= 0.93;
    linear = oklchToLinear(L, chroma, hDeg);
  }
  return linear.map((v) => Math.round(gamma(v) * 255)) as Rgb;
}

export const toHex = ([r, g, b]: Rgb) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

export function fromHex(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

/** rgb(r g b / a) — for glows that must be translucent without relying on color-mix(). */
export const rgba = ([r, g, b]: Rgb, alpha: number) => `rgb(${r} ${g} ${b} / ${alpha})`;

export function luminance([r, g, b]: Rgb): number {
  const [R, G, B] = [r, g, b].map((v) => degamma(v / 255));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB → OKLab, for perceptual distance between themes. */
export function toOklab([r, g, b]: Rgb): [number, number, number] {
  const [R, G, B] = [r, g, b].map((v) => degamma(v / 255));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Distance in OKLab ×100: ~2 is barely noticeable, ~10 is clearly different, 20+ unmistakable. */
export function distance(a: Rgb, b: Rgb): number {
  const [l1, a1, b1] = toOklab(a);
  const [l2, a2, b2] = toOklab(b);
  return 100 * Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * The first lightness (searching `direction` from `from`) at which `make(L)` meets
 * `minRatio` against `against`. Returns the colour, or null when nothing in range does.
 */
export function withContrast(
  make: (L: number) => Rgb,
  against: Rgb,
  minRatio: number,
  from: number,
  direction: 1 | -1,
): Rgb | null {
  for (let step = 0; step <= 100; step++) {
    const L = from + direction * step * 0.01;
    if (L < 0 || L > 1) return null;
    const candidate = make(L);
    if (contrast(candidate, against) >= minRatio) return candidate;
  }
  return null;
}
