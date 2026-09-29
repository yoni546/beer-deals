import { expect, test, type Page } from "@playwright/test";
import { onboard, resetDb, seedDeals, seedRealCatalog, sql } from "./helpers";

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

/** Sorting and pack filters live behind one quiet control ("מיון: …"); open it to reach them. */
const openSort = (page: Page) => page.locator("details.sort-panel > summary").first().click();

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
  await expect(keys.nth(0)).toContainText("#1");
  await expect(keys.nth(3)).toContainText("#4");
  // Minimal: each beer's own bottle, no card around it.
  await expect(keys.nth(0).locator("img[data-bottle-photo='maccabee']")).toBeVisible();
  await expect(keys.nth(0).locator(".tape")).toHaveCount(0);
  await expect(keys.nth(1)).toContainText("גולדסטאר");
  await expect(keys.nth(3)).toContainText("קורונה");
});

test("Home: beer for home — packs and cases only, a single never reaches Home", async ({ page }) => {
  // A single-can deal on the person's own #1 (a user-submitted one: it has a kind, "בודד", and no count).
  await seedDeals([{ beer: "goldstar", store: "hatzi-hinam", category: "single", deal: 590, regular: 790 }]);
  const singles = await sql<{ n: number }>("select count(*)::int as n from public.offers_feed where pack_label = 'בודד' or pack_quantity = 1");
  expect(singles[0].n).toBeGreaterThan(0);
  await onboard(page);
  await expect(page.locator("main")).not.toContainText("₪5.90");
  const lines = page.locator("main article");
  expect(await lines.count()).toBeGreaterThan(0);
  for (const text of await lines.allInnerTexts()) expect(text).toMatch(/שישייה|רביעייה|שמינייה|ארגז|זוג|שלישייה|עשירייה/);
  await openSort(page);
  await expect(page.getByRole("link", { name: "בודדים", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "שישיות", exact: true })).toBeVisible();
  await expect(page.getByText("מארזים")).toHaveCount(0);
  // …and the single is still one tap away, on the beer's page, under בודדים.
  await page.goto("/beer/goldstar");
  await expect(page.locator("section[data-pack-section='single']")).toContainText("₪5.90");
});

test("Home: when none of my beers has a pack or case deal, it says exactly that", async ({ page }) => {
  const quiet = await sql<{ name_he: string }>(
    `select name_he from public.beers b where b.is_active and b.category = 'beer'
       and not exists (select 1 from public.offers_feed o where o.beer_id = b.id and coalesce(o.pack_quantity, 2) >= 2)
       and not exists (select 1 from public.group_offers_feed g where b.id = any(g.beer_ids))
     order by b.sort_order limit 4`,
  );
  expect(quiet).toHaveLength(4);
  await onboard(page, "שקטה", quiet.map((b) => b.name_he));
  await expect(page.getByText("אין כרגע מבצעי שישיות או ארגזים לבירות שלך")).toBeVisible();
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
  // Folded by default: one control that names the active order.
  await expect(page.locator("details.sort-panel > summary").first()).toContainText("הכי משתלם");
  await expect(page.getByRole("link", { name: "מהזול ליקר" })).toBeHidden();
  await openSort(page);
  await page.getByRole("link", { name: "מהזול ליקר" }).click();
  await expect(page).toHaveURL(/sort=price_asc/);

  // The strip, not the headline card above it (which carries the same beer's name).
  const goldstar = page
    .locator("section", { has: page.getByRole("heading", { level: 2, name: "גולדסטאר" }) })
    .filter({ hasNot: page.locator("#hero-title") });
  const ascending = await pricesIn(goldstar);
  expect(ascending.length).toBeGreaterThan(1);
  expect(ascending).toEqual([...ascending].sort((a, b) => a - b));

  await expect(page.locator("details.sort-panel > summary").first()).toContainText("מהזול ליקר");
  await openSort(page);
  await page.getByRole("link", { name: "מהיקר לזול" }).click();
  await expect(page).toHaveURL(/sort=price_desc/);
  const descending = await pricesIn(goldstar);
  expect(descending).toEqual([...descending].sort((a, b) => b - a));

  await page.reload();
  await expect(page).toHaveURL(/sort=price_desc/);
  await openSort(page);
  await expect(page.getByRole("link", { name: "מהיקר לזול" })).toHaveAttribute("aria-current", "true");
});

/** A beer's or chain's page: one section per kind of pack (שישיות, ארגזים, בודדים), deals then regular prices in each. */
const kind = (page: Page, k: "small_multipack" | "case" | "single") => page.locator(`section[data-pack-section='${k}']`);
const dealsPart = (page: Page, k: "small_multipack" | "case" | "single" = "small_multipack") => kind(page, k).locator("[data-part='deals']");
const regularPart = (page: Page, k: "small_multipack" | "case" | "single" = "small_multipack") => kind(page, k).locator("[data-part='regular']");
const strip = (part: ReturnType<Page["locator"]>, name: string) => part.locator("section", { has: part.page().getByRole("heading", { level: 4, name }) });

test("Beer page: every pack is its own strip and a chain's 6×500 price never sits among the 6×330s", async ({ page }) => {
  await onboard(page);
  await page.goto("/beer/goldstar");

  for (const pack of ["שישייה · 6×330 מ״ל · פחית", "שישייה · 6×500 מ״ל · פחית"]) {
    await expect(dealsPart(page).getByRole("heading", { level: 4, name: pack }), pack).toBeVisible();
  }
  await expect(dealsPart(page, "case").getByRole("heading", { level: 4, name: "ארגז · 24×330 מ״ל · פחית" })).toBeVisible();

  const small = strip(dealsPart(page), "שישייה · 6×330 מ״ל · פחית");
  await expect(small).toContainText("₪25.00");
  // Shufersal's ₪29.90 on this pack is a club price: not for everyone, so never shown (0014).
  await expect(small).not.toContainText("₪29.90");
  await expect(small).not.toContainText("₪40.00");

  const mid = strip(dealsPart(page), "שישייה · 6×500 מ״ל · פחית");
  await expect(mid).toContainText("₪40.00");
  await expect(mid).toContainText("2 ב־₪80"); // the multi-buy terms travel with the price
  await expect(mid).not.toContainText("₪25.00");
});

test("Beer page: the pack filter narrows to one kind of pack and stays in the URL", async ({ page }) => {
  await onboard(page);
  await page.goto("/beer/goldstar");
  await openSort(page);
  await page.getByRole("link", { name: "ארגזים" }).click();
  await expect(page).toHaveURL(/pack=case/);
  await expect(dealsPart(page, "case").getByRole("heading", { level: 4, name: "ארגז · 24×330 מ״ל · פחית" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 4, name: "שישייה · 6×330 מ״ל · פחית" })).toHaveCount(0);
  await expect(kind(page, "small_multipack")).toHaveCount(0);
});

test("Beer page: שישיות, then ארגזים, then בודדים — deals before regular prices in each, one sort orders both", async ({ page }) => {
  await onboard(page);
  await page.goto("/beer/goldstar");
  const sections = page.getByRole("heading", { level: 2 }).filter({ hasText: /^(שישיות|ארגזים|בודדים)$/ });
  const names = await sections.allInnerTexts();
  expect(names).toEqual(["שישיות", "ארגזים", "בודדים"].filter((n) => names.includes(n)));
  expect(names[0]).toBe("שישיות");
  // Inside a kind: the deals, then the regular prices — never mixed.
  const parts = await kind(page, "small_multipack").locator("[data-part]").evaluateAll((els) => els.map((el) => el.getAttribute("data-part")));
  expect(parts).toEqual(["deals", "regular"]);
  // No "מארזים" anywhere.
  await openSort(page);
  await expect(page.getByText("מארזים")).toHaveCount(0);

  const small = strip(regularPart(page), "שישייה · 6×330 מ״ל · פחית");
  expect(await pricesIn(small)).toEqual([3690, 3790, 3890, 3990]);
  await page.getByRole("link", { name: "מהיקר לזול" }).click();
  await expect(page).toHaveURL(/sort=price_desc/);
  expect(await pricesIn(strip(regularPart(page), "שישייה · 6×330 מ״ל · פחית"))).toEqual([3990, 3890, 3790, 3690]);
  // A regular price is not dressed up as a saving.
  await expect(small.getByText(/−\d+%/)).toHaveCount(0);
});

test("Store page: 'my beers' keeps to the four, in order, by kind of pack — and names any with nothing here", async ({ page }) => {
  await onboard(page);
  await page.goto("/store/rami-levy");
  await page.getByRole("link", { name: "הבירות שלי" }).click();
  await expect(page).toHaveURL(/mine=1/);

  const mine = /^(גולדסטאר|מכבי|היינקן|קורונה)$/;
  const beersShown = await page.getByRole("heading", { level: 4 }).allInnerTexts();
  expect(beersShown.length).toBeGreaterThan(0);
  for (const name of beersShown) expect(name).toMatch(mine);
  // Inside each part the favourites keep the person's order.
  const order = ["גולדסטאר", "מכבי", "היינקן", "קורונה"];
  for (const part of await page.locator("[data-part]").all()) {
    const names = (await part.getByRole("heading", { level: 4 }).allInnerTexts()).map((n) => order.indexOf(n));
    expect(names).toEqual([...names].sort((a, b) => a - b));
  }
  // A favourite with nothing at all here is still named, plainly.
  for (const name of order.filter((n) => !beersShown.includes(n))) {
    await expect(page.getByText(`לא ראינו את ${name} ברמי לוי`)).toBeVisible();
  }
});

test("A deal line says, on the line itself, the regular price it is measured against and where that comes from", async ({ page }) => {
  await onboard(page);
  await page.goto("/beer/goldstar");
  const line = page.locator("article", { hasText: "₪25.00" }).first();
  await expect(line.getByText(/במקום/)).toBeVisible();
  await expect(line.locator("s")).toHaveText("₪37.90");
  await expect(line).toContainText("המחיר הרגיל, אושר על ידי מנהל"); // read out to screen readers
  await expect(line.getByText("−34%")).toBeVisible();
  // One unit per deal: nothing to unfold on an ordinary line.
  await expect(line.locator("summary")).toHaveCount(0);
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
