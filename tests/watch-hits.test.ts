import { describe, expect, it } from "vitest";
import { pickHero, watchHits } from "@/lib/offer-logic";
import type { Offer } from "@/lib/db/types";

/**
 * What Home says about a beer somebody follows (0037), and what it refuses to
 * recommend (0031).
 */

const offer = (over: Partial<Offer>): Offer =>
  ({
    offer_key: "obs:1",
    origin: "catalog",
    sku_id: "sku",
    beer_id: "beer-a",
    beer_slug: "goldstar",
    beer_name: "גולדסטאר",
    store_id: "store",
    store_slug: "rami-levy",
    store_name: "רמי לוי",
    pack_label: "שישייה",
    container: "can",
    volume_ml: 330,
    pack_quantity: 6,
    effective_agorot: 2500,
    unit_price_per_liter_agorot: null,
    reference_agorot: null,
    reference_trust: null,
    value_pct: null,
    needs_review: false,
    market_reference_agorot: null,
    market_value_pct: null,
    promo_type: "price_cut",
    conditions: {},
    valid_from: null,
    valid_to: null,
    observed_at: null,
    is_sample: false,
    notes: null,
    ...over,
  }) as Offer;

describe("a followed beer that reached your price", () => {
  it("says 'reached' only where there was a price to reach", () => {
    const withPrice = offer({ beer_id: "a", effective_agorot: 2400 });
    const withoutPrice = offer({ beer_id: "b", effective_agorot: 2400 });
    const { hits, rest } = watchHits([withPrice, withoutPrice], {
      a: { maxPriceAgorot: 2500 },
      b: { maxPriceAgorot: null },
    });

    expect(hits.map((h) => h.offer.beer_id)).toEqual(["a"]);
    // A follow with no price is about notifications, not a claim about this shelf.
    expect(rest.map((o) => o.beer_id)).toEqual(["b"]);
  });

  it("counts the ceiling itself as reached", () => {
    const { hits } = watchHits([offer({ effective_agorot: 2500 })], { "beer-a": { maxPriceAgorot: 2500 } });
    expect(hits).toHaveLength(1);
  });

  it("leaves out beers nobody is following", () => {
    const { hits, rest } = watchHits([offer({ beer_id: "zzz" })], { "beer-a": { maxPriceAgorot: 9900 } });
    expect(hits).toEqual([]);
    expect(rest).toEqual([]);
  });

  it("does not call a shelf people say is empty 'the price you were waiting for'", () => {
    const gone = offer({ effective_agorot: 1900, standing: "ended" });
    const { hits, rest } = watchHits([gone], { "beer-a": { maxPriceAgorot: 2500 } });

    // Dropped from the good news, kept in the plain list where its label can be read.
    expect(hits).toEqual([]);
    expect(rest).toHaveLength(1);
  });

  it("puts the one furthest under its price first", () => {
    const { hits } = watchHits(
      [offer({ beer_id: "a", effective_agorot: 2450 }), offer({ beer_id: "b", effective_agorot: 1800 })],
      { a: { maxPriceAgorot: 2500 }, b: { maxPriceAgorot: 2500 } },
    );
    expect(hits.map((h) => h.offer.beer_id)).toEqual(["b", "a"]);
  });
});

describe("the hero never recommends what the shelf has contradicted", () => {
  it("skips an offer people report is gone, however good it looks", () => {
    const gone = offer({ offer_key: "obs:gone", value_pct: 60, standing: "ended" });
    const fine = offer({ offer_key: "obs:fine", value_pct: 30 });

    // Left to itself the 60 % would win; it is still in every list, labelled, and it
    // is not what the app puts its name to.
    expect(pickHero([gone, fine], ["beer-a"])?.offer.offer_key).toBe("obs:fine");
  });

  it("would rather have no hero than a contradicted one", () => {
    const gone = offer({ value_pct: 60, standing: "ended" });
    expect(pickHero([gone], ["beer-a"])).toBeNull();
  });

  it("keeps a disputed offer, because 'unclear' is not 'gone'", () => {
    const disputed = offer({ offer_key: "obs:disputed", value_pct: 60, standing: "unclear" });
    expect(pickHero([disputed], ["beer-a"])?.offer.offer_key).toBe("obs:disputed");
  });
});
