import { describe, expect, it } from "vitest";
import { asUser } from "./helpers/db";
import { inDays, world } from "./helpers/catalog";

/**
 * The catalogue model (migrations 0007–0009): brand · variant · container ·
 * volume_ml · pack_quantity, regular prices, promotions, history, conditions.
 *
 * These run the real SQL on Postgres, as real roles, so RLS and privileges are
 * exercised for what they are.
 */

describe("SKU identity — brand, variant, container, volume, pack", () => {
  it("keeps Goldstar 6×330ml and Goldstar 6×500ml as separate SKUs with the right volumes", async () => {
    const w = await world();
    const small = await w.sku(w.ids.goldstar, "can", 330, 6, "גולדסטאר 6×330 מ״ל פחית");
    const big = await w.sku(w.ids.goldstar, "bottle", 500, 6, "גולדסטאר 6×500 מ״ל בקבוק");

    expect(small).not.toBe(big);
    const { rows } = await w.db.query<{ volume_ml: number; pack_quantity: number; total_volume_ml: number }>(
      "select volume_ml, pack_quantity, total_volume_ml from public.skus where id = any($1::uuid[]) order by total_volume_ml",
      [[small, big]],
    );
    expect(rows.map((r) => r.total_volume_ml)).toEqual([1980, 3000]);
  });

  it("tells a can from a bottle, and a single from a multipack, when volume is the same", async () => {
    const w = await world();
    const can = await w.sku(w.ids.goldstar, "can", 500, 1);
    const bottle = await w.sku(w.ids.goldstar, "bottle", 500, 1);
    const sixCans = await w.sku(w.ids.goldstar, "can", 500, 6);
    expect(new Set([can, bottle, sixCans]).size).toBe(3);
  });

  it("refuses the same physical product twice", async () => {
    const w = await world();
    await w.sku(w.ids.goldstar, "can", 330, 6);
    await expect(w.sku(w.ids.goldstar, "can", 330, 6, "duplicate")).rejects.toMatchObject({ code: "23505" });
  });

  it("refuses nonsense sizes", async () => {
    const w = await world();
    await expect(w.sku(w.ids.goldstar, "can", 0, 6)).rejects.toMatchObject({ code: "23514" });
    await expect(w.sku(w.ids.goldstar, "can", 330, 0)).rejects.toMatchObject({ code: "23514" });
  });

  it("models a brand and its variants: Tuborg and Tuborg Red share a brand", async () => {
    const w = await world();
    const { rows } = await w.db.query<{ slug: string; brand: string; variant: string | null }>(
      `select b.slug, br.slug as brand, b.variant from public.beers b join public.brands br on br.id = b.brand_id
        where b.slug in ('tuborg', 'tuborg-red', 'goldstar') order by b.slug`,
    );
    expect(rows).toEqual([
      { slug: "goldstar", brand: "goldstar", variant: null },
      { slug: "tuborg", brand: "tuborg", variant: null },
      { slug: "tuborg-red", brand: "tuborg", variant: "red" },
    ]);

    // A brand has one beer per variant.
    const tuborg = await w.one<{ brand_id: string }>("select brand_id from public.beers where slug = 'tuborg-red'");
    await expect(
      w.db.query("insert into public.beers (slug, name_he, name_en, brand_id, variant) values ('tuborg-red-2', 'x', 'x', $1, 'red')", [tuborg.brand_id]),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("maps many barcodes to one SKU, never one barcode to two SKUs", async () => {
    const w = await world();
    const a = await w.sku(w.ids.goldstar, "can", 330, 6);
    const b = await w.sku(w.ids.goldstar, "can", 500, 6);
    const add = (sku: string, code: string, store: string | null = null) =>
      w.db.query("insert into public.sku_barcodes (sku_id, barcode, store_id) values ($1, $2, $3)", [sku, code, store]);

    await add(a, "7290000000001");
    await add(a, "7290000000002"); // a second barcode for the same SKU
    await expect(add(b, "7290000000001")).rejects.toMatchObject({ code: "23505" }); // …but not for another SKU
    // A chain's own internal code is scoped to that chain, so two chains may reuse it.
    await add(a, "12345", w.ids.rami);
    await add(b, "12345", w.ids.shufersal);
  });

  it("lets only administrators change the catalogue; everyone can read it", async () => {
    const w = await world();
    const insert = () =>
      w.db.query(
        `insert into public.skus (beer_id, container, volume_ml, pack_quantity, display_he) values ($1, 'can', 330, 24, 'x')`,
        [w.ids.goldstar],
      );
    await expect(asUser(w.db, w.visitor, insert)).rejects.toMatchObject({ code: "42501" });
    await asUser(w.db, w.admin, insert);
    const seen = await w.asPublic(() => w.db.query("select count(*)::int as n from public.skus"));
    expect(seen.rows[0]).toEqual({ n: 1 });
  });
});

describe("several SKUs of one beer at the same chain", () => {
  it("shows both packs on offer at Rami Levy at once, each with its own unit price", async () => {
    const w = await world();
    const small = await w.sku(w.ids.goldstar, "can", 330, 6);
    const big = await w.sku(w.ids.goldstar, "bottle", 500, 6);

    await w.record({ sku: small, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500 });
    await w.record({ sku: big, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 3400 });

    const rows = await w.offers("store_slug = 'rami-levy'");
    expect(rows).toHaveLength(2);
    const bySku = Object.fromEntries(rows.map((r) => [r.sku_id as string, r]));
    // ₪25.00 for 1.98 L and ₪34.00 for 3.00 L are not the same price per litre.
    expect(bySku[small].unit_price_per_liter_agorot).toBe(1263);
    expect(bySku[big].unit_price_per_liter_agorot).toBe(1133);
    expect(bySku[big].volume_ml).toBe(500);
    expect(bySku[small].pack_quantity).toBe(6);
  });

  it("keeps each SKU's price separate from the others at the same chain", async () => {
    const w = await world();
    const small = await w.sku(w.ids.goldstar, "can", 330, 6);
    const big = await w.sku(w.ids.goldstar, "can", 500, 6);
    await w.record({ sku: small, store: w.ids.rami, kind: "regular", price: 3790 });
    await w.record({ sku: big, store: w.ids.rami, kind: "regular", price: 4990 });
    await w.record({ sku: small, store: w.ids.rami, kind: "regular", price: 3990 }); // only the 330 changes

    const { rows } = await w.db.query<{ sku_id: string; price_agorot: number }>(
      "select sku_id, price_agorot from public.regular_prices_current order by price_agorot",
    );
    expect(rows).toEqual([
      { sku_id: small, price_agorot: 3990 },
      { sku_id: big, price_agorot: 4990 },
    ]);
  });
});

describe("regular price and promotion coexist", () => {
  it("stores a regular price with no promotion at all", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 3790 });
    const { rows } = await w.asPublic(() => w.db.query("select price_agorot from public.regular_prices_current"));
    expect(rows).toEqual([{ price_agorot: 3790 }]);
    expect(await w.offers()).toHaveLength(0); // a regular price is not an offer
  });

  it("holds both at once; the promotion does not replace the regular price", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 3790 });
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500, validTo: inDays(3) });

    const regular = await w.asPublic(() => w.db.query("select price_agorot from public.regular_prices_current"));
    expect(regular.rows).toEqual([{ price_agorot: 3790 }]);

    const [offer] = await w.offers();
    expect(offer).toMatchObject({ effective_agorot: 2500, reference_agorot: 3790, reference_trust: "moderated", value_pct: 34 });
  });

  it("lets a chain feed vouch for the reference as well", async () => {
    const w = await world();
    const feed = await w.source("rami-levy-feed", "chain_feed");
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 3790, source: feed });
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500, source: feed });
    expect((await w.offers())[0]).toMatchObject({ reference_trust: "feed", value_pct: 34 });
  });

  it("records several promotions on one SKU at one chain, but publishes only the one everyone can use", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2900, naturalKey: "P-100" });
    await w.record({
      sku: s, store: w.ids.rami, kind: "promotion", promoType: "club_price", price: 2500, naturalKey: "P-200",
      conditions: { club: "רמי לוי מועדון" },
    });
    // Both are in the ledger (provenance)…
    const { rows: ledger } = await w.db.query<{ n: number }>("select count(*)::int as n from public.price_observations where kind = 'promotion' and status = 'live'");
    expect(ledger[0].n).toBe(2);
    // …but a club price is not for everyone, so the app never sees it.
    const rows = await w.offers();
    expect(rows.map((r) => r.effective_agorot)).toEqual([2900]);
  });
});

describe("history is kept, never overwritten", () => {
  it("a price change is a new row; the old one is kept as superseded", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    const first = await w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 3790, observedAt: inDays(-5) });
    const second = await w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 3990, observedAt: inDays(-1) });

    const { rows } = await w.db.query<{ id: string; price_agorot: number; status: string; superseded_by: string | null }>(
      "select id::text, price_agorot, status, superseded_by::text from public.price_observations order by id",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ price_agorot: 3790, status: "superseded", superseded_by: String(second.id) });
    expect(rows[1]).toMatchObject({ price_agorot: 3990, status: "live", superseded_by: null });
    expect(String(first.id)).toBe(rows[0].id);

    const current = await w.db.query("select price_agorot from public.regular_prices_current");
    expect(current.rows).toEqual([{ price_agorot: 3990 }]);
  });

  it("back-filling an OLDER observation never replaces what is currently true", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 3990, observedAt: inDays(-1) });
    const old = await w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 3500, observedAt: inDays(-30) });

    expect(old.status).toBe("superseded"); // it is history the moment it arrives
    const current = await w.db.query("select price_agorot from public.regular_prices_current");
    expect(current.rows).toEqual([{ price_agorot: 3990 }]);
    const all = await w.db.query("select count(*)::int as n from public.price_observations");
    expect(all.rows[0]).toEqual({ n: 2 });
  });

  it("an updated promotion supersedes the earlier version of the SAME promotion only", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2900, naturalKey: "P-100", observedAt: inDays(-2) });
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2700, naturalKey: "P-200", observedAt: inDays(-2) });
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500, naturalKey: "P-100", observedAt: inDays(-1) });

    const rows = await w.offers();
    expect(rows.map((r) => r.effective_agorot)).toEqual([2500, 2700]); // P-100 updated, P-200 untouched
    const history = await w.db.query("select count(*)::int as n from public.price_observations where status = 'superseded'");
    expect(history.rows[0]).toEqual({ n: 1 });
  });

  it("ending a promotion early is another observation, not an edit", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500, naturalKey: "P-1", validTo: inDays(5), observedAt: inDays(-1) });
    expect(await w.offers()).toHaveLength(1);
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500, naturalKey: "P-1", validTo: inDays(-0.01), validFrom: inDays(-1), observedAt: inDays(0) });
    expect(await w.offers()).toHaveLength(0);
  });

  it("is append-only: prices cannot be edited or deleted, even by a superuser", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    const row = await w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 3790 });

    await expect(w.db.query("update public.price_observations set price_agorot = 1 where id = $1", [row.id])).rejects.toMatchObject({ code: "42501" });
    await expect(w.db.query("update public.price_observations set observed_at = now() where id = $1", [row.id])).rejects.toMatchObject({ code: "42501" });
    await expect(w.db.query("delete from public.price_observations where id = $1", [row.id])).rejects.toMatchObject({ code: "42501" });

    // A bad row can be rejected (that is how an import is rolled back)…
    await w.db.query("update public.price_observations set status = 'rejected' where id = $1", [row.id]);
    // …but history does not come back to life.
    await expect(w.db.query("update public.price_observations set status = 'live' where id = $1", [row.id])).rejects.toMatchObject({ code: "42501" });
  });

  it("ignores a replayed record: same source + content hash adds nothing", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    const args = { sku: s, store: w.ids.rami, kind: "regular" as const, price: 3790, contentHash: "sha:abc" };
    const first = await w.record(args);
    const again = await w.record(args);
    expect(again.id).toBe(first.id);
    const n = await w.db.query("select count(*)::int as n from public.price_observations");
    expect(n.rows[0]).toEqual({ n: 1 });
  });

  it("rolls back an import by run id without deleting anything", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    const feed = await w.source("some-feed", "chain_feed");
    const run = await w.one<{ id: string }>(
      "insert into public.ingestion_runs (source_id) select id from public.sources where slug = $1 returning id",
      [feed],
    );

    // The ingestion job (service role) records a price tagged with its run…
    await asUser(
      w.db, null,
      () => w.db.query(
        `select public.record_price(p_sku_id := $1, p_store_id := $2, p_kind := 'regular', p_price_agorot := 100,
                                    p_observed_at := now(), p_source_slug := $3, p_run_id := $4)`,
        [s, w.ids.rami, feed, run.id],
      ),
      "service_role",
    );
    expect((await w.db.query("select * from public.regular_prices_current")).rows).toHaveLength(1);

    // …and a bad run is undone by rejecting its rows, not by deleting them.
    await w.db.query("update public.price_observations set status = 'rejected' where run_id = $1", [run.id]);
    expect((await w.db.query("select * from public.regular_prices_current")).rows).toHaveLength(0);
    const kept = await w.db.query("select count(*)::int as n from public.price_observations where run_id = $1", [run.id]);
    expect(kept.rows[0]).toEqual({ n: 1 });
  });

  it("keeps unpublished (held) observations out of sight of the public", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 1000, status: "held" });

    expect(await w.offers()).toHaveLength(0);
    const asPublic = await w.asPublic(() => w.db.query("select count(*)::int as n from public.price_observations"));
    expect(asPublic.rows[0]).toEqual({ n: 0 });
    const asAdmin = await asUser(w.db, w.admin, () => w.db.query("select count(*)::int as n from public.price_observations"));
    expect(asAdmin.rows[0]).toEqual({ n: 1 });
  });
});

describe("stale or unknown reference prices never produce a fake saving", () => {
  it("gives a price but no percentage when there is no regular price to compare with", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500 });
    expect((await w.offers())[0]).toMatchObject({
      effective_agorot: 2500, reference_agorot: null, reference_trust: null, value_pct: null, needs_review: false,
    });
  });

  it("does not trust a regular price older than 14 days", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 3790, observedAt: inDays(-20) });
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500 });
    expect((await w.offers())[0]).toMatchObject({ reference_agorot: null, value_pct: null });
  });

  it("does not trust a regular price that only a user reported", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 3790, source: "user-submission" });
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500 });
    expect((await w.offers())[0]).toMatchObject({ reference_agorot: 3790, reference_trust: "unverified", value_pct: null });
  });

  it("shows no saving when the promotion is not actually cheaper", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 2500 });
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500 });
    expect((await w.offers())[0]).toMatchObject({ value_pct: null, needs_review: false });
  });

  it("holds an implausible saving (over 70 %) for review instead of showing it", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 10000 });
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500 }); // 75 %
    expect((await w.offers())[0]).toMatchObject({ value_pct: null, needs_review: true });
  });

  it("only compares with the same SKU at the same chain", async () => {
    const w = await world();
    const small = await w.sku(w.ids.goldstar, "can", 330, 6);
    const big = await w.sku(w.ids.goldstar, "can", 500, 6);
    await w.record({ sku: big, store: w.ids.rami, kind: "regular", price: 4990 }); // a DIFFERENT pack
    await w.record({ sku: small, store: w.ids.shufersal, kind: "regular", price: 3790 }); // a DIFFERENT chain
    await w.record({ sku: small, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500 });
    expect((await w.offers())[0]).toMatchObject({ reference_agorot: null, value_pct: null });
  });

  it("stops showing a promotion once it has ended, has not started, or was last seen too long ago", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    const promo = (naturalKey: string, extra: Record<string, unknown>) =>
      w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500, naturalKey, ...extra });

    await promo("ended", { validFrom: inDays(-10), validTo: inDays(-1) });
    await promo("not-yet", { validFrom: inDays(2), validTo: inDays(9) });
    await promo("running", { validFrom: inDays(-1), validTo: inDays(2) });
    await promo("open-ended-recent", { observedAt: inDays(-3) });
    await promo("open-ended-stale", { observedAt: inDays(-9) }); // end unknown + not seen for 9 days ⇒ not "still on"

    const shown = await w.db.query<{ identity_key: string }>(
      "select identity_key from public.promotions_current order by identity_key",
    );
    expect(shown.rows.map((r) => r.identity_key)).toEqual(["open-ended-recent", "running"]);
  });

  it("compares with the median of other chains as a second, separate signal", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.shufersal, kind: "regular", price: 3790 });
    await w.record({ sku: s, store: w.ids.victory, kind: "regular", price: 3990 });
    await w.record({ sku: s, store: w.ids.yochananof, kind: "regular", price: 4190 });
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500 });

    // Median of the OTHER chains is 3990; the chain's own missing "before" price is irrelevant.
    expect((await w.offers())[0]).toMatchObject({
      value_pct: null, market_reference_agorot: 3990, market_chains: 3, market_value_pct: 37,
    });
  });

  it("needs at least two other chains before it claims a market comparison", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.shufersal, kind: "regular", price: 3790 });
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500 });
    expect((await w.offers())[0]).toMatchObject({ market_reference_agorot: null, market_value_pct: null });
  });
});

describe("multi-buy promotions", () => {
  it("stores '2 for ₪45' as the per-pack price 22.50 and keeps the terms", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 3790 });
    await w.record({
      sku: s, store: w.ids.rami, kind: "promotion", promoType: "multi_buy",
      conditions: { multi_buy: { qty: 2, total_agorot: 4500 }, note_he: "בקנייה של 2" },
    });

    const [offer] = await w.offers();
    expect(offer).toMatchObject({ effective_agorot: 2250, promo_type: "multi_buy", value_pct: 41 });
    expect(offer.conditions).toEqual({ multi_buy: { qty: 2, total_agorot: 4500 }, note_he: "בקנייה של 2" });
    expect(offer.unit_price_per_liter_agorot).toBe(1136); // 22.50 / 1.98 L
  });

  it("rounds an uneven split up to the next agora ('3 for ₪100' → 33.34 each)", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    const row = await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "multi_buy", conditions: { multi_buy: { qty: 3, total_agorot: 10000 } } });
    expect(row.price_agorot).toBe(3334);
  });

  it("accepts a price that agrees with the terms and rejects one that does not", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    const conditions = { multi_buy: { qty: 2, total_agorot: 4500 } };
    const ok = await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "multi_buy", price: 2250, conditions });
    expect(ok.price_agorot).toBe(2250);
    await expect(
      w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "multi_buy", price: 2000, conditions, naturalKey: "other" }),
    ).rejects.toThrow(/must equal/);
  });

  it("requires the terms to make sense", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    const attempt = (conditions: Record<string, unknown>) =>
      w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "multi_buy", conditions });
    await expect(attempt({})).rejects.toThrow(/multi_buy needs/);
    await expect(attempt({ multi_buy: { qty: 1, total_agorot: 4500 } })).rejects.toThrow(/multi_buy needs/);
    await expect(attempt({ multi_buy: { qty: 2, total_agorot: 0 } })).rejects.toThrow(/multi_buy needs/);
  });

  it("the table itself refuses a multi-buy whose price disagrees with its terms, even if the function is bypassed", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    const src = await w.one<{ id: string }>("select id from public.sources where slug = 'admin'");
    const insert = (price: number) =>
      w.db.query(
        `insert into public.price_observations (sku_id, store_id, kind, price_agorot, observed_at, promo_type, conditions, identity_key, source_id)
         values ($1, $2, 'promotion', $3, now(), 'multi_buy', '{"multi_buy":{"qty":2,"total_agorot":4500}}', 'k', $4)`,
        [s, w.ids.rami, price, src.id],
      );
    await expect(insert(2000)).rejects.toMatchObject({ code: "23514" });
    await insert(2250);
  });

  it("does not let a regular price carry promotion fields", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    await expect(w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 3790, promoType: "price_cut" })).rejects.toThrow(/regular price has no/);
    await expect(w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 3790, validTo: inDays(3) })).rejects.toThrow(/regular price has no/);
    await expect(w.record({ sku: s, store: w.ids.rami, kind: "promotion", price: 2500 })).rejects.toThrow(/needs a promo_type/);
  });
});

describe("who may write prices", () => {
  it("lets an administrator and the service role, and nobody else", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    const base = { sku: s, store: w.ids.rami, kind: "regular" as const, price: 3790 };

    await w.record({ ...base, naturalKey: "a" }); // admin
    await w.record({ ...base, price: 3800, as: null, role: "service_role" }); // service role
    await expect(w.record({ ...base, as: w.visitor })).rejects.toMatchObject({ code: "42501" }); // signed-in visitor
    await expect(w.record({ ...base, as: null, role: "anon" })).rejects.toMatchObject({ code: "42501" }); // signed out
  });

  it("offers no direct table write to anyone, so record_price is the only door", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    const src = await w.one<{ id: string }>("select id from public.sources where slug = 'admin'");
    const insert = () =>
      w.db.query(
        `insert into public.price_observations (sku_id, store_id, kind, price_agorot, observed_at, identity_key, source_id)
         values ($1, $2, 'regular', 100, now(), 'regular', $3)`,
        [s, w.ids.rami, src.id],
      );
    await expect(asUser(w.db, w.admin, insert)).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(w.db, null, insert, "service_role")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("batch recording for ingestion", () => {
  it("applies good records and reports bad ones by position, without failing the batch", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6);
    const items = [
      { sku_id: s, store_id: w.ids.rami, kind: "regular", price_agorot: 3790, observed_at: inDays(0) },
      { sku_id: s, store_id: w.ids.rami, kind: "promotion", promo_type: "multi_buy", observed_at: inDays(0), conditions: { multi_buy: { qty: 2, total_agorot: 4500 } } },
      { sku_id: s, store_id: w.ids.rami, kind: "promotion", observed_at: inDays(0), price_agorot: 2500 }, // no promo_type → rejected
      { sku_id: "00000000-0000-0000-0000-000000000000", store_id: w.ids.rami, kind: "regular", price_agorot: 100, observed_at: inDays(0) }, // unknown sku
    ];
    const { rows } = await asUser(w.db, w.admin, () =>
      w.db.query<{ result: { accepted: number; rejected: number; errors: Array<{ index: number; message: string }> } }>(
        "select public.record_prices('admin', $1::jsonb) as result",
        [JSON.stringify(items)],
      ),
    );
    const result = rows[0].result;
    expect(result.accepted).toBe(2);
    expect(result.rejected).toBe(2);
    expect(result.errors.map((e) => e.index)).toEqual([3, 4]);
    expect((await w.offers())[0]).toMatchObject({ effective_agorot: 2250 });
  });
});

describe("offers_feed — one thing for the app to read while legacy deals still exist", () => {
  it("shows catalogue offers and admin-approved legacy deals together, and never pending ones", async () => {
    const w = await world();
    const s = await w.sku(w.ids.goldstar, "can", 330, 6, "גולדסטאר 6×330 מ״ל פחית");
    await w.record({ sku: s, store: w.ids.rami, kind: "regular", price: 3790 });
    await w.record({ sku: s, store: w.ids.rami, kind: "promotion", promoType: "price_cut", price: 2500 });

    const legacy = (status: string, price: number, store: string) =>
      w.db.query(
        `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, approved_by, approved_at)
         values ($1, $2, 'case', $3, 13900, $4::text::public.deal_status,
                 case when $4::text = 'approved' then $5::uuid end, case when $4::text = 'approved' then now() end)`,
        [w.ids.maccabee, store, price, status, w.admin],
      );
    await legacy("approved", 8900, w.ids.shufersal);
    await legacy("pending", 5000, w.ids.victory);

    const { rows } = await w.asPublic(() =>
      w.db.query<Record<string, unknown>>("select * from public.offers_feed order by origin, effective_agorot"),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ origin: "catalog", pack_label: "גולדסטאר 6×330 מ״ל פחית", volume_ml: 330, effective_agorot: 2500, value_pct: 34 });
    expect(rows[1]).toMatchObject({
      origin: "legacy", pack_label: "ארגז", sku_id: null, volume_ml: null, effective_agorot: 8900,
      reference_agorot: 13900, reference_trust: "moderated", value_pct: 36, offer_key: expect.stringMatching(/^deal:/),
    });
  });
});
