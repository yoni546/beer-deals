import { describe, expect, it } from "vitest";
import { world } from "./helpers/catalog";

/**
 * The branches of a promotion, nearest first (migration 0039).
 *
 * Phase H asked for a map. A map of this data today would be an empty map —
 * `branches.latitude` is deliberately null everywhere (0026) — and it would add a
 * tile provider that sees every viewer's IP plus a map library, on an app whose
 * loudest complaint was that it was slow. What somebody actually wants from a map
 * here is one sentence: which branch near me has this. These tests are about
 * answering that from the data we hold, including the honest answer.
 */

type Row = { branch_name: string; branch_city: string | null; km: number | null; geo_precision: string | null };

/** A branch, with or without a position. */
async function branch(
  w: Awaited<ReturnType<typeof world>>,
  storeId: string,
  name: string,
  at?: { lat: number; lon: number; precision?: string },
) {
  const { rows } = await w.db.query<{ id: string }>(
    `insert into public.branches (store_id, external_ref, name_he, city, latitude, longitude, geocode_source, geocoded_at, geocode_precision)
     values ($1, $2, $3, 'תל אביב', $4::double precision, $5::double precision,
             case when $4::double precision is null then null else 'test' end,
             case when $4::double precision is null then null else now() end,
             $6)
     returning id`,
    [storeId, name, name, at?.lat ?? null, at?.lon ?? null, at?.precision ?? null],
  );
  return rows[0].id;
}

const near = async (w: Awaited<ReturnType<typeof world>>, promotionId: number, lat?: number, lon?: number) =>
  (await w.db.query<Row>("select branch_name, branch_city, km, geo_precision from public.promotion_branches_near($1, $2, $3)", [
    promotionId,
    lat ?? null,
    lon ?? null,
  ])).rows;

/**
 * A promotion seen at a set of branches, through the real write path: an occurrence
 * per branch, with a scan that counts as read.
 */
async function promotionAt(w: Awaited<ReturnType<typeof world>>, storeId: string, branchIds: string[]) {
  const { rows: promo } = await w.db.query<{ id: number }>(
    `insert into public.promotions (store_id, canonical_key, kind) values ($1, 'test-promo', 'price') returning id`,
    [storeId],
  );
  const scanId = "scan-h";
  for (const branchId of branchIds) {
    await w.db.query(
      `insert into public.branch_scans (scan_id, store_id, branch_id, scanned_at, status, price_file, promo_file)
       values ($1, $2, $3, now(), 'ok', 'p.xml', 'promo.xml')`,
      [scanId, storeId, branchId],
    );
    await w.db.query(
      `insert into public.promotion_occurrences (store_id, branch_id, canonical_key, source_file, observed_at, kind, price_agorot, published)
       values ($1, $2, 'test-promo', 'promo.xml', now(), 'price', 2490, true)`,
      [storeId, branchId],
    );
  }
  return promo[0].id;
}

describe("which branch near me has this", () => {
  it("orders by distance and says how far, when we know where they are", async () => {
    const w = await world();
    // Tel Aviv centre is about 32.08 / 34.78.
    const far = await branch(w, w.ids.rami, "רחוק", { lat: 32.8, lon: 35.0 });
    const close = await branch(w, w.ids.rami, "קרוב", { lat: 32.09, lon: 34.79 });
    const id = await promotionAt(w, w.ids.rami, [far, close]);

    const rows = await near(w, id, 32.08, 34.78);
    expect(rows.map((r) => r.branch_name)).toEqual(["קרוב", "רחוק"]);
    expect(rows[0].km).toBeLessThan(3);
    expect(rows[1].km).toBeGreaterThan(50);
  });

  it("keeps a branch we cannot place, AFTER the ones we can", async () => {
    const w = await world();
    const unplaced = await branch(w, w.ids.rami, "אלמוני");
    const placed = await branch(w, w.ids.rami, "ממוקם", { lat: 32.09, lon: 34.79 });
    const id = await promotionAt(w, w.ids.rami, [unplaced, placed]);

    const rows = await near(w, id, 32.08, 34.78);
    // Dropping it would be the worse answer: a branch we cannot locate is still a
    // branch the deal is at.
    expect(rows.map((r) => r.branch_name)).toEqual(["ממוקם", "אלמוני"]);
    expect(rows[1].km).toBeNull();
  });

  it("returns every branch with no distance at all when the person has no home", async () => {
    const w = await world();
    const a = await branch(w, w.ids.rami, "ב", { lat: 32.09, lon: 34.79 });
    const b = await branch(w, w.ids.rami, "א", { lat: 32.8, lon: 35.0 });
    const id = await promotionAt(w, w.ids.rami, [a, b]);

    const rows = await near(w, id);
    // Alphabetical, and every km null — not a zero, and not an order we cannot defend.
    expect(rows.map((r) => r.branch_name)).toEqual(["א", "ב"]);
    expect(rows.every((r) => r.km === null)).toBe(true);
  });

  it("says a town-centre fix is a town centre", async () => {
    const w = await world();
    const rough = await branch(w, w.ids.rami, "בערך", { lat: 32.09, lon: 34.79, precision: "locality" });
    const id = await promotionAt(w, w.ids.rami, [rough]);

    const rows = await near(w, id, 32.08, 34.78);
    // The screen words it ("מרכז העיר"); saying "2 km" off a city centre as if it
    // were the shop's door would be a precision we do not have.
    expect(rows[0].geo_precision).toBe("locality");
  });

  it("is readable by a visitor who is not signed in", async () => {
    const w = await world();
    const only = await branch(w, w.ids.rami, "סניף", { lat: 32.09, lon: 34.79 });
    const id = await promotionAt(w, w.ids.rami, [only]);

    const { asUser } = await import("./helpers/db");
    const rows = await asUser(
      w.db,
      null,
      () => w.db.query("select branch_name from public.promotion_branches_near($1, 32.08, 34.78)", [id]),
      "anon",
    );
    // A branch's address is public information; what would be private is storing
    // where somebody asked from, and this stores nothing.
    expect(rows.rows).toHaveLength(1);
  });

  it("says nothing about a promotion nobody has seen anywhere", async () => {
    const w = await world();
    expect(await near(w, 999999, 32.08, 34.78)).toEqual([]);
  });
});
