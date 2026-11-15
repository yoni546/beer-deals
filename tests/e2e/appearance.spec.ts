import { expect, test, type Page } from "@playwright/test";
import { onboard, resetDb, seedRealCatalog } from "./helpers";

/**
 * Light, dark, or whatever the phone says (DESIGN.md, "Light and dark").
 *
 * The rule this replaced said the phone decides and there is no in-app switch. The owner asked
 * for the choice on 2026-11-14 and it was added deliberately, so what is checked here is the
 * part of the old rule that did NOT change: the colours still come from favourite #1, and this
 * only picks which of that beer's two generated modes is shown.
 *
 * Everything below reads the SERVER's HTML as well as the rendered page, because the whole point
 * of keeping the answer in a cookie is that the first paint is already right. A mode restored by
 * a script after hydration would pass a test that only looked at the DOM, and would still flash
 * white in a dark room.
 */
test.beforeAll(async () => {
  await resetDb();
  await seedRealCatalog();
});

const paper = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--paper").trim());
const scheme = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme.trim());

/**
 * The HTML the server actually sent for a real navigation -- the bytes that decide the first
 * paint, before any script runs. Deliberately the navigation's own response and not
 * `page.request.get()`, which fetches outside the page and did not carry the cookie: it kept
 * reporting the un-chosen stylesheet while the page in front of the user was plainly right.
 */
const servedHtml = async (page: Page, path: string) => {
  const response = await page.goto(path);
  expect(response, path).not.toBeNull();
  return await response!.text();
};
/**
 * Tap the option the way a person does: on the label. The <input> is `sr-only` -- present for
 * the keyboard and for screen readers, but one pixel -- so clicking IT is what a real finger
 * never does, and Playwright rightly refuses: the label is on top and intercepts the click.
 *
 * Then wait for the SERVER to have it. `toBeChecked()` alone passes on the optimistic state,
 * before the round trip, so a reader of this file would think the assertions after it were
 * about the new mode when some of them were still about the old one.
 */
const choose = async (page: Page, label: string, value: string) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: label, exact: true }).locator("xpath=ancestor::label").click();
  await expect(page.getByRole("radio", { name: label, exact: true })).toBeChecked();
  await expect
    .poll(async () => (await page.context().cookies()).find((c) => c.name === "appearance")?.value)
    .toBe(value);
  // And wait for the page in front of the person to be the one the server now describes.
  await expect.poll(() => scheme(page)).toBe(value === "dark" ? "dark" : "light");
};

test("the phone decides until someone says otherwise, and then it does not", async ({ page }) => {
  await onboard(page, "בדיקה", ["גולדסטאר", "היינקן", "מכבי", "קורונה"]);

  // Nothing chosen: the stylesheet carries both modes and defers to the device.
  const asShipped = await servedHtml(page, "/");
  expect(asShipped).toContain("prefers-color-scheme:dark");

  await choose(page, "כהה", "dark");
  const dark = await paper(page);
  expect(await scheme(page)).toBe("dark");
  // No media query at all now: the device cannot override a stated choice.
  const darkHtml = await servedHtml(page, "/");
  expect(darkHtml).not.toContain("prefers-color-scheme");
  // ...and the status bar agrees, as one fixed colour rather than a pair.
  expect(darkHtml.match(/<meta name="theme-color"/g)).toHaveLength(1);

  await choose(page, "בהיר", "light");
  const light = await paper(page);
  expect(await scheme(page)).toBe("light");
  expect(light).not.toBe(dark);

  await choose(page, "לפי הטלפון", "system");
  expect(await servedHtml(page, "/")).toContain("prefers-color-scheme:dark");
});

test("the choice survives a reload and every page, with no flash of the other mode", async ({ page }) => {
  await onboard(page, "בדיקה", ["גולדסטאר", "היינקן", "מכבי", "קורונה"]);
  await choose(page, "כהה", "dark");
  const chosen = await paper(page);

  for (const path of ["/", "/beer", "/settings"]) {
    // The server said so before any script ran...
    const html = await servedHtml(page, path);
    expect(html, path).not.toContain("prefers-color-scheme");
    // ...and the rendered page agrees.
    expect(await paper(page), path).toBe(chosen);
  }
});

test("it chooses the mode and never the colours: those still come from favourite #1", async ({ page }) => {
  await onboard(page, "בדיקה", ["גולדסטאר", "היינקן", "מכבי", "קורונה"]);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "goldstar");

  await choose(page, "כהה", "dark");
  // Still Goldstar's app, in Goldstar's dark palette.
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-theme", "goldstar");
  await expect(page.locator(".bottle-stage").last()).toHaveAttribute("data-beer", "goldstar");
});
