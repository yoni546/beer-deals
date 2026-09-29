import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { STANDARD_DEALS, makeAdmin, onboard, resetDb, seedDeals } from "./helpers";

// The same file the app renders from; read directly because Playwright loads
// specs as native ESM, which cannot import JSON without an attribute.
type Release = { version: string; title_he: string; highlights_he: string[]; showInApp: boolean };
const visibleReleases = (
  JSON.parse(readFileSync(new URL("../../src/content/releases.json", import.meta.url), "utf8")) as Release[]
).filter((release) => release.showInApp);
const latestRelease = visibleReleases[0];
// Settings shows the app's own version, which can be newer than the last release users are shown.
const appVersion = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

test.beforeAll(async () => {
  await resetDb();
  await seedDeals(STANDARD_DEALS);
});

test("What's New (admins): a quiet link with an unread dot, the latest update in full, history one tap away", async ({ page }) => {
  await onboard(page, "מנהלת");
  await makeAdmin("מנהלת");
  await page.reload();

  const link = page.getByRole("link", { name: /מה חדש/ });
  await expect(link).toBeVisible();
  await expect(page.getByTestId("whats-new-dot")).toBeVisible(); // never opened yet

  // Unobtrusive but still a proper touch target.
  const box = await link.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await link.click();
  await expect(page).toHaveURL(/\/whats-new$/);
  await expect(page.getByRole("heading", { name: latestRelease.title_he })).toBeVisible();
  await expect(page.getByText(latestRelease.version).first()).toBeVisible();
  for (const line of latestRelease.highlights_he) await expect(page.getByText(line)).toBeVisible();

  // Earlier updates are collapsed until asked for.
  if (visibleReleases.length > 1) {
    const earlier = visibleReleases[1];
    const summary = page.getByText(earlier.title_he);
    await expect(summary).toBeVisible();
    await expect(page.getByText(earlier.highlights_he[0])).toBeHidden();
    await summary.click();
    await expect(page.getByText(earlier.highlights_he[0])).toBeVisible();
  }

  // Having read it, the dot is gone.
  await page.goto("/");
  await expect(page.getByRole("link", { name: /מה חדש/ })).toBeVisible();
  await expect(page.getByTestId("whats-new-dot")).toHaveCount(0);
});

test("Settings shows the app version, and the same entry point for admins", async ({ page }) => {
  await onboard(page, "מנהל");
  await makeAdmin("מנהל");
  await page.goto("/settings");
  await expect(page.getByText(`גרסה ${appVersion}`)).toBeVisible();
  await expect(page.getByRole("link", { name: /מה חדש/ })).toBeVisible();
});

test("a regular user: no What's New anywhere (the page itself refuses), and 'share with friends' instead", async ({ page, context }) => {
  await onboard(page, "רגיל");
  await expect(page.getByRole("link", { name: /מה חדש/ })).toHaveCount(0);
  await page.goto("/settings");
  await expect(page.getByText(`גרסה ${appVersion}`)).toBeVisible();
  await expect(page.getByRole("link", { name: /מה חדש/ })).toHaveCount(0);

  // Not just hidden: the server answers "not found" to anyone who is not an admin.
  const response = await page.goto("/whats-new");
  expect(response!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: latestRelease.title_he })).toHaveCount(0);

  // Share: where the browser has no share sheet, the production link is copied and the button says so.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.evaluate(() => Object.defineProperty(navigator, "share", { value: undefined, configurable: true }));
  const share = page.getByRole("button", { name: "אהבתם? שתפו לחברים" });
  await expect(share).toBeVisible();
  const box = await share.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await share.click();
  await expect(page.getByText("הקישור הועתק")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://beer-deals.vercel.app");
});
