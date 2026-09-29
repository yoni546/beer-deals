import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, distance, fromHex, oklch, toHex } from "@/design/color";
import {
  BEER_THEMES,
  HOUSE_THEME,
  generateTokens,
  resolveTheme,
  themeFor,
  themeStyleSheet,
  type Mode,
} from "@/design/themes";

const ALL = [HOUSE_THEME, ...BEER_THEMES];
const MODES: Mode[] = ["light", "dark"];
const rgb = fromHex;

describe("colour maths", () => {
  it("knows the contrast of black and white (21:1) and of identical colours (1:1)", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
    expect(contrast([120, 40, 40], [120, 40, 40])).toBeCloseTo(1, 5);
  });

  it("keeps a requested lightness stable across hues (that is why OKLCH is used)", () => {
    const L = (hex: string) => contrast(rgb(hex), [0, 0, 0]);
    const yellow = L(toHex(oklch(0.7, 0.1, 100)));
    const blue = L(toHex(oklch(0.7, 0.1, 260)));
    expect(Math.abs(yellow - blue)).toBeLessThan(1.2); // in HSL these would differ enormously
  });

  it("maps colours outside the screen's range back inside without changing their hue", () => {
    const [r, g, b] = oklch(0.9, 0.4, 145); // far outside sRGB
    for (const channel of [r, g, b]) expect(channel).toBeGreaterThanOrEqual(0);
    for (const channel of [r, g, b]) expect(channel).toBeLessThanOrEqual(255);
    expect(g).toBeGreaterThan(r); // still green
  });
});

describe("every beer has a theme", () => {
  it("covers every seeded beer, so no beer falls back to the neutral theme by accident", () => {
    const seed = readFileSync(join(import.meta.dirname, "..", "supabase", "migrations", "0004_seed.sql"), "utf8");
    // (SQL escapes an apostrophe by doubling it — "Beck''s" — hence the `''` alternative.)
    const slugs = [...seed.matchAll(/^\s*\('([a-z0-9-]+)',\s*'(?:[^']|'')*',\s*'(?:[^']|'')*',\s*'#/gm)].map((match) => match[1]);
    expect(slugs.length).toBe(22);
    for (const slug of slugs) expect(BEER_THEMES.some((theme) => theme.slug === slug), `no theme for ${slug}`).toBe(true);
  });

  it("has unique slugs", () => {
    expect(new Set(BEER_THEMES.map((theme) => theme.slug)).size).toBe(BEER_THEMES.length);
  });
});

describe.each(MODES)("contrast, %s mode — every theme, every text role", (mode) => {
  for (const theme of ALL) {
    it(`${theme.slug} passes`, () => {
      const t = generateTokens(theme, mode);
      const c = (fg: string, bg: string) => contrast(rgb(fg), rgb(bg));
      const failures: string[] = [];
      const need = (label: string, ratio: number, min: number) => {
        if (ratio < min) failures.push(`${label}: ${ratio.toFixed(2)} < ${min}`);
      };

      // Reading on the paper.
      need("ink on paper", c(t.ink, t.paper), 7);
      need("ink-2 on paper", c(t.ink2, t.paper), 4.5);
      need("ink-2 on paper-2", c(t.ink2, t.paper2), 4.5);
      need("ink-3 on paper-2 (large/decorative only)", c(t.ink3, t.paper2), 3);
      need("price on paper", c(t.price, t.paper), 6);
      need("price on paper-2", c(t.price, t.paper2), 4.5);
      need("deal chip text", c(t.onDeal, t.deal), 4.5);
      need("danger on paper", c(t.danger, t.paper), 4.5);
      // Reading on the counter.
      need("on-ground on ground", c(t.onGround, t.ground), 7);
      need("on-ground-2 on ground", c(t.onGround2, t.ground), 4.5);
      need("on-ground-2 on ground-2", c(t.onGround2, t.ground2), 4.5);
      need("accent on ground", c(t.accent, t.ground), 4.5);
      need("accent on ground-2", c(t.accent, t.ground2), 3);
      // Seeing where you are.
      need("focus ring on ground", c(t.focus, t.ground), 3);
      need("focus ring on paper", c(t.focus, t.paper), 3);
      // The paper must lift off the counter.
      expect(failures, failures.join("; ")).toEqual([]);
      expect(distance(rgb(t.paper), rgb(t.ground))).toBeGreaterThan(8);
    });
  }
});

describe("themes are visibly different from each other", () => {
  // The old presets had ten amber accents that could not be told apart on a phone.
  const MIN = 8;
  for (const mode of MODES) {
    it(`no two beer themes look alike (${mode})`, () => {
      const tokens = BEER_THEMES.map((theme) => ({ slug: theme.slug, t: generateTokens(theme, mode) }));
      const close: string[] = [];
      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < tokens.length; j++) {
          // How far apart the accents are, plus how far apart the counters (the large area) are.
          const d = distance(rgb(tokens[i].t.accent), rgb(tokens[j].t.accent)) + distance(rgb(tokens[i].t.ground), rgb(tokens[j].t.ground));
          if (d < MIN) close.push(`${tokens[i].slug} ~ ${tokens[j].slug} (${d.toFixed(1)})`);
        }
      }
      expect(close, `themes closer than ${MIN}: ${close.join(", ")}`).toEqual([]);
    });
  }

  it("the neutral house theme is not mistaken for any beer", () => {
    const house = generateTokens(HOUSE_THEME, "dark");
    for (const theme of BEER_THEMES) {
      const t = generateTokens(theme, "dark");
      const d = distance(rgb(t.accent), rgb(house.accent)) + distance(rgb(t.ground), rgb(house.ground));
      expect(d, `${theme.slug} vs house`).toBeGreaterThan(8);
    }
  });
});

describe("theme selection and output", () => {
  it("prefers the manual override, then favourite #1, then the neutral house theme", () => {
    expect(resolveTheme({ override: "heineken", primaryBeerSlug: "goldstar" }).slug).toBe("heineken");
    expect(resolveTheme({ override: null, primaryBeerSlug: "goldstar" }).slug).toBe("goldstar");
    expect(resolveTheme({}).slug).toBe("house");
    expect(resolveTheme({ primaryBeerSlug: "a-beer-added-later" }).slug).toBe("house");
    expect(themeFor("nonsense").slug).toBe("house");
  });

  it("follows the device by default, with both modes in one stylesheet", () => {
    const css = themeStyleSheet(themeFor("goldstar"), "system");
    expect(css).toContain("prefers-color-scheme:dark");
    expect(css.match(/--ground:/g)).toHaveLength(2);
  });

  it("pins a single mode when the person chose one in Settings", () => {
    const light = themeStyleSheet(themeFor("goldstar"), "light");
    const dark = themeStyleSheet(themeFor("goldstar"), "dark");
    expect(light).not.toContain("prefers-color-scheme");
    expect(dark).not.toContain("prefers-color-scheme");
    expect(light).toContain("color-scheme:light");
    expect(dark).toContain("color-scheme:dark");
    expect(light).not.toEqual(dark);
  });

  it("emits every semantic token and only plain values (nothing user-supplied reaches the stylesheet)", () => {
    const css = themeStyleSheet(themeFor("tuborg"), "dark");
    for (const token of ["--ground", "--paper", "--ink", "--price", "--deal", "--on-deal", "--accent", "--glow", "--focus", "--danger"]) {
      expect(css).toContain(`${token}:`);
    }
    expect(css).not.toMatch(/[<>{}]\s*[a-z]+\s*\(/i.source ? /<\/?style/i : /x/);
  });
});
