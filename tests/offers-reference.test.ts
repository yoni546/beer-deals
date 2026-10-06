import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inDays, world } from "./helpers/catalog";

/**
 * Migration 0022: offers_ranked finds each promotion's reference regular price with two one-row index probes
 * instead of reading every branch's price. The answer must be exactly 0018's: this branch's newest regular
 * price within 14 days, else the chain-wide (branch-less) one; never another branch's, never a stale one.
 */
async function setup() {
  const w = await world();
  const branch = async (ref: string) =>
    (await w.one<{ id: string }>("insert into public.branches (store_id, external_ref, name_he, city) values ($1, $2, $2, 'עיר') returning id", [w.ids.rami, ref])).id;
  const [b1, b2, b3] = [await branch("b1"), await branch("b2"), await branch("b3")];
  const six = await w.sku(w.ids.goldstar, "can", 330, 6);
  const regular = (price: number, branchId: string | null, days = 0) =>
    w.record({ sku: six, store: w.ids.rami, kind: "regular", price, branch: branchId, observedAt: inDays(-days) });
  const promo = (price: number, branchId: string) =>
    w.record({ sku: six, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price, branch: branchId, naturalKey: `p-${price}`, validTo: inDays(5) });

  await regular(4290, null, 1); // chain-wide
  await regular(4100, b1, 3); // b1, older …
  await regular(3990, b1, 0); // … and b1's newest
  await regular(3000, b2, 20); // b2, too old to count
  await regular(3500, b3, 0); // b3: another branch, never b2's reference
  await promo(2490, b1);
  await promo(2690, b2);
  return { w, b1, b2 };
}

describe("offers_ranked reference price (0022)", () => {
  it("is this branch's newest regular price, else the chain-wide one — never another branch's or a stale one", async () => {
    const { w, b1, b2 } = await setup();
    const rows = await w.offers();
    const ref = (branchId: string) => rows.find((r) => r.branch_id === branchId)?.reference_agorot;
    expect(ref(b1)).toBe(3990);
    expect(ref(b2)).toBe(4290);
  });

  it("returns exactly the rows 0018's definition returns", async () => {
    const { w } = await setup();
    const src = readFileSync(join(__dirname, "..", "supabase/migrations/0018_read_model_at_scale.sql"), "utf8").split("\r\n").join("\n");
    const start = src.indexOf("create or replace view public.offers_ranked");
    const end = src.indexOf(";", src.indexOf("left join market mk on mk.sku_id = o.sku_id and mk.store_id = o.store_id"));
    await w.db.exec(src.slice(start, end).replace("create or replace view public.offers_ranked", "create view public.offers_ranked_0018"));
    const diff = async (a: string, b: string) =>
      (await w.db.query<{ n: number }>(`select count(*)::int n from (select * from public.${a} except all select * from public.${b}) x`)).rows[0].n;
    expect((await w.db.query<{ n: number }>("select count(*)::int n from public.offers_ranked")).rows[0].n).toBeGreaterThan(0);
    expect(await diff("offers_ranked", "offers_ranked_0018")).toBe(0);
    expect(await diff("offers_ranked_0018", "offers_ranked")).toBe(0);
  });

  it("has the index the probes use", async () => {
    const { w } = await setup();
    const idx = await w.one<{ def: string }>("select indexdef as def from pg_indexes where indexname = 'price_obs_live_regular'");
    expect(idx.def).toMatch(/\(sku_id, store_id, branch_id, observed_at DESC, id DESC\) INCLUDE \(price_agorot, source_id\) WHERE/);
  });
});
