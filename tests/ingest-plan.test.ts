import { describe, expect, it } from "vitest";
import { isGtin } from "../scripts/ingest/lib/normalize.mjs";
import { buildPlan, termsOf } from "../scripts/ingest/lib/plan.mjs";

/**
 * The 0.8.0 fixes to the ingestion plan, each on the smallest set of branches that shows it. Rows are shaped
 * exactly as the installed skill's parser emits them (tests/fixtures/ingest/*.json); the names are real
 * shelf names from the 2026-09-29 feeds.
 */
type Item = { item_code: string; item_name: string; manufacturer: string; price: number; quantity: string; unit_of_measure: string; is_weighted: boolean };
type PromoItem = { item_code: string; min_qty: string; discounted_price: string; reward_type: string };
type Promo = { promotion_id: string; description: string; club_only: boolean; club_id_raw: string; start: string; end: string; items: PromoItem[] };

const NOW = Date.parse("2026-09-29T12:00:00Z");
const item = (item_code: string, item_name: string, price: number, quantity = "1.00", unit_of_measure = "יחידות"): Item => ({
  item_code, item_name, manufacturer: "", price, quantity, unit_of_measure, is_weighted: false,
});
const promo = (promotion_id: string, description: string, items: Array<[code: string, discounted: string, minQty?: string]>): Promo => ({
  promotion_id, description, club_only: false, club_id_raw: "0", start: "2026-09-01T00:00:00.000", end: "2026-10-31T23:59:00.000",
  items: items.map(([item_code, discounted_price, min_qty = "1"]) => ({ item_code, discounted_price, min_qty, reward_type: "1" })),
});
let n = 0;
const branch = (retailer: string, items: Item[], promotions: Promo[] = []) => ({
  publisher: retailer, source: `feed-${retailer}`, retailer,
  branch: { feed_chain_code: "7290058140886", feed_sub_chain_code: "001", feed_store_code: String(++n), name_he: `סניף ${n}`, address: null, city: null },
  observedAt: "2026-09-29T09:00:00.000Z", files: [], fileHash: `h${n}`, dialect: "shufersal", items, promotions,
});

// Real barcodes (valid check digits): Carlsberg Luma 6×330, Goldstar 6×330, Carlsberg 6×330, Tuborg 6×330.
const LUMA = "7290110110369";
const GOLDSTAR6 = "7290000327822";
const CARLSBERG6 = "7290001594865";
const TUBORG6 = "7290001594858";

describe("ingestion plan: packs the row does not spell out", () => {
  it("uses real barcodes", () => {
    for (const code of [LUMA, GOLDSTAR6, CARLSBERG6, TUBORG6]) expect(isGtin(code), code).toBe(true);
  });

  it("publishes a six-pack whose name has no container word, as 'container not stated' — not held", () => {
    const plan = buildPlan([branch("rami-levy", [item(GOLDSTAR6, "בירה גולדסטאר שישייה", 39.9, "1.98", "ליטר")])], NOW);
    expect(plan.regular.map((r: { sku: string }) => r.sku)).toEqual(["goldstar||other|330|6"]);
  });

  it("a name cut before its pack word takes the pack every other reading of its barcode agrees on", () => {
    const full = branch("shufersal", [item(LUMA, "בירה קרלסברג לומה 6*330 מ\"ל בקבוק", 39.9, "1.98", "ליטר")]);
    // As Rami Levy publishes it: the name cut before "שישייה", Quantity the size of one bottle — read alone,
    // a ₪37.90 bottle of 330 ml, which the price check rejects (₪115 a litre).
    const cut = branch("rami-levy", [item(LUMA, "בירה קרלסברג לומה שי", 37.9, "330.00", "100 מיליליטר")]);
    const plan = buildPlan([full, cut], NOW);
    const rami = plan.regular.filter((r: { retailer: string }) => r.retailer === "rami-levy");
    expect(rami.map((r: { sku: string; price_agorot: number }) => [r.sku, r.price_agorot])).toEqual([["carlsberg|לומה|bottle|330|6", 3790]]);
    expect(plan.invalid).toEqual([]);
  });

  it("…but never when the readings elsewhere disagree, or there are none", () => {
    const alone = buildPlan([branch("rami-levy", [item(LUMA, "בירה קרלסברג לומה שי", 37.9, "330.00", "100 מיליליטר")])], NOW);
    expect(alone.regular).toEqual([]);
    expect(alone.invalid).toHaveLength(1);
    const disagree = buildPlan(
      [
        branch("shufersal", [item(LUMA, "בירה קרלסברג לומה 6*330 מ\"ל בקבוק", 39.9, "1.98", "ליטר")]),
        branch("tiv-taam", [item(LUMA, "בירה קרלסברג לומה 4*330 מ\"ל בקבוק", 29.9, "1.32", "ליטר")]),
        branch("rami-levy", [item(LUMA, "בירה קרלסברג לומה שי", 37.9, "330.00", "100 מיליליטר")]),
      ],
      NOW,
    );
    expect(disagree.regular.filter((r: { retailer: string }) => r.retailer === "rami-levy")).toEqual([]);
  });
});

describe("ingestion plan: public promotions are not over-filtered", () => {
  const shelf = [item(GOLDSTAR6, "בירה גולדסטאר 6*330 בקבוק", 39.9, "1.98", "ליטר"), item(CARLSBERG6, "בירה קרלסברג 6*330 בקבוק", 42.9, "1.98", "ליטר")];

  it("a price stated only once (Yochananof writes no price in the text) is confirmed by the branch's shelf price", () => {
    const plan = buildPlan([branch("yochananof", shelf, [promo("1", "גולדסטאר שישייה", [[GOLDSTAR6, "34.90"]])])], NOW);
    expect(plan.promotions.map((p: { status: string; price_agorot: number }) => [p.status, p.price_agorot])).toEqual([["live", 3490]]);
  });

  it("…and stays held when the 'saving' is not believable against the shelf price", () => {
    const plan = buildPlan([branch("yochananof", shelf, [promo("2", "גולדסטאר שישייה", [[GOLDSTAR6, "9.90"]])])], NOW);
    expect(plan.promotions.filter((p: { status: string }) => p.status === "live")).toEqual([]);
    const log = plan.promoLog as Array<{ id: string; outcome?: string }>;
    expect(log.find((l) => l.id === "2")?.outcome).toMatch(/^held/);
  });

  it("one price for several packs is one promotion per pack (no mixing is involved)", () => {
    const plan = buildPlan([branch("yochananof", shelf, [promo("3", "קרלסברג/גולדסטאר שישייה ב 29.90", [[GOLDSTAR6, "29.90"], [CARLSBERG6, "29.90"]])])], NOW);
    const live = plan.promotions.filter((p: { status: string }) => p.status === "live").map((p: { sku: string }) => p.sku).sort();
    expect(live).toEqual(["carlsberg||bottle|330|6", "goldstar||bottle|330|6"]);
  });

  it("an item we cannot read is left out of the offer, not a reason to hold the packs we did read", () => {
    const plan = buildPlan(
      // The Tuborg row says neither count nor size, and no other branch reads its barcode.
      [branch("yochananof", [...shelf, item(TUBORG6, "בירה טובורג", 29.9)], [promo("4", "גולדסטאר שישייה ב 29.90", [[GOLDSTAR6, "29.90"], [TUBORG6, "29.90"]])])],
      NOW,
    );
    const p = (plan.promotions as Array<{ status: string; raw: { promotion_id: string; items_left_out?: number } }>).find((x) => x.raw.promotion_id === "4");
    expect(p?.status).toBe("live");
    expect(p?.raw.items_left_out).toBe(1);
  });

  it("the same offer published twice (two promotion ids, same pack, price and dates) is one line", () => {
    const twice = [promo("6", "שישיית גולדסטאר ב24.90 כולל", [[GOLDSTAR6, "24.90"]]), promo("7", "שישיית גולדסטאר ב24.90 כולל", [[GOLDSTAR6, "24.90"]])];
    const plan = buildPlan([branch("rami-levy", shelf, twice)], NOW);
    expect(plan.promotions.filter((p: { status: string }) => p.status === "live")).toHaveLength(1);
  });

  it("keeps the terms a description states beside the price: a minimum basket and a per-customer limit", () => {
    expect(termsOf("שישיית גולדסטאר ב24.90 מעל 75 מו2 כולל")).toEqual({ min_basket_agorot: 7500, max_qty: 2 });
    expect(termsOf("בירה גולדסטאר 4*250מ ל ב14.90 כולל")).toEqual({});
    const plan = buildPlan([branch("rami-levy", shelf, [promo("8", "שישיית גולדסטאר ב24.90 מעל 75 מו2 כולל", [[GOLDSTAR6, "24.90"]])])], NOW);
    const p = (plan.promotions as Array<{ conditions: Record<string, unknown> }>)[0];
    expect(p.conditions).toMatchObject({ min_basket_agorot: 7500, max_qty: 2 });
  });

  it("a club price is still never published", () => {
    const club = { ...promo("5", "גולדסטאר שישייה ב 29.90 מועדון", [[GOLDSTAR6, "29.90"]]), club_id_raw: "1" };
    const plan = buildPlan([branch("tiv-taam", shelf, [club])], NOW);
    expect(plan.promotions.every((p: { status: string }) => p.status === "held")).toBe(true);
  });
});
