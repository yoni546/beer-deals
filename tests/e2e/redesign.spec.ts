import { expect, test, type Page } from "@playwright/test";
import { onboard, resetDb, seedRealCatalog } from "./helpers";

/**
 * The rebuilt screens ("The Tape", DESIGN.md), exercised the way a person uses them.
 * Data is the dev catalogue re-attributed to a real source (see seedRealCatalog), so the
 * production-mode server shows it. Prices are invented numbers; the shapes are real.
 *
 * Default favourites from onboard(): גולדסטאר, מכבי, היינקן, קורונה.
 */
test.beforeAll(async () => {
  await resetDb();
  await seedRealCatalog();
});

/** Every "₪12.34" figure that is read out by a screen reader within a locator, as agorot. */
async function pricesIn(scope: ReturnType<Page["locator"]>): Promise<number[]> {
  const texts = await scope.locator(".num > .sr-only").allInnerTexts();
  return texts.map((text) => Math.round(parseFloat(text.replace(/[^\d.]/g, "")) * 100));
}

test("Home: the four beers are keys in the person's own order, and the first is marked", async ({ page }) => {
  await onboard(page, "דנה", ["מכבי", "גולדסטאר", "היינקן", "קורונה"]);
  const keys = page.getByRole("list", { name: "ארבע הבירות שלי, לפי הסדר" }).getByRole("listitem");
  await expect(keys).toHaveCount(4);
  await expect(keys.nth(0)).toContainText("מכבי");
  await expect(keys.nth(0)).toContainText("ראשית");
  await expect(keys.nth(1)).toContainText("גולדסטאר");
  await expect(keys.nth(3)).toContainText("קורונה");
});

test("Home: the headline deal is a verified saving on one of the person's beers, with the price shown as printed", async ({ page }) => {
  await onboard(page);
  const hero = page.locator("#hero-title");
  await expect(hero).toHaveText("גולדסטאר");
  const card = page.locator("section", { has: hero });
  await expect(card).toContainText("₪89.00");
  await expect(card).toContainText("−36%");
  await expect(card).toContainText("₪139.00"); // the trusted regular price it is measured against
});

test("Home: a promotion with no trusted regular price is shown without a percentage", async ({ page }) => {
  await onboard(page);
  // Heineken at Victory has no reference to compare with: the price stands alone.
  const line = page.locator("article", { hasText: "₪36.90" }).first();
  await expect(line).toBeVisible();
  await expect(line.getByText(/חיסכון של/)).toHaveCount(0);
  await expect(line.getByText(/−\d+%/)).toHaveCount(0);
});

test("Home: the search box, the number-one beer and the bottom bar are all on the first screen", async ({ page }) => {
  await onboard(page);
  const height = page.viewportSize()!.height;
  const searchbox = page.getByRole("searchbox", { name: "חיפוש בירה או סופר" });
  const numberOne = page.getByRole("list", { name: "ארבע הבירות שלי, לפי הסדר" }).getByRole("listitem").first();
  const bar = page.getByRole("navigation", { name: "ניווט ראשי" });
  for (const [name, locator] of [["search", searchbox], ["number one", numberOne], ["bottom bar", bar]] as const) {
    const box = (await locator.boundingBox())!;
    expect(box.y, name).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `${name} fits above the fold`).toBeLessThanOrEqual(height + 1);
  }
});

test("Home search: a beer or a chain, typos forgiven, Enter opens the best match", async ({ page }) => {
  await onboard(page);
  await page.waitForLoadState("networkidle"); // hydrated, so typing reaches React
  const box = page.getByRole("searchbox", { name: "חיפוש בירה או סופר" });
  const results = page.getByRole("search");

  await box.fill("גולדסטר"); // a letter short
  await expect(results.getByRole("link", { name: /גולדסטאר/ })).toBeVisible();
  await expect(results.getByRole("link", { name: /קורונה/ })).toHaveCount(0);
  await box.press("Enter");
  await expect(page).toHaveURL(/\/beer\/goldstar$/);

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await box.fill("רמי");
  await results.getByRole("link", { name: /רמי לוי/ }).click();
  await expect(page).toHaveURL(/\/store\/rami-levy$/);

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await box.fill("zzzz");
  await expect(page.getByText("לא מצאנו בירה או סופר בשם הזה")).toBeVisible();
  await page.getByRole("button", { name: "נקו את החיפוש" }).first().click(); // a way out, not just advice
  await expect(box).toHaveValue("");
  await expect(page.getByText("לא מצאנו בירה או סופר בשם הזה")).toHaveCount(0);
});

test("Home: sorting lives in the URL, reorders the lines, and survives a reload", async ({ page }) => {
  await onboard(page);
  await page.getByRole("link", { name: /מחיר.*מהזול ליקר/ }).click();
  await expect(page).toHaveURL(/sort=price_asc/);

  // The strip, not the headline card above it (which carries the same beer's name).
  const goldstar = page
    .locator("section", { has: page.getByRole("heading", { level: 2, name: "גולדסטאר" }) })
    .filter({ hasNot: page.locator("#hero-title") });
  const ascending = await pricesIn(goldstar);
  expect(ascending.length).toBeGreaterThan(1);
  expect(ascending).toEqual([...ascending].sort((a, b) => a - b));

  await page.getByRole("link", { name: /מחיר.*מהיקר לזול/ }).click();
  await expect(page).toHaveURL(/sort=price_desc/);
  const descending = await pricesIn(goldstar);
  expect(descending).toEqual([...descending].sort((a, b) => b - a));

  await page.reload();
  await expect(page).toHaveURL(/sort=price_desc/);
  await expect(page.getByRole("link", { name: /מחיר.*מהיקר לזול/ })).toHaveAttribute("aria-current", "true");
});

test("Beer page: every pack is its own strip and a chain's 6×500 price never sits among the 6×330s", async ({ page }) => {
  await onboard(page);
  await page.goto("/beer/goldstar");

  for (const pack of ["6 × 330 מ״ל · פחית", "6 × 500 מ״ל · פחית", "24 × 330 מ״ל · פחית"]) {
    await expect(page.getByRole("heading", { level: 2, name: pack }), pack).toBeVisible();
  }

  const small = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "6 × 330 מ״ל · פחית" }) });
  await expect(small).toContainText("₪25.00");
  await expect(small).toContainText("₪29.90");
  await expect(small).not.toContainText("₪40.00");

  const mid = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "6 × 500 מ״ל · פחית" }) });
  await expect(mid).toContainText("₪40.00");
  await expect(mid).toContainText("2 ב־₪80"); // the multi-buy terms travel with the price
  await expect(mid).not.toContainText("₪25.00");
});

test("Beer page: the pack filter narrows to one kind of pack and stays in the URL", async ({ page }) => {
  await onboard(page);
  await page.goto("/beer/goldstar");
  await page.getByRole("link", { name: "ארגזים" }).click();
  await expect(page).toHaveURL(/pack=case/);
  await expect(page.getByRole("heading", { level: 2, name: "24 × 330 מ״ל · פחית" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "6 × 330 מ״ל · פחית" })).toHaveCount(0);
});

test("Beer page: regular prices are their own view, every chain, cheapest first", async ({ page }) => {
  await onboard(page);
  await page.goto("/beer/goldstar");
  await page.getByRole("link", { name: /מחירים רגילים/ }).click();
  await expect(page).toHaveURL(/view=regular/);

  const small = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "6 × 330 מ״ל · פחית" }) });
  expect(await pricesIn(small)).toEqual([3690, 3790, 3890, 3990]);
  // A regular price is not dressed up as a saving.
  await expect(small.getByText(/−\d+%/)).toHaveCount(0);
});

test("Store page: 'my beers' lists all four in order and says plainly which have nothing here", async ({ page }) => {
  await onboard(page);
  await page.goto("/store/rami-levy");
  await page.getByRole("link", { name: "הבירות שלי" }).click();
  await expect(page).toHaveURL(/mine=1/);

  const headings = page.getByRole("heading", { level: 2 });
  await expect(headings.filter({ hasText: /^(גולדסטאר|מכבי|היינקן|קורונה)$/ })).toHaveText(["גולדסטאר", "מכבי", "היינקן", "קורונה"]);
  await expect(page.getByText("אין כרגע מבצע על מכבי ברמי לוי")).toBeVisible();
  await expect(page.getByText("אין כרגע מבצע על היינקן ברמי לוי")).toBeVisible();
});

test("Details fold out on a line: the regular price it is measured against and where that comes from", async ({ page }) => {
  await onboard(page);
  await page.goto("/beer/goldstar");
  const line = page.locator("article", { hasText: "₪25.00" }).first();
  await expect(line.getByText("מחיר רגיל")).toBeHidden();
  await line.locator("summary").click();
  await expect(line.getByText("מחיר רגיל")).toBeVisible();
  await expect(line.getByText("₪37.90").last()).toBeVisible();
});

test.describe("settings", () => {
  test("changing the order of the four beers changes what Home puts first, and the theme follows the new number one", async ({ page }) => {
    await onboard(page); // גולדסטאר, מכבי, היינקן, קורונה
    await expect(page.locator("body")).toHaveAttribute("data-theme", "goldstar");

    await page.goto("/settings");
    await page.getByRole("button", { name: "העלו את מכבי מקום אחד" }).click();
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toBeVisible();
    await expect(page.locator("body")).toHaveAttribute("data-theme", "maccabee");

    await page.goto("/");
    const keys = page.getByRole("list", { name: "ארבע הבירות שלי, לפי הסדר" }).getByRole("listitem");
    await expect(keys.nth(0)).toContainText("מכבי");
    await expect(keys.nth(1)).toContainText("גולדסטאר");
  });

  test("swapping a beer out is remove-then-add, and saving needs exactly four", async ({ page }) => {
    await onboard(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "הסירו את קורונה" }).click();
    await expect(page.getByRole("button", { name: "שמירה" })).toBeDisabled(); // only three left
    await page.getByRole("button", { name: /^\s*טובורג\s*$/ }).click();
    await expect(page.getByRole("button", { name: "שמירה" })).toBeEnabled();
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toBeVisible();

    await page.goto("/");
    await expect(page.getByRole("list", { name: "ארבע הבירות שלי, לפי הסדר" })).toContainText("טובורג");
    await expect(page.getByRole("list", { name: "ארבע הבירות שלי, לפי הסדר" })).not.toContainText("קורונה");
  });
});

test("the bottom bar takes you between the four places and marks where you are", async ({ page }) => {
  await onboard(page);
  const bar = page.getByRole("navigation", { name: "ניווט ראשי" });
  await expect(bar.getByRole("link", { name: "מבצעים" })).toHaveAttribute("aria-current", "page");

  await bar.getByRole("link", { name: "בירות" }).click();
  await expect(page).toHaveURL(/\/beer$/);
  await expect(bar.getByRole("link", { name: "בירות" })).toHaveAttribute("aria-current", "page");

  await bar.getByRole("link", { name: "סופרים" }).click();
  await expect(page).toHaveURL(/\/store$/);

  await bar.getByRole("link", { name: "אני" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(bar.getByRole("link", { name: "אני" })).toHaveAttribute("aria-current", "page");
});

test("an unknown beer is a designed 404, not a crash", async ({ page }) => {
  await onboard(page);
  // (The status line is already sent, as 200, by the time the page streams its 404 body — the
  // price of showing a loading skeleton at once. What a person sees is what matters here.)
  await page.goto("/beer/no-such-beer");
  await expect(page.getByRole("heading", { name: "לא מצאנו את הדף הזה" })).toBeVisible();
  await expect(page.getByRole("link", { name: "לחיפוש בירה" })).toBeVisible();
});
