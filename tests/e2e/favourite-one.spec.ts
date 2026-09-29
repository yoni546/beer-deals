import { expect, test, type Page } from "@playwright/test";
import { NO_IDENTITY_BEER, addBeerWithoutIdentity, onboard, resetDb, seedRealCatalog } from "./helpers";

/**
 * The locked product rule (PRODUCT.md, "Favourite #1 is the app"): the person's favourite beer #1
 * decides the whole look — its bottle stands on the counter and the palette follows it. There is
 * no theme picker and no in-app light/dark switch; reordering the favourites is how the look
 * changes, and it changes everywhere, at once, with no flash and nothing stale left behind.
 */
test.beforeAll(async () => {
  await resetDb();
  await seedRealCatalog();
});

/** The bottle standing on the counter (onboarding may add a second, previewing layer). */
const stage = (page: Page) => page.locator(".bottle-stage").last();
const ground = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ground").trim());

test("favourite #1 Goldstar → the Goldstar app: bottle, palette and browser chrome, on the first paint", async ({ page }) => {
  await onboard(page, "בדיקה", ["גולדסטאר", "היינקן", "מכבי", "קורונה"]);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "goldstar");
  await expect(stage(page)).toHaveAttribute("data-beer", "goldstar");
  // Goldstar's own bottle photo (the pack shot, cut out — src/design/bottle-photos.json).
  await expect(stage(page)).toHaveAttribute("data-bottle", "photo");
  // The composition: one hero bottle in the centre, two smaller ones of the same beer at the sides.
  await expect(stage(page).locator(".bottle-hero")).toHaveAttribute("src", "/bottles/goldstar.webp");
  await expect(stage(page).locator(".bottle-side")).toHaveCount(2);
  for (const side of await stage(page).locator(".bottle-side").all()) await expect(side).toHaveAttribute("src", "/bottles/goldstar.webp");
  // Home leaves a stage open for it, and names the beer there.
  await expect(page.locator(".stage-caption")).toContainText("גולדסטאר");

  // No flash: the server's HTML already carries the beer — before any script runs.
  const html = await (await page.request.get("/")).text();
  expect(html).toContain('data-theme="goldstar"');
  expect(html).toContain('data-beer="goldstar"');
  expect(html).toMatch(/<meta name="theme-color"[^>]+content="#[0-9a-f]{6}"/);
});

test("changing #1 to Heineken changes the app at once, on every page, and leaves no Goldstar behind", async ({ page }) => {
  await onboard(page, "בדיקה", ["גולדסטאר", "היינקן", "מכבי", "קורונה"]);
  const goldstarGround = await ground(page);

  await page.goto("/settings");
  await page.getByRole("button", { name: "העלו את היינקן מקום אחד" }).click();
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toBeVisible();

  // Without a reload: the layout re-renders from the saved favourites.
  await expect(page.locator("body")).toHaveAttribute("data-theme", "heineken");
  await expect(stage(page)).toHaveAttribute("data-beer", "heineken");
  expect(await ground(page)).not.toBe(goldstarGround);

  for (const route of ["/", "/beer/goldstar", "/store/rami-levy", "/settings"]) {
    await page.goto(route);
    await expect(page.locator("body"), route).toHaveAttribute("data-theme", "heineken");
    await expect(page.locator(".bottle-stage[data-beer='goldstar']"), `${route}: stale Goldstar bottle`).toHaveCount(0);
  }
  await page.reload();
  await expect(stage(page)).toHaveAttribute("data-beer", "heineken");
});

test("dragging a beer to the top makes it #1, and the app follows it", async ({ page }) => {
  await onboard(page, "בדיקה", ["גולדסטאר", "מכבי", "קרלסברג", "קורונה"]);
  await page.goto("/settings");

  const grip = page.locator("[data-grip='carlsberg']");
  const topRow = page.locator("li[data-rank='1']");
  const from = (await grip.boundingBox())!;
  const to = (await topRow.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + ((to.y - from.y) * step) / 8);
  }
  await page.mouse.up();

  await expect(page.locator("li[data-rank='1']")).toContainText("קרלסברג");
  await expect(page.locator("li[data-rank='2']")).toContainText("גולדסטאר");
  await expect(page.getByText("קרלסברג עכשיו במקום 1")).toBeAttached(); // announced for screen readers

  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "carlsberg");
  await expect(stage(page)).toHaveAttribute("data-beer", "carlsberg");
});

test("the keyboard way to reorder does the same, and #1 is marked as what decides the look", async ({ page }) => {
  await onboard(page, "בדיקה", ["גולדסטאר", "מכבי", "היינקן", "קורונה"]);
  await page.goto("/settings");
  await expect(page.locator("li[data-rank='1']")).toContainText("המראה וההתראות");

  const up = page.getByRole("button", { name: "העלו את מכבי מקום אחד" });
  await up.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("li[data-rank='1']")).toContainText("מכבי");
  await expect(page.locator("li[data-rank='1']")).toContainText("המראה וההתראות");
});

test("there is no way to choose a look by hand: no picker, no light/dark switch", async ({ page }) => {
  await onboard(page);
  await page.goto("/settings");
  for (const text of ["צבעי האפליקציה", "בהיר או כהה", "מראה", "לפי המכשיר"]) {
    await expect(page.getByText(text, { exact: true }), text).toHaveCount(0);
  }
  for (const name of ["בהיר", "כהה", "אוטומטי", "ניטרלי"]) {
    await expect(page.getByRole("button", { name, exact: true }), name).toHaveCount(0);
  }
});

test("light or dark follows the device, and nothing else", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await onboard(page);
  const luminance = () =>
    page.evaluate(() => {
      const hex = getComputedStyle(document.documentElement).getPropertyValue("--ground").trim();
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    });
  expect(await luminance()).toBeGreaterThan(0.4);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(luminance).toBeLessThan(0.15);
});

test("a beer without its own identity gets the neutral look and no bottle — never another beer's", async ({ page }) => {
  await addBeerWithoutIdentity();
  await onboard(page, "בדיקה", [NO_IDENTITY_BEER, "גולדסטאר", "מכבי", "קורונה"]);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "house");
  await expect(stage(page)).toHaveAttribute("data-bottle", "none");
  await expect(page.locator(".bottle-art")).toHaveCount(0);
});
