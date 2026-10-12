import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase } from "./helpers/db";

/** Every column the view exposes — compared one by one, not as a row hash. */
const COLUMNS = "offer_key, origin, sku_id, beer_id, beer_slug, beer_name, store_id, store_slug, store_name, pack_label, container, volume_ml, pack_quantity, effective_agorot, unit_price_per_liter_agorot, reference_agorot, reference_trust, value_pct, needs_review, market_reference_agorot, market_value_pct, promo_type, conditions, valid_from, valid_to, observed_at, is_sample, notes, variant, category, deposit_agorot, deposit_included, branch_count, branch_id, branch_name, branch_city, promotion_id, scope, scope_evidence, branches_known, branches_checked, branches_matching, coverage_as_of, only_branch_name, only_branch_city";

/**
 * 0044 stores the chain half of the feed instead of recomputing it per request.
 * The whole bet is that what it stores is what the view said, so that is what
 * these assert — against the source it was built from, in the same database, so
 * no two clocks are involved.
 *
 * Production measured 15,306 ms on this read, past Supabase's 8-second
 * cancellation, which is what made the change necessary.
 */
let db: PGlite;

const asWriter = async <T>(sql: string): Promise<T> => {
  await db.exec("begin; set local role service_role;");
  const result = await db.query<T>(sql);
  await db.exec("commit;");
  return result.rows[0] as T;
};

beforeAll(async () => {
  db = await freshDatabase();
  await db.exec("set app.allow_demo_seed = 'yes';\n" + readFileSync(join(process.cwd(), "supabase/seed/dev-catalog.sql"), "utf8"));
  await asWriter("select public.refresh_offers_catalog() as n");
}, 120_000);

describe("the stored chain half", () => {
  it("holds exactly what its source says", async () => {
    // Every column, both directions, in one query: a row in one and not the
    // other turns up here whichever side it is missing from.
    const { rows } = await db.query<{ side: string; n: number }>(`
      select 'stored not in source' as side, count(*)::int n from (
        select ${COLUMNS} from public.offers_catalog
        except all
        select ${COLUMNS} from public.offers_catalog_source
      ) x
      union all
      select 'source not in stored', count(*)::int from (
        select ${COLUMNS} from public.offers_catalog_source
        except all
        select ${COLUMNS} from public.offers_catalog
      ) y
    `);
    expect(rows).toEqual([
      { side: "stored not in source", n: 0 },
      { side: "source not in stored", n: 0 },
    ]);
  });

  it("is not empty, so the comparison above means something", async () => {
    const { rows } = await db.query<{ n: number }>("select count(*)::int n from public.offers_catalog");
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("keeps the feed's columns unchanged", async () => {
    // The app and every test read these by name; 0044 must not have moved one.
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'offers_feed' order by ordinal_position`,
    );
    const names = rows.map((r) => r.column_name);
    expect(names).toContain("offer_key");
    expect(names).toContain("value_pct");
    expect(names).toContain("branch_count");
    expect(names).toContain("only_branch_city");
    expect(names[0]).toBe("offer_key");
  });
});

describe("the manual half", () => {
  it("is still live, so an approved deal does not wait for the next import", async () => {
    const before = await db.query<{ n: number }>(
      "select count(*)::int n from public.offers_feed where origin = 'legacy'",
    );

    // Approve a deal the way an admin does, then read the feed WITHOUT refreshing.
    const beer = (await db.query<{ id: string }>("select id from public.beers limit 1")).rows[0];
    const store = (await db.query<{ id: string }>("select id from public.stores limit 1")).rows[0];
    const admin = (await db.query<{ id: string }>("insert into auth.users (email) values ('a@x.test') returning id")).rows[0];
    await db.query(
      `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot,
                                 status, created_by, approved_by, approved_at)
       values ($1, $2, 'sixpack', 2990, 3990, 'approved', $3, $3, now())`,
      [beer.id, store.id, admin.id],
    );

    const after = await db.query<{ n: number }>(
      "select count(*)::int n from public.offers_feed where origin = 'legacy'",
    );
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);
  });
});

describe("who may rebuild it", () => {
  it("refuses an ordinary signed-in person", async () => {
    await db.exec("begin; set local role authenticated;");
    await expect(db.query("select public.refresh_offers_catalog()")).rejects.toMatchObject({ code: "42501" });
    await db.exec("rollback;");
  });

  it("refuses the anonymous public outright", async () => {
    await db.exec("begin; set local role anon;");
    await expect(db.query("select public.refresh_offers_catalog()")).rejects.toThrow();
    await db.exec("rollback;");
  });

  it("lets nobody write the table by hand", async () => {
    await db.exec("begin; set local role authenticated;");
    await expect(db.query("delete from public.offers_catalog")).rejects.toThrow();
    await db.exec("rollback;");
  });
});
