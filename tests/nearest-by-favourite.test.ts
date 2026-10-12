import { describe, expect, it } from "vitest";
import { groupByBeer, orderByIntent } from "@/lib/offer-logic";
import type { Offer } from "@/lib/db/types";

/**
 * "Closest to me", in the person's own order of beers.
 *
 * The screen began as one flat distance list, on the argument that "I want beer now"
 * is a question about where and not whose. The owner used it and said otherwise, and
 * the app's permanent rule agrees with him: favourite #1 is the app, and that does not
 * stop being true when the question is where.
 *
 * So the list is grouped by beer in the person's own ranking — and these tests hold the
 * part that is easy to lose in that change: that "closest" still means closest INSIDE
 * each beer, and that a beer nobody follows does not quietly disappear.
 */

const offer = (over: Partial<Offer> & { offer_key: string; beer_id: string }): Offer =>
  ({
    origin: "catalog",
    beer_slug: "b",
    beer_name: "בירה",
    store_id: "s",
    store_slug: "rami-levy",
    store_name: "רמי לוי",
    pack_label: "שישייה",
    effective_agorot: 2500,
    value_pct: null,
    deal_score: null,
    reference_agorot: null,
    reference_trust: null,
    market_value_pct: null,
    needs_review: false,
    conditions: {},
    is_sample: false,
    branch_id: null,
    ...over,
  }) as unknown as Offer;

const near = (offers: Offer[], km: Record<string, number>) => orderByIntent(offers, "near", km);

describe("closest to me, by the beers you like", () => {
  const goldstar = "beer-gold";
  const maccabee = "beer-macc";
  const stranger = "beer-other";

  const offers = [
    offer({ offer_key: "far-gold", beer_id: goldstar, beer_name: "גולדסטאר" }),
    offer({ offer_key: "near-gold", beer_id: goldstar, beer_name: "גולדסטאר" }),
    offer({ offer_key: "near-macc", beer_id: maccabee, beer_name: "מכבי" }),
    offer({ offer_key: "nearest-stranger", beer_id: stranger, beer_name: "בירה אחרת" }),
  ];
  const km = { "far-gold": 20, "near-gold": 3, "near-macc": 8, "nearest-stranger": 1 };

  it("leads with favourite #1, even when another beer is nearer", () => {
    const { offers: sorted } = near(offers, km);
    // Flat, the stranger at 1 km is first — that is the ordering this builds on.
    expect(sorted[0].offer_key).toBe("nearest-stranger");

    const favourites = [goldstar, maccabee];
    const mine = sorted.filter((o) => favourites.includes(o.beer_id));
    const groups = groupByBeer(mine, favourites);
    expect(groups.map((g) => g.beerId)).toEqual([goldstar, maccabee]);
  });

  it("keeps closest meaning closest INSIDE each beer", () => {
    const { offers: sorted } = near(offers, km);
    const groups = groupByBeer(sorted.filter((o) => o.beer_id === goldstar), [goldstar]);
    expect(groups[0].offers.map((o) => o.offer_key)).toEqual(["near-gold", "far-gold"]);
  });

  it("does not drop a beer nobody follows", () => {
    const { offers: sorted } = near(offers, km);
    const favourites = new Set([goldstar, maccabee]);
    const rest = sorted.filter((o) => !favourites.has(o.beer_id));
    expect(rest.map((o) => o.offer_key)).toEqual(["nearest-stranger"]);
  });

  it("still refuses to place an offer it cannot measure", () => {
    const { offers: sorted, unplaceable } = near(offers, { "near-gold": 3 });
    expect(sorted.map((o) => o.offer_key)).toEqual(["near-gold"]);
    expect(unplaceable).toBe(3);
  });
});
