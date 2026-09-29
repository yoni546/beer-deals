import { expect, test } from "@playwright/test";

/**
 * A read-only check of a DEPLOYED environment (staging, a Vercel preview, or
 * production). It creates nothing except the anonymous session every visit gets,
 * and never submits, reports, subscribes or signs in.
 *
 *   E2E_BASE_URL=https://beer-deals.vercel.app npx playwright test deployed-smoke
 *
 * Runs only when E2E_BASE_URL is set; the rest of the suite needs the local fake
 * database and is skipped in that mode (see playwright.config.ts).
 */
const SAMPLE_DEAL_NOTE = "מבצע לדוגמה";

for (const route of ["/welcome", "/whats-new", "/beer", "/store", "/beer/goldstar", "/store/rami-levy", "/admin/login"]) {
  test(`${route} answers without a server error`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response!.status(), route).toBeLessThan(500);
    await expect(page.getByText("משהו השתבש")).toHaveCount(0);
  });
}

test("search by beer and by supermarket work", async ({ page }) => {
  await page.goto("/beer");
  await page.getByRole("searchbox").fill("gold");
  await page.getByRole("link", { name: "גולדסטאר" }).click();
  await expect(page).toHaveURL(/\/beer\/goldstar/);

  await page.goto("/store");
  await page.getByRole("searchbox").fill("רמי");
  await page.getByRole("link", { name: "רמי לוי" }).click();
  await expect(page).toHaveURL(/\/store\/rami-levy/);
});

test("no sample deal is ever shown as a real one", async ({ page }) => {
  for (const route of ["/beer/goldstar", "/beer/goldstar?c=case", "/beer/maccabee", "/store/rami-levy", "/store/shufersal"]) {
    await page.goto(route);
    await expect(page.getByText(SAMPLE_DEAL_NOTE), route).toHaveCount(0);
  }
});

test("What's New is reachable and shows a version", async ({ page }) => {
  await page.goto("/whats-new");
  await expect(page.getByText(/גרסה\s*\d+\.\d+\.\d+/)).toBeVisible();
});
