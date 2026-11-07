import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inDays, world, type World } from "./helpers/catalog";

/**
 * Migration 0069: the live row a price is compared with is found through an index on the BRANCH, not by
 * reading every row of that pack at that chain (every branch, the whole history). The production import was
 * cancelled at its time limit every day from 27.10 because of the old way.
 *
 * Two things are proved here: the behaviour did not change (a branch's price and the chain-wide price are
 * still separate rows, an unchanged price is still seen again, a new price still supersedes only its own
 * branch), and the lookup can now use the index.
 */
const at = (base: string, days: number) => new Date(Date.parse(base) + days * 86_400_000).toISOString();
const START = inDays(-60);

async function setup(branches = 2) {
  const w = await world();
  await w.source("feed-shufersal", "chain_feed");
  const ids: string[] = [];
  for (let i = 0; i < branches; i++) {
    ids.push((await w.one<{ id: string }>(
      "insert into public.branches (store_id, external_ref, name_he) values ($1, $2, $3) returning id",
      [w.ids.shufersal, `b${i}`, `סניף ${i}`],
    )).id);
  }
  const sku = await w.sku(w.ids.goldstar, "bottle", 330, 6);
  return { w, branches: ids, sku };
}

const live = (w: World, sku: string) =>
  w.db.query<{ branch_id: string | null; price_agorot: number }>(
    "select branch_id, price_agorot from public.price_observations where sku_id = $1 and status = 'live' order by branch_id nulls first",
    [sku],
  );

describe("record_price after 0069: same behaviour", () => {
  it("keeps a branch's price and the chain-wide price apart, and a new price supersedes only its own branch", async () => {
    const { w, branches: [b1, b2], sku } = await setup();
    const p = { sku, store: w.ids.shufersal, kind: "regular" as const, source: "feed-shufersal" };
    await w.record({ ...p, branch: null, price: 3990, observedAt: START, contentHash: "chain-0" });
    await w.record({ ...p, branch: b1, price: 3690, observedAt: START, contentHash: "b1-0" });
    await w.record({ ...p, branch: b2, price: 3790, observedAt: START, contentHash: "b2-0" });

    // A new price at branch 1 replaces branch 1's row and nothing else.
    await w.record({ ...p, branch: b1, price: 3490, observedAt: at(START, 1), contentHash: "b1-1" });
    expect((await live(w, sku)).rows.map((r) => [r.branch_id, r.price_agorot])).toEqual(
      [[null, 3990], ...[[b1, 3490], [b2, 3790]].sort((x, y) => String(x[0]).localeCompare(String(y[0])))],
    );

    // A new chain-wide price replaces the chain-wide row and leaves the branches alone.
    await w.record({ ...p, branch: null, price: 3890, observedAt: at(START, 1), contentHash: "chain-1" });
    const rows = (await live(w, sku)).rows;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ branch_id: null, price_agorot: 3890 });
  });

  it("still sees an unchanged price again instead of writing it again, for a branch and for the chain", async () => {
    const { w, branches: [b1], sku } = await setup(1);
    const p = { sku, store: w.ids.shufersal, kind: "regular" as const, source: "feed-shufersal", price: 3690 };
    for (const branch of [b1, null]) {
      const first = await w.record({ ...p, branch, observedAt: START, contentHash: `${branch}-0` });
      const again = await w.record({ ...p, branch, observedAt: at(START, 1), contentHash: `${branch}-1` });
      expect(again.id).toBe(first.id);
    }
    expect((await live(w, sku)).rows).toHaveLength(2);
  });

  it("still holds a sudden change at the same branch (record_prices' check), and only there", async () => {
    const { w, branches: [b1, b2], sku } = await setup();
    const item = (branch: string, price: number, day: number) => ({
      sku_id: sku, store_id: w.ids.shufersal, branch_id: branch, kind: "regular", price_agorot: price,
      observed_at: at(START, day), content_hash: `${branch}-${day}`,
    });
    const send = (items: unknown[]) =>
      w.db.query<{ r: { accepted: number; held: number } }>("select public.record_prices('feed-shufersal', $1::jsonb) as r", [JSON.stringify(items)]);
    await w.db.exec("set role service_role;");
    try {
      await send([item(b1, 3690, 0), item(b2, 3690, 0)]);
      // Branch 1 jumps by more than 40 %; branch 2 moves a little.
      const { rows } = await send([item(b1, 6990, 1), item(b2, 3590, 1)]);
      expect(rows[0].r.held).toBe(1);
    } finally {
      await w.db.exec("reset role;");
    }
    const { rows: held } = await w.db.query<{ branch_id: string; price_agorot: number }>(
      "select branch_id, price_agorot from public.price_observations where sku_id = $1 and status = 'held'",
      [sku],
    );
    expect(held).toEqual([{ branch_id: b1, price_agorot: 6990 }]);
  });
});

describe("record_price after 0069: the lookups can use the index", () => {
  it("has no branch comparison left that an index cannot serve", async () => {
    const { w } = await setup(0);
    for (const name of ["record_price", "record_prices"]) {
      const { def } = await w.one<{ def: string }>("select pg_get_functiondef(p.oid) as def from pg_proc p where proname = $1", [name]);
      expect(def, name).not.toMatch(/branch_id is not distinct from/);
      expect(def, name).toContain("coalesce(o.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)");
    }
  });

  it("finds a branch's live row through price_obs_live_branch, with the pack, chain and branch in the index condition", async () => {
    const { w, branches, sku } = await setup(30);
    const p = { sku, store: w.ids.shufersal, kind: "regular" as const, source: "feed-shufersal" };
    // A history like production's: every branch, weekly new prices (each one supersedes the last).
    for (let week = 0; week < 6; week++) {
      for (const branch of branches) await w.record({ ...p, branch, price: 3500 + week * 10, observedAt: at(START, week * 7), contentHash: `${branch}-${week}` });
    }
    await w.db.exec("analyze public.price_observations; set enable_seqscan = off;");
    const { rows } = await w.db.query<{ "QUERY PLAN": string }>(
      `explain select o.id from public.price_observations o
        where o.sku_id = $1 and o.store_id = $2
          and coalesce(o.branch_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          and o.kind = 'regular' and o.identity_key = 'regular' and o.status = 'live'
        order by o.observed_at desc, o.id desc limit 1`,
      [sku, w.ids.shufersal, branches[7]],
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    expect(plan).toContain("price_obs_live_branch");
    expect(plan).toMatch(/Index Cond:[^\n]*COALESCE\(branch_id/);
  });
});

describe("0069 rollback", () => {
  it("puts back the 0013/0066 functions and drops the two indexes, and prices are still written the same way", async () => {
    const { w, branches: [b1], sku } = await setup(1);
    await w.db.exec(readFileSync(join(import.meta.dirname, "..", "supabase/rollback/0069_price_writes_use_an_index.down.sql"), "utf8"));
    const { def } = await w.one<{ def: string }>("select pg_get_functiondef('public.record_price'::regproc) as def");
    expect(def).toContain("branch_id is not distinct from p_branch_id");
    const { n } = await w.one<{ n: number }>(
      "select count(*)::int as n from pg_indexes where indexname in ('price_obs_live_branch', 'price_obs_live_sku_recent')",
    );
    expect(n).toBe(0);
    const p = { sku, store: w.ids.shufersal, kind: "regular" as const, source: "feed-shufersal", branch: b1 };
    await w.record({ ...p, price: 3690, observedAt: START, contentHash: "r0" });
    await w.record({ ...p, price: 3490, observedAt: at(START, 1), contentHash: "r1" });
    expect((await live(w, sku)).rows).toEqual([{ branch_id: b1, price_agorot: 3490 }]);
  });
});
