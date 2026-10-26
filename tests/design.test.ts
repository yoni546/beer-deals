import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, distance, fromHex, oklch, toHex } from "@/design/color";
import { OVER_BOTTLE, SHAPES, passesOver } from "@/design/bottles";
import * as themes from "@/design/themes";
import {
  BEER_IDENTITIES,
  HOUSE,
  generateTokens,
  getThemeForBeer,
  identityFor,
  themeStyleSheet,
  type Mode,
} from "@/design/themes";

const ALL = [HOUSE, ...BEER_IDENTITIES];
const MODES: Mode[] = ["light", "dark"];
const rgb = fromHex;
const ROOT = join(import.meta.dirname, "..");

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

describe("favourite #1 is the app — the locked product rule", () => {
  it("chooses the theme from favourite #1 and from nothing else", () => {
    expect(getThemeForBeer("goldstar").beerId).toBe("goldstar");
    expect(getThemeForBeer("heineken").beerId).toBe("heineken");
    // Reordering so that a different beer is #1 is the one way the look changes.
    const before = getThemeForBeer(["goldstar", "heineken", "maccabee", "corona"][0]);
    const after = getThemeForBeer(["heineken", "goldstar", "maccabee", "corona"][0]);
    expect(before.beerId).not.toBe(after.beerId);
    expect(before.modes.dark.surface).not.toBe(after.modes.dark.surface);
  });

  it("takes exactly one argument: there is no override to pass", () => {
    expect(getThemeForBeer.length).toBe(1);
  });

  it("offers no API for choosing a look by hand", () => {
    const exported = Object.keys(themes);
    for (const forbidden of ["resolveTheme", "ALL_THEMES", "isThemeSlug", "swatches", "themeFor"]) {
      expect(exported, `${forbidden} is a manual-theme API`).not.toContain(forbidden);
    }
    expect(themeStyleSheet.length).toBe(1); // no appearance parameter either
  });

  it("has no code, action or schema anywhere for a theme override or an in-app light/dark choice", () => {
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) scan(path);
        else if (/\.(tsx?|sql)$/.test(name)) {
          const text = readFileSync(path, "utf8");
          if (/theme_override|themeOverride|saveAppearance|ThemePicker|data-mode|profiles?\.appearance/.test(text)) offenders.push(relative(ROOT, path));
        }
      }
    };
    scan(join(ROOT, "src"));
    for (const file of readdirSync(join(ROOT, "supabase", "migrations"))) {
      const text = readFileSync(join(ROOT, "supabase", "migrations", file), "utf8").replace(/^--.*$/gm, "");
      if (/theme_override|column appearance/.test(text)) offenders.push(`supabase/migrations/${file}`);
    }
    expect(offenders).toEqual([]);
  });

  it("falls back to the neutral house look — with no bottle — for a beer without an identity", () => {
    for (const slug of ["somersby", "a-beer-added-later", null, undefined, ""]) {
      const preset = getThemeForBeer(slug);
      expect(preset.beerId).toBe("house");
      expect(preset.background.kind).toBe("none");
    }
  });
});

describe("every beer has an identity and a bottle", () => {
  // The catalogue: the original 22 (0004) and the twelve added in 0.8.0 (0016).
  const seed = ["0004_seed.sql", "0016_more_beers_and_chains.sql"].map((file) => readFileSync(join(ROOT, "supabase", "migrations", file), "utf8")).join("\n");
  // (SQL escapes an apostrophe by doubling it — "Beck''s" — hence the `''` alternative.)
  const slugs = [...seed.matchAll(/^\s*\('([a-z0-9-]+)',\s*'(?:[^']|'')*',\s*'(?:[^']|'')*',\s*'#/gm)].map((match) => match[1]);
  /** Deliberately without an identity: a cider, shown in the neutral look. */
  const WITHOUT = ["somersby"];

  it("covers every seeded beer except the ones deliberately left neutral", () => {
    expect(slugs.length).toBe(34);
    for (const slug of slugs.filter((s) => !WITHOUT.includes(s))) {
      expect(identityFor(slug).slug, `no identity for ${slug}`).toBe(slug);
      expect(getThemeForBeer(slug).background.kind, `no bottle for ${slug}`).not.toBe("none");
    }
  });

  it("has unique slugs and only known bottle shapes", () => {
    expect(new Set(BEER_IDENTITIES.map((identity) => identity.slug)).size).toBe(BEER_IDENTITIES.length);
    for (const identity of BEER_IDENTITIES) expect(Object.keys(SHAPES)).toContain(identity.bottle!.shape);
  });
});

describe.each(MODES)("contrast, %s mode — every beer, every text role", (mode) => {
  for (const identity of ALL) {
    it(`${identity.slug} passes`, () => {
      const t = generateTokens(identity, mode);
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
      expect(failures, failures.join("; ")).toEqual([]);
      // The paper must lift off the counter.
      expect(distance(rgb(t.paper), rgb(t.ground))).toBeGreaterThan(8);
    });
  }
});

describe.each(MODES)("the bottle never costs readability, %s mode", (mode) => {
  for (const identity of ALL) {
    it(`${identity.slug}: every counter text passes over the darkest and the lightest bottle pixel`, () => {
      const preset = getThemeForBeer(identity.slug);
      const { bottleTone, tokens } = preset.modes[mode];
      // The filter maps each channel c to lo + (hi − lo)·c, so every bottle pixel lies between the
      // greys lo and hi. Passing against both greys is passing against every pixel.
      for (const level of [bottleTone.lo, bottleTone.hi]) {
        expect(passesOver(tokens, level), `${identity.slug} ${mode} at grey ${level}`).toBe(true);
        const bg: [number, number, number] = [level, level, level];
        expect(contrast(rgb(tokens.onGround), bg)).toBeGreaterThanOrEqual(OVER_BOTTLE.onGround);
        expect(contrast(rgb(tokens.onGround2), bg)).toBeGreaterThanOrEqual(OVER_BOTTLE.onGround2);
        expect(contrast(rgb(tokens.accent), bg)).toBeGreaterThanOrEqual(OVER_BOTTLE.accent);
      }
      // …and the counter itself lies inside the range, so the bottle can be lighter or darker than it.
      const [r, g, b] = rgb(tokens.ground);
      const groundGrey = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      expect(bottleTone.lo).toBeLessThanOrEqual(groundGrey);
      expect(bottleTone.hi).toBeGreaterThanOrEqual(groundGrey);
    });

    it(`${identity.slug}: the bottle is still clearly visible (a real tonal range, not a ghost)`, () => {
      const { bottleTone } = getThemeForBeer(identity.slug).modes[mode];
      expect(bottleTone.hi - bottleTone.lo).toBeGreaterThanOrEqual(70);
    });
  }
});

describe("beers are visibly different from each other", () => {
  // The bottle does most of the telling apart; the palettes must still not collapse into one.
  const MIN = 8;
  for (const mode of MODES) {
    it(`no two beers look alike (${mode})`, () => {
      const tokens = BEER_IDENTITIES.map((identity) => ({ slug: identity.slug, t: generateTokens(identity, mode), b: identity.bottle! }));
      const close: string[] = [];
      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < tokens.length; j++) {
          const [x, y] = [tokens[i], tokens[j]];
          const d =
            distance(rgb(x.t.accent), rgb(y.t.accent)) +
            distance(rgb(x.t.ground), rgb(y.t.ground)) +
            distance(rgb(x.b.label.base), rgb(y.b.label.base)) / 2;
          if (d < MIN) close.push(`${x.slug} ~ ${y.slug} (${d.toFixed(1)})`);
        }
      }
      expect(close, `beers closer than ${MIN}: ${close.join(", ")}`).toEqual([]);
    });
  }
});

describe("theme output", () => {
  it("follows the device's light/dark setting, with both modes in one stylesheet", () => {
    const css = themeStyleSheet(getThemeForBeer("goldstar"));
    expect(css).toContain("prefers-color-scheme:dark");
    expect(css.match(/--ground:/g)).toHaveLength(2);
    expect(css).toContain("url(#bottle-tone-light)");
    expect(css).toContain("url(#bottle-tone-dark)");
  });

  it("emits every semantic token and only plain values (nothing user-supplied reaches the stylesheet)", () => {
    const css = themeStyleSheet(getThemeForBeer("tuborg"));
    for (const token of ["--ground", "--paper", "--ink", "--price", "--deal", "--on-deal", "--accent", "--glow", "--scrim", "--focus", "--danger"]) {
      expect(css).toContain(`${token}:`);
    }
    expect(css).not.toMatch(/<\/?style/i);
  });

  it("exposes the preset in the product's own vocabulary", () => {
    const preset = getThemeForBeer("goldstar");
    // Goldstar's own bottle photo (scripts/fetch-bottles.mjs), with its provenance on record.
    expect(preset.background.kind).toBe("photo");
    if (preset.background.kind === "photo") expect(preset.background.photo).toMatchObject({ src: "/bottles/goldstar.webp", barcode: "7290006764072" });
    // A beer without a usable photo keeps its drawn stand-in, never another beer's photo.
    expect(getThemeForBeer("bazelet").background.kind).toBe("drawn");
    for (const key of ["surface", "surfaceElevated", "textPrimary", "textMuted", "accent", "accentStrong", "border", "dealHighlight", "glow", "scrim"]) {
      expect(preset.modes.dark).toHaveProperty(key);
    }
    expect(preset.backgroundScale).toBeGreaterThan(0.5);
  });
});

/**
 * The icon set's stroke is one CSS class, `.ico`, instead of eight attributes on
 * each of the 157 icons a chain page draws (globals.css, 0.12.0). That saves the
 * markup AND the RSC payload the phone parses — and it moves the stroke from an
 * SVG presentation attribute to a CSS declaration, which outranks one.
 *
 * So an icon that wants to be a filled shape can no longer say `fill="currentColor"`
 * on itself: `.ico { fill: none }` would win and the icon would render invisible,
 * which is the kind of break that looks like nothing at all. `solid` is how it asks.
 */
describe("the icon set", () => {
  const icons = readFileSync(join(ROOT, "src/components/ui/icons.tsx"), "utf8");

  it("declares the stroke once, in CSS, not on every icon", () => {
    const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.ico\s*\{[^}]*stroke:\s*currentColor/);
    expect(css).toMatch(/\.ico-solid\s*\{[^}]*fill:\s*currentColor/);
    // The <svg> itself must not carry them any more, or every icon pays for them twice.
    expect(icons).not.toMatch(/strokeLinejoin=|strokeLinecap=/);
  });

  it("has no icon fighting that class with its own fill or stroke attribute", () => {
    // `fill="currentColor"` on an icon loses to `.ico { fill: none }` and vanishes.
    expect(icons).not.toMatch(/<Icon[^>]*\bfill=/);
    expect(icons).not.toMatch(/<Icon[^>]*\bstrokeWidth=\{0\}/);
  });
});

/**
 * One beer, one picture, everywhere (the owner's rule, 2026-10-24).
 *
 * There are two ways to put a bottle beside a beer's name. `BeerBottle` asks the
 * central source — `photoFor(slug)`, src/design/bottle-photos.json — and falls
 * back to the drawing only when that beer has no approved photo. `BeerMark` IS
 * that drawing: it never looks at a photo at all.
 *
 * Four screens called the drawing directly — the deal list, the deal of the week,
 * search and onboarding — so Goldstar was a real bottle on Home and an empty
 * glass one in search. That is the whole of the complaint, and this is the line
 * that lets it come back: a new screen reaching for `BeerMark` because it is the
 * one whose name sounds like a small bottle.
 */
describe("the same beer shows the same bottle everywhere", () => {
  const screens = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? screens(path) : path.endsWith(".tsx") ? [path] : [];
    });
  const files = screens(join(ROOT, "src"));

  it("has every screen go through BeerBottle, never the drawing directly", () => {
    const direct = files
      .filter((f) => !f.endsWith(join("ui", "Bottle.tsx")))
      .filter((f) => /<BeerMark\b/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));

    expect(direct).toEqual([]);
  });

  it("keeps the fallback order: approved photo, then that beer's drawing", () => {
    const bottle = readFileSync(join(ROOT, "src/components/ui/Bottle.tsx"), "utf8");
    // BeerBottle asks for the photo first and hands off to the drawing when there is none.
    expect(bottle).toMatch(/const photo = photoFor\(slug\);\s*\n\s*if \(!photo\) return <BeerMark/);
  });
});
