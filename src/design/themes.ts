import { contrast, oklch, rgba, toHex, withContrast, type Rgb } from "@/design/color";

/**
 * The theme system.
 *
 * A theme is DATA: a handful of OKLCH numbers describing a beer's mood (the colour
 * of the glass, the light it sits in). `generateTokens()` expands them into the
 * semantic tokens every component uses — identical names in every theme — and
 * moves lightness until each text role clears its contrast target, so a theme
 * cannot ship unreadable. Only the COUNTER (the page ground) takes the beer's
 * colour; the PAPER that carries all reading stays near-neutral.
 *
 * These are moods, not brand palettes: nothing here is sampled from a label, logo
 * or trade dress. See DESIGN.md.
 */

export type LightDirection = "top" | "left" | "right" | "low";

export type ThemeMood = {
  slug: string;
  /** A short Hebrew name for the mood, shown in the theme picker. */
  name_he: string;
  /** Counter (page ground) hue, chroma and dark-mode lightness. */
  groundHue: number;
  groundChroma: number;
  groundL: number;
  /** Counter lightness in light mode. */
  lightL: number;
  /** Accent hue, chroma and (dark-mode) lightness. */
  accentHue: number;
  accentChroma: number;
  accentL: number;
  /** Where the light falls from. */
  light: LightDirection;
};

export type Mode = "light" | "dark";
export type Appearance = "system" | Mode;

export const HOUSE_THEME: ThemeMood = {
  slug: "house", name_he: "ניטרלי", groundHue: 72, groundChroma: 0.02, groundL: 0.2, lightL: 0.9,
  accentHue: 74, accentChroma: 0.12, accentL: 0.82, light: "top",
};

const LIGHTS: LightDirection[] = ["top", "right", "left", "low"];

/**
 * The fifteen colourful beers are spread evenly round the hue wheel (24° apart) and
 * cycle through THREE looks — vivid, mid, pale — so neighbours (and neighbours-of-
 * neighbours) always differ in lightness as well as hue. Lightness is what the eye
 * separates fastest; this is what keeps one green beer from looking like the next.
 * Fifteen is a multiple of three, so the cycle closes cleanly round the wheel.
 * tests/design.test.ts enforces the result.
 */
const LOOKS = [
  { groundChroma: 0.07, groundL: 0.18, lightL: 0.82, accentChroma: 0.18, accentL: 0.7 }, // vivid
  { groundChroma: 0.055, groundL: 0.215, lightL: 0.86, accentChroma: 0.14, accentL: 0.8 }, // mid
  { groundChroma: 0.04, groundL: 0.255, lightL: 0.895, accentChroma: 0.09, accentL: 0.91 }, // pale
];

const wheel = (slug: string, name_he: string, index: number): ThemeMood => {
  const hue = 8 + 24 * index;
  return { slug, name_he, groundHue: hue, accentHue: hue + 2, light: LIGHTS[index % 4], ...LOOKS[index % 3] };
};

/** The near-neutral beers: distinguished by how dark the counter is and which way it leans. */
const quiet = (
  slug: string, name_he: string, groundHue: number, groundChroma: number, groundL: number, lightL: number,
  accentHue: number, accentChroma: number, accentL: number, light: LightDirection,
): ThemeMood => ({ slug, name_he, groundHue, groundChroma, groundL, lightL, accentHue, accentChroma, accentL, light });

/** One mood per seeded beer (keyed by beers.slug). A beer added later falls back to HOUSE_THEME. */
export const BEER_THEMES: ThemeMood[] = [
  wheel("tuborg-red", "יין אדום", 0),
  wheel("budweiser",  "אדום בוהק", 1),
  wheel("leffe",      "נחושת", 2),
  wheel("goldstar",   "ענבר", 3),
  wheel("paulaner",   "חיטה", 4),
  wheel("somersby",   "תפוח", 5),
  wheel("maccabee",   "טחב ירוק", 6),
  wheel("heineken",   "בקבוק ירוק", 7),
  wheel("carlsberg",  "אורן", 8),
  wheel("corona",     "ים", 9),
  wheel("weihen",     "שמיים", 10),
  wheel("tuborg",     "קובלט", 11),
  wheel("erdinger",   "לבנדר", 12),
  wheel("malka",      "פירות יער", 13),
  wheel("desperados", "שקיעה", 14),
  //     slug          name        gH   gC     gL    lightL  aH   aC     aL    light
  quiet("guinness",   "גוף שחור",   40, 0.006, 0.125, 0.8,    75, 0.085, 0.9,  "low"),
  quiet("bazelet",    "בזלת",      268, 0.016, 0.235, 0.865, 288, 0.055, 0.76, "top"),
  quiet("shapiro",    "ארד",        68, 0.03,  0.155, 0.835,  60, 0.11,  0.64, "low"),
  quiet("stella",     "פלטינה",    100, 0.035, 0.30,  0.9,   102, 0.035, 0.955, "top"),
  quiet("becks",      "כסף",       200, 0.004, 0.19,  0.905, 200, 0.012, 0.88, "left"),
  quiet("alexander",  "פלדה חמה",  255, 0.022, 0.17,  0.83,   15, 0.065, 0.72, "right"),
  quiet("negev",      "דמדומי מדבר", 330, 0.03, 0.245, 0.885,  36, 0.08,  0.82, "top"),
];

const BY_SLUG = new Map(BEER_THEMES.map((theme) => [theme.slug, theme]));

export const themeFor = (slug: string | null | undefined): ThemeMood => (slug ? BY_SLUG.get(slug) : undefined) ?? HOUSE_THEME;

/** Every look a person can choose by hand: the neutral house look first, then one per beer. */
export const ALL_THEMES: ThemeMood[] = [HOUSE_THEME, ...BEER_THEMES];

/** True only for a slug we actually have a look for — the check before storing a manual choice. */
export const isThemeSlug = (slug: unknown): slug is string => typeof slug === "string" && ALL_THEMES.some((theme) => theme.slug === slug);

/** manual override → favourite #1 → house. */
export function resolveTheme(input: { override?: string | null; primaryBeerSlug?: string | null }): ThemeMood {
  return themeFor(input.override ?? input.primaryBeerSlug ?? null);
}

export type Tokens = {
  ground: string; ground2: string; groundLine: string; onGround: string; onGround2: string; accent: string;
  glow: string; deepBand: string;
  paper: string; paper2: string; paperLine: string; ink: string; ink2: string; ink3: string;
  price: string; deal: string; onDeal: string;
  focus: string; danger: string; onDanger: string;
};

export function generateTokens(mood: ThemeMood, mode: Mode): Tokens {
  const { groundHue: gh, groundChroma: gc, accentHue: ah, accentChroma: ac, accentL, groundL, lightL } = mood;
  const dark = mode === "dark";

  // --- the counter -------------------------------------------------------------
  const ground = dark ? oklch(groundL, gc, gh) : oklch(lightL, gc * 1.25, gh);
  const ground2 = dark ? oklch(groundL + 0.055, gc, gh) : oklch(lightL - 0.035, gc * 1.3, gh);
  const groundLine = dark ? oklch(groundL + 0.16, gc, gh) : oklch(lightL - 0.13, gc * 1.2, gh);
  const onGround = dark ? oklch(0.96, 0.012, gh) : oklch(0.2, 0.035, gh);
  const onGround2 =
    withContrast((L) => oklch(L, dark ? 0.03 : 0.035, gh), ground, 4.8, dark ? 0.84 : 0.34, dark ? -1 : 1) ?? onGround;
  const accent = dark
    ? (withContrast((L) => oklch(L, ac, ah), ground, 4.6, accentL, 1) ?? oklch(0.9, ac, ah))
    : (withContrast((L) => oklch(L, ac, ah), ground, 4.6, Math.min(accentL, 0.55), -1) ?? oklch(0.3, ac, ah));

  const glowLight = dark ? oklch(0.5, ac * 1.1, ah) : oklch(0.82, ac * 0.9, ah);
  const glow = rgba(glowLight, dark ? 0.55 : 0.7);
  const deepBand = rgba(dark ? oklch(0.13, gc, gh) : oklch(0.8, gc * 1.3, gh), dark ? 0.6 : 0.55);

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
    onGround: toHex(onGround), onGround2: toHex(onGround2), accent: toHex(accent), glow, deepBand,
    paper: toHex(paper), paper2: toHex(paper2), paperLine: toHex(paperLine),
    ink: toHex(ink), ink2: toHex(ink2), ink3: toHex(ink3),
    price: toHex(price), deal: toHex(deal), onDeal: toHex(onDeal),
    focus: toHex(focus), danger: toHex(danger), onDanger: toHex(paper),
  };
}

/** Where the counter's light sits, as CSS custom-property values. */
const LIGHT: Record<LightDirection, { x: string; y: string }> = {
  top: { x: "50%", y: "-6%" },
  left: { x: "-10%", y: "18%" },
  right: { x: "110%", y: "18%" },
  low: { x: "50%", y: "108%" },
};

const cssVars = (mood: ThemeMood, mode: Mode): string => {
  const t = generateTokens(mood, mode);
  const light = LIGHT[mood.light];
  const entries: Record<string, string> = {
    "--ground": t.ground, "--ground-2": t.ground2, "--ground-line": t.groundLine,
    "--on-ground": t.onGround, "--on-ground-2": t.onGround2, "--accent": t.accent,
    "--glow": t.glow, "--deep-band": t.deepBand, "--glow-x": light.x, "--glow-y": light.y,
    "--paper": t.paper, "--paper-2": t.paper2, "--paper-line": t.paperLine,
    "--ink": t.ink, "--ink-2": t.ink2, "--ink-3": t.ink3,
    "--price": t.price, "--deal": t.deal, "--on-deal": t.onDeal,
    "--focus": t.focus, "--danger": t.danger, "--on-danger": t.onDanger,
  };
  return Object.entries(entries).map(([k, v]) => `${k}:${v};`).join("");
};

/**
 * The stylesheet for one theme: light values by default, dark values when the
 * device asks for dark — unless the person chose a mode in Settings, which
 * `data-mode` on <html> pins either way. Generated per request for the ONE active
 * theme, so no visitor downloads 22 themes.
 */
export function themeStyleSheet(mood: ThemeMood, appearance: Appearance = "system"): string {
  const light = cssVars(mood, "light");
  const dark = cssVars(mood, "dark");
  if (appearance === "light") return `:root{${light}color-scheme:light}`;
  if (appearance === "dark") return `:root{${dark}color-scheme:dark}`;
  return `:root{${light}color-scheme:light}@media (prefers-color-scheme:dark){:root{${dark}color-scheme:dark}}`;
}

/** Colours for the browser chrome (address bar / status bar). */
export function chromeColors(mood: ThemeMood) {
  return { light: generateTokens(mood, "light").ground, dark: generateTokens(mood, "dark").ground };
}

/** A few swatches for the theme picker, in the given mode. */
export function swatches(mood: ThemeMood, mode: Mode) {
  const t = generateTokens(mood, mode);
  return { ground: t.ground, accent: t.accent, paper: t.paper, ink: t.price };
}
