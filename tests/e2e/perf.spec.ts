import { expect, test } from "@playwright/test";
import { onboard, resetDb, seedRealCatalog } from "./helpers";

/**
 * The gate Phase Q is behind: is the app fast, and does a change keep it fast?
 *
 * The V2 audit's second finding was that the app felt slow (§2: measured TTFB of
 * 2–5 s in production, from geography and prefetch fan-out rather than bundle
 * size). Decoration is not allowed to be the thing that puts a millisecond back,
 * so this measures navigation and holds a budget — in the suite, where it will
 * fail somebody's pull request rather than being rediscovered in an audit.
 *
 * The numbers are deliberately generous. This runs on CI hardware against a local
 * fake database, so it cannot tell us what a phone in a shop in Haifa experiences;
 * what it CAN do is catch a regression of the kind that turns 200 ms into 2 s. A
 * tight budget here would be a flaky test pretending to be a guarantee.
 */
test.beforeAll(async () => {
  await resetDb();
  await seedRealCatalog();
});

/** Routes a person actually moves between, with a budget each. */
const ROUTES: Array<{ path: string; label: string; budgetMs: number }> = [
  { path: "/", label: "דף הבית", budgetMs: 2500 },
  { path: "/beer", label: "בירות", budgetMs: 2500 },
  { path: "/beer/goldstar", label: "בירה אחת", budgetMs: 2500 },
  { path: "/store", label: "סופרים", budgetMs: 2500 },
  { path: "/settings", label: "הגדרות", budgetMs: 2500 },
];

test("every screen a person navigates to answers inside its budget", async ({ page }) => {
  await onboard(page);

  const measured: Array<{ label: string; ttfb: number; loaded: number }> = [];
  for (const route of ROUTES) {
    // Warm first, then measure: the first hit of a route in a fresh server compiles
    // and fills caches, which is a real cost but not the one a person pays twice.
    await page.goto(route.path);
    await page.goto(route.path);

    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return { ttfb: nav.responseStart - nav.requestStart, loaded: nav.domContentLoadedEventEnd - nav.startTime };
    });
    measured.push({ label: route.label, ...timing });
    expect(timing.loaded, `${route.label} (${route.path})`).toBeLessThan(route.budgetMs);
  }

  // Printed so a regression is visible as a number and not only as a pass.
  console.log("navigation:", measured.map((m) => `${m.label} ttfb=${Math.round(m.ttfb)}ms dcl=${Math.round(m.loaded)}ms`).join(" · "));
});

test("the bottle's motion is decoration: it is off under reduced motion, and the depth stays", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await onboard(page);
  await page.goto("/");

  const hero = page.locator(".bottle-hero").first();
  await expect(hero).toBeAttached();

  const style = await hero.evaluate((el) => {
    const computed = getComputedStyle(el);
    const parent = getComputedStyle(el.parentElement!);
    return { duration: computed.animationDuration, perspective: parent.perspective };
  });
  // The MOTION goes. Asserted on the computed duration, not on a class name: the
  // global reduced-motion rule works by duration, so the animation's NAME is still
  // there and testing for that would pass while the bottle still moved.
  expect(parseFloat(style.duration)).toBeLessThan(0.01);
  // The DEPTH stays: a perspective is composition, not motion, and somebody who asked
  // for no animation did not ask for a flatter picture.
  expect(style.perspective).not.toBe("none");
});

test("the settle does not fight the one navigation that is already animated", async ({ page }) => {
  await onboard(page); // ends by arriving at Home from /welcome

  // The reveal script marks that arrival, and the mark is what keeps the settle off
  // the element the view transition is carrying. Two animations on one transform is
  // how a tuned 780 ms journey becomes a twitch.
  await expect(page.locator("html")).toHaveAttribute("data-arrived", "welcome");
  const running = await page
    .locator(".bottle-hero")
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(running).toBe("none");

  // On any later visit it settles again, because that arrival is not animated.
  await page.goto("/beer");
  await page.goto("/");
  const later = await page
    .locator(".bottle-hero")
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(later).toBe("bottle-settle");
});
