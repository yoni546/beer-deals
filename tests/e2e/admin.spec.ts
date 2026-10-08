import { expect, test, type Page } from "@playwright/test";
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

  // One filtered list since Phase U: the approved deals are a tap away, not a
  // second list on the same screen.
  await page.goto("/admin/queue?status=approved");
  await expect(page.getByRole("heading", { name: /מבצעים מאושרים/ })).toBeVisible();
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
  await page.goto("/admin/queue?status=approved");
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

// Phase M: the people who submit (0035) — a moderation tool, not a directory.
test("the submitters screen can stop one account, and shows nothing private", async ({ page, browser }) => {
  await onboard(page, "מנהל שולחים");
  await makeAdmin("מנהל שולחים");

  /** A deal sent through the public form, by somebody who is not an admin. */
  const sendOne = async (sender: Page, beerIndex: number, storeIndex: number) => {
    await sender.goto("/submit");
    await sender.getByLabel("איזו בירה?").selectOption({ index: beerIndex });
    await sender.getByLabel("איפה?").selectOption({ index: storeIndex });
    await sender.getByPlaceholder("24.90").fill("21.90");
    await sender.getByPlaceholder("39.90").fill("36.90");
    await sender.getByRole("button", { name: "שליחה לאישור" }).click();
  };

  // A separate browser context, so this is a different person and not the admin.
  const other = await browser.newContext();
  const theirs = await other.newPage();
  await onboard(theirs, "שולחת");
  await sendOne(theirs, 1, 1);
  await expect(theirs.getByText("תודה! המבצע נשלח לאישור ויפורסם אחרי בדיקה.")).toBeVisible();

  await page.goto("/admin/submitters");
  const row = page.getByRole("article").first();
  // They never chose a public name, so the row says that — not their first name,
  // which admins cannot read, and not "anonymous".
  await expect(row.getByText("לא בחר שם ציבורי")).toBeVisible();
  await expect(page.getByText("שולחת")).toHaveCount(0);

  await row.getByRole("button", { name: "חסימת שליחה" }).click();
  await row.getByLabel("למה?").fill("בדיקה: מחירים שלא קיימים");
  await row.getByRole("button", { name: "חסימת שליחה" }).last().click();
  await expect(page.getByText("כל השאר לא נגענו בו")).toBeVisible();
  await expect(page.getByText("חסום לשליחה")).toBeVisible();

  // And they are told, in words written for them — not "you have no permission".
  await sendOne(theirs, 2, 2);
  await expect(theirs.getByText(/לא יכול לשלוח מבצעים חדשים/)).toBeVisible();

  await other.close();
});

// Phase U: the moderation list, filtered — and the filter in the URL.
test("the queue can be narrowed, and the narrowing is in the address", async ({ page }) => {
  await onboard(page, "מסננת");
  await makeAdmin("מסננת");

  // One deal by hand, so there is something approved to find.
  await page.goto("/admin/queue");
  await page.getByRole("button", { name: "+ הוספת מבצע ידנית" }).click();
  await page.getByLabel("בירה", { exact: true }).selectOption({ index: 3 });
  await page.getByLabel("חנות", { exact: true }).selectOption({ index: 3 });
  await page.getByPlaceholder("24.90").fill("18.90");
  await page.getByPlaceholder("39.90").fill("33.90");
  await page.getByRole("button", { name: "הוספה ופרסום" }).click();
  await expect(page.getByText("המבצע נוסף ופורסם.")).toBeVisible();

  // Pending is the default, and the plain page has a plain address.
  await page.goto("/admin/queue");
  await expect(page.getByRole("heading", { name: /ממתינים לאישור/ })).toBeVisible();

  await page.getByRole("navigation", { name: "סטטוס" }).getByRole("link", { name: "מאושרים" }).click();
  await expect(page).toHaveURL(/status=approved/);
  await expect(page.getByRole("heading", { name: /מבצעים מאושרים/ })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "₪18.90" })).toBeVisible();

  // A chain nothing was added for: the list is empty and says it is the FILTER that
  // is empty, not the queue.
  await page.getByLabel("הצגה לפי חנות").selectOption({ index: 6 });
  await page.getByRole("button", { name: "סינון" }).click();
  await expect(page).toHaveURL(/store=/);
  await expect(page.getByText("אין מבצעים שמתאימים לסינון.")).toBeVisible();

  // The URL survives a reload, which is the point of putting it there.
  await page.reload();
  await expect(page.getByText("אין מבצעים שמתאימים לסינון.")).toBeVisible();

  // And each chosen filter carries its own way out.
  await page.getByRole("link", { name: "ניקוי הכול" }).click();
  await expect(page).toHaveURL(/\/admin\/queue$/);
  await expect(page.getByRole("heading", { name: /ממתינים לאישור/ })).toBeVisible();
});

// Phase T: coverage, as the database holds it (0036).
test("the coverage screen says what we know now, and points at what it cannot know", async ({ page }) => {
  await onboard(page, "בודקת כיסוי");
  await makeAdmin("בודקת כיסוי");

  await page.goto("/admin/coverage");
  await expect(page.getByRole("heading", { name: "כיסוי הרשתות" })).toBeVisible();

  // The e2e database has chains and no branch scan, and the screen says exactly
  // that rather than "0 of 0 checked", which would read like a result.
  await expect(page.getByText("לא נסרקה").first()).toBeVisible();
  await expect(page.getByText("הרשת הזאת לא נסרקה אף פעם.").first()).toBeVisible();

  // And it names the document that holds what no table can.
  await expect(page.getByText(/RETAILER-COVERAGE\.md/)).toBeVisible();
});
