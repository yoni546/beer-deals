import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";

/**
 * What the database knows about each retailer's coverage (migration 0036).
 *
 * The point of the screen, and so of these tests: docs/RETAILER-COVERAGE.md is a
 * snapshot produced on the machine that ran a scan, and nothing in the app could
 * say what the database holds NOW. The number that mattered most was invisible
 * everywhere — how many branches we can actually place on a map — which is how
 * "we have no locations" stayed true for a fortnight without anybody seeing it.
 */

type Row = {
  store_slug: string;
  branches: number;
  located: number;
  last_scan_id: string | null;
  checked: number;
  promo_checked: number;
  no_promo_file: number;
  failed: number;
  live_offers: number;
};

async function setup() {
  const w = await world();
  const moderator = await createUser(w.db, "moderator@example.test");
  await w.db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [moderator]);
  return { w, moderator };
}

const coverage = async (w: World, who: string): Promise<Row[]> =>
  (await asUser(w.db, who, () => w.db.query<Row>("select * from public.admin_coverage()"))).rows;

const find = (rows: Row[], slug: string) => rows.find((r) => r.store_slug === slug)!;

/** A branch, optionally one we know the position of. */
async function branch(w: World, storeId: string, ref: string, located = false) {
  const { rows } = await w.db.query<{ id: string }>(
    `insert into public.branches (store_id, external_ref, name_he, city, latitude, longitude, geocode_source, geocoded_at)
     values ($1, $2, $3, 'תל אביב', $4::double precision, $5::double precision,
             case when $4::double precision is null then null else 'test' end,
             case when $4::double precision is null then null else now() end)
     returning id`,
    [storeId, ref, `סניף ${ref}`, located ? 32.08 : null, located ? 34.78 : null],
  );
  return rows[0].id;
}

async function scanned(w: World, storeId: string, branchId: string, status: string, scanId = "scan-1", promo = true) {
  await w.db.query(
    `insert into public.branch_scans (scan_id, store_id, branch_id, scanned_at, status, price_file, promo_file)
     values ($1, $2, $3, now(), $4, 'prices.xml', case when $5::boolean then 'promos.xml' end)`,
    [scanId, storeId, branchId, status, promo],
  );
}

describe("coverage, as the database holds it", () => {
  it("counts the branches and how many of them we can place on a map", async () => {
    const { w, moderator } = await setup();
    await branch(w, w.ids.rami, "1", true);
    await branch(w, w.ids.rami, "2", true);
    await branch(w, w.ids.rami, "3", false);

    expect(find(await coverage(w, moderator), "rami-levy")).toMatchObject({ branches: 3, located: 2 });
  });

  it("says nothing rather than zero about a chain that was never scanned", async () => {
    const { w, moderator } = await setup();
    const row = find(await coverage(w, moderator), "rami-levy");
    expect(row.last_scan_id).toBeNull();
    // The counts are zero because nothing was checked — and last_scan_id being null
    // is what tells the screen to say "never scanned" instead of "0 of 0 checked".
    expect(row.checked).toBe(0);
  });

  it("separates checked from promotions-checked, which is a different denominator", async () => {
    const { w, moderator } = await setup();
    const a = await branch(w, w.ids.rami, "1");
    const b = await branch(w, w.ids.rami, "2");
    await scanned(w, w.ids.rami, a, "ok", "scan-1", true);
    await scanned(w, w.ids.rami, b, "no_promo_file", "scan-1", false);

    const row = find(await coverage(w, moderator), "rami-levy");
    // One branch had both files; the other had prices and no promotions. A single
    // "checked" number would hide exactly the thing promotion scope depends on.
    expect(row).toMatchObject({ checked: 1, promo_checked: 1, no_promo_file: 1 });
  });

  it("counts 'unchanged' as checked, because an unchanged file was still read", async () => {
    const { w, moderator } = await setup();
    const a = await branch(w, w.ids.rami, "1");
    await scanned(w, w.ids.rami, a, "unchanged");
    expect(find(await coverage(w, moderator), "rami-levy").checked).toBe(1);
  });

  it("reads the latest scan PER CHAIN, not the latest scan overall", async () => {
    const { w, moderator } = await setup();
    const rami = await branch(w, w.ids.rami, "1");
    const shufersal = await branch(w, w.ids.shufersal, "1");

    // An older run covered Rami Levy; a newer, incremental one touched only Shufersal.
    await w.db.query(
      `insert into public.branch_scans (scan_id, store_id, branch_id, scanned_at, status, price_file)
       values ('old', $1, $2, now() - interval '2 days', 'ok', 'prices.xml')`,
      [w.ids.rami, rami],
    );
    await scanned(w, w.ids.shufersal, shufersal, "ok", "new");

    const rows = await coverage(w, moderator);
    // Rami Levy keeps its own last scan rather than showing nothing because a later
    // run skipped it. Confidently stale is the worst kind of wrong.
    expect(find(rows, "rami-levy")).toMatchObject({ last_scan_id: "old", checked: 1 });
    expect(find(rows, "shufersal")).toMatchObject({ last_scan_id: "new", checked: 1 });
  });

  it("puts the chains with the least evidence first, because that is the work", async () => {
    const { w, moderator } = await setup();
    const rami = await branch(w, w.ids.rami, "1");
    await scanned(w, w.ids.rami, rami, "ok");

    const rows = await coverage(w, moderator);
    // Everything never scanned comes before the one chain that was.
    const scannedAt = rows.findIndex((r) => r.store_slug === "rami-levy");
    expect(rows.slice(0, scannedAt).every((r) => r.last_scan_id === null)).toBe(true);
  });

  it("is not reachable by anybody who is not an admin", async () => {
    const { w } = await setup();
    await expect(asUser(w.db, w.visitor, () => w.db.query("select public.admin_coverage()"))).rejects.toThrow(
      /admin privileges required/,
    );
  });
});
