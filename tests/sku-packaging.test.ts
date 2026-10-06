import { describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyMigration, freshDatabase } from "./helpers/db";

/**
 * Migration 0021: a SKU's pack form. A ארגז (bottle_crate) takes evidence; nothing becomes one by its count.
 */
const beerId = async (db: PGlite) => (await db.query<{ id: string }>("select id from public.beers where slug = 'stella'")).rows[0].id;
const sku = async (db: PGlite, container: string, qty: number, packaging: string | null = null) =>
  (
    await db.query<{ id: string; packaging: string }>(
      "insert into public.skus (beer_id, container, volume_ml, pack_quantity, display_he, packaging) values ($1, $2, 330, $3, 'x', $4) returning id, packaging",
      [await beerId(db), container, qty, packaging],
    )
  ).rows[0];

describe("skus.packaging (0021)", () => {
  it("defaults from the count — single or multipack, never a crate", async () => {
    const db = await freshDatabase();
    expect((await sku(db, "bottle", 1)).packaging).toBe("single");
    expect((await sku(db, "can", 24)).packaging).toBe("multipack");
    expect((await sku(db, "bottle", 24)).packaging).toBe("multipack"); // 24 bottles alone: no evidence
  });

  it("a crate is bottles, 12 or more; a single is one unit", async () => {
    const db = await freshDatabase();
    expect((await sku(db, "bottle", 24, "bottle_crate")).packaging).toBe("bottle_crate");
    await expect(sku(db, "can", 24, "bottle_crate")).rejects.toThrow(/skus_crate_is_bottles/);
    await expect(sku(db, "bottle", 6, "bottle_crate")).rejects.toThrow(/skus_crate_is_bottles/);
    await expect(sku(db, "bottle", 6, "single")).rejects.toThrow(/skus_packaging_matches_count/);
    await expect(sku(db, "bottle", 12, "box")).rejects.toThrow(/skus_packaging_known/);
  });

  it("a crate and a carton of the same 24 bottles are two products", async () => {
    const db = await freshDatabase();
    await sku(db, "bottle", 24, "bottle_crate");
    await sku(db, "bottle", 24, "multipack");
    await expect(sku(db, "bottle", 24, "multipack")).rejects.toThrow(/skus_identity/);
  });

  it("the backfill marks a crate only where the chain's own title says ארגז on bottles", async () => {
    const db = await freshDatabase({ through: "0020" });
    const id = await beerId(db);
    const add = async (container: string, qty: number, title: string) => {
      const s = (await db.query<{ id: string }>("insert into public.skus (beer_id, container, volume_ml, pack_quantity, display_he) values ($1, $2, $3, $4, 'x') returning id", [id, container, 300 + qty, qty])).rows[0].id;
      await db.query("insert into public.source_products (feed_chain_code, item_code, raw_name, sku_id, status) values ('7290000000000', $1, $2, $3, 'matched')", [String(qty) + container, title, s]);
      return s;
    };
    const crate = await add("bottle", 24, "ארגז בירה סטלה בקבוק 330  מל- 24 יח");
    const carton = await add("bottle", 20, "קרטון ארגז 20 בקבוקים");
    const cans = await add("can", 18, "ארגז 18 פחיות");
    const plain = await add("bottle", 12, "סטלה 12 בקבוקים");
    await applyMigration(db, "0021");
    const got = Object.fromEntries((await db.query<{ id: string; packaging: string }>("select id, packaging from public.skus")).rows.map((r) => [r.id, r.packaging]));
    expect([got[crate], got[carton], got[cans], got[plain]]).toEqual(["bottle_crate", "multipack", "multipack", "multipack"]);
  });
});
