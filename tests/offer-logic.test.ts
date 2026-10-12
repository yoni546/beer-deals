import { describe, expect, it } from "vitest";
import type { Offer, RegularPrice } from "@/lib/db/types";
import {
  PACK_FILTERS,
  classOfPack,
  filterByPack,
  groupPackClass,
  homeOrder,
  orderForHome,
  packOrder,
  filterRegularByPack,
  groupByBeer,
  groupByPack,
  groupRegularByBeer,
  groupRegularByPack,
  orderPackGroups,
  newestObservation,
  packClass,
  parseIntent,
  orderByIntent,
  parsePack,
  parseSort,
  pickHero,
  sortOffers,
  summarize,
} from "@/lib/offer-logic";

let counter = 0;
/** An offer with sensible defaults; each test overrides what it cares about. */
function offer(overrides: Partial<Offer> = {}): Offer {
  counter += 1;
  return {
    offer_key: `obs:${counter}`, origin: "catalog", sku_id: `sku-${counter}`,
    beer_id: "b-goldstar", beer_slug: "goldstar", beer_name: "גולדסטאר",
    store_id: "s-rami", store_slug: "rami-levy", store_name: "רמי לוי",
    pack_label: "גולדסטאר 6×330 מ״ל פחית", container: "can", volume_ml: 330, pack_quantity: 6,
    effective_agorot: 2500, unit_price_per_liter_agorot: 1263,
    reference_agorot: 3790, reference_trust: "moderated", value_pct: 34, needs_review: false,
    market_reference_agorot: null, market_value_pct: null, promo_type: "price_cut", conditions: {},
    valid_from: null, valid_to: null, observed_at: "2026-09-29T08:00:00Z", is_sample: false, notes: null,
    ...overrides,
  };
}

describe("what the person is after right now", () => {
  const near = (score: number | null, km?: number) => ({
    offer: offer({
      effective_agorot: 2500,
      deal_score: score === null ? null : { score, band: score >= 85 ? "amazing" : "fair" },
    }),
    km,
  });

  const build = (rows: ReturnType<typeof near>[]) => ({
    offers: rows.map((r) => r.offer),
    distances: Object.fromEntries(
      rows.filter((r) => r.km !== undefined).map((r) => [r.offer.offer_key, r.km!]),
    ),
  });

  it("reads the intent from the URL, and defaults to best value", () => {
    expect(parseIntent("near")).toBe("near");
    expect(parseIntent("best")).toBe("best");
    expect(parseIntent(undefined)).toBe("best");
    expect(parseIntent("nonsense")).toBe("best");
  });

  it("'best' puts the strongest score first, whatever the distance", () => {
    const rows = [near(50, 1), near(94, 40), near(70, 2)];
    const { offers, unplaceable } = orderByIntent(rows.map((r) => r.offer), "best", build(rows).distances);
    expect(offers.map((o) => o.deal_score?.score)).toEqual([94, 70, 50]);
    expect(unplaceable).toBe(0);
  });

  it("'closest' puts the nearest first, and uses the score only to break a tie", () => {
    const rows = [near(50, 12), near(94, 3), near(60, 3)];
    const { offers } = orderByIntent(rows.map((r) => r.offer), "near", build(rows).distances);
    // 3 km before 12 km; between the two at 3 km, the better deal.
    expect(offers.map((o) => o.deal_score?.score)).toEqual([94, 60, 50]);
  });

  it("'closest' LEAVES OUT what it cannot measure, and says how many", () => {
    // The whole point: an offer with no distance must not be shown at the bottom of a
    // list labelled by distance. That would be claiming a distance we do not have.
    const rows = [near(50, 4), near(94), near(60)];
    const { offers, unplaceable } = orderByIntent(rows.map((r) => r.offer), "near", build(rows).distances);
    expect(offers).toHaveLength(1);
    expect(offers[0].deal_score?.score).toBe(50);
    expect(unplaceable).toBe(2);
  });

  it("'closest' with nothing placeable returns nothing, not a reordered list", () => {
    const rows = [near(94), near(60)];
    const { offers, unplaceable } = orderByIntent(rows.map((r) => r.offer), "near", {});
    expect(offers).toEqual([]);
    expect(unplaceable).toBe(2);
  });

  it("'best' still shows a deal with no score at all — it is a deal, just an unrated one", () => {
    const rows = [near(null, 5), near(80, 5)];
    const { offers } = orderByIntent(rows.map((r) => r.offer), "best", build(rows).distances);
    expect(offers).toHaveLength(2);
    expect(offers[0].deal_score?.score).toBe(80);
  });

  it("'best' uses distance only to separate two equally good deals", () => {
    const rows = [near(80, 30), near(80, 2)];
    const { offers } = orderByIntent(rows.map((r) => r.offer), "best", build(rows).distances);
    expect(build(rows).distances[offers[0].offer_key]).toBe(2);
  });

  it("changes nothing about the offers themselves", () => {
    const rows = [near(50, 4), near(94, 1)];
    const before = JSON.stringify(rows.map((r) => r.offer));
    orderByIntent(rows.map((r) => r.offer), "near", build(rows).distances);
    orderByIntent(rows.map((r) => r.offer), "best", build(rows).distances);
    expect(JSON.stringify(rows.map((r) => r.offer))).toBe(before);
  });
});

describe("sorting", () => {
  const a = offer({ effective_agorot: 3000, value_pct: 20, unit_price_per_liter_agorot: 1515 });
  const b = offer({ effective_agorot: 2500, value_pct: 34, unit_price_per_liter_agorot: 1263 });
  const c = offer({ effective_agorot: 2700, value_pct: null, reference_agorot: null, reference_trust: null, unit_price_per_liter_agorot: 1364 });

  it("orders by verified saving by default, and puts offers with no verified saving after those that have one", () => {
    expect(sortOffers([a, b, c], "value").map((o) => o.effective_agorot)).toEqual([2500, 3000, 2700]);
  });

  it("orders by price, low to high and high to low", () => {
    expect(sortOffers([a, b, c], "price_asc").map((o) => o.effective_agorot)).toEqual([2500, 2700, 3000]);
    expect(sortOffers([a, b, c], "price_desc").map((o) => o.effective_agorot)).toEqual([3000, 2700, 2500]);
  });

  it("compares per litre when asked, so a big pack is not judged by its bigger total", () => {
    const six = offer({ effective_agorot: 2500, unit_price_per_liter_agorot: 1263 }); // 1.98 L
    const twentyFour = offer({ effective_agorot: 8900, unit_price_per_liter_agorot: 1124 }); // 7.92 L
    expect(sortOffers([six, twentyFour], "price_asc", false)[0]).toBe(six); // by pack: the small one is "cheaper"
    expect(sortOffers([six, twentyFour], "price_asc", true)[0]).toBe(twentyFour); // by litre: the big one is
  });

  it("puts offers with no per-litre price (legacy deals) last in either direction", () => {
    const legacy = offer({ origin: "legacy", unit_price_per_liter_agorot: null, effective_agorot: 100 });
    const real = offer({ effective_agorot: 2500, unit_price_per_liter_agorot: 1263 });
    expect(sortOffers([legacy, real], "price_asc", true)[0]).toBe(real);
    expect(sortOffers([legacy, real], "price_desc", true)[0]).toBe(real);
  });

  it("does not mutate its input", () => {
    const input = [a, b, c];
    sortOffers(input, "price_asc");
    expect(input).toEqual([a, b, c]);
  });
});

describe("URL parsing", () => {
  it("falls back to sane defaults for anything unrecognised", () => {
    expect(parseSort("nonsense")).toBe("value");
    expect(parseSort(undefined)).toBe("value");
    expect(parseSort("price_desc")).toBe("price_desc");
    expect(parsePack("nonsense")).toBe("all");
  });

  it("keeps old links and push notifications working by mapping the old pack categories", () => {
    expect(parsePack(undefined, "sixpack")).toBe("small_multipack");
    expect(parsePack("multi")).toBe("small_multipack"); // 0.7.x "מארזים" links
    expect(parsePack(undefined, "case")).toBe("case");
    expect(parsePack(undefined, "single")).toBe("single");
    expect(parsePack("case", "single")).toBe("case"); // the new parameter wins
  });
});

describe("pack classes", () => {
  it("classifies catalogue offers by how many are in the pack and what they come in", () => {
    expect(packClass(offer({ pack_quantity: 1 }))).toBe("single");
    expect(packClass(offer({ pack_quantity: 6 }))).toBe("small_multipack");
    expect(packClass(offer({ pack_quantity: 24, container: "bottle", packaging: "bottle_crate" }))).toBe("case"); // 24×330 bottles, a crate on evidence
    expect(packClass(offer({ pack_quantity: 20, volume_ml: 500, container: "bottle", packaging: "bottle_crate" }))).toBe("case"); // 20×500 bottles in a crate
    expect(packClass(offer({ pack_quantity: 24, container: "can", packaging: "multipack" }))).toBe("small_multipack"); // a 24-can tray is not a ארגז
    // 24 bottles with no crate evidence (a carton, or a form nobody stated) are a multipack — the count is not evidence.
    expect(packClass(offer({ pack_quantity: 24, container: "bottle", packaging: "multipack" }))).toBe("small_multipack");
    expect(packClass(offer({ pack_quantity: 24, container: "bottle", packaging: null }))).toBe("small_multipack");
    expect(packClass(offer({ pack_quantity: 12, container: "bottle" }))).toBe("small_multipack");
  });

  it("has exactly three kinds: 1 is single; a crate only on evidence (packaging); everything else is a multipack", () => {
    const counts = [1, 2, 4, 6, 8, 10, 12, 18, 20, 24, 30];
    // No count, however large, makes a crate by itself.
    for (const packaging of ["multipack", null, undefined] as const) {
      expect(counts.map((n) => classOfPack({ pack_quantity: n, packaging }))).toEqual(counts.map((n) => (n === 1 ? "single" : "small_multipack")));
    }
    // Evidence makes it one.
    expect(classOfPack({ pack_quantity: 24, packaging: "bottle_crate" })).toBe("case");
    expect(classOfPack({ pack_quantity: 20, packaging: "bottle_crate" })).toBe("case");
    expect(classOfPack({ pack_quantity: null })).toBe("single");
    // The filters a person sees: packs, cases, singles — and no "multi"/"מארזים".
    expect(PACK_FILTERS).toEqual(["all", "small_multipack", "case", "single"]);
  });

  it("classifies a mix-and-match offer by the kind most of its packs are", () => {
    const packs = (...ns: number[]) => ({ packs: ns.map((pack_quantity) => ({ pack_quantity, packaging: pack_quantity >= 12 ? ("bottle_crate" as const) : null })) });
    expect(groupPackClass(packs(6, 6))).toBe("small_multipack");
    expect(groupPackClass(packs(1, 1, 6))).toBe("single");
    expect(groupPackClass(packs(24))).toBe("case");
    expect(groupPackClass({ packs: [{ pack_quantity: 24, packaging: "multipack" }] })).toBe("small_multipack");
  });

  it("classifies legacy deals by their category label", () => {
    const legacy = (pack_label: string) => offer({ origin: "legacy", pack_label, pack_quantity: null, sku_id: null });
    expect(packClass(legacy("בודד"))).toBe("single");
    expect(packClass(legacy("שישייה"))).toBe("small_multipack");
    expect(packClass(legacy("ארגז"))).toBe("case");
  });

  it("filters", () => {
    const list = [offer({ pack_quantity: 1 }), offer({ pack_quantity: 6 }), offer({ pack_quantity: 24, container: "bottle", packaging: "bottle_crate" })];
    expect(filterByPack(list, "all")).toHaveLength(3);
    expect(filterByPack(list, "case").map((o) => o.pack_quantity)).toEqual([24]);
  });
});

describe("grouping", () => {
  it("never mixes two packs of one beer in a group (Goldstar 6×330 vs 6×500)", () => {
    const small = offer({ sku_id: "sku-330", pack_label: "6×330", store_slug: "rami-levy" });
    const big = offer({ sku_id: "sku-500", pack_label: "6×500", store_slug: "rami-levy" });
    const small2 = offer({ sku_id: "sku-330", pack_label: "6×330", store_slug: "shufersal" });
    const groups = groupByPack([small, big, small2]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.key === "sku-330")?.offers).toHaveLength(2);
  });

  it("groups legacy deals by their pack label, since they have no SKU", () => {
    const l = (label: string) => offer({ origin: "legacy", sku_id: null, pack_label: label });
    expect(groupByPack([l("שישייה"), l("ארגז"), l("שישייה")]).map((g) => g.offers.length).sort()).toEqual([1, 2]);
  });

  it("orders beers by the person's ranking, then the rest in their incoming order", () => {
    const beers = ["b-x", "b-corona", "b-y", "b-goldstar"].map((id) => offer({ beer_id: id, beer_slug: id, beer_name: id }));
    const order = groupByBeer(beers, ["b-goldstar", "b-corona"]).map((g) => g.beerId);
    expect(order).toEqual(["b-goldstar", "b-corona", "b-x", "b-y"]);
  });
});

describe("the hero — 'best deal now'", () => {
  const favourites = ["b-goldstar", "b-maccabee", "b-heineken", "b-corona"];

  it("prefers a favourite's best VERIFIED saving over a bigger saving on a beer they do not follow", () => {
    const mine = offer({ beer_id: "b-maccabee", value_pct: 25 });
    const other = offer({ beer_id: "b-guinness", value_pct: 60 });
    expect(pickHero([other, mine], favourites)).toMatchObject({ offer: mine, reason: "value" });
  });

  it("breaks a tie on saving by the person's own ranking", () => {
    const second = offer({ beer_id: "b-maccabee", value_pct: 30 });
    const first = offer({ beer_id: "b-goldstar", value_pct: 30 });
    expect(pickHero([second, first], favourites)?.offer).toBe(first);
  });

  it("falls back to a favourite that beats other chains' regular prices", () => {
    const market = offer({ beer_id: "b-corona", value_pct: null, market_value_pct: 22 });
    expect(pickHero([market], favourites)).toMatchObject({ offer: market, reason: "market" });
  });

  it("uses the best verified saving elsewhere when no favourite has one", () => {
    const stranger = offer({ beer_id: "b-guinness", value_pct: 40 });
    const noBasis = offer({ beer_id: "b-goldstar", value_pct: null, market_value_pct: null });
    expect(pickHero([noBasis, stranger], favourites)).toMatchObject({ offer: stranger, reason: "value" });
  });

  it("never crowns an offer with no basis for calling it good on price alone from a beer they do not follow", () => {
    const cheapButUnknown = offer({ beer_id: "b-guinness", value_pct: null, market_value_pct: null, effective_agorot: 100 });
    expect(pickHero([cheapButUnknown], favourites)).toBeNull();
  });

  it("as a last resort names the cheapest per-litre favourite, labelled as such", () => {
    const a = offer({ beer_id: "b-corona", value_pct: null, unit_price_per_liter_agorot: 1500 });
    const b = offer({ beer_id: "b-heineken", value_pct: null, unit_price_per_liter_agorot: 1100 });
    expect(pickHero([a, b], favourites)).toMatchObject({ offer: b, reason: "favourite" });
  });

  it("returns nothing for nothing", () => {
    expect(pickHero([], favourites)).toBeNull();
  });
});

describe("summaries", () => {
  it("counts offers and reports the best verified saving, ignoring unverified ones", () => {
    expect(summarize([{ value_pct: 20 }, { value_pct: null }, { value_pct: 35 }])).toEqual({ count: 3, bestValuePct: 35 });
    expect(summarize([{ value_pct: null }])).toEqual({ count: 1, bestValuePct: null });
    expect(summarize([])).toEqual({ count: 0, bestValuePct: null });
  });

  it("finds the newest observation", () => {
    expect(newestObservation([{ observed_at: "2026-09-27T00:00:00Z" }, { observed_at: "2026-09-29T00:00:00Z" }, { observed_at: null }])).toBe("2026-09-29T00:00:00Z");
    expect(newestObservation([{ observed_at: null }])).toBeNull();
  });
});

let regularCounter = 0;
function regular(overrides: Partial<RegularPrice> = {}): RegularPrice {
  regularCounter += 1;
  return {
    observation_id: regularCounter, sku_id: "sku-6x330", beer_id: "b-goldstar", beer_slug: "goldstar", beer_name: "גולדסטאר",
    container: "can", volume_ml: 330, pack_quantity: 6, pack_label: "גולדסטאר 6×330 מ״ל פחית",
    store_id: "s-rami", store_slug: "rami-levy", store_name: "רמי לוי", price_agorot: 3790, unit_price_per_liter_agorot: 1914,
    observed_at: "2026-09-29T08:00:00Z", is_sample: false, trust: "feed", is_stale: false,
    ...overrides,
  };
}

describe("pack ordering", () => {
  it("lists packs by kind (packs, cases, singles), and 6×330 before 6×500", () => {
    const big = offer({ sku_id: "24x330", volume_ml: 330, pack_quantity: 24, container: "bottle", packaging: "bottle_crate", pack_label: "24 × 330" });
    const mid = offer({ sku_id: "6x500", volume_ml: 500, pack_quantity: 6, pack_label: "6 × 500" });
    const small = offer({ sku_id: "6x330", volume_ml: 330, pack_quantity: 6, pack_label: "6 × 330" });
    const one = offer({ sku_id: "1x330", volume_ml: 330, pack_quantity: 1, pack_label: "330" });
    expect(orderPackGroups(groupByPack([one, big, mid, small])).map((g) => g.key)).toEqual(["6x330", "6x500", "24x330", "1x330"]);
  });

  it("orders the packs six, then eight, then four, then the rare others — unless a price sort is chosen", () => {
    const pack = (n: number, price: number) => offer({ sku_id: `${n}x330`, pack_quantity: n, effective_agorot: price, pack_label: String(n) });
    const list = [pack(4, 1500), pack(2, 900), pack(8, 3000), pack(6, 2500)];
    expect(orderPackGroups(groupByPack(list)).map((g) => g.key)).toEqual(["6x330", "8x330", "4x330", "2x330"]);
    expect(orderPackGroups(groupByPack(list), "price_asc").map((g) => g.key)).toEqual(["2x330", "4x330", "6x330", "8x330"]);
    expect(orderPackGroups(groupByPack(list), "price_desc").map((g) => g.key)).toEqual(["8x330", "6x330", "4x330", "2x330"]);
    expect([6, 8, 4, 10].map(packOrder)).toEqual([...[6, 8, 4, 10].map(packOrder)].sort((a, b) => a - b));
  });

  it("keeps Goldstar 6×330 and 6×500 as two groups", () => {
    const groups = groupByPack([offer({ sku_id: "6x330" }), offer({ sku_id: "6x500", volume_ml: 500 }), offer({ sku_id: "6x330" })]);
    expect(groups.map((g) => [g.key, g.offers.length])).toEqual([["6x330", 2], ["6x500", 1]]);
  });
});

describe("regular prices", () => {
  it("groups by pack with the cheapest chain first, and never mixes pack sizes", () => {
    const groups = groupRegularByPack([
      regular({ sku_id: "6x500", volume_ml: 500, pack_label: "6 × 500", price_agorot: 4590, store_name: "שופרסל" }),
      regular({ price_agorot: 3990, store_name: "שופרסל" }),
      regular({ price_agorot: 3790, store_name: "רמי לוי" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["sku-6x330", "6x500"]);
    expect(groups[0].prices.map((p) => p.price_agorot)).toEqual([3790, 3990]);
  });

  it("filters by pack kind: single, multipack, bottle crate", () => {
    const prices = [regular({ pack_quantity: 1 }), regular({ pack_quantity: 6 }), regular({ pack_quantity: 24, container: "bottle", packaging: "bottle_crate" }), regular({ pack_quantity: 24, container: "can", packaging: "multipack" })];
    expect(filterRegularByPack(prices, "single").map((p) => p.pack_quantity)).toEqual([1]);
    expect(filterRegularByPack(prices, "small_multipack").map((p) => [p.pack_quantity, p.container])).toEqual([[6, "can"], [24, "can"]]);
    expect(filterRegularByPack(prices, "case").map((p) => [p.pack_quantity, p.container])).toEqual([[24, "bottle"]]);
    expect(filterRegularByPack(prices, "all")).toHaveLength(4);
  });

  it("a crate with only a regular price (no promotion at all) is still a crate", () => {
    const crate = regular({ sku_id: "stella-24x330", pack_quantity: 24, container: "bottle", packaging: "bottle_crate", pack_label: "סטלה ארטואה ארגז 24×330 מ״ל בקבוק" });
    const groups = groupRegularByPack([regular(), crate]);
    expect(groups.map((g) => g.key)).toEqual(["sku-6x330", "stella-24x330"]);
    expect(filterRegularByPack([crate], "case")).toEqual([crate]);
  });

  it("groups by beer with favourites first, in the person's own order", () => {
    const groups = groupRegularByBeer(
      [regular({ beer_id: "b-x", beer_name: "אלכסנדר" }), regular({ beer_id: "b-b", beer_name: "בקס" }), regular({ beer_id: "b-a", beer_name: "גולדסטאר" })],
      ["b-a", "b-b"],
    );
    expect(groups.map((g) => g.beerId)).toEqual(["b-a", "b-b", "b-x"]);
  });
});

describe("Home: beer for home", () => {
  it("ranks true six-packs, then cases, then eights and fours, then other packs; singles last of all", () => {
    const pack = (n: number, packaging: "multipack" | "bottle_crate" = "multipack") => homeOrder({ pack_quantity: n, packaging });
    expect([pack(6), pack(24, "bottle_crate"), pack(8), pack(4), pack(10), pack(1)]).toEqual([0, 1, 2, 2, 3, 9]);
    expect(pack(24)).toBe(3); // 24 cans, or a carton of 24 bottles: another multipack, not a crate
  });

  it("puts the person's beers first, then orders each by pack — and an explicit price sort wins", () => {
    const o = (beer: string, n: number, price: number, value: number | null = null) =>
      offer({ beer_id: beer, pack_quantity: n, container: n >= 12 ? "bottle" : "can", packaging: n >= 12 ? "bottle_crate" : "multipack", effective_agorot: price, value_pct: value, sku_id: `${beer}-${n}` });
    const list = [o("b-other", 6, 2000, 40), o("b-mine", 4, 1200, 30), o("b-mine", 24, 9000, 10), o("b-mine", 6, 2600, 5)];
    const home = orderForHome(list, ["b-mine"], "value").map((x) => `${x.beer_id}:${x.pack_quantity}`);
    expect(home).toEqual(["b-mine:6", "b-mine:24", "b-mine:4", "b-other:6"]);
    const cheapest = orderForHome(list, ["b-mine"], "price_asc").map((x) => x.effective_agorot);
    expect(cheapest).toEqual([1200, 2000, 2600, 9000]);
  });
});
