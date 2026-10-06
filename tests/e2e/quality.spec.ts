import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NO_IDENTITY_BEER, addBeerWithoutIdentity, floorViolations, onboard, resetDb, seedRealCatalog } from "./helpers";

/**
 * The quality floor for every screen, checked in a real browser at both phone widths:
 *   - nothing scrolls sideways,
 *   - every control is at least 44 × 44 CSS px,
 *   - no text is smaller than 12px,
 *   - axe finds no WCAG 2.x A/AA violation (contrast, names, roles, labels…), in light and
 *     dark, and in several of the beer themes.
 * (Contrast is also proven exhaustively, for every theme, in tests/design.test.ts.)
 */
const SCREENS = [
  "/",
  "/beer",
  "/store",
  "/beer/goldstar",
  "/beer/goldstar?view=regular",
  "/store/rami-levy",
  "/store/rami-levy?mine=1",
  "/settings",
  "/submit",
  "/whats-new",
];

test.beforeAll(async () => {
  await resetDb();
  await seedRealCatalog();
  await addBeerWithoutIdentity();
});

test("no screen scrolls sideways, every control is a real touch target, no text is under 12px", async ({ page }) => {
  await onboard(page);
  for (const route of SCREENS) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    expect(await floorViolations(page), route).toEqual([]);
  }
});

// The two other widths the audit named: a small Android phone and a tablet held upright.
for (const width of [360, 768]) {
  test(`no screen scrolls sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await onboard(page);
    for (const route of SCREENS) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${route} at ${width}px`).toBeLessThanOrEqual(1);
    }
  });
}

test("the unread dot and the sort control are still touch targets when they are open", async ({ page }) => {
  await onboard(page);
  await page.goto("/beer/goldstar");
  for (const summary of await page.locator("summary").all()) await summary.click();
  expect(await floorViolations(page)).toEqual([]);
});

async function axe(page: Page, route: string, label: string) {
  await page.goto(route);
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const brief = results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(brief, `${label} ${route}`).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test(`axe: no WCAG A/AA violations on any screen (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await onboard(page);
    for (const route of SCREENS) await axe(page, route, scheme);
  });
}

// A spread of beers (as favourite #1 — the only way a look is chosen), plus the neutral house look.
const OTHERS = ["גולדסטאר", "מכבי", "קורונה"];
for (const [theme, name] of [["house", NO_IDENTITY_BEER], ["heineken", "היינקן"], ["stella", "סטלה ארטואה"], ["guinness", "גינס"], ["tuborg-red", "טובורג אדום"]] as const) {
  test(`axe: contrast holds with ${theme} as favourite #1, light and dark`, async ({ page }) => {
    await onboard(page, "בדיקה", [name, ...OTHERS]);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const route of ["/", "/beer/goldstar", "/settings"]) {
        await page.goto(route);
        await expect(page.locator("body")).toHaveAttribute("data-theme", theme);
        const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
        const brief = results.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.any[0]?.message ?? ""}`));
        expect(brief, `${theme}/${scheme} ${route}`).toEqual([]);
      }
    }
  });
}
