import { expect, test } from "@playwright/test";
import { exec, onboard, resetDb, seedRealCatalog, sql } from "./helpers";

/**
 * 0.9.0: where a deal runs. Three Rami Levy branches were checked in one scan; one promotion is listed at
 * two of them, another at all three. The page must say "בסניפים משתתפים" and "בכל הרשת" — and the sheet must
 * list exactly the branches that list the first one.
 */
test.beforeAll(async () => {
  await resetDb();
  await seedRealCatalog();
  const [{ rami }] = await sql<{ rami: string }>("select id as rami from public.stores where slug = 'rami-levy'");
  const [{ sku }] = await sql<{ sku: string }>(
    "select k.id as sku from public.skus k join public.beers b on b.id = k.beer_id where b.slug = 'goldstar' and k.container = 'can' and k.volume_ml = 330 and k.pack_quantity = 6 and k.variant = ''",
  );
  const branches: string[] = [];
  for (const [ref, name] of [["e2e-1", "גבעת שאול"], ["e2e-2", "תלפיות"], ["e2e-3", "מודיעין"]]) {
    const [{ id }] = await sql<{ id: string }>("insert into public.branches (store_id, external_ref, name_he, city, listed_in_stores_file) values ($1, $2, $3, 'ירושלים', true) returning id", [rami, ref, name]);
    branches.push(id);
  }
  const offer = (branch: string, key: string, price: number) =>
    `select public.record_price(p_sku_id := '${sku}', p_store_id := '${rami}', p_kind := 'promotion', p_price_agorot := ${price}, p_observed_at := now(),
       p_source_slug := 'admin', p_branch_id := '${branch}', p_valid_to := now() + interval '5 days', p_promo_type := 'price_cut', p_natural_key := '${key}');`;
  const listing = (key: string, list: string[], price: number) =>
    `select public.record_promotion_occurrences('${rami}', '${JSON.stringify(list.map((b) => ({ branch_id: b, canonical_key: key, source_promotion_id: key, source_file: `f-${b}`, observed_at: new Date().toISOString(), kind: "price", price_agorot: price, published: true })))}'::jsonb);`;
  await exec(
    [
      "begin;",
      "set local role service_role;",
      offer(branches[0], "e2e:c:partial", 2190),
      offer(branches[1], "e2e:c:partial", 2190),
      ...branches.map((b) => offer(b, "e2e:c:everywhere", 2390)),
      listing("e2e:c:partial", branches.slice(0, 2), 2190),
      listing("e2e:c:everywhere", branches, 2390),
      `select public.record_branch_scan('e2e-scan', '${rami}', now(), '${JSON.stringify(branches.map((b) => ({ branch_id: b, status: "ok", promo_file: `f-${b}` })))}'::jsonb);`,
      `select public.refresh_promotion_scope('${rami}');`,
      "commit;",
    ].join("\n"),
  );
});

test("a deal at some of the checked branches says so, and lists exactly those branches", async ({ page }) => {
  await onboard(page);
  await page.goto("/beer/goldstar");
  const partial = page.locator("article", { hasText: "₪21.90" }).first();
  await expect(partial).toContainText("בסניפים משתתפים");
  await expect(partial).not.toContainText("בכל הרשת");
  const summary = partial.locator("[data-scope] summary");
  expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await summary.click();
  const list = partial.getByRole("list", { name: "הסניפים שבהם נמצא המבצע" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list).toContainText("גבעת שאול");
  await expect(list).toContainText("תלפיות");
  await expect(list).not.toContainText("מודיעין");
  await expect(partial).toContainText("2 מתוך 3 סניפים שנבדקו");
});

test("a deal listed at every known branch, all checked, is the only one that says 'בכל הרשת' — once, not per branch", async ({ page }) => {
  await onboard(page);
  await page.goto("/beer/goldstar");
  const everywhere = page.locator("article", { hasText: "₪23.90" });
  await expect(everywhere).toHaveCount(1); // three branch observations, ONE offer
  await expect(everywhere).toContainText("בכל הרשת");
  // A deal the scan model does not cover (the rest of the catalogue) claims nothing about the chain.
  const claims = await page.locator("article").filter({ hasText: "בכל הרשת" }).count();
  expect(claims).toBe(1);
});

test("Home never implies the whole chain without evidence", async ({ page }) => {
  await onboard(page); // Goldstar is #1
  const line = page.locator("main article", { hasText: "₪21.90" }).first();
  await expect(line).toBeVisible();
  await expect(line).toContainText("בסניפים משתתפים");
  await expect(line).not.toContainText("בכל הרשת");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
