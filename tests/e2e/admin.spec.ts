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
