import { expect, test, type Page } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { onboard } from "./helpers";

/**
 * The 0.8.0 and 0.9.0 product rules, checked on REAL feed data: the app running against the STAGING project
 * (docs/STAGING.md), at 390×844 and 430×932. Read-only apart from the one anonymous person each run
 * onboards (staging data only; never production).
 *
 *   E2E_STAGING=1 E2E_BASE_URL=http://localhost:3300 PW_CHANNEL=chrome npx playwright test
 *
 * Skipped in the ordinary run (which uses the local fake database).
 */
test.skip(!process.env.E2E_STAGING, "needs the app running against staging (E2E_STAGING=1, E2E_BASE_URL)");
test.describe.configure({ mode: "serial" });

/** Words that name a pack of 2 or more — every line on Home must carry one (no singles on Home). */
const PACK_WORD = /שישייה|רביעייה|שמינייה|ארגז|זוג|שלישייה|חמישייה|עשירייה|מארז \d/;
const CHAINS = ["rami-levy", "shufersal", "carrefour", "yeinot-bitan", "victory", "mahsanei", "osher-ad", "tiv-taam", "yochananof", "hatzi-hinam", "ampm", "keshet-taamim", "fresh-market", "stop-market", "politzer"];

/**
 * Chains the latest scan could not read at all (no branch published a current file — Osher Ad before it publishes
 * the day's files), from the coverage report (`node scripts/ingest/coverage.mjs`). Their pages must show the
 * designed empty states, not rows; every other chain must show rows.
 */
function chainsNotReadToday(): Set<string> {
  const dir = ".ingest-cache/scans";
  const report = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith("-coverage.json")).sort().pop() : undefined;
  if (!report) return new Set();
  const { rows } = JSON.parse(readFileSync(`${dir}/${report}`, "utf8")) as { rows: Array<{ slug: string; checked: number }> };
  return new Set(rows.filter((r) => r.checked === 0).map((r) => r.slug));
}

let page: Page;
const shots: string[] = [];
const shot = async (name: string) => {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  shots.push(path);
};

/** Nothing wider than the screen, and the bottom bar is there. */
async function layoutHolds(route: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${route}: horizontal overflow`).toBeLessThanOrEqual(1);
  await expect(page.getByRole("navigation", { name: "ניווט ראשי" }), route).toBeVisible();
  await expect(page.locator("html"), route).toHaveAttribute("dir", "rtl");
}

test.beforeAll(async ({ browser }, info) => {
  const context = await browser.newContext({ ...info.project.use });
  page = await context.newPage();
  await onboard(page, "בודקת", ["גולדסטאר", "היינקן", "קרלסברג", "מכבי"]);
});

test("Home: packs and cases only — never a single can — the person's beers first", async () => {
  await page.goto("/");
  await layoutHolds("/");
  await shot("home");
  const lines = page.locator("main article");
  const count = await lines.count();
  expect(count, "Home lists deals from the real feeds").toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const title = await lines.nth(i).innerText();
    expect(title, `Home line ${i}`).toMatch(PACK_WORD);
  }
  const hero = page.locator("section", { has: page.locator("#hero-title") });
  if (await hero.count()) expect(await hero.innerText()).toMatch(PACK_WORD);
  // The categories on offer here: never singles, never "מארזים".
  await page.locator("details.sort-panel > summary").first().click();
  await expect(page.getByRole("link", { name: "בודדים", exact: true })).toHaveCount(0);
  await expect(page.getByText("מארזים")).toHaveCount(0);
  // The four beers: bottle, small rank, name — no cards.
  const keys = page.getByRole("list", { name: "הבירות שלי, לפי הסדר" }).getByRole("listitem");
  await expect(keys).toHaveCount(4);
  for (const [i, rank] of ["#1", "#2", "#3", "#4"].entries()) await expect(keys.nth(i)).toContainText(rank);
  await expect(keys.nth(0).locator("img[data-bottle-photo='goldstar']")).toBeVisible();
  await expect(page.locator("[aria-label='הבירות שלי, לפי הסדר'] .tape")).toHaveCount(0);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "goldstar");
});

test("Beer pages: שישיות → ארגזים → בודדים, deals before regular prices, and every pack named by its real count", async () => {
  for (const slug of ["goldstar", "heineken", "carlsberg", "corona", "krombacher"]) {
    await page.goto(`/beer/${slug}`);
    await layoutHolds(`/beer/${slug}`);
    await shot(`beer-${slug}`);
    const kinds = await page.locator("section[data-pack-section]").evaluateAll((els) => els.map((el) => el.getAttribute("data-pack-section")));
    const order = ["small_multipack", "case", "single"];
    expect(kinds, slug).toEqual(order.filter((k) => kinds.includes(k)));
    for (const section of await page.locator("section[data-pack-section]").all()) {
      const parts = await section.locator("[data-part]").evaluateAll((els) => els.map((el) => el.getAttribute("data-part")));
      expect(parts.indexOf("deals"), `${slug}: deals first`).toBe(0);
    }
    for (const heading of await page.getByRole("heading", { level: 4 }).allInnerTexts()) {
      if (/(^|\s)4×/.test(heading)) expect(heading, heading).toContain("רביעייה");
      if (/(^|\s)6×/.test(heading)) expect(heading, heading).toContain("שישייה");
      if (/(^|\s)8×/.test(heading)) expect(heading, heading).toContain("שמינייה");
      expect(heading).not.toMatch(/שישייה · [48]×/);
    }
    // Inside שישיות: six-packs before eights before fours (the default order).
    const packs = await page.locator("section[data-pack-section='small_multipack'] [data-part='deals'] h4").allInnerTexts();
    const rank = (t: string) => (/ 6×/.test(` ${t}`) ? 0 : / 8×/.test(` ${t}`) ? 1 : / 4×/.test(` ${t}`) ? 2 : 3);
    const ranks = packs.map(rank);
    expect(ranks, `${slug}: 6 → 8 → 4`).toEqual([...ranks].sort((a, b) => a - b));
  }
});

test("Chain pages: every chain with a feed shows its deals and regular prices, by kind, on real data", async () => {
  test.setTimeout(240_000); // fifteen pages, each a round trip to the remote staging database
  const notRead = chainsNotReadToday();
  for (const slug of CHAINS) {
    const response = await page.goto(`/store/${slug}`);
    expect(response!.status(), slug).toBe(200);
    await layoutHolds(`/store/${slug}`);
    const deals = await page.locator("[data-part='deals'] article").count();
    const regular = await page.locator("[data-part='regular'] article").count();
    if (notRead.has(slug)) {
      expect(deals + regular, `${slug}: not read today, so no rows`).toBe(0);
      await expect(page.getByText("אין כרגע מבצעים ברשת הזו"), slug).toBeVisible();
    } else {
      expect(deals + regular, `${slug}: rows on the page`).toBeGreaterThan(0);
    }
    await expect(page.getByText("משהו השתבש")).toHaveCount(0);
    if (["rami-levy", "victory", "yochananof"].includes(slug)) await shot(`store-${slug}`);
  }
});

test("Sort and filter: one control; שישיות / ארגזים / בודדים and four sorts; no מארזים", async () => {
  await page.goto("/beer/goldstar");
  await page.locator("details.sort-panel > summary").first().click();
  await shot("sort-panel");
  for (const name of ["הכי משתלם", "מהזול ליקר", "מהיקר לזול", "שישיות"]) {
    await expect(page.getByRole("link", { name, exact: true }), name).toBeVisible();
  }
  await expect(page.getByRole("link", { name: /^לליטר/ })).toBeVisible(); // its name adds what it compares, for screen readers
  await expect(page.getByText("מארזים")).toHaveCount(0);
  await page.getByRole("link", { name: "שישיות", exact: true }).click();
  await expect(page).toHaveURL(/pack=small_multipack/);
  await expect(page.locator("section[data-pack-section]")).toHaveCount(1);
});

test("A regular user: no What's New anywhere, the page refuses, and 'share with friends' copies the production link", async ({}, info) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /מה חדש/ })).toHaveCount(0);
  await page.goto("/settings");
  await layoutHolds("/settings");
  await shot("settings");
  await expect(page.getByRole("link", { name: /מה חדש/ })).toHaveCount(0);
  const response = await page.goto("/whats-new");
  expect(response!.status()).toBe(404);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: info.project.use.baseURL });
  await page.goto("/");
  await page.evaluate(() => Object.defineProperty(navigator, "share", { value: undefined, configurable: true }));
  const share = page.getByRole("button", { name: "אהבתם? שתפו לחברים" });
  await share.scrollIntoViewIfNeeded();
  expect((await share.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await share.click();
  await expect(page.getByText("הקישור הועתק")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://beer-deals.vercel.app");
  await shot("share-copied");
});

test("Settings: the four beers stand on the counter — bottle, rank, name — drag and the keyboard both reorder, and the look follows #1 at once", async () => {
  await page.goto("/settings");
  const first = page.locator("li[data-rank='1']");
  await expect(first).toContainText("#1");
  await expect(first.locator("img[data-bottle-photo='goldstar']")).toBeVisible();
  await page.getByRole("button", { name: "העלו את היינקן מקום אחד" }).click();
  // Three sections carry a "שמירה" now (beers, credit, place): name the one you mean.
  await page.getByRole("region", { name: "הבירות שלי" }).getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "heineken");
  await shot("settings-heineken");
  for (const route of ["/", "/beer/goldstar", "/store/rami-levy"]) {
    await page.goto(route);
    await expect(page.locator("body"), route).toHaveAttribute("data-theme", "heineken");
    await expect(page.locator(".bottle-stage[data-beer='goldstar']"), `${route}: stale bottle`).toHaveCount(0);
  }
  // Put it back, the other way: drag Goldstar to the top.
  await page.goto("/settings");
  const grip = page.locator("[data-grip='goldstar']");
  const from = (await grip.boundingBox())!;
  const to = (await page.locator("li[data-rank='1']").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + ((to.y - from.y) * step) / 8);
  await page.mouse.up();
  await expect(page.locator("li[data-rank='1']")).toContainText("גולדסטאר");
  await page.getByRole("region", { name: "הבירות שלי" }).getByRole("button", { name: "שמירה" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "goldstar");
});

test("0.9.0: every chain deal says where it runs; 'בכל הרשת' only where every known branch was checked; the sheet lists branches", async () => {
  test.setTimeout(240_000);
  let opened = false;
  for (const slug of ["rami-levy", "shufersal", "tiv-taam", "stop-market", "yochananof"]) {
    await page.goto(`/store/${slug}`);
    await layoutHolds(`/store/${slug}`);
    const deals = page.locator("[data-part='deals'] article");
    const n = await deals.count();
    for (let i = 0; i < n; i++) {
      const scope = deals.nth(i).locator("[data-scope]");
      await expect(scope, `${slug} deal ${i} states its scope`).toHaveCount(1);
    }
    // Never "מבצעי שילוב"; mix-and-match says what the shopper does.
    await expect(page.getByText("מבצעי שילוב")).toHaveCount(0);
    if (await page.locator("[data-part='deals']").getByText("לבחירה מהמוצרים שבמבצע").count()) {
      await expect(page.getByRole("heading", { name: "קונים כמה, בוחרים מהמבצע" }).first()).toBeVisible();
    }
    const sheet = page.locator("[data-part='deals'] details[data-scope] summary").first();
    if (!opened && (await sheet.count())) {
      expect((await sheet.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await sheet.click();
      const list = page.getByRole("list", { name: "הסניפים שבהם נמצא המבצע" }).first();
      await expect(list.getByRole("listitem").first()).toBeVisible({ timeout: 20_000 });
      await shot(`scope-sheet-${slug}`);
      opened = true;
    }
  }
  expect(opened, "at least one deal's branch list opened").toBe(true);
});

test("0.9.0: a beer page shows each promotion once, however many branches list it", async () => {
  for (const slug of ["goldstar", "maccabee", "carlsberg", "corona", "heineken"]) {
    await page.goto(`/beer/${slug}`);
    await shot(`beer-scope-${slug}`);
    // The same chain, pack, price and scope twice in one strip would be a duplicate of one promotion. Each strip
    // is one pack (its h4 title): one promotion that covers two products — Carrefour's "גולדסטאר / גולדסטאר UF
    // רביעייה" — is rightly one line under each product's own strip, never twice under the same one.
    const lines = await page.locator("[data-part='deals'] article").evaluateAll((els) =>
      els.map((el) => {
        let strip: Element | null = el.parentElement;
        while (strip && !strip.querySelector("h4")) strip = strip.parentElement;
        const pack = strip?.querySelector("h4")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        return `${pack} ⟶ ${el.textContent?.replace(/\s+/g, " ").trim() ?? ""}`;
      }),
    );
    expect(lines.length, `${slug}: deal lines`).toBeGreaterThan(0);
    expect(lines.filter((l, i) => lines.indexOf(l) !== i), `${slug}: duplicate deal lines`).toEqual([]);
  }
});
