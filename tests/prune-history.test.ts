import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asUser } from "./helpers/db";
import { inDays, world, type World } from "./helpers/catalog";

/**
 * Migration 0052: an unchanged price is seen again, not written again (one sample a week is kept for the Deal
 * Score's history), and prune_history() deletes only what nothing reads.
 */
const at = (base: string, days: number) => new Date(Date.parse(base) + days * 86_400_000).toISOString();
const START = inDays(-20);

async function setup() {
  const w = await world();
  await w.source("feed-rami-levy", "chain_feed");
  const branch = (await w.one<{ id: string }>("insert into public.branches (store_id, external_ref, name_he) values ($1, 'b1', 'סניף 1') returning id", [w.ids.rami])).id;
  const sku = await w.sku(w.ids.goldstar, "bottle", 330, 6);
  return { w, branch, sku };
}

const ledger = (w: World, sku: string) =>
  w.db.query<{ id: number; status: string; price_agorot: number; observed_at: Date; first_observed_at: Date | null; superseded_by: number | null }>(
    "select id, status, price_agorot, observed_at, first_observed_at, superseded_by from public.price_observations where sku_id = $1 order by id",
    [sku],
  );

describe("record_price: unchanged is not new (0052)", () => {
  it("re-reading the same price from a newer file moves observed_at on the same row", async () => {
    const { w, branch, sku } = await setup();
    const p = { sku, store: w.ids.rami, branch, kind: "regular" as const, price: 3490, source: "feed-rami-levy" };
    const first = await w.record({ ...p, observedAt: START, contentHash: "day0" });
    const again = await w.record({ ...p, observedAt: at(START, 1), contentHash: "day1" });
    const third = await w.record({ ...p, observedAt: at(START, 2), contentHash: "day2" });
    expect(again.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    const { rows } = await ledger(w, sku);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("live");
    expect(new Date(rows[0].observed_at).toISOString()).toBe(at(START, 2));
    expect(new Date(rows[0].first_observed_at!).toISOString()).toBe(START);
  });

  it("an older file replayed changes nothing", async () => {
    const { w, branch, sku } = await setup();
    const p = { sku, store: w.ids.rami, branch, kind: "regular" as const, price: 3490, source: "feed-rami-levy" };
    await w.record({ ...p, observedAt: at(START, 2), contentHash: "day2" });
    await w.record({ ...p, observedAt: START, contentHash: "day0" });
    const { rows } = await ledger(w, sku);
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].observed_at).toISOString()).toBe(at(START, 2));
  });

  it("keeps one sample a week for the Deal Score's history", async () => {
    const { w, branch, sku } = await setup();
    const p = { sku, store: w.ids.rami, branch, kind: "regular" as const, price: 3490, source: "feed-rami-levy" };
    for (let day = 0; day <= 15; day++) await w.record({ ...p, observedAt: at(START, day), contentHash: `day${day}` });
    const { rows } = await ledger(w, sku);
    // days 0–6 → one row, 7–13 → the next, 14–15 → the third: 3 rows instead of 16.
    expect(rows.map((r) => r.status)).toEqual(["superseded", "superseded", "live"]);
    expect(rows.every((r) => r.price_agorot === 3490)).toBe(true);
  });

  it("a changed price is a new row, as before", async () => {
    const { w, branch, sku } = await setup();
    const p = { sku, store: w.ids.rami, branch, kind: "regular" as const, source: "feed-rami-levy" };
    await w.record({ ...p, price: 3490, observedAt: START, contentHash: "a" });
    await w.record({ ...p, price: 2990, observedAt: at(START, 1), contentHash: "b" });
    const { rows } = await ledger(w, sku);
    expect(rows.map((r) => [r.status, r.price_agorot])).toEqual([["superseded", 3490], ["live", 2990]]);
  });

  it("a promotion still listed in the next file stays live through close_missing_promotions", async () => {
    const { w, branch, sku } = await setup();
    const p = { sku, store: w.ids.rami, branch, kind: "promotion" as const, promoType: "price_cut" as const, price: 2490, naturalKey: "rami-levy:p:x", validTo: inDays(5), source: "feed-rami-levy" };
    const fileN1 = inDays(0); // the file's time: run.mjs passes the same instant to record and to close_missing
    await w.record({ ...p, observedAt: inDays(-1), contentHash: "file-n" });
    await w.record({ ...p, observedAt: fileN1, contentHash: "file-n1" });
    await asUser(w.db, w.admin, () => w.db.query("select public.close_missing_promotions($1, $2)", [branch, fileN1]));
    const { rows } = await ledger(w, sku);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("live");
  });
});

describe("0052 rollback", () => {
  it("puts back a new row per file, the append-only delete refusal, and removes prune_history", async () => {
    const { w, branch, sku } = await setup();
    await w.db.exec(readFileSync(join(__dirname, "..", "supabase/rollback/0052_prune_history.down.sql"), "utf8"));
    const p = { sku, store: w.ids.rami, branch, kind: "regular" as const, price: 3490, source: "feed-rami-levy" };
    await w.record({ ...p, observedAt: START, contentHash: "day0" });
    await w.record({ ...p, observedAt: at(START, 1), contentHash: "day1" });
    const statuses = await w.db.query<{ status: string }>("select status from public.price_observations where sku_id = $1 order by id", [sku]);
    expect(statuses.rows.map((r) => r.status)).toEqual(["superseded", "live"]);
    await expect(w.db.query("delete from public.price_observations where sku_id = $1", [sku])).rejects.toThrow(/append-only/);
    expect((await w.db.query("select to_regprocedure('public.prune_history(text,boolean,integer)') as f")).rows[0]).toEqual({ f: null });
  });
});

describe("prune_history (0052)", () => {
  const KINDS = ["rejected_prices", "stale_occurrences", "old_branch_scans", "old_groups"];
  const prune = async (w: World, apply: boolean) => {
    const out: Record<string, number> = {};
    for (const k of KINDS) {
      const res = await w.db.exec(`begin; set local role service_role; select public.prune_history('${k}', ${apply}, 1000) as n; commit;`);
      out[k] = Number(res[2].rows[0].n);
    }
    return out;
  };

  it("counts without p_apply, then deletes only what nothing reads", async () => {
    const { w, branch, sku } = await setup();
    const branch2 = (await w.one<{ id: string }>("insert into public.branches (store_id, external_ref, name_he) values ($1, 'b2', 'סניף 2') returning id", [w.ids.rami])).id;
    const p = { sku, store: w.ids.rami, branch, kind: "regular" as const, source: "feed-rami-levy" };
    // live 3490 superseded by 2990; then a rejected row the superseded one points at.
    await w.record({ ...p, price: 3490, observedAt: START, contentHash: "a" });
    const live = await w.record({ ...p, price: 2990, observedAt: at(START, 1), contentHash: "b" });
    await w.db.query("update public.price_observations set status = 'rejected' where id = $1", [live.id]);
    // scans: an old scan and the latest one; occurrences in the old file and in the current one.
    const scan = (id: string, b: string, file: string, when: string) =>
      w.db.query("insert into public.branch_scans (scan_id, store_id, branch_id, scanned_at, status, promo_file) values ($1, $2, $3, $4, 'ok', $5)", [id, w.ids.rami, b, when, file]);
    await scan("old", branch, "promo-old", inDays(-10));
    await scan("new", branch, "promo-new", inDays(0));
    await scan("new", branch2, "promo-b2", inDays(0));
    const occ = (b: string, file: string) =>
      w.db.query("insert into public.promotion_occurrences (store_id, branch_id, canonical_key, source_promotion_id, source_file, observed_at, kind, price_agorot, published) values ($1, $2, 'k', '1', $3, now(), 'price', 2490, true)", [w.ids.rami, b, file]);
    await occ(branch, "promo-old");
    await occ(branch, "promo-new");
    await occ(branch2, "promo-b2");

    const counted = await prune(w, false);
    expect(counted).toMatchObject({ rejected_prices: 1, stale_occurrences: 1, old_branch_scans: 1, old_groups: 0 });
    expect((await ledger(w, sku)).rows).toHaveLength(2); // counting changed nothing

    const done = await prune(w, true);
    expect(done).toMatchObject({ rejected_prices: 1, stale_occurrences: 1, old_branch_scans: 1 });
    const { rows } = await ledger(w, sku);
    expect(rows.map((r) => r.status)).toEqual(["superseded"]); // history kept; its pointer to the rejected row cleared
    expect(rows[0].superseded_by).toBeNull();
    expect((await w.db.query("select source_file from public.promotion_occurrences order by source_file")).rows).toEqual([{ source_file: "promo-b2" }, { source_file: "promo-new" }]);
    expect((await w.db.query("select distinct scan_id from public.branch_scans")).rows).toEqual([{ scan_id: "new" }]);
    expect(await prune(w, false)).toMatchObject({ rejected_prices: 0, stale_occurrences: 0, old_branch_scans: 0, old_groups: 0 });
  });

  it("is the service role's alone", async () => {
    const { w } = await setup();
    await expect(asUser(w.db, w.visitor, () => w.db.query("select public.prune_history('old_groups', false, 10)"))).rejects.toThrow(/permission denied|privileges required/);
    await expect(asUser(w.db, null, () => w.db.query("select public.prune_history('old_groups', false, 10)"), "anon")).rejects.toThrow(/permission denied/);
  });
});
