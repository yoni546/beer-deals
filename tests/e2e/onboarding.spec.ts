import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { NO_IDENTITY_BEER, addBeerWithoutIdentity, floorViolations, resetDb, seedRealCatalog } from "./helpers";

/**
 * First run (0.10.0): a name, four beers, their order, and the moment #1 becomes the app — under a
 * stage of the bottles themselves. The motion is decoration: these specs prove the flow works the
 * same with it, without it, and while it is still running.
 *
 * ONBOARDING_SHOTS=<dir> also saves a screenshot of every step (for the pull request).
 */
test.beforeAll(async () => {
  await resetDb();
  await seedRealCatalog();
  await addBeerWithoutIdentity();
});

const SHOTS = process.env.ONBOARDING_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const { width } = page.viewportSize()!;
  await page.screenshot({ path: `${SHOTS}/${width}-${name}.png` });
}

const stage = (page: Page) => page.locator(".ob-stage");
const head = (page: Page) => page.locator(".ob-item[data-rank='0']");
const ground = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ground").trim());
const pick = (page: Page, beer: string) => page.locator("button[aria-pressed]", { hasText: beer }).first().click();
/** How far the beer has risen in the glass: 140 = empty, 44 = full (the SVG's own units). */
const liquidLevel = (page: Page) => page.locator(".ob-liquid").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).f);

async function toRanking(page: Page, beers = ["גולדסטאר", "היינקן", "מכבי", "קורונה"]) {
  await page.goto("/welcome");
  await page.getByPlaceholder("יוני").fill("דנה");
  await page.getByRole("button", { name: "ממשיכים" }).click();
  for (const beer of beers) await pick(page, beer);
  await page.getByRole("button", { name: "לדירוג" }).click();
}

test("name → four beers → their order → the pour: #1 leads the line, then becomes the app", async ({ page }) => {
  await page.goto("/welcome");
  // Nobody's beer yet: one unlabelled bottle, the neutral look.
  await expect(stage(page)).toHaveAttribute("data-scene", "name");
  await expect(stage(page)).toHaveAttribute("data-bottle", "none");
  await expect(page.locator(".ob-item.ob-blank")).toHaveCount(1);
  const neutral = await ground(page);
  await shot(page, "1-name");

  await page.getByPlaceholder("יוני").fill("דנה");
  await page.getByPlaceholder("יוני").press("Enter"); // the keyboard's own button moves on
  await expect(stage(page)).toHaveAttribute("data-scene", "pick");
  await expect(page.getByRole("button", { name: "בחרו בירה אחת לפחות" })).toBeDisabled();

  // The first beer chosen stands at the head of the line as its own real bottle, and the page takes its colours.
  await pick(page, "גולדסטאר");
  await expect(head(page).locator("img").first()).toHaveAttribute("src", "/bottles/goldstar.webp");
  await expect.poll(() => ground(page)).not.toBe(neutral);
  const goldstar = await ground(page);
  for (const beer of ["היינקן", "מכבי", "קורונה"]) await pick(page, beer);
  await expect(page.locator(".ob-item img:not(.ob-cap)")).toHaveCount(4);
  await shot(page, "2-pick");

  await page.getByRole("button", { name: "לדירוג" }).click();
  await expect(stage(page)).toHaveAttribute("data-scene", "rank");
  await expect(page.locator("li[data-rank='1']")).toContainText("המראה וההתראות");
  await shot(page, "3-rank-goldstar");

  // A new #1: the line re-forms behind it and the whole page follows.
  await page.getByRole("button", { name: "העלו את היינקן מקום אחד" }).click();
  await expect(stage(page)).toHaveAttribute("data-beer", "heineken");
  await expect(head(page).locator("img").first()).toHaveAttribute("src", "/bottles/heineken.webp");
  await expect.poll(() => ground(page)).not.toBe(goldstar);
  await shot(page, "3-rank-heineken");

  await page.getByRole("button", { name: "ממשיכים" }).click(); // the place step
  await page.getByRole("button", { name: "סיימנו" }).click();
  await expect(stage(page)).toHaveAttribute("data-scene", "reveal");
  await expect(page.getByRole("heading", { name: "אהלן, דנה" })).toBeVisible();
  await expect(page.getByText("היינקן היא עכשיו האפליקציה שלכם.")).toBeVisible();
  // The way on is there at once; the pour happens beside it, and ends with a full glass.
  const finish = page.getByRole("button", { name: /קדימה/ });
  await expect(finish).toBeEnabled();
  await expect.poll(() => liquidLevel(page), { timeout: 8000 }).toBeCloseTo(44, 0);
  await shot(page, "4-reveal");

  await finish.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "heineken");
  await expect(page.locator(".stage-caption")).toContainText("היינקן");
  await expect(page.getByRole("heading", { name: /אהלן, דנה/ })).toBeVisible();
  // Coming back never lands in onboarding again.
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/$/);
});

test("a bottle can be carried along the line to change the ranking", async ({ page }) => {
  await toRanking(page); // גולדסטאר, היינקן, מכבי, קורונה
  const bottle = (await page.locator(".ob-item[data-rank='2']").boundingBox())!; // מכבי
  const first = (await page.locator(".ob-badge[data-rank='0']").boundingBox())!;
  const y = bottle.y + bottle.height / 2;
  await page.mouse.move(bottle.x + bottle.width / 2, y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) await page.mouse.move(bottle.x + bottle.width / 2 + ((first.x - bottle.x) * step) / 6, y);
  await page.mouse.up();

  // The list below — the accessible way to do the same — shows the same order, and the page follows the new #1.
  await expect(page.locator("li[data-rank='1']")).toContainText("מכבי");
  await expect(page.locator("li[data-rank='2']")).toContainText("גולדסטאר");
  await expect(stage(page)).toHaveAttribute("data-beer", "maccabee");
  await expect(page.getByText("מכבי עכשיו במקום 1")).toHaveCount(0); // (the stage is decorative; the list announces its own moves)
});

test("the pour is the beer's own: the real cap comes off, and a stout gets a stout's glass", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); // settled frames
  await toRanking(page, ["גינס", "גולדסטאר", "מכבי", "קורונה"]);
  // Until the last step the photo is whole.
  expect(await head(page).locator(".ob-cap").evaluate((el) => getComputedStyle(el).display)).toBe("none");
  await page.getByRole("button", { name: "ממשיכים" }).click(); // the place step
  await page.getByRole("button", { name: "סיימנו" }).click();
  await expect(stage(page)).toHaveAttribute("data-scene", "reveal");
  // The same photo, shown as two pieces: the bottle without its top, and the top — which has flown.
  await expect(head(page).locator("img.ob-body")).toHaveAttribute("src", "/bottles/guinness.webp");
  await expect(head(page).locator("img.ob-cap")).toHaveAttribute("src", "/bottles/guinness.webp");
  expect(await head(page).locator(".ob-body").evaluate((el) => getComputedStyle(el).clipPath)).toContain("inset(");
  await expect.poll(() => head(page).locator(".ob-cap").evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  await expect(page.locator(".ob-glass")).toHaveAttribute("data-glass", "tulip");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test("arriving on Home from onboarding is the one animated navigation; no other page load is", async ({ page }) => {
  // What the layout's own listener decided: read once every listener for the event has run.
  await page.addInitScript(() => {
    addEventListener("pagereveal", (event) => {
      const transition = (event as Event & { viewTransition?: { types: Set<string> } }).viewTransition;
      const types = transition?.types;
      setTimeout(() => ((window as unknown as { __reveal: string }).__reveal = types ? [...types].join(",") || "skipped" : "none"));
    });
  });
  const supported = await page.evaluate(() => "PageRevealEvent" in window);
  test.skip(!supported, "this browser has no cross-document view transitions; the page simply loads");

  await toRanking(page);
  await page.getByRole("button", { name: "ממשיכים" }).click(); // the place step
  await page.getByRole("button", { name: "סיימנו" }).click();
  await page.getByRole("button", { name: /קדימה/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /אהלן/ })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __reveal?: string }).__reveal)).toBe("from-welcome");
  // An ordinary page load is left alone.
  await page.goto("/settings");
  expect(await page.evaluate(() => (window as unknown as { __reveal?: string }).__reveal)).not.toBe("from-welcome");
  await expect(page.locator("body")).toHaveAttribute("data-theme", "goldstar");
});

test("nobody waits for the animation: leaving mid-pour works", async ({ page }) => {
  await toRanking(page);
  await page.getByRole("button", { name: "ממשיכים" }).click(); // the place step
  await page.getByRole("button", { name: "סיימנו" }).click();
  await page.getByRole("button", { name: /קדימה/ }).click(); // the bottle has barely started to lean
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "goldstar");
});

// 0024: a person picks between one and four. One is a complete answer, not a half-finished one.
test("one beer is enough: the line holds one bottle, and that beer becomes the app", async ({ page }) => {
  await page.goto("/welcome");
  const neutral = await ground(page);

  await page.getByPlaceholder("יוני").fill("דנה");
  await page.getByRole("button", { name: "ממשיכים" }).click();
  await pick(page, "גולדסטאר");

  await page.getByRole("button", { name: "לדירוג" }).click();
  await expect(stage(page)).toHaveAttribute("data-scene", "rank");

  // One bottle on the stage, and no empty slots left standing beside it.
  await expect(stage(page)).toHaveAttribute("data-count", "1");
  await expect(page.locator(".ob-stage .ob-empty")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "הבירות שלי, לפי הסדר" })).toHaveCount(0);

  await page.getByRole("button", { name: "ממשיכים" }).click(); // the place step
  await page.getByRole("button", { name: "סיימנו" }).click();
  await page.getByRole("button", { name: /קדימה/ }).click();
  await expect(page).toHaveURL(/\/$/);

  // It is their app now: the palette moved off the house neutral, and Home lists exactly one key.
  await expect.poll(() => ground(page)).not.toBe(neutral);
  await expect(page.getByRole("list", { name: "הבירות שלי, לפי הסדר" }).getByRole("listitem")).toHaveCount(1);
});

// 0026: where they live and how far they will go. Both optional, both asked for
// in words rather than taken from the browser without being asked.
test("the place step asks for a settlement, never an address, and can be skipped", async ({ page }) => {
  await toRanking(page);
  await page.getByRole("button", { name: "ממשיכים" }).click();
  await expect(stage(page)).toHaveAttribute("data-scene", "place");

  // A settlement, not a street. And the distances only appear once there is a place
  // to measure from -- the question is meaningless before that.
  await expect(page.getByText("רק היישוב. לא צריך כתובת.")).toBeVisible();
  await expect(page.getByRole("button", { name: "עד 15 ק״מ" })).toHaveCount(0);

  // Skipping is a real choice: the save goes through with no place at all.
  await page.getByRole("button", { name: "סיימנו" }).click();
  await expect(stage(page)).toHaveAttribute("data-scene", "reveal");
});

test("typing a city offers it, and choosing it brings out the distances", async ({ page }) => {
  await toRanking(page);
  await page.getByRole("button", { name: "ממשיכים" }).click();

  const field = page.getByPlaceholder("תל אביב, חיפה, באר שבע…");
  await field.fill("תל אביב");
  // "תל אביב" finds "תל אביב-יפו": the list is searched the way the app searches beers.
  await page.getByRole("button", { name: "תל אביב-יפו" }).click();
  await expect(field).toHaveValue("תל אביב-יפו");

  await expect(page.getByRole("heading", { name: "כמה רחוק תיסעו בשביל מבצע?" })).toBeVisible();
  await page.getByRole("button", { name: "עד 15 ק״מ" }).click();
  await expect(page.getByRole("button", { name: "עד 15 ק״מ" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "סיימנו" }).click();
  await expect(stage(page)).toHaveAttribute("data-scene", "reveal");
});

test("a place we do not hold is still a place: the typed name is kept", async ({ page }) => {
  await toRanking(page);
  await page.getByRole("button", { name: "ממשיכים" }).click();

  const field = page.getByPlaceholder("תל אביב, חיפה, באר שבע…");
  await field.fill("כפר שלא קיים ברשימה");
  await field.blur();
  await expect(field).toHaveValue("כפר שלא קיים ברשימה");

  // No coordinates, so no distances to offer -- and nothing pretends otherwise.
  await expect(page.getByRole("heading", { name: "כמה רחוק תיסעו בשביל מבצע?" })).toBeVisible();
  await page.getByRole("button", { name: "סיימנו" }).click();
  await expect(stage(page)).toHaveAttribute("data-scene", "reveal");
});

test("the browser is never asked for a location until somebody taps for it", async ({ page }) => {
  let asked = false;
  await page.exposeFunction("__geoAsked", () => {
    asked = true;
  });
  await page.addInitScript(() => {
    const real = navigator.geolocation?.getCurrentPosition?.bind(navigator.geolocation);
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback, fail?: PositionErrorCallback, opts?: PositionOptions) => {
          (window as unknown as { __geoAsked: () => void }).__geoAsked();
          return real?.(ok, fail, opts);
        },
      },
    });
  });

  await toRanking(page);
  await page.getByRole("button", { name: "ממשיכים" }).click();
  await expect(page.getByRole("button", { name: "השתמשו במיקום שלי" })).toBeVisible();
  expect(asked, "the prompt appeared without anyone asking for it").toBe(false);
});

test("going back keeps the name and the four beers", async ({ page }) => {
  await toRanking(page);
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page.locator("button[aria-pressed='true']")).toHaveCount(4);
  // Swapping one out is done here: the newcomer joins the end of the line.
  await pick(page, "קורונה");
  // 0024: three is a valid choice, so the button is live rather than counting down to four.
  await expect(page.getByRole("button", { name: "לדירוג" })).toBeEnabled();
  await pick(page, "קרלסברג");
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page.getByPlaceholder("יוני")).toHaveValue("דנה");
  await page.getByRole("button", { name: "ממשיכים" }).click();
  await page.getByRole("button", { name: "לדירוג" }).click();
  await expect(page.locator("li[data-rank='4']")).toContainText("קרלסברג");
});

test("reduced motion: nothing moves, and the last step is already in its final state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await toRanking(page);
  await page.getByRole("button", { name: "ממשיכים" }).click(); // the place step
  await page.getByRole("button", { name: "סיימנו" }).click();
  await expect(stage(page)).toHaveAttribute("data-scene", "reveal");
  // No waiting: the glass is full and the bottle upright as soon as the step is there.
  await expect.poll(() => liquidLevel(page), { timeout: 1000 }).toBeCloseTo(44, 0);
  expect(await head(page).locator(".ob-tilt").evaluate((el) => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
});

test("the switch in the corner turns the animation off, for anyone", async ({ page }) => {
  await page.goto("/welcome");
  const off = page.getByRole("button", { name: "בלי אנימציה" });
  await expect(off).toHaveAttribute("aria-pressed", "false");
  await off.click();
  await expect(off).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("main.ob")).toHaveAttribute("data-motion", "off");
  await page.getByRole("button", { name: "ממשיכים" }).click();
  await pick(page, "גולדסטאר");
  expect(await head(page).locator(".ob-turn").evaluate((el) => getComputedStyle(el).animationDuration)).toMatch(/^(1e-05s|0\.00001s)/);
});

test("a beer without its own identity leads with the unlabelled bottle — never another beer's", async ({ page }) => {
  await toRanking(page, [NO_IDENTITY_BEER, "גולדסטאר", "מכבי", "קורונה"]);
  await expect(stage(page)).toHaveAttribute("data-bottle", "none");
  await expect(head(page)).toHaveClass(/ob-blank/);
  await expect(head(page).locator("img").first()).toHaveAttribute("src", "/onboarding/bottle.webp");
  await expect(page.locator(".ob-item img[src^='/bottles/']:not(.ob-cap)")).toHaveCount(3); // the other three are themselves
});

for (const scheme of ["light", "dark"] as const) {
  test(`every step keeps the quality floor and passes axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); // settled frames
    const check = async (step: string) => {
      expect(await floorViolations(page), step).toEqual([]);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`), step).toEqual([]);
    };
    await page.goto("/welcome");
    await check("name");
    await page.getByRole("button", { name: "ממשיכים" }).click();
    await check("pick, nothing chosen");
    for (const beer of ["טובורג", "גינס", "מכבי", "קורונה"]) await pick(page, beer);
    await check("pick, four chosen");
    await page.getByRole("button", { name: "לדירוג" }).click();
    await check("rank");
    await page.getByRole("button", { name: "ממשיכים" }).click();
    await check("place, nothing entered");
    await page.getByPlaceholder("תל אביב, חיפה, באר שבע…").fill("חיפה");
    await page.getByRole("button", { name: "חיפה", exact: true }).click();
    await check("place, a city and the distances");
    await page.getByRole("button", { name: "סיימנו" }).click();
    await expect(stage(page)).toHaveAttribute("data-scene", "reveal");
    await check("reveal");
    await shot(page, `4-reveal-tuborg-${scheme}`);
  });
}

// The other sizes the audit named: a small Android phone, a short one, and a desktop window.
for (const [width, height] of [[360, 640], [412, 915], [1280, 800]] as const) {
  test(`every step fits a ${width}×${height} screen with the button in reach`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const fits = async (button: string | RegExp, step: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${step}: sideways scroll`).toBeLessThanOrEqual(1);
      await expect(page.getByRole("button", { name: button }), step).toBeInViewport({ ratio: 1 });
      await shot(page, `${height}h-${step}`);
    };
    await page.goto("/welcome");
    await fits("ממשיכים", "name");
    await page.getByRole("button", { name: "ממשיכים" }).click();
    for (const beer of ["גולדסטאר", "היינקן", "מכבי", "קורונה"]) await pick(page, beer);
    await fits("לדירוג", "pick");
    await page.getByRole("button", { name: "לדירוג" }).click();
    await fits("ממשיכים", "rank");
    await page.getByRole("button", { name: "ממשיכים" }).click();
    await fits("סיימנו", "place");
  });
}
