import { expect, test } from "@playwright/test";
import {
  DEMO_NOTE,
  STANDARD_DEALS,
  completeOnboardingSteps,
  onboard,
  resetDb,
  seedDeals,
} from "./helpers";

/**
 * Regression tests for the defects found in the 2026-09-29 audit
 * (docs/PRODUCT-AUDIT-2026-09-29.md §5). Each test is named after the behaviour
 * a user should get, and each was written failing first.
 */
test.beforeAll(async () => {
  await resetDb();
  await seedDeals([
    ...STANDARD_DEALS,
    // Sample data must never reach a production-mode server, whatever the DB holds.
    { beer: "tuborg", store: "osher-ad", category: "sixpack", deal: 2790, regular: 3890, notes: DEMO_NOTE },
  ]);
});

test("B-01 · every route answers without a server error", async ({ page }) => {
  const welcome = await page.goto("/welcome");
  expect(welcome!.status()).toBeLessThan(500);

  await onboard(page);
  for (const route of ["/", "/beer", "/store", "/beer/goldstar", "/store/rami-levy", "/settings", "/submit", "/admin/login"]) {
    const response = await page.goto(route);
    expect(response!.status(), `${route} should not be a server error`).toBeLessThan(500);
  }
});

test("B-01 · search by beer finds a beer by English or Hebrew name and opens its deals", async ({ page }) => {
  await onboard(page);
  await page.goto("/beer");

  const search = page.getByRole("searchbox");
  await search.fill("gold");
  await expect(page.getByRole("link", { name: "גולדסטאר" })).toBeVisible();
  await expect(page.getByRole("link", { name: "קורונה" })).toHaveCount(0);

  await search.fill("מכ");
  await expect(page.getByRole("link", { name: "מכבי" })).toBeVisible();

  await search.fill("gold");
  await page.getByRole("link", { name: "גולדסטאר" }).click();
  await expect(page).toHaveURL(/\/beer\/goldstar/);
  await expect(page.getByText("₪24.90")).toBeVisible();
});

test("B-01 · search by supermarket opens the store's deals", async ({ page }) => {
  await onboard(page);
  await page.goto("/store");
  await page.getByRole("searchbox").fill("רמי");
  await page.getByRole("link", { name: "רמי לוי" }).click();
  await expect(page).toHaveURL(/\/store\/rami-levy/);
  await expect(page.getByText("₪24.90")).toBeVisible();
});

test("a deal card leads to its beer and to its store", async ({ page }) => {
  await onboard(page);
  const card = page.locator("article", { hasText: "₪24.90" }).first();
  await card.getByRole("link", { name: "גולדסטאר" }).click();
  await expect(page).toHaveURL(/\/beer\/goldstar\?c=sixpack/);

  await page.goto("/");
  await page.locator("article", { hasText: "₪24.90" }).first().getByRole("link", { name: "רמי לוי" }).click();
  await expect(page).toHaveURL(/\/store\/rami-levy\?c=sixpack/);
});

test("B-02 · sample deals are never shown as real deals", async ({ page }) => {
  await onboard(page);
  await expect(page.getByText(DEMO_NOTE)).toHaveCount(0);
  for (const route of ["/", "/beer/tuborg", "/store/osher-ad"]) {
    await page.goto(route);
    await expect(page.getByText(DEMO_NOTE), route).toHaveCount(0);
    await expect(page.getByText("₪27.90"), route).toHaveCount(0);
  }
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
  const base = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--base").trim());
  expect(base).toBe("#04140b"); // Heineken
});

test.describe("notification settings", () => {
  test.use({ permissions: ["notifications"] });

  test("B-04 · someone who never subscribed is not shown as subscribed", async ({ page }) => {
    await onboard(page);
    await page.goto("/settings");
    await expect(page.getByText("קבלו התראה על מבצע חזק")).toBeVisible();
    await expect(page.getByText("התראות פעילות")).toHaveCount(0);
  });

  test("B-05 · a browser that refuses to subscribe gets a message, not a crashed page", async ({ page }) => {
    await page.addInitScript(() => {
      PushManager.prototype.subscribe = () => Promise.reject(new DOMException("push service unavailable", "AbortError"));
    });
    await onboard(page);
    await page.goto("/settings");

    await page.getByRole("button", { name: /קבלו התראה/ }).click();
    // (Next.js's own route announcer is also role=alert, so match on our text.)
    await expect(page.locator("[role=alert]", { hasText: "להירשם להתראות" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "הגדרות" })).toBeVisible();
    await expect(page.getByText("משהו השתבש")).toHaveCount(0);
  });
});
