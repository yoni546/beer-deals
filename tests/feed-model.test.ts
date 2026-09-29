import { describe, expect, it } from "vitest";
import { asUser } from "./helpers/db";
import { inDays, world } from "./helpers/catalog";

/**
 * Migration 0014: the model the real price feeds need (docs/INGESTION-DRY-RUN.md). Each block is one
 * mismatch the dry run found, proved closed.
 */

const feedRows = (w: Awaited<ReturnType<typeof world>>, view: string, where = "true") =>
  w.asPublic(async () => (await w.db.query<Record<string, unknown>>(`select * from public.${view} where ${where}`)).rows);

describe("categories", () => {
  it("shows beer, non-alcoholic beer and radler; keeps malt drinks and cider out", async () => {
    const w = await world();
    const scope = await w.asPublic(
      async () => (await w.db.query<{ slug: string; in_scope: boolean }>("select slug, in_scope from public.product_categories order by sort_order")).rows,
    );
    expect(scope).toEqual([
      { slug: "beer", in_scope: true },
      { slug: "non_alcoholic", in_scope: true },
      { slug: "radler", in_scope: true },
      { slug: "malt", in_scope: false },
      { slug: "cider", in_scope: false },
    ]);
    expect(await w.one<{ category: string }>("select category from public.beers where slug = 'somersby'")).toEqual({ category: "cider" });
  });

  it("a pack in an out-of-scope category never reaches the app, not even as a regular price", async () => {
    const w = await world();
    const malt = await w.one<{ id: string }>(
      "insert into public.skus (beer_id, container, volume_ml, pack_quantity, display_he, variant, category) values ($1, 'bottle', 330, 6, 'x', 'מאלט', 'malt') returning id",
      [w.ids.goldstar],
    );
    await w.record({ sku: malt.id, store: w.ids.rami, kind: "regular", price: 3000 });
    await w.record({ sku: malt.id, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2000, validTo: inDays(3) });
    expect(await feedRows(w, "regular_prices_feed")).toHaveLength(0);
    expect(await feedRows(w, "offers_feed", "origin = 'catalog'")).toHaveLength(0);
  });
});

describe("variants", () => {
  it("keeps Goldstar and Goldstar Unfiltered in the same can as different SKUs", async () => {
    const w = await world();
    const insert = (variant: string) =>
      w.one<{ id: string }>(
        "insert into public.skus (beer_id, container, volume_ml, pack_quantity, display_he, variant) values ($1, 'can', 500, 1, $2, $3) returning id",
        [w.ids.goldstar, `גולדסטאר ${variant}`, variant],
      );
    const plain = await insert("");
    const unfiltered = await insert("לא מסונן");
    expect(plain.id).not.toBe(unfiltered.id);
    await expect(insert("לא מסונן")).rejects.toThrow(/skus_identity/);
  });
});

describe("only offers everyone can use are published", () => {
  for (const [label, conditions, promoType] of [
    ["club members", { audience: "club", club: "חבר מועדון" }, "price_cut"],
    ["a credit card", { audience: "payment" }, "price_cut"],
    ["a coupon", { audience: "coupon" }, "price_cut"],
    ["a personal offer", { audience: "personal" }, "price_cut"],
    ["an old-style club price", {}, "club_price"],
  ] as const) {
    it(`an offer for ${label} is kept in the ledger but reaches no screen and no notification`, async () => {
      const w = await world();
      const s = await w.sku(w.ids.goldstar, "can", 330, 6);
      await w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 3790, source: await w.source("feed-rami-levy", "chain_feed") });
      await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType, price: 2500, validTo: inDays(3), conditions });

      expect(await w.one<{ n: number }>("select count(*)::int as n from public.price_observations where kind = 'promotion'")).toEqual({ n: 1 });
      expect(await w.offers()).toHaveLength(0);
      expect(await feedRows(w, "offers_feed", "origin = 'catalog'")).toHaveLength(0);
      expect(await w.one<{ n: number }>("select count(*)::int as n from public.notification_events")).toEqual({ n: 0 });
    });
  }

  it("a universal offer is published and announced", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500, validTo: inDays(3), conditions: { audience: "everyone" } });
    expect(await w.offers()).toHaveLength(1);
    expect(await w.one<{ n: number }>("select count(*)::int as n from public.notification_events")).toEqual({ n: 1 });
  });

  it("an unknown audience is refused outright", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await expect(
      w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500, conditions: { audience: "vip" } }),
    ).rejects.toThrow(/price_obs_audience/);
  });
});

describe("deposit", () => {
  it("is carried beside the price, and a deposit difference is never a saving", async () => {
    const w = await world();
    const feed = await w.source("feed-shufersal", "chain_feed");
    const s = await w.sku(w.ids.goldstar, "bottle", 330, 6);
    // Shelf price excludes the 6 × ₪0.30 deposit; the promotion was published INCLUDING it.
    await w.record({ sku: s, store: w.ids.shufersal, kind: "regular", price: 3990, source: feed, conditions: { deposit: { agorot: 180, included: false } } });
    await w.record({
      sku: s, store: w.ids.shufersal, kind: "promotion", promoType: "price_cut", price: 3990, validTo: inDays(3), source: feed,
      conditions: { deposit: { agorot: 180, included: true } },
    });
    const [offer] = await w.offers();
    expect(offer).toMatchObject({ deposit_agorot: 180, deposit_included: true, reference_agorot: 4170 });
    // 39.90 with the deposit vs 39.90 + 1.80: a real ₪1.80 saving (4 %), not a fake 0 % or a fake bigger one.
    expect(offer.value_pct).toBe(4);

    const [regular] = await feedRows(w, "regular_prices_feed");
    expect(regular).toMatchObject({ price_agorot: 3990, deposit_agorot: 180, deposit_included: false });
  });
});

describe("chain vs branch", () => {
  it("keeps branch prices, and shows the chain's lowest with how many branches — never an invented chain price", async () => {
    const w = await world();
    const branch = async (ref: string) =>
      (await w.one<{ id: string }>(
        "insert into public.branches (store_id, external_ref, name_he, feed_chain_code, feed_sub_chain_code, feed_store_code) values ($1, $2, $2, '7290058140886', '001', $2) returning id",
        [w.ids.rami, ref],
      )).id;
    const [a, b] = [await branch("002"), await branch("039")];
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, branch: a, kind: "regular", price: 3790 });
    await w.record({ sku: s, store: w.ids.rami, branch: b, kind: "regular", price: 3590 });

    const rows = await feedRows(w, "regular_prices_feed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ price_agorot: 3590, max_price_agorot: 3790, branch_count: 2, branch_id: b });
    expect(await w.one<{ n: number }>("select count(*)::int as n from public.price_observations where status = 'live'")).toEqual({ n: 2 });
  });

  it("the same chain promotion at several branches is one offer", async () => {
    const w = await world();
    const branch = async (ref: string) =>
      (await w.one<{ id: string }>("insert into public.branches (store_id, external_ref) values ($1, $2) returning id", [w.ids.rami, ref])).id;
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    for (const ref of ["1", "2", "3"]) {
      await w.record({ sku: s, store: w.ids.rami, branch: await branch(ref), kind: "promotion", promoType: "price_cut", price: 2500, naturalKey: "P-1", validTo: inDays(3) });
    }
    const rows = await feedRows(w, "offers_feed", "origin = 'catalog'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ branch_count: 3, effective_agorot: 2500 });
    // …and one notification, not three.
    expect(await w.one<{ n: number }>("select count(*)::int as n from public.notification_events")).toEqual({ n: 1 });
  });

  it("feed codes identify a branch once, and the branch says which retailer it belongs to", async () => {
    const w = await world();
    const yb = (await w.one<{ id: string }>("select id from public.stores where slug = 'yeinot-bitan'")).id;
    // Carrefour's feed publishes a Yeinot Bitan branch: the branch row carries Carrefour's codes but Yeinot Bitan's store.
    await w.db.query(
      "insert into public.branches (store_id, external_ref, name_he, feed_chain_code, feed_sub_chain_code, feed_store_code) values ($1, '080', 'יינות ביתן טבעון', '7290055700007', '001', '080')",
      [yb],
    );
    await expect(
      w.db.query("insert into public.branches (store_id, external_ref, feed_chain_code, feed_sub_chain_code, feed_store_code) values ($1, 'x', '7290055700007', '001', '080')", [w.ids.rami]),
    ).rejects.toThrow(/branches_feed_identity/);
  });
});

describe("group (mix-and-match) promotions", () => {
  async function setup() {
    const w = await world();
    await w.source("feed-osher-ad", "chain_feed");
    const g = await w.sku(w.ids.goldstar, "bottle", 330, 6);
    const m = await w.sku(w.ids.maccabee, "bottle", 330, 6);
    const group = (extra: Record<string, unknown> = {}) => ({
      store_id: w.ids.rami, natural_key: "0001116932", description_he: "שישיית בירה גולדסטאר / מכבי 2 ב 55",
      required_qty: 2, total_agorot: 5500, sku_ids: [g, m], valid_to: inDays(3), observed_at: inDays(0), ...extra,
    });
    const record = (payload: Record<string, unknown>, role: "service_role" | "anon" = "service_role") =>
      asUser(w.db, null, async () => (await w.db.query<{ r: Record<string, unknown> }>("select public.record_promotion_group('feed-osher-ad', $1::jsonb) as r", [JSON.stringify(payload)])).rows[0].r, role);
    return { w, g, m, group, record };
  }

  it("is one offer across several packs, with the per-unit price derived — no pack gets a fake price of its own", async () => {
    const { w, group, record } = await setup();
    await record(group());
    const [offer] = await feedRows(w, "group_offers_feed");
    expect(offer).toMatchObject({ required_qty: 2, total_agorot: 5500, per_unit_agorot: 2750 });
    expect((offer.packs as unknown[]).length).toBe(2);
    expect(await w.one<{ n: number }>("select count(*)::int as n from public.price_observations")).toEqual({ n: 0 });
  });

  it("refuses a 'group' of one pack (that is an ordinary multi-buy)", async () => {
    const { g, group, record } = await setup();
    await expect(record(group({ sku_ids: [g, g] }))).rejects.toThrow(/at least two different SKUs/);
  });

  it("a club-only group is kept, held and never shown", async () => {
    const { w, group, record } = await setup();
    expect(await record(group({ audience: "club" }))).toMatchObject({ status: "held" });
    expect(await feedRows(w, "group_offers_feed")).toHaveLength(0);
  });

  it("only price writers may record one; replaying the same record adds nothing", async () => {
    const { w, group, record } = await setup();
    await expect(record(group(), "anon")).rejects.toThrow();
    const first = await record(group({ content_hash: "h1" }));
    expect(await record(group({ content_hash: "h1" }))).toMatchObject({ id: first.id, replayed: true });
    expect(await w.one<{ n: number }>("select count(*)::int as n from public.promotion_groups")).toEqual({ n: 1 });
  });

  it("an expired group disappears; a rolled-back run takes its groups with it", async () => {
    const { w, group, record } = await setup();
    await record(group({ valid_from: inDays(-5), valid_to: inDays(-1) }));
    expect(await feedRows(w, "group_offers_feed")).toHaveLength(0);

    const run = await asUser(w.db, null, async () => (await w.db.query<{ r: { run_id: string } }>("select public.start_ingestion_run('feed-osher-ad', 'file-1') as r")).rows[0].r, "service_role");
    await asUser(w.db, null, () => w.db.query("select public.record_promotion_group('feed-osher-ad', $1::jsonb, $2)", [JSON.stringify(group()), run.run_id]), "service_role");
    expect(await feedRows(w, "group_offers_feed")).toHaveLength(1);
    const undone = await asUser(w.db, null, async () => (await w.db.query<{ r: Record<string, unknown> }>("select public.rollback_ingestion_run($1, 'test') as r", [run.run_id])).rows[0].r, "service_role");
    expect(undone).toMatchObject({ groups_rejected: 1 });
    expect(await feedRows(w, "group_offers_feed")).toHaveLength(0);
  });
});

describe("source products (aliases and the review queue)", () => {
  it("are invisible to the public and to ordinary users", async () => {
    const w = await world();
    await w.db.query("insert into public.source_products (feed_chain_code, item_code, raw_name, status) values ('7290058140886', '7290000135557', 'גולדסטאר 330 מל שיש', 'review')");
    await expect(feedRows(w, "source_products")).rejects.toThrow(/permission denied/); // no grant at all for anon
    const asVisitor = await asUser(w.db, w.visitor, async () => (await w.db.query("select * from public.source_products")).rows);
    expect(asVisitor).toHaveLength(0);
    const asAdmin = await asUser(w.db, w.admin, async () => (await w.db.query("select * from public.source_products")).rows);
    expect(asAdmin).toHaveLength(1);
  });

  it("a matched product must name its SKU", async () => {
    const w = await world();
    await expect(
      w.db.query("insert into public.source_products (feed_chain_code, item_code, raw_name, status) values ('7290058140886', '1', 'x', 'matched')"),
    ).rejects.toThrow(/source_products_matched_has_sku/);
  });
});
