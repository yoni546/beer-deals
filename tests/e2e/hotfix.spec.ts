import { expect, test } from "@playwright/test";
import {
  DEMO_NOTE,
  STANDARD_DEALS,
  completeOnboardingSteps,
  onboard,
  resetDb,
  seedDeals,
  seedRealCatalog,
  stubBrowserPush,
} from "./helpers";

/**
 * Regression tests for the defects found in the 2026-09-29 audit
 * (docs/PRODUCT-AUDIT-2026-09-29.md §5), kept passing through the design rebuild.
 * Each test is named after the behaviour a person should get.
 *
 * The server runs in production mode (APP_ENV=production), so the catalogue is seeded as
 * REAL data (re-attributed to the 'admin' source) — except Carlsberg, which stays sample
 * data, and one legacy demo deal, to prove that invented prices never reach a screen.
 */
test.beforeAll(async () => {
  await resetDb();
  await seedRealCatalog({ sample: ["carlsberg"] });
  await seedDeals([
    ...STANDARD_DEALS,
    { beer: "tuborg", store: "osher-ad", category: "sixpack", deal: 2790, regular: 3890, notes: DEMO_NOTE },
  ]);
});

test("B-01 · every route answers without a server error", async ({ page }) => {
  const welcome = await page.goto("/welcome");
  expect(welcome!.status()).toBeLessThan(500);

  await onboard(page);
  for (const route of [
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
    "/admin/login",
  ]) {
    const response = await page.goto(route);
    expect(response!.status(), `${route} should not be a server error`).toBeLessThan(500);
  }
});

test("B-01 · search by beer finds a beer by English or Hebrew name and opens its deals", async ({ page }) => {
  await onboard(page);
  await page.goto("/beer");

  const search = page.getByRole("searchbox");
  await search.fill("gold");
  await expect(page.getByRole("link", { name: /גולדסטאר/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /קורונה/ })).toHaveCount(0);

  await search.fill("מכ");
  await expect(page.getByRole("link", { name: /מכבי/ })).toBeVisible();

  // A slip of the finger still finds the beer.
  await search.fill("גולדסטר");
  await expect(page.getByRole("link", { name: /גולדסטאר/ })).toBeVisible();

  await search.fill("gold");
  await page.getByRole("link", { name: /גולדסטאר/ }).click();
  await expect(page).toHaveURL(/\/beer\/goldstar/);
  await expect(page.getByText("₪25.00").first()).toBeVisible();
});

test("B-01 · search by supermarket opens the store's deals", async ({ page }) => {
  await onboard(page);
  await page.goto("/store");
  await page.getByRole("searchbox").fill("רמי");
  await page.getByRole("link", { name: /רמי לוי/ }).click();
  await expect(page).toHaveURL(/\/store\/rami-levy/);
  await expect(page.getByText("₪25.00").first()).toBeVisible();
});

test("a line on the tape leads to its beer and to its store", async ({ page }) => {
  await onboard(page);
  const line = page.locator("article", { hasText: "₪25.00" }).first();
  await line.getByRole("link", { name: /6 × 330/ }).click();
  await expect(page).toHaveURL(/\/beer\/goldstar$/);

  await page.goto("/");
  await page.locator("article", { hasText: "₪25.00" }).first().getByRole("link", { name: "רמי לוי" }).click();
  await expect(page).toHaveURL(/\/store\/rami-levy$/);
});

test("B-02 · sample data is never shown as real, on any screen", async ({ page }) => {
  await onboard(page);
  await expect(page.getByText(DEMO_NOTE)).toHaveCount(0);

  // Carlsberg exists only as sample data here, and the legacy Tuborg at Osher Ad is a demo deal.
  for (const route of ["/", "/beer/tuborg", "/store/osher-ad", "/store/rami-levy"]) {
    await page.goto(route);
    await expect(page.getByText(DEMO_NOTE), route).toHaveCount(0);
    await expect(page.getByText("₪27.90"), `${route}: the legacy demo Tuborg`).toHaveCount(0);
    await expect(page.getByText("קרלסברג"), `${route}: the sample Carlsberg`).toHaveCount(0);
  }

  await page.goto("/beer/carlsberg");
  await expect(page.getByText("אין כרגע מבצע על קרלסברג").first()).toBeVisible();
  await expect(page.getByText("₪24.90")).toHaveCount(0); // its sample promotion
  await page.goto("/beer/carlsberg?view=regular");
  await expect(page.getByText("₪34.90")).toHaveCount(0); // its sample regular price

  // The real Tuborg offer next to it is still there.
  await page.goto("/beer/tuborg");
  await expect(page.getByText("₪35.00").first()).toBeVisible();
});

test("B-06/B-07 · the last onboarding step stays on screen until the user moves on", async ({ page }) => {
  await completeOnboardingSteps(page, "בדיקה", ["היינקן", "גולדסטאר", "מכבי", "קורונה"]);

  const finish = page.getByRole("button", { name: /קדימה/ });
  await expect(finish).toBeVisible();
  // It used to be replaced by the home page after roughly one to three seconds.
  await page.waitForTimeout(4000);
  await expect(finish).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/welcome");

  await finish.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /אהלן/ })).toBeVisible();

  // The first-ranked beer's theme is applied on arrival, not after a manual reload.
  await expect(page.locator("body")).toHaveAttribute("data-theme", "heineken");
});

test("onboarding repaints the page in the first beer's colours as soon as it is picked", async ({ page }) => {
  await page.goto("/welcome");
  await page.getByRole("button", { name: "ממשיכים" }).click(); // the name is optional
  const ground = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ground").trim());
  const before = await ground();
  await page.locator("button[aria-pressed]", { hasText: "גולדסטאר" }).first().click();
  await expect.poll(ground).not.toBe(before);
});

test.describe("notification settings", () => {
  test("B-04 · someone who never subscribed is not shown as subscribed", async ({ page }) => {
    await stubBrowserPush(page, { permission: "granted", subscribe: "none" });
    await onboard(page);
    await page.goto("/settings");
    // Permission is granted and the stored preference used to default to "on":
    // that must not read as "subscribed" when this device has no subscription.
    await expect(page.getByRole("button", { name: /קבלו התראה/ })).toBeEnabled();
    await expect(page.getByText("התראות פעילות")).toHaveCount(0);
  });

  test("B-05 · a browser that refuses to subscribe gets a message, not a crashed page", async ({ page }) => {
    await stubBrowserPush(page, { permission: "granted", subscribe: "refuse" });
    await onboard(page);
    await page.goto("/settings");

    await page.getByRole("button", { name: /קבלו התראה/ }).click();
    // (Next.js's own route announcer is also role=alert, so match on our text.)
    await expect(page.locator("[role=alert]", { hasText: "להירשם להתראות" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "הגדרות" })).toBeVisible();
    await expect(page.getByText("משהו השתבש")).toHaveCount(0);
  });
});
