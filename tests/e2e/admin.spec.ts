import { expect, test } from "@playwright/test";
import { makeAdmin, onboard, resetDb } from "./helpers";

/**
 * The admin area as a person meets it (0.9.0 admin home, 0020 RPCs): a visitor is sent to the sign-in page;
 * an admin gets the overview, the queue, and — collapsed at the top of the queue — adding a deal by hand,
 * with the notification OFF unless they tick it. (Who may call what is pinned in tests/admin-rpcs.test.ts.)
 */
test.beforeAll(async () => {
  await resetDb();
});

test("Admin pages: a visitor is sent to sign in, never shown the panel", async ({ page }) => {
  await onboard(page, "אורחת");
  for (const path of ["/admin", "/admin/queue", "/admin/reports"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/admin\/login$/);
  }
});

test("Admin pages: the overview, the queue, and a deal added by hand (notification off by default)", async ({ page }) => {
  await onboard(page, "מנהלת");
  await makeAdmin("מנהלת");

  await page.goto("/admin");
  await expect(page.getByText("שלום מנהלת")).toBeVisible();

  await page.goto("/admin/queue");
  await page.getByRole("button", { name: "+ הוספת מבצע ידנית" }).click();
  await page.getByLabel("בירה", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("חנות", { exact: true }).selectOption({ index: 1 });
  await page.getByPlaceholder("24.90").fill("24.90");
  await page.getByPlaceholder("39.90").fill("39.90");
  await expect(page.getByText("38%-")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /לשלוח התראה/ })).not.toBeChecked();
  await page.getByRole("button", { name: "הוספה ופרסום" }).click();
  await expect(page.getByText("המבצע נוסף ופורסם.")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "מבצעים מאושרים" })).toBeVisible();
  await expect(page.getByText("אין מבצעים מאושרים כרגע.")).toHaveCount(0);
});

// Phase AA: the audit log (0032). Until now nothing could answer "who took this down?".
test("the audit log says who did what, and offers nothing to press", async ({ page }) => {
  await onboard(page, "רשמת");
  await makeAdmin("רשמת");

  // Do two real things: add a deal by hand, then take it off the site. The removal is
  // the case that mattered — it deliberately erases approved_by from the deal itself.
  await page.goto("/admin/queue");
  await page.getByRole("button", { name: "+ הוספת מבצע ידנית" }).click();
  // A different shelf from the test above: one approved deal per beer/chain/pack (0005).
  await page.getByLabel("בירה", { exact: true }).selectOption({ index: 2 });
  await page.getByLabel("חנות", { exact: true }).selectOption({ index: 2 });
  await page.getByPlaceholder("24.90").fill("19.90");
  await page.getByPlaceholder("39.90").fill("34.90");
  await page.getByRole("button", { name: "הוספה ופרסום" }).click();
  await expect(page.getByText("המבצע נוסף ופורסם.")).toBeVisible();

  // Take down the one just added, not the one the test above left behind.
  await page.reload();
  await page
    .getByRole("article")
    .filter({ hasText: "₪19.90" })
    .getByRole("button", { name: "הסרה מהאתר" })
    .click();
  await expect(page.getByText("עודכן.").first()).toBeVisible();

  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "מה נעשה כאן" })).toBeVisible();

  // Newest first, and the person is named — here as "you".
  const entries = page.getByRole("article");
  await expect(entries.nth(0)).toContainText("הסיר מבצע מהאתר");
  await expect(entries.nth(0)).toContainText("אתם");
  await expect(entries.nth(0)).toContainText("ממצב: מאושר");
  await expect(entries.nth(1)).toContainText("הוסיף מבצע ידנית");
  await expect(entries.nth(1)).toContainText("בלי התראה");

  // A log with controls on it is a log somebody can tidy.
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
});

// Phase D: the beers, from the panel (0034).
test("the beers screen can switch one off, and says what that does and does not do", async ({ page }) => {
  await onboard(page, "מנהלת בירות");
  await makeAdmin("מנהלת בירות");

  await page.goto("/admin/beers");
  await expect(page.getByRole("heading", { name: "בירות", exact: true })).toBeVisible();

  const goldstar = page.getByRole("article").filter({ hasText: "גולדסטאר" }).first();
  await goldstar.getByRole("button", { name: "הסרה מרשימת הבחירה" }).click();

  // The confirmation says the part people get wrong, and it survives the row
  // re-rendering (0.21.1) because it is shown above the list, not inside the row.
  await expect(page.getByText("מי שכבר בחר אותה שומר אותה")).toBeVisible();
  await expect(goldstar.getByText("לא בבחירה")).toBeVisible();
  await goldstar.getByRole("button", { name: "החזרה לרשימה" }).click();
  await expect(page.getByText("חזרה לרשימת הבחירה")).toBeVisible();

  // What cannot be done from here is SAID, where somebody would look for the field.
  await goldstar.getByRole("button", { name: "עריכה" }).click();
  await expect(goldstar.getByText(/המראה נמצא בקוד/)).toBeVisible();
  await expect(goldstar.getByLabel("מזהה")).toHaveCount(0);

  // And the work that needs a deploy is listed rather than rediscovered each time.
  await expect(page.getByRole("heading", { name: "מחכות למראה שלהן" })).toBeVisible();
  await expect(page.getByText("חסרה תמונה").first()).toBeVisible();
});
