import { contrast, oklch, rgba, toHex, withContrast, type Rgb } from "@/design/color";
import { SHAPES, toneRange, transfer, type BottleSpec, type ToneRange } from "@/design/bottles";
import photos from "@/design/bottle-photos.json";

/**
 * The theme system.
 *
 * PERMANENT PRODUCT RULE: a person's favourite beer #1 IS their app. There is no theme picker and
 * no override — `getThemeForBeer(favourite #1)` is the only way a theme is chosen, so reordering
 * the favourites is how someone changes how the app looks. (PRODUCT.md, "Favourite #1 is the app".)
 *
 *   favourite #1 → beer identity (below) → bottle on the counter → colour tokens
 *
 * A beer's identity is DATA: the colour of its counter and accent (taken from the beer's own
 * colours — Goldstar's black and gold, Heineken's green and red), its bottle, and where the bottle
 * stands. `generateTokens()` expands it into the semantic tokens every component uses and moves
 * lightness until each text role clears its contrast target, so no beer can ship unreadable.
 * The paper that carries the reading stays near-neutral in every beer.
 *
 * Light or dark follows the device. That is the phone's setting, not a choice inside the app.
 */

export type LightDirection = "top" | "left" | "right" | "low";
export type Mode = "light" | "dark";

/**
 * Where the bottle stands: horizontal offset (vw, negative = cropped off the left edge), where the
 * middle of its label sits (svh from the top — in the header zone, beside the right-aligned title),
 * its height as a multiple of the screen, and its tilt.
 */
export type Stage = { x: number; labelAt: number; scale: number; rotate: number };

export type BeerIdentity = {
  slug: string;
  /** Counter (page ground): hue, chroma, lightness in dark and in light mode. */
  counter: { hue: number; chroma: number; darkL: number; lightL: number };
  accent: { hue: number; chroma: number; L: number };
  light: LightDirection;
  bottle: BottleSpec | null;
  stage: Stage;
};

const STAGE: Stage = { x: -3, labelAt: 30, scale: 0.98, rotate: -5 };

type Counter = [hue: number, chroma: number, darkL: number, lightL: number];
type Accent = [hue: number, chroma: number, L: number];

const beer = (
  slug: string,
  [hue, chroma, darkL, lightL]: Counter,
  [aHue, aChroma, aL]: Accent,
  light: LightDirection,
  bottle: BottleSpec,
  stage: Partial<Stage> = {},
): BeerIdentity => ({
  slug,
  counter: { hue, chroma, darkL, lightL },
  accent: { hue: aHue, chroma: aChroma, L: aL },
  light,
  bottle,
  stage: { ...STAGE, ...stage },
});

const amber = "#56300f";

/**
 * One identity per supported beer (keyed by beers.slug). The colours approximate each beer's own
 * palette; the owner can correct any of them without touching a component.
 *
 * NOT here on purpose: Somersby — a cider, not a beer, and so it shows the neutral house look. Any
 * beer added to the catalogue later does the same until it gets an identity.
 */
export const BEER_IDENTITIES: BeerIdentity[] = [
  //    slug           counter [h, C, darkL, lightL]   accent [h, C, L]     light
  beer("goldstar",    [55, 0.025, 0.14, 0.88],        [82, 0.14, 0.78],    "low",
    { shape: "classic", glass: "#4a260c", cap: "#c9982f", neck: "#171312", label: { form: "band", base: "#171312", band: "#cfa041", detail: "#b3261e" } }),
  beer("heineken",    [152, 0.06, 0.19, 0.86],        [25, 0.17, 0.68],    "top",
    { shape: "longneck", glass: "#1f5d2d", cap: "#1b5e32", neck: "#13502a", label: { form: "oval", base: "#eef0ea", band: "#13692f", detail: "#c8102e" } }),
  beer("carlsberg",   [140, 0.045, 0.22, 0.88],       [95, 0.07, 0.9],     "right",
    { shape: "longneck", glass: "#2d6a31", cap: "#256b35", neck: "#1e6a37", label: { form: "band", base: "#1f6b36", band: "#f1efe2", detail: "#c7a456" } }),
  // The current Israeli bottle (0.7.0 photo): royal-blue label and neck, gold lettering, amber glass.
  beer("maccabee",    [262, 0.085, 0.17, 0.88],       [84, 0.12, 0.82],    "left",
    { shape: "classic", glass: amber, cap: "#b08a3e", neck: "#1f4aa0", label: { form: "shield", base: "#1f4aa0", band: "#c9a24a", detail: "#f4f1e8" } }),
  beer("tuborg",      [150, 0.07, 0.2, 0.86],         [125, 0.15, 0.85],   "right",
    { shape: "classic", glass: "#2e6a2b", cap: "#1f8a3d", neck: "#1f8a3d", label: { form: "band", base: "#1f8a3d", band: "#ffffff", detail: "#d1b04b" } }),
  beer("tuborg-red",  [22, 0.09, 0.18, 0.86],         [60, 0.04, 0.93],    "top",
    { shape: "classic", glass: amber, cap: "#c62828", neck: "#c62828", label: { form: "band", base: "#c62828", band: "#ffffff", detail: "#1a1a1a" } }),
  beer("corona",      [205, 0.07, 0.22, 0.89],        [88, 0.14, 0.85],    "top",
    { shape: "longneck", glass: "#d8d4b0", liquid: "#e1ad38", cap: "#d7b24a", neck: "#f4f1e8", label: { form: "oval", base: "#f4f1e8", band: "#1f3a93", detail: "#d4a53a" } }),
  beer("stella",      [30, 0.035, 0.2, 0.9],          [85, 0.1, 0.82],     "top",
    { shape: "longneck", glass: "#2f5134", cap: "#c6a24a", neck: "#c6a24a", label: { form: "shield", base: "#f0e8d4", band: "#b3222a", detail: "#c6a24a" } }),
  beer("becks",       [170, 0.02, 0.19, 0.9],         [170, 0.015, 0.88],  "left",
    { shape: "longneck", glass: "#235a31", cap: "#1d5a30", neck: "#cfd8cc", label: { form: "band", base: "#cfd8cc", band: "#1f5c33", detail: "#c8102e" } }),
  beer("budweiser",   [25, 0.1, 0.17, 0.87],          [30, 0.03, 0.95],    "right",
    { shape: "longneck", glass: amber, cap: "#c8102e", neck: "#c8102e", label: { form: "band", base: "#f2f1ec", band: "#c8102e", detail: "#1f3a93" } }),
  beer("guinness",    [60, 0.008, 0.12, 0.82],        [85, 0.08, 0.9],     "low",
    { shape: "classic", glass: "#1a110b", cap: "#151515", neck: "#151515", label: { form: "oval", base: "#efe3c2", band: "#1a1a1a", detail: "#b8903a" } }),
  beer("leffe",       [50, 0.05, 0.16, 0.85],         [80, 0.12, 0.78],    "low",
    { shape: "belgian", glass: "#2b170b", cap: "#c7a049", neck: "#c7a049", label: { form: "shield", base: "#caa24c", band: "#7e1a1a", detail: "#2b170b" } }),
  beer("paulaner",    [255, 0.05, 0.2, 0.9],          [90, 0.04, 0.93],    "top",
    { shape: "wheat", glass: "#5a3210", cap: "#1e3a8a", neck: "#1e3a8a", label: { form: "oval", base: "#f4f4f2", band: "#1e3a8a", detail: "#c5a24b" } }),
  beer("weihen",      [218, 0.07, 0.23, 0.9],         [200, 0.1, 0.86],    "left",
    { shape: "wheat", glass: "#5b3412", cap: "#0d4c92", neck: "#f2f2f0", label: { form: "band", base: "#f2f2f0", band: "#0d4c92", detail: "#c5a24b" } }),
  beer("erdinger",    [268, 0.06, 0.15, 0.87],        [85, 0.12, 0.8],     "right",
    { shape: "wheat", glass: "#4b2a10", cap: "#13294b", neck: "#13294b", label: { form: "shield", base: "#13294b", band: "#c4a24c", detail: "#f2f2f0" } }),
  beer("desperados",  [35, 0.08, 0.15, 0.88],         [95, 0.16, 0.87],    "low",
    { shape: "longneck", glass: "#cfc99a", liquid: "#d9a632", cap: "#f2c230", neck: "#f2c230", label: { form: "band", base: "#f2c230", band: "#c62828", detail: "#151515" } }),
  beer("malka",       [12, 0.08, 0.16, 0.87],         [60, 0.08, 0.85],    "top",
    { shape: "classic", glass: amber, cap: "#7a1c24", neck: "#7a1c24", label: { form: "band", base: "#7a1c24", band: "#efe6d6", detail: "#c9a24a" } }),
  beer("negev",       [55, 0.06, 0.2, 0.88],          [48, 0.13, 0.76],    "right",
    { shape: "classic", glass: amber, cap: "#d06a2a", neck: "#d06a2a", label: { form: "band", base: "#e8d6b0", band: "#d06a2a", detail: "#3a2a1a" } }),
  beer("bazelet",     [185, 0.012, 0.17, 0.86],       [50, 0.11, 0.74],    "low",
    { shape: "classic", glass: "#1c1410", cap: "#222222", neck: "#b8903a", label: { form: "shield", base: "#222226", band: "#b8903a", detail: "#e9e4d8" } }),
  beer("alexander",   [248, 0.035, 0.16, 0.85],       [20, 0.12, 0.72],    "left",
    { shape: "classic", glass: amber, cap: "#1d2a44", neck: "#1d2a44", label: { form: "band", base: "#1d2a44", band: "#e9e4d8", detail: "#c0392b" } }),
  beer("shapiro",     [70, 0.04, 0.16, 0.86],         [60, 0.12, 0.7],     "right",
    { shape: "classic", glass: amber, cap: "#6b4a2a", neck: "#6b4a2a", label: { form: "oval", base: "#efe6d2", band: "#3d2a1c", detail: "#b87333" } }),
  // 0.8.0 (migration 0016). Photos where a retailer shows a single bottle; drawn otherwise (fetch-bottles.mjs).
  beer("krombacher",  [0, 0, 0.16, 0.9],              [0, 0.16, 0.7],      "top",
    { shape: "longneck", glass: "#2c5a33", cap: "#f1efe8", neck: "#f1efe8", label: { form: "shield", base: "#f4f2ec", band: "#1b1b1b", detail: "#b8903a" } }),
  beer("eagle",       [45, 0.05, 0.15, 0.87],         [78, 0.13, 0.76],    "low",
    { shape: "classic", glass: amber, cap: "#b08a3e", neck: "#3a2616", label: { form: "oval", base: "#3a2616", band: "#c9a24a", detail: "#e9dcc0" } }),
  beer("kronenbourg", [258, 0.09, 0.2, 0.9],          [22, 0.16, 0.66],    "right",
    { shape: "longneck", glass: "#1f4fa8", liquid: "#e8d9a8", cap: "#1f4fa8", neck: "#f4f4f2", label: { form: "shield", base: "#f4f4f2", band: "#1f4fa8", detail: "#c8102e" } }),
  beer("miller",      [95, 0.035, 0.17, 0.89],        [28, 0.15, 0.64],    "left",
    { shape: "longneck", glass: "#d6cfa2", liquid: "#e2b33c", cap: "#c9a24a", neck: "#141414", label: { form: "band", base: "#141414", band: "#c9a24a", detail: "#c8102e" } }),
  beer("staropramen", [112, 0.08, 0.14, 0.86],        [8, 0.18, 0.7],      "left",
    { shape: "longneck", glass: "#2f5a2a", cap: "#1d4a22", neck: "#1d4a22", label: { form: "oval", base: "#efe8d2", band: "#1d4a22", detail: "#c8202e" } }),
  beer("chouffe",     [108, 0.05, 0.16, 0.87],        [32, 0.16, 0.7],     "low",
    { shape: "belgian", glass: amber, cap: "#c8202e", neck: "#c8202e", label: { form: "band", base: "#e8d9a0", band: "#2f6a3a", detail: "#c8202e" } }),
  beer("kasteel",     [355, 0.09, 0.12, 0.84],        [85, 0.14, 0.78],    "top",
    { shape: "belgian", glass: "#3a1d10", cap: "#8a1c22", neck: "#8a1c22", label: { form: "shield", base: "#8a1c22", band: "#c9a24a", detail: "#f1e6cf" } }),
  beer("hoegaarden",  [90, 0.02, 0.2, 0.9],           [265, 0.08, 0.82],   "top",
    { shape: "classic", glass: "#6b4a2a", cap: "#f2f2f0", neck: "#f2f2f0", label: { form: "oval", base: "#f2f2f0", band: "#6d8fc1", detail: "#c9a24a" } }),
  beer("franziskaner",[60, 0.01, 0.13, 0.9],          [40, 0.16, 0.72],    "right",
    { shape: "wheat", glass: "#3a2412", cap: "#141414", neck: "#141414", label: { form: "oval", base: "#f2f0ea", band: "#141414", detail: "#d65a1e" } }),
  beer("estrella",    [18, 0.09, 0.16, 0.86],         [22, 0.15, 0.73],    "right",
    { shape: "longneck", glass: "#2f5a36", cap: "#c8102e", neck: "#f2efe6", label: { form: "band", base: "#f2efe6", band: "#c8102e", detail: "#c9a24a" } }),
  beer("blue-moon",   [238, 0.09, 0.2, 0.9],          [50, 0.18, 0.7],     "low",
    { shape: "classic", glass: amber, cap: "#1f4a8a", neck: "#1f4a8a", label: { form: "oval", base: "#1f4a8a", band: "#e98d3c", detail: "#f2f2f0" } }),
  beer("benediktiner",[78, 0.03, 0.2, 0.9],           [18, 0.12, 0.66],    "left",
    { shape: "wheat", glass: "#6b3e14", cap: "#8a6a2a", neck: "#8a6a2a", label: { form: "shield", base: "#efe6d2", band: "#8a6a2a", detail: "#7a1c24" } }),
];

/** The neutral look: no beer ranked yet, or a beer without an identity. No bottle. */
export const HOUSE: BeerIdentity = {
  slug: "house",
  counter: { hue: 72, chroma: 0.02, darkL: 0.2, lightL: 0.9 },
  accent: { hue: 74, chroma: 0.12, L: 0.82 },
  light: "top",
  bottle: null,
  stage: STAGE,
};

const BY_SLUG = new Map(BEER_IDENTITIES.map((identity) => [identity.slug, identity]));

/** An approved product photo, when one exists (scripts/prepare-bottle.mjs writes these). */
export type BottlePhoto = {
  src: string;
  width: number;
  height: number;
  source: string;
  license: string;
  approvedBy: string;
  addedOn: string;
  /** The exact file it was made from, the site it came from, and the product's barcode. */
  sourceUrl?: string;
  sourceName?: string;
  barcode?: string;
};

const PHOTOS = photos as Record<string, BottlePhoto>;

/** The identity for a beer slug; the neutral house look for anything else. */
export const identityFor = (slug: string | null | undefined): BeerIdentity => (slug ? BY_SLUG.get(slug) : undefined) ?? HOUSE;

// --------------------------------------------------------------------- tokens

export type Tokens = {
  ground: string; ground2: string; groundLine: string; onGround: string; onGround2: string; accent: string;
  glow: string; deepBand: string; scrim: string;
  paper: string; paper2: string; paperLine: string; ink: string; ink2: string; ink3: string;
  price: string; deal: string; onDeal: string;
  focus: string; danger: string; onDanger: string;
};

export function generateTokens(identity: BeerIdentity, mode: Mode): Tokens {
  const { hue: gh, chroma: gc, darkL: groundL, lightL } = identity.counter;
  const { hue: ah, chroma: ac, L: accentL } = identity.accent;
  const dark = mode === "dark";

  // --- the counter -------------------------------------------------------------
  // In light mode the counter is a pale wash of the beer colour, not a candy pastel.
  const lc = Math.min(gc, 0.045);
  const ground = dark ? oklch(groundL, gc, gh) : oklch(lightL, lc, gh);
  const ground2 = dark ? oklch(groundL + 0.055, gc, gh) : oklch(lightL - 0.035, lc * 1.1, gh);
  const groundLine = dark ? oklch(groundL + 0.16, gc, gh) : oklch(lightL - 0.13, lc, gh);
  const onGround = dark ? oklch(0.97, 0.01, gh) : oklch(0.17, 0.03, gh);
  // Muted counter text is held well above the 4.5:1 minimum. The headroom is what lets the bottle
  // be visible behind it: see toneRange() in bottles.ts.
  const onGround2 =
    withContrast((L) => oklch(L, dark ? 0.03 : 0.035, gh), ground, 7, dark ? 0.86 : 0.3, dark ? 1 : -1) ?? onGround;
  const accent = dark
    ? (withContrast((L) => oklch(L, ac, ah), ground, 6, accentL, 1) ?? oklch(0.92, ac, ah))
    : (withContrast((L) => oklch(L, ac, ah), ground, 6, Math.min(accentL, 0.5), -1) ?? oklch(0.28, ac, ah));

  const glowLight = dark ? oklch(0.5, ac * 1.1, ah) : oklch(0.82, ac * 0.9, ah);
  const glow = rgba(glowLight, dark ? 0.45 : 0.6);
  const deepBand = rgba(dark ? oklch(0.12, gc, gh) : oklch(0.8, lc * 1.2, gh), dark ? 0.6 : 0.55);
  const scrim = rgba(ground, dark ? 0.72 : 0.66);

  // --- the paper (near-neutral in both modes; it is what people read) ----------
  const paper = dark ? oklch(0.955, 0.006, gh) : oklch(0.988, 0.005, gh);
  const paper2 = oklch(dark ? 0.9 : 0.94, 0.012, gh);
  const paperLine = oklch(dark ? 0.8 : 0.84, 0.014, gh);
  const ink = oklch(0.22, 0.02, gh);
  const ink2 = withContrast((L) => oklch(L, 0.02, gh), paper2, 5, 0.5, -1) ?? ink;
  const ink3 = withContrast((L) => oklch(L, 0.02, gh), paper2, 3.2, 0.62, -1) ?? ink2;

  // Price ink and the deal chip, from the beer's accent, darkened until they pass on paper.
  const price = withContrast((L) => oklch(L, ac * 0.95, ah), paper, 6, 0.55, -1) ?? ink;
  const deal = withContrast((L) => oklch(L, ac, ah), paper, 4.8, 0.62, -1) ?? price;
  const onDeal = paper;

  // A focus ring that shows on both the counter and the paper.
  let focus: Rgb = oklch(0.6, 0.16, 250);
  for (let L = 0.5; L <= 0.72; L += 0.01) {
    const candidate = oklch(L, 0.17, ah);
    if (contrast(candidate, ground) >= 3 && contrast(candidate, paper) >= 3) {
      focus = candidate;
      break;
    }
  }

  const danger = oklch(0.46, 0.17, 27);

  return {
    ground: toHex(ground), ground2: toHex(ground2), groundLine: toHex(groundLine),
    onGround: toHex(onGround), onGround2: toHex(onGround2), accent: toHex(accent), glow, deepBand, scrim,
    paper: toHex(paper), paper2: toHex(paper2), paperLine: toHex(paperLine),
    ink: toHex(ink), ink2: toHex(ink2), ink3: toHex(ink3),
    price: toHex(price), deal: toHex(deal), onDeal: toHex(onDeal),
    focus: toHex(focus), danger: toHex(danger), onDanger: toHex(paper),
  };
}

// --------------------------------------------------------------------- the preset

/**
 * Everything the screen needs for one beer, resolved: the names match the product brief
 * (surface, textPrimary, …) and map one-to-one onto the CSS custom properties.
 */
export type ThemePreset = {
  beerId: string;
  /** Whether a bottle is shown, and which kind. */
  background: { kind: "photo"; photo: BottlePhoto } | { kind: "drawn"; bottle: BottleSpec } | { kind: "none" };
  /** x: vw offset; top: svh of the bottle's top edge (derived from where the label should sit). */
  backgroundPosition: { x: number; top: number; rotate: number };
  backgroundScale: number;
  light: LightDirection;
  modes: Record<Mode, {
    surface: string;
    surfaceElevated: string;
    textPrimary: string;
    textMuted: string;
    accent: string;
    accentStrong: string;
    border: string;
    dealHighlight: string;
    glow: string;
    scrim: string;
    /** The tone range the bottle is squeezed into so every counter text stays readable. */
    bottleTone: ToneRange;
    tokens: Tokens;
  }>;
};

/** The bottle's top edge (svh) that puts the middle of its label at stage.labelAt. */
function bottleTop(identity: BeerIdentity): number {
  const shape = SHAPES[identity.bottle?.shape ?? "classic"];
  const labelMiddle = (shape.label.top + shape.label.bottom) / 2 / 820;
  return Math.round((identity.stage.labelAt - labelMiddle * identity.stage.scale * 100) * 10) / 10;
}

/** The ONLY way a theme is chosen: from the person's favourite beer #1 (or nothing yet). */
export function getThemeForBeer(favouriteOneSlug: string | null | undefined): ThemePreset {
  const identity = identityFor(favouriteOneSlug);
  const photo = identity.slug !== "house" ? PHOTOS[identity.slug] : undefined;
  const mode = (m: Mode) => {
    const t = generateTokens(identity, m);
    // The same range bounds a drawn bottle and a photo: the filter squeezes every pixel into it.
    const tone = toneRange(t);
    return {
      surface: t.ground,
      surfaceElevated: t.ground2,
      textPrimary: t.onGround,
      textMuted: t.onGround2,
      accent: t.accent,
      accentStrong: t.price,
      border: t.groundLine,
      dealHighlight: t.deal,
      glow: t.glow,
      scrim: t.scrim,
      bottleTone: tone,
      tokens: t,
    };
  };
  return {
    beerId: identity.slug,
    background: photo ? { kind: "photo", photo } : identity.bottle ? { kind: "drawn", bottle: identity.bottle } : { kind: "none" },
    backgroundPosition: { x: identity.stage.x, top: bottleTop(identity), rotate: identity.stage.rotate },
    backgroundScale: identity.stage.scale,
    light: identity.light,
    modes: { light: mode("light"), dark: mode("dark") },
  };
}

/** Where the counter's light sits, as CSS custom-property values. */
const LIGHT: Record<LightDirection, { x: string; y: string }> = {
  top: { x: "50%", y: "-6%" },
  left: { x: "-10%", y: "18%" },
  right: { x: "110%", y: "18%" },
  low: { x: "50%", y: "108%" },
};

const cssVars = (preset: ThemePreset, m: Mode): string => {
  const t = preset.modes[m].tokens;
  const light = LIGHT[preset.light];
  const entries: Record<string, string> = {
    "--ground": t.ground, "--ground-2": t.ground2, "--ground-line": t.groundLine,
    "--on-ground": t.onGround, "--on-ground-2": t.onGround2, "--accent": t.accent,
    "--glow": t.glow, "--deep-band": t.deepBand, "--glow-x": light.x, "--glow-y": light.y, "--scrim": t.scrim,
    "--paper": t.paper, "--paper-2": t.paper2, "--paper-line": t.paperLine,
    "--ink": t.ink, "--ink-2": t.ink2, "--ink-3": t.ink3,
    "--price": t.price, "--deal": t.deal, "--on-deal": t.onDeal,
    "--focus": t.focus, "--danger": t.danger, "--on-danger": t.onDanger,
  };
  return Object.entries(entries).map(([k, v]) => `${k}:${v};`).join("");
};

/**
 * The stylesheet for the active beer: light values by default, dark values when the device asks
 * for dark. Generated per request for the ONE active beer, so no visitor downloads 21 palettes.
 * It also points the bottle at the tone filter for the current mode (the filters are rendered by
 * <BottleBackdrop>).
 */
export function themeStyleSheet(preset: ThemePreset): string {
  return (
    `:root{${cssVars(preset, "light")}color-scheme:light}` +
    `.bottle-art{filter:url(#bottle-tone-light)}.bottle-side{filter:url(#bottle-tone-soft-light)}` +
    `@media (prefers-color-scheme:dark){:root{${cssVars(preset, "dark")}color-scheme:dark}.bottle-art{filter:url(#bottle-tone-dark)}.bottle-side{filter:url(#bottle-tone-soft-dark)}}`
  );
}

/** Colours for the browser chrome (address bar / status bar). */
export function chromeColors(preset: ThemePreset) {
  return { light: preset.modes.light.surface, dark: preset.modes.dark.surface };
}

/** Linear transfer parameters for the bottle's tone filter in one mode. */
export const toneTransfer = (preset: ThemePreset, m: Mode) => transfer(preset.modes[m].bottleTone, m);
