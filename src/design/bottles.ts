import { contrast, fromHex, oklch, toHex, toOklab, type Rgb } from "@/design/color";

/**
 * The bottle: the one picture that makes the app someone's own.
 *
 * Favourite #1's bottle stands on the counter behind the paper strips. It is either
 *   - a PHOTO, when an approved, licensed product image exists (src/design/bottle-photos.json,
 *     prepared by scripts/prepare-bottle.mjs), or
 *   - a DRAWN bottle built from the data below: the real glass colour, cap and label colours,
 *     the right silhouette — and no logo, no wordmark, no label art. It is a stand-in that is
 *     ours to draw, not a copy of anyone's trade dress.
 *
 * Readability is guaranteed by construction, not by eye: before it reaches the screen the bottle
 * goes through a tone filter that squeezes every colour channel into [lo, hi] (see `toneRange`),
 * chosen so that every kind of text that can sit on the counter keeps its contrast over ANY pixel
 * of the bottle. tests/design.test.ts proves it for every beer, in both light and dark.
 */

export type BottleShape = "longneck" | "classic" | "wheat" | "belgian";
export type LabelForm = "band" | "oval" | "shield";

export type BottleSpec = {
  shape: BottleShape;
  /** The colour of the glass itself. */
  glass: string;
  /** Beer visible through clear glass (Corona, Desperados). Omit for coloured glass. */
  liquid?: string;
  cap: string;
  /** The foil or label around the neck. */
  neck: string;
  label: { form: LabelForm; base: string; band: string; detail: string };
};

/** Geometry on a 200 × 820 canvas. The outline is symmetric about x = 100. */
export type ShapeGeometry = {
  outline: string;
  cap: { y: number; h: number; w: number };
  neck: { top: number; bottom: number };
  label: { top: number; bottom: number };
  /** Where the beer starts, for clear glass. */
  fill: number;
};

export const SHAPES: Record<BottleShape, ShapeGeometry> = {
  longneck: {
    outline: "M79 84 L79 205 C79 255 40 280 40 345 L40 766 Q40 790 64 790 L136 790 Q160 790 160 766 L160 345 C160 280 121 255 121 205 L121 84 Z",
    cap: { y: 58, h: 28, w: 52 },
    neck: { top: 104, bottom: 196 },
    label: { top: 440, bottom: 650 },
    fill: 160,
  },
  classic: {
    outline: "M80 84 L80 165 C80 225 36 245 36 310 L36 766 Q36 790 60 790 L140 790 Q164 790 164 766 L164 310 C164 245 120 225 120 165 L120 84 Z",
    cap: { y: 58, h: 28, w: 50 },
    neck: { top: 100, bottom: 160 },
    label: { top: 420, bottom: 640 },
    fill: 130,
  },
  wheat: {
    outline: "M82 60 L82 150 C82 250 44 270 44 360 L44 772 Q44 792 66 792 L134 792 Q156 792 156 772 L156 360 C156 270 118 250 118 150 L118 60 Z",
    cap: { y: 34, h: 28, w: 46 },
    neck: { top: 74, bottom: 170 },
    label: { top: 450, bottom: 680 },
    fill: 110,
  },
  belgian: {
    outline: "M78 110 L78 190 C78 240 30 250 30 320 L30 764 Q30 792 60 792 L140 792 Q170 792 170 764 L170 320 C170 250 122 240 122 190 L122 110 Z",
    cap: { y: 84, h: 28, w: 54 },
    neck: { top: 124, bottom: 186 },
    label: { top: 400, bottom: 660 },
    fill: 150,
  },
};

/**
 * The bottle nobody has claimed yet: amber glass and a blank paper label. Onboarding opens with it,
 * and it stands in for a beer that has no identity — never another beer's colours.
 */
export const BLANK_BOTTLE: BottleSpec = {
  shape: "longneck",
  glass: "#8a4712",
  cap: "#b9b2a3",
  neck: "#efe9dc",
  label: { form: "band", base: "#efe9dc", band: "#efe9dc", detail: "#d9d1c0" },
};

/** The same colour, lighter or darker by `dL` in OKLab lightness (hue and chroma kept). */
export function shade(hex: string, dL: number): string {
  const [L, a, b] = toOklab(fromHex(hex));
  const C = Math.hypot(a, b);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return toHex(oklch(Math.min(0.99, Math.max(0.02, L + dL)), C, h));
}

/**
 * The tone range: the bottle's colour channels are mapped to lo + (hi − lo)·c before display
 * (an SVG feComponentTransfer, the same for a drawn bottle and a photo). Because the mapping is
 * the same for R, G and B, the darkest possible result is the grey (lo, lo, lo) and the lightest
 * (hi, hi, hi) — so if the text passes against both greys, it passes against every pixel.
 *
 * The range is widened as far as the text allows, around the counter's own grey, so the bottle is
 * as visible as it can be while everything stays readable.
 */
export type ToneRange = { lo: number; hi: number };

type CounterText = { ground: string; onGround: string; onGround2: string; accent: string };

const grey = (v: number): Rgb => [v, v, v];

/** The minimum contrast every text role needs over any bottle pixel. */
export const OVER_BOTTLE = { onGround: 4.5, onGround2: 4.5, accent: 3 } as const;

export function passesOver(t: CounterText, v: number): boolean {
  const bg = grey(v);
  return (
    contrast(fromHex(t.onGround), bg) >= OVER_BOTTLE.onGround &&
    contrast(fromHex(t.onGround2), bg) >= OVER_BOTTLE.onGround2 &&
    contrast(fromHex(t.accent), bg) >= OVER_BOTTLE.accent
  );
}

export function toneRange(t: CounterText): ToneRange {
  // Start at the counter's own grey level and grow outwards while the text still passes.
  const [r, g, b] = fromHex(t.ground);
  const start = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  let lo = start;
  let hi = start;
  while (lo > 0 && passesOver(t, lo - 1)) lo -= 1;
  while (hi < 255 && passesOver(t, hi + 1)) hi += 1;
  // If the counter grey itself were too close to the text (it is not, for any generated theme),
  // fall back to an invisible bottle rather than an unreadable page.
  if (!passesOver(t, lo) || !passesOver(t, hi)) return { lo: start, hi: start };
  return { lo, hi };
}

/**
 * feComponentTransfer "gamma" parameters for a range: out = offset + amplitude · in^exponent.
 * For in ∈ [0, 1] the output stays in [lo, hi] whatever the exponent, so the contrast guarantee is
 * unchanged; the exponent only decides where the bottle's detail lands inside the range. In dark
 * mode (exponent < 1) the glass's dark tones are lifted off the black counter; in light mode
 * (exponent > 1) mid-tones are pulled down so the bottle is more than a pale ghost.
 */
export const transfer = ({ lo, hi }: ToneRange, mode: "light" | "dark") => ({
  amplitude: (hi - lo) / 255,
  exponent: mode === "dark" ? 0.55 : 1.6,
  offset: lo / 255,
});
