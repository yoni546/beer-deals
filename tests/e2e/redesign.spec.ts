import { expect, test, type Page } from "@playwright/test";
import { onboard, resetDb, revalidateAppCaches, seedDeals, seedRealCatalog, sql } from "./helpers";

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
  const keys = page.getByRole("list", { name: "הבירות שלי, לפי הסדר" }).getByRole("listitem");
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
  const numberOne = page.getByRole("list", { name: "הבירות שלי, לפי הסדר" }).getByRole("listitem").first();
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
  await expect(dealsPart(page, "case").getByRole("heading", { level: 4, name: "ארגז · 24×330 מ״ל · בקבוק" })).toBeVisible();

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
  await expect(dealsPart(page, "case").getByRole("heading", { level: 4, name: "ארגז · 24×330 מ״ל · בקבוק" })).toBeVisible();
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
  // One unit per deal: nothing to unfold on an ordinary line -- bar the two
  // disclosures that are on every line by design, the branch list (data-scope) and
  // "הייתם שם?" (data-feedback, 0031).
  await expect(line.locator("details:not([data-feedback]):not([data-scope])")).toHaveCount(0);
});

test.describe("settings", () => {
  /** The two forms on /settings both have a "שמירה"; name the section you mean. */
  const section = (page: Page, name: string) => page.getByRole("region", { name });

  test("changing the order of the four beers changes what Home puts first, and the theme follows the new number one", async ({ page }) => {
    await onboard(page); // גולדסטאר, מכבי, היינקן, קורונה
    await expect(page.locator("body")).toHaveAttribute("data-theme", "goldstar");

    await page.goto("/settings");
    await page.getByRole("button", { name: "העלו את מכבי מקום אחד" }).click();
    await section(page, "הבירות שלי").getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toBeVisible();
    await expect(page.locator("body")).toHaveAttribute("data-theme", "maccabee");

    await page.goto("/");
    const keys = page.getByRole("list", { name: "הבירות שלי, לפי הסדר" }).getByRole("listitem");
    await expect(keys.nth(0)).toContainText("מכבי");
    await expect(keys.nth(1)).toContainText("גולדסטאר");
  });

  // 0024: between one and four. Removing one is a complete, saveable state in its own
  // right — it used to disable the save until a fourth was put back.
  test("a beer can be removed and saved, or swapped for another", async ({ page }) => {
    await onboard(page);
    await page.goto("/settings");

    await page.getByRole("button", { name: "הסירו את קורונה" }).click();
    await expect(section(page, "הבירות שלי").getByRole("button", { name: "שמירה" })).toBeEnabled(); // three is a choice
    await page.getByRole("button", { name: /^\s*טובורג\s*$/ }).click();
    await section(page, "הבירות שלי").getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toBeVisible();

    await page.goto("/");
    await expect(page.getByRole("list", { name: "הבירות שלי, לפי הסדר" })).toContainText("טובורג");
    await expect(page.getByRole("list", { name: "הבירות שלי, לפי הסדר" })).not.toContainText("קורונה");
  });

  // 0026: the place is editable after onboarding, through the same picker the first run uses.
  test("where I live and how far I will go can be changed later", async ({ page }) => {
    await onboard(page);
    await page.goto("/settings");

    const field = page.getByPlaceholder("תל אביב, חיפה, באר שבע…");
    await expect(field).toBeVisible();
    await field.fill("חיפה");
    await page.getByRole("button", { name: "חיפה", exact: true }).click();
    await page.getByRole("button", { name: "עד 25 ק״מ" }).click();

    await section(page, "איפה אני").getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toBeVisible();

    // And it is still there on the next visit.
    await page.reload();
    await expect(page.getByPlaceholder("תל אביב, חיפה, באר שבע…")).toHaveValue("חיפה");
    await expect(page.getByRole("button", { name: "עד 25 ק״מ" })).toHaveAttribute("aria-pressed", "true");
  });

  test("the last beer cannot be removed: one is the minimum", async ({ page }) => {
    await onboard(page);
    await page.goto("/settings");

    for (const beer of ["קורונה", "היינקן", "מכבי"]) {
      await page.getByRole("button", { name: `הסירו את ${beer}` }).click();
    }
    // One left, and no way to reach zero — a form that could would only fail at the database.
    await expect(page.getByRole("button", { name: /^הסירו את/ })).toHaveCount(0);
    await section(page, "הבירות שלי").getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toBeVisible();

    await page.goto("/");
    await expect(page.getByRole("list", { name: "הבירות שלי, לפי הסדר" }).getByRole("listitem")).toHaveCount(1);
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

// "Closest to me" vs "Best deal": the control the V2 brief calls out as important.
// It is a per-search choice, so it lives in the URL and never in the profile — and
// where it cannot do what its label promises, it says so instead of reordering.
test("the intent control is in the URL, not in the profile", async ({ page }) => {
  await onboard(page);

  const control = page.getByRole("navigation", { name: "מה מחפשים עכשיו" });
  await expect(control.getByRole("link", { name: "הכי משתלם" })).toHaveAttribute("aria-current", "page");

  await control.getByRole("link", { name: "הכי קרוב אליי" }).click();
  await expect(page).toHaveURL(/intent=near/);
  await expect(control.getByRole("link", { name: "הכי קרוב אליי" })).toHaveAttribute("aria-current", "page");

  // A shared link reproduces it, and going back to best clears it from the address.
  await page.goto("/?intent=near");
  await expect(page.getByRole("navigation", { name: "מה מחפשים עכשיו" }).getByRole("link", { name: "הכי קרוב אליי" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "הכי משתלם" }).click();
  await expect(page).not.toHaveURL(/intent=near/);
});

test("'closest to me' asks for a place when it has none, instead of pretending to sort", async ({ page }) => {
  await onboard(page); // the default walk skips the place step
  await page.goto("/?intent=near");

  await expect(page.getByText("לא סיפרתם לנו איפה אתם")).toBeVisible();
  await expect(page.getByRole("link", { name: "להגדרת היישוב" })).toBeVisible();
  // And it does NOT quietly show a list in some other order under this label.
  await expect(page.getByRole("heading", { name: "הכי קרוב אליך" })).toHaveCount(0);
});

test("with a place but no located branches, it says that — it does not invent distances", async ({ page }) => {
  await onboard(page);

  await page.goto("/settings");
  await page.getByPlaceholder("תל אביב, חיפה, באר שבע…").fill("תל אביב");
  await page.getByRole("link", { name: "תל אביב-יפו" }).or(page.getByRole("button", { name: "תל אביב-יפו" })).first().click();
  await page.getByRole("button", { name: "עד 25 ק״מ" }).click();
  await page.getByRole("region", { name: "איפה אני" }).getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toBeVisible();

  await page.goto("/?intent=near");
  // Migration 0026 shipped the branch coordinates deliberately empty: no provider, no
  // guesses. The screen says exactly that rather than showing an order it cannot justify.
  await expect(page.getByText("עוד אין לנו את המיקומים של הסניפים")).toBeVisible();
  await expect(page.getByRole("heading", { name: "הכי קרוב אליך" })).toHaveCount(0);
});

// Phase J/K: who found the deal, and the people who find them.
test("the hunters page explains the score and says plainly when nobody qualifies yet", async ({ page }) => {
  await onboard(page);
  await page.goto("/hunters");

  await expect(page.getByRole("heading", { name: "ציידי המבצעים" })).toBeVisible();
  await expect(page.getByText("עוד אין ציידים")).toBeVisible();

  // A leaderboard nobody understands is a ranking of strangers, so the rules are on the page.
  await expect(page.getByRole("heading", { name: "איך נספר הניקוד" })).toBeVisible();
  await expect(page.getByText(/שני דיווחים טובים שווים יותר ממאה דיווחים שלא/)).toBeVisible();
});

test("choosing a name credits the deals you already found, and puts you on the board", async ({ page }) => {
  await onboard(page);

  // A deal this person submitted, already approved.
  const [me] = await sql<{ id: string }>("select id from public.profiles order by created_at desc limit 1");
  await sql(
    `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by, approved_by, approved_at)
     select b.id, s.id, 'sixpack', 2490, 3990, 'approved', $1::uuid, $1::uuid, now()
       from public.beers b, public.stores s where b.slug = 'goldstar' and s.slug = 'rami-levy'`,
    [me.id],
  );

  // Nobody is credited until they ask to be.
  await page.goto("/hunters");
  await expect(page.getByText("עוד אין ציידים")).toBeVisible();

  await page.goto("/settings");
  await page.getByLabel("השם שיוצג על מבצעים שמצאתם").fill("יוני");
  await page.getByRole("region", { name: "הקרדיט שלי" }).getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toBeVisible();

  // Naming yourself picks up what you already submitted.
  await page.goto("/hunters");
  await expect(page.getByRole("listitem").filter({ hasText: "יוני" })).toBeVisible();

  // The chain the credit travels along, asserted where it can actually be seen to break.
  const [row] = await sql<{ display_name: string; approved: number }>(
    "select display_name, approved from public.contributors",
  );
  expect(row, "nobody was recorded as a contributor").toBeDefined();
  expect(row.approved, "the trigger did not count the approved deal").toBe(1);

  const [feed] = await sql<{ offer_key: string; origin: string }>(
    "select offer_key, origin from public.offers_feed where origin = 'legacy' limit 1",
  );
  expect(feed, "the submitted deal never reached offers_feed").toBeDefined();

  // And the deal itself now says who found it. On the beer's own page, which shows
  // every deal — Home's strips cap at three, and this one need not be in the top three.
  await page.goto("/beer/goldstar");
  await expect(page.getByText("דווח על ידי יוני").first()).toBeVisible();
});

test("the credit can be taken back", async ({ page }) => {
  await onboard(page);
  await page.goto("/settings");

  const field = page.getByLabel("השם שיוצג על מבצעים שמצאתם");
  const save = page.getByRole("region", { name: "הקרדיט שלי" }).getByRole("button", { name: "שמירה" });

  // A name of this test's own, so the assertion is about this person and not about
  // whatever another test left behind.
  await field.fill("דנה-בדיקה");
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toBeVisible();
  expect(await sql("select 1 from public.contributors where display_name = 'דנה-בדיקה'")).toHaveLength(1);

  await field.fill("");
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "השם הוסר" })).toBeVisible();

  // Taken back means the row is gone, not blanked.
  expect(await sql("select 1 from public.contributors where display_name = 'דנה-בדיקה'")).toHaveLength(0);
});

// Phase V: "המבצע עדיין קיים" / "המבצע נגמר", on a CHAIN offer — the case that had no
// report path at all before 0031, in the UI or in the schema.
test("anyone can say a chain offer has ended, and what people said reaches the next person", async ({ page }) => {
  await onboard(page);
  await page.goto("/beer/goldstar");

  const line = page.locator("article").filter({ hasText: "הייתם שם?" }).first();
  await line.getByText("הייתם שם?").click();
  await line.getByRole("button", { name: "המבצע נגמר" }).click();

  // The wording matters: pressing it must not look like it deleted anything.
  await expect(line.getByText("לא הסרנו כלום")).toBeVisible();

  // It is a catalogue offer, not a `deals` row — the thing that used to be impossible.
  const [said] = await sql<{ offer_key: string; verdict: string }>(
    "select offer_key, verdict from public.offer_feedback",
  );
  expect(said, "nothing was recorded").toBeDefined();
  expect(said.offer_key.startsWith("obs:"), `expected a chain offer, got ${said.offer_key}`).toBe(true);
  expect(said.verdict).toBe("ended");

  // One tap says nothing to anybody else. That is the whole rule.
  await page.reload();
  await expect(page.getByText("משתמשים מדווחים שהמבצע נגמר")).toHaveCount(0);

  // Two more strangers agree, and now the line says so — still showing the offer,
  // because this is a label and not a deletion.
  await sql(
    "insert into auth.users (id, email) values (gen_random_uuid(), 'a@example.test'), (gen_random_uuid(), 'b@example.test')",
  );
  await sql(
    `insert into public.offer_feedback (offer_key, verdict, reported_by)
     select $1, 'ended', u.id from auth.users u where u.email in ('a@example.test', 'b@example.test')`,
    [said.offer_key],
  );
  // Written behind the app's back, so ring the same doorbell an import does.
  await revalidateAppCaches();

  await page.goto("/beer/goldstar");
  await expect(page.getByText("משתמשים מדווחים שהמבצע נגמר").first()).toBeVisible();
  await expect(line).toBeVisible();
});

// Phase O/N: following a beer beyond the four favourites, at a price of your own.
test("a beer can be followed at your own price, and it shows up in Settings", async ({ page }) => {
  await onboard(page); // גולדסטאר, מכבי, היינקן, קורונה

  // A beer that is NOT one of the four: the thing the app could not do before.
  await page.goto("/beer/carlsberg");
  await page.getByRole("button", { name: /עקבו אחרי/ }).click();
  await page.getByLabel("להודיע לי כשהמחיר מתחת ל־ (רשות)").fill("24.90");
  await page.getByRole("region", { name: "מעקב" }).getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByText("נודיע לכם כשהמחיר יגיע לשם.")).toBeVisible();
  await expect(page.getByText(/עוקבים · נודיע מתחת ל/)).toBeVisible();

  // It is on record, with the price in agorot.
  const [row] = await sql<{ max_price_agorot: number }>("select max_price_agorot from public.watchlist");
  expect(row.max_price_agorot).toBe(2490);

  // And Settings lists it, with a way out.
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "בירות שאני עוקב אחריהן" });
  await expect(section.getByText("קרלסברג")).toBeVisible();
  await expect(section.getByText(/נודיע מתחת ל/)).toBeVisible();
  await section.getByRole("button", { name: "הסרה" }).click();
  await expect(page.getByText("הפסקנו לעקוב.")).toBeVisible();
  expect(await sql("select 1 from public.watchlist")).toHaveLength(0);
});

test("following with no price is a real choice, and the app says what it means", async ({ page }) => {
  await onboard(page);
  await page.goto("/beer/carlsberg");
  await page.getByRole("button", { name: /עקבו אחרי/ }).click();

  // Empty is not a mistake: it means "the same rules as my number one", and the
  // copy says so before the button is pressed.
  await expect(page.getByText(/בלי מחיר — נודיע לכם על מבצע חזק/)).toBeVisible();
  await page.getByRole("region", { name: "מעקב" }).getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByText("כמו על הבירה הראשית שלכם.")).toBeVisible();

  const [row] = await sql<{ max_price_agorot: number | null }>("select max_price_agorot from public.watchlist");
  expect(row.max_price_agorot).toBeNull();
});

// Phase W: trust is context and weight — never authority, and said as a record.
test("standing is shown to the person it belongs to, and says exactly what it does", async ({ page }) => {
  await onboard(page);

  // Nothing before a name is chosen: no row exists, and inventing one would be a
  // label nobody asked for.
  await page.goto("/settings");
  const credit = page.getByRole("region", { name: "הקרדיט שלי" });
  await expect(credit.getByText(/נקודות/)).toHaveCount(0);

  const [me] = await sql<{ id: string }>("select id from public.profiles order by created_at desc limit 1");
  await sql(
    `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by, approved_by, approved_at)
     select b.id, s.id, 'sixpack', 2490, 3990, 'approved', $1::uuid, $1::uuid, now()
       from public.beers b, public.stores s where b.slug = 'goldstar' and s.slug = 'rami-levy'`,
    [me.id],
  );

  await credit.getByLabel("השם שיוצג על מבצעים שמצאתם").fill("יוני");
  await credit.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("אתם בתחילת הדרך")).toBeVisible();
  // The only thing standing does, said plainly. No rank, no badge, and nothing that
  // reads like permission.
  await expect(page.getByText(/ייחשב יותר/)).toBeVisible();
  await expect(page.getByText("1 מבצע שלכם אושר")).toBeVisible();
});

// Phase P: Home tells you about the price you asked to be told about.
test("Home leads with a followed beer that reached your price, and only then with its own picks", async ({ page }) => {
  await onboard(page); // גולדסטאר, מכבי, היינקן, קורונה

  // Nothing before anything is followed: no empty frame about nothing happening.
  await page.goto("/");
  await expect(page.getByRole("region", { name: /המחיר/ })).toHaveCount(0);

  // Follow a beer that is NOT a favourite, at a price the seeded catalogue beats.
  await page.goto("/beer/carlsberg");
  await page.getByRole("button", { name: /עקבו אחרי/ }).click();
  await page.getByLabel("להודיע לי כשהמחיר מתחת ל־ (רשות)").fill("500");
  await page.getByRole("region", { name: "מעקב" }).getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByText(/נודיע לכם כשהמחיר יגיע לשם/)).toBeVisible();

  await page.goto("/");
  const section = page.getByRole("region", { name: /המחיר/ });
  await expect(section).toBeVisible();
  // The claim is checkable: it says which price was reached.
  await expect(section.getByText(/ביקשתם מתחת ל/)).toBeVisible();
  await expect(section.getByText("קרלסברג").first()).toBeVisible();

  // It is above the person's own four beers, because they asked for this one.
  const order = await page.evaluate(() => {
    const names = [...document.querySelectorAll("h2")].map((h) => h.textContent?.trim() ?? "");
    return { watch: names.findIndex((n) => n.includes("המחיר")), mine: names.indexOf("הבירות שלי") };
  });
  expect(order.watch).toBeGreaterThanOrEqual(0);
  expect(order.watch).toBeLessThan(order.mine);

  // And it goes away when the follow does.
  await page.goto("/settings");
  await page.getByRole("region", { name: "בירות שאני עוקב אחריהן" }).getByRole("button", { name: "הסרה" }).click();
  await expect(page.getByText("הפסקנו לעקוב.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("region", { name: /המחיר/ })).toHaveCount(0);
});
