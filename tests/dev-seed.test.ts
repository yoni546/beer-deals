import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers/db";
import { asUser } from "./helpers/db";

const SEED = (name: string) => readFileSync(join(import.meta.dirname, "..", "supabase", "seed", name), "utf8");
const CONFIRM = "set app.allow_demo_seed = 'yes';\n";

describe("supabase/seed/dev-catalog.sql", () => {
  it("refuses to run unless the operator says the database is not production", async () => {
    const db = await freshDatabase();
    await expect(db.exec(SEED("dev-catalog.sql"))).rejects.toThrow(/Refusing to insert sample catalogue data/);
    const { rows } = await db.query("select count(*)::int as n from public.skus");
    expect(rows[0]).toEqual({ n: 0 });
  });

  it("builds a catalogue with several packs per beer and prices at several chains", async () => {
    const db = await freshDatabase();
    await db.exec(CONFIRM + SEED("dev-catalog.sql"));

    const goldstar = await db.query<{ n: number }>(
      "select count(*)::int as n from public.skus s join public.beers b on b.id = s.beer_id where b.slug = 'goldstar'",
    );
    expect(goldstar.rows[0].n).toBe(4); // 6×330 can, 6×500 can, 6×330 bottle, 24×330 can

    const feed = await asUser(db, null, () => db.query<Record<string, unknown>>("select * from public.offers_feed order by origin, effective_agorot"), "anon");
    expect(feed.rows).toHaveLength(9); // 10 promotions in the seed; the club price is not published
    expect(feed.rows.every((r) => r.is_sample === true)).toBe(true);
  });

  it("covers the awkward cases the app must handle", async () => {
    const db = await freshDatabase();
    await db.exec(CONFIRM + SEED("dev-catalog.sql"));
    const offer = async (beer: string, store: string, volume: number, pack: number) =>
      (
        await asUser(
          db, null,
          () => db.query<Record<string, unknown>>(
            "select * from public.offers_feed where beer_slug = $1 and store_slug = $2 and volume_ml = $3 and pack_quantity = $4",
            [beer, store, volume, pack],
          ),
          "anon",
        )
      ).rows[0];

    // Plain cut, with a reference: 25.00 against 37.90.
    expect(await offer("goldstar", "rami-levy", 330, 6)).toMatchObject({ effective_agorot: 2500, reference_agorot: 3790, value_pct: 34 });
    // Multi-buy: "2 for ₪80.00" is ₪40.00 a pack, against 49.90.
    expect(await offer("goldstar", "rami-levy", 500, 6)).toMatchObject({ promo_type: "multi_buy", effective_agorot: 4000, value_pct: 20 });
    // A club price is recorded but never published: it is not available to everyone.
    expect(await offer("goldstar", "shufersal", 330, 6)).toBeUndefined();
    // Two packs of one beer on offer at the same chain, at different unit prices.
    const small = await offer("goldstar", "rami-levy", 330, 6);
    const dozens = await offer("goldstar", "rami-levy", 330, 24);
    expect(small.unit_price_per_liter_agorot).not.toBe(dozens.unit_price_per_liter_agorot);
    // No known regular price: a price, but no percentage.
    expect(await offer("heineken", "victory", 330, 6)).toMatchObject({ effective_agorot: 3690, reference_agorot: null, value_pct: null });
  });

  it("is safe to run twice", async () => {
    const db = await freshDatabase();
    await db.exec(CONFIRM + SEED("dev-catalog.sql"));
    const count = async () => (await db.query<{ n: number }>("select count(*)::int as n from public.price_observations")).rows[0].n;
    const first = await count();
    await db.exec(SEED("dev-catalog.sql"));
    expect(await count()).toBe(first);
  });
});

describe("supabase/seed/dev-demo-deals.sql", () => {
  it("refuses to run unless the operator confirms, and inserts nothing when refused", async () => {
    const db = await freshDatabase();
    await expect(db.exec(SEED("dev-demo-deals.sql"))).rejects.toThrow(/Refusing to insert sample deals/);
    expect((await db.query("select count(*)::int as n from public.deals")).rows[0]).toEqual({ n: 0 });
  });
});
