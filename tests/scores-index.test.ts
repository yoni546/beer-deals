import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inDays, world } from "./helpers/catalog";

/**
 * Migration 0072: the Deal Score refresh reads an index instead of the whole price ledger.
 *
 * The first production import after the move to Frankfurt ended with
 * `deal scores: FAILED canceling statement due to statement timeout (120.2s)`, and calling
 * refresh_offer_scores() directly reproduced it three times (120.3s, 120.7s, 121.1s) against
 * service_role's 120s ceiling (0056). The work is one CTE, over 822,870 of the ledger's
 * 842,019 rows: of those, 741,475 are `superseded`, and every index this table had that
 * mentions status is `where status = 'live'` (0014, 0069). Nine tenths of what it reads had
 * no index at all, so the planner read the table and sorted it.
 *
 * Statistics were ruled out first, in production, before the index was written: `analyze
 * public.price_observations` then `analyze`, and the next call still took 121.1s.
 *
 * What is asserted here is the thing that was wrong — which relation the planner reads for
 * that CTE — not a duration, which on PGlite in CI would mean nothing.
 */
const at = (base: string, days: number) => new Date(Date.parse(base) + days * 86_400_000).toISOString();
const START = inDays(-120);

/** The `history` CTE of refresh_offer_scores (0027), on its own. */
const HISTORY = `
  select p.sku_id,
         min(p.price_agorot) as lowest_agorot,
         (percentile_cont(0.5) within group (order by p.price_agorot))::integer as typical_agorot,
         count(*)::integer as samples
    from public.price_observations p
   where p.observed_at >= now() - interval '180 days'
     and p.status in ('live', 'superseded')
   group by p.sku_id
  having count(*) >= 4`;

/**
 * A ledger shaped like production's: one pack per beer at one chain, a new price every few
 * days so that each supersedes the last. The point is the ratio — a few live rows and many
 * superseded ones — not the size, which PGlite could not carry.
 */
async function ledger() {
  const w = await world();
  await w.source("feed-shufersal", "chain_feed");
  const sku = await w.sku(w.ids.goldstar, "bottle", 330, 6);
  const other = await w.sku(w.ids.maccabee, "bottle", 330, 6);
  for (const [id, base] of [[sku, 3500], [other, 4100]] as const) {
    for (let week = 0; week < 12; week++) {
      await w.record({
        sku: id, store: w.ids.shufersal, branch: null, kind: "regular", source: "feed-shufersal",
        price: base + week * 10, observedAt: at(START, week * 7), contentHash: `${id}-${week}`,
      });
    }
  }
  await w.db.exec("analyze public.price_observations;");
  return { w, sku, other };
}

describe("0072 · the Deal Score refresh reads an index", () => {
  it("reads price_obs_scores for its history, not the table", async () => {
    const { w } = await ledger();
    // seqscan off, as tests/price-writes-index.test.ts does: PGlite's tables are far too
    // small for the planner to prefer any index on cost, and cost is not the claim here.
    await w.db.exec("set enable_seqscan = off;");
    const { rows } = await w.db.query<{ "QUERY PLAN": string }>(`explain ${HISTORY}`);
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    expect(plan).toContain("price_obs_scores");
    expect(plan).not.toMatch(/Seq Scan on price_observations/);
  });

  it("is a partial index that covers superseded rows, which the live-only indexes do not", async () => {
    const { w } = await ledger();
    const { rows } = await w.db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'public' and indexname = 'price_obs_scores'",
    );
    expect(rows).toHaveLength(1);
    const def = rows[0].indexdef;
    expect(def).toContain("superseded");
    expect(def).toMatch(/\(sku_id, observed_at, price_agorot\)/);
  });

  it("gives the same history it gave before the index, row for row", async () => {
    const { w, sku, other } = await ledger();
    const read = async () => (await w.db.query<{ sku_id: string; lowest_agorot: number; typical_agorot: number; samples: number }>(
      `${HISTORY} order by 1`,
    )).rows;

    const withIndex = await read();
    expect(withIndex).toHaveLength(2);
    // Twelve prices 3500, 3510 … 3610: lowest is the first, the median of an even count is
    // the midpoint of the two middle ones.
    expect(withIndex.find((r) => r.sku_id === sku)).toMatchObject({ lowest_agorot: 3500, typical_agorot: 3555, samples: 12 });
    expect(withIndex.find((r) => r.sku_id === other)).toMatchObject({ lowest_agorot: 4100, typical_agorot: 4155, samples: 12 });

    await w.db.exec(readFileSync(join(import.meta.dirname, "..", "supabase/rollback/0072_scores_read_an_index_not_the_ledger.down.sql"), "utf8"));
    expect(await read()).toEqual(withIndex);
  });
});

describe("0072 rollback", () => {
  it("drops the index and leaves every other index on the ledger alone", async () => {
    const { w } = await ledger();
    const names = async () => (await w.db.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'public' and tablename = 'price_observations' order by 1",
    )).rows.map((r) => r.indexname);

    const before = await names();
    expect(before).toContain("price_obs_scores");

    await w.db.exec(readFileSync(join(import.meta.dirname, "..", "supabase/rollback/0072_scores_read_an_index_not_the_ledger.down.sql"), "utf8"));
    expect(await names()).toEqual(before.filter((n) => n !== "price_obs_scores"));
  });
});
