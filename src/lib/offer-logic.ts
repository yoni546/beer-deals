import type { Offer, RegularPrice } from "@/lib/db/types";

/**
 * What to show first, and in what order. Pure functions over `Offer` rows so the
 * rules can be tested without a database or a browser.
 *
 * Two rules matter more than the rest:
 *   1. Packs are never compared as if they were the same product. Sorting by price
 *      happens inside one pack group, or by price-per-litre across groups.
 *   2. A saving is only ever ranked by its VERIFIED value_pct (see offers_ranked in
 *      migration 0009); an offer without one is not "worth 0%" — it sorts after those
 *      that have one, and is never promoted to a headline on price alone.
 */

export type SortMode = "value" | "price_asc" | "price_desc";
export type PackFilter = "all" | "single" | "multi" | "case";

export const SORT_MODES: SortMode[] = ["value", "price_asc", "price_desc"];
export const PACK_FILTERS: PackFilter[] = ["all", "single", "multi", "case"];

export const parseSort = (value: string | undefined | null): SortMode =>
  SORT_MODES.includes(value as SortMode) ? (value as SortMode) : "value";

/**
 * The pack filter from the URL. `c=` is the OLD pack category (sixpack | case | single) that
 * older links and push notifications still carry; it is mapped rather than broken.
 */
export function parsePack(pack: string | undefined | null, legacyCategory?: string | null): PackFilter {
  if (PACK_FILTERS.includes(pack as PackFilter)) return pack as PackFilter;
  if (legacyCategory === "single") return "single";
  if (legacyCategory === "sixpack") return "multi";
  if (legacyCategory === "case") return "case";
  return "all";
}

/** Which of the three kinds of pack an offer is. */
export function packClass(offer: Pick<Offer, "origin" | "pack_label" | "pack_quantity">): Exclude<PackFilter, "all"> {
  if (offer.origin === "legacy") {
    if (offer.pack_label === "בודד") return "single";
    if (offer.pack_label === "ארגז") return "case";
    return "multi";
  }
  const n = offer.pack_quantity ?? 1;
  return n <= 1 ? "single" : n >= 12 ? "case" : "multi";
}

export const filterByPack = (offers: Offer[], pack: PackFilter) =>
  pack === "all" ? offers : offers.filter((offer) => packClass(offer) === pack);

/** The number a price sort uses: the pack price, or the price per litre when comparing across packs. */
export const comparable = (offer: Offer, perLiter: boolean): number =>
  perLiter ? (offer.unit_price_per_liter_agorot ?? Number.POSITIVE_INFINITY) : offer.effective_agorot;

const valueOf = (offer: Offer) => offer.value_pct ?? -1;

export function sortOffers(offers: Offer[], mode: SortMode, perLiter = false): Offer[] {
  const cheaper = (a: Offer, b: Offer) => comparable(a, perLiter) - comparable(b, perLiter) || a.effective_agorot - b.effective_agorot;
  const copy = [...offers];
  switch (mode) {
    case "price_asc":
      return copy.sort((a, b) => cheaper(a, b) || valueOf(b) - valueOf(a));
    case "price_desc":
      return copy.sort((a, b) => {
        const [ca, cb] = [comparable(a, perLiter), comparable(b, perLiter)];
        // Offers with no per-litre price (legacy deals) go last in either direction.
        if (ca === Infinity && cb !== Infinity) return 1;
        if (cb === Infinity && ca !== Infinity) return -1;
        return cb - ca || a.effective_agorot - b.effective_agorot;
      });
    default:
      return copy.sort(
        (a, b) => valueOf(b) - valueOf(a) || (b.market_value_pct ?? -1) - (a.market_value_pct ?? -1) || cheaper(a, b),
      );
  }
}

export type PackGroup = { key: string; label: string; offers: Offer[] };

/** Offers grouped by pack, so a Goldstar 6×330 is never listed among the 6×500s. */
export function groupByPack(offers: Offer[]): PackGroup[] {
  const groups = new Map<string, PackGroup>();
  for (const offer of offers) {
    const key = offer.sku_id ?? `legacy:${offer.pack_label}`;
    const existing = groups.get(key);
    if (existing) existing.offers.push(offer);
    else groups.set(key, { key, label: offer.pack_label, offers: [offer] });
  }
  return [...groups.values()];
}

/** Total volume of a pack in millilitres — what "smaller pack first" means. */
const totalMl = (pack: { volume_ml: number | null; pack_quantity: number | null }) => (pack.volume_ml ?? 0) * (pack.pack_quantity ?? 1);

/** Pack groups from smallest to largest, so 6×330 always precedes 6×500 whatever the sort mode. */
export function orderPackGroups(groups: PackGroup[]): PackGroup[] {
  return [...groups].sort((a, b) => totalMl(a.offers[0]) - totalMl(b.offers[0]) || a.label.localeCompare(b.label, "he"));
}

export type RegularGroup = { key: string; label: string; prices: RegularPrice[] };

const cheapestFirst = (a: RegularPrice, b: RegularPrice) => a.price_agorot - b.price_agorot || a.store_name.localeCompare(b.store_name, "he");

/** Regular prices grouped by pack (SKU): smaller packs first, cheapest chain first inside each. */
export function groupRegularByPack(prices: RegularPrice[]): RegularGroup[] {
  const groups = new Map<string, RegularGroup>();
  for (const price of prices) {
    const existing = groups.get(price.sku_id);
    if (existing) existing.prices.push(price);
    else groups.set(price.sku_id, { key: price.sku_id, label: price.pack_label, prices: [price] });
  }
  return [...groups.values()]
    .map((group) => ({ ...group, prices: [...group.prices].sort(cheapestFirst) }))
    .sort((a, b) => totalMl(a.prices[0]) - totalMl(b.prices[0]) || a.label.localeCompare(b.label, "he"));
}

/** The pack kind of a regular price, mirroring `packClass` for offers. */
export const regularPackClass = (price: Pick<RegularPrice, "pack_quantity">): Exclude<PackFilter, "all"> =>
  price.pack_quantity <= 1 ? "single" : price.pack_quantity >= 12 ? "case" : "multi";

export const filterRegularByPack = (prices: RegularPrice[], pack: PackFilter) =>
  pack === "all" ? prices : prices.filter((price) => regularPackClass(price) === pack);

export type RegularBeerGroup = { beerId: string; slug: string; name: string; prices: RegularPrice[] };

/** Regular prices grouped by beer (a person's favourites first), cheapest per litre first inside each. */
export function groupRegularByBeer(prices: RegularPrice[], beerOrder: string[] = []): RegularBeerGroup[] {
  const groups = new Map<string, RegularBeerGroup>();
  for (const price of prices) {
    const existing = groups.get(price.beer_id);
    if (existing) existing.prices.push(price);
    else groups.set(price.beer_id, { beerId: price.beer_id, slug: price.beer_slug, name: price.beer_name, prices: [price] });
  }
  const rank = (id: string) => {
    const at = beerOrder.indexOf(id);
    return at === -1 ? Number.POSITIVE_INFINITY : at;
  };
  return [...groups.values()]
    .map((group) => ({
      ...group,
      prices: [...group.prices].sort((a, b) => totalMl(a) - totalMl(b) || cheapestFirst(a, b)),
    }))
    .sort((a, b) => {
      const [ra, rb] = [rank(a.beerId), rank(b.beerId)];
      return ra === rb ? a.name.localeCompare(b.name, "he") : ra < rb ? -1 : 1;
    });
}

export type BeerGroup = { beerId: string; slug: string; name: string; offers: Offer[] };

/** Offers grouped by beer, in the order of `beerOrder` (a person's ranked favourites), then the rest. */
export function groupByBeer(offers: Offer[], beerOrder: string[] = []): BeerGroup[] {
  const groups = new Map<string, BeerGroup>();
  for (const offer of offers) {
    const existing = groups.get(offer.beer_id);
    if (existing) existing.offers.push(offer);
    else groups.set(offer.beer_id, { beerId: offer.beer_id, slug: offer.beer_slug, name: offer.beer_name, offers: [offer] });
  }
  const rank = (id: string) => {
    const at = beerOrder.indexOf(id);
    return at === -1 ? Number.POSITIVE_INFINITY : at;
  };
  // Array.prototype.sort is stable: beers outside the order keep their incoming order.
  return [...groups.values()].sort((a, b) => {
    const [ra, rb] = [rank(a.beerId), rank(b.beerId)];
    return ra === rb ? 0 : ra < rb ? -1 : 1;
  });
}

export type Hero = { offer: Offer; reason: "value" | "favourite" | "market" };

/**
 * The single "best deal now". A favourite's best VERIFIED saving wins; failing that, a
 * favourite that beats other chains' regular prices; failing that, the best verified
 * saving anywhere; failing that, the cheapest per-litre favourite. Never a price alone
 * with no basis for calling it good — except the last, which is labelled for what it is.
 */
export function pickHero(offers: Offer[], favouriteOrder: string[]): Hero | null {
  const rank = (offer: Offer) => {
    const at = favouriteOrder.indexOf(offer.beer_id);
    return at === -1 ? Number.POSITIVE_INFINITY : at;
  };
  const byRank = (a: Offer, b: Offer) => (rank(a) === rank(b) ? 0 : rank(a) < rank(b) ? -1 : 1);
  const byValue = (a: Offer, b: Offer) => valueOf(b) - valueOf(a) || byRank(a, b) || a.effective_agorot - b.effective_agorot;

  const mine = offers.filter((offer) => rank(offer) !== Number.POSITIVE_INFINITY);

  const mineVerified = mine.filter((offer) => offer.value_pct !== null).sort(byValue);
  if (mineVerified[0]) return { offer: mineVerified[0], reason: "value" };

  const mineByMarket = mine
    .filter((offer) => offer.market_value_pct !== null)
    .sort((a, b) => (b.market_value_pct ?? 0) - (a.market_value_pct ?? 0) || byRank(a, b));
  if (mineByMarket[0]) return { offer: mineByMarket[0], reason: "market" };

  const anyVerified = offers.filter((offer) => offer.value_pct !== null).sort(byValue);
  if (anyVerified[0]) return { offer: anyVerified[0], reason: "value" };

  const mineByLiter = mine
    .filter((offer) => offer.unit_price_per_liter_agorot !== null)
    .sort((a, b) => (a.unit_price_per_liter_agorot ?? 0) - (b.unit_price_per_liter_agorot ?? 0) || byRank(a, b));
  if (mineByLiter[0]) return { offer: mineByLiter[0], reason: "favourite" };

  return null;
}

export type BeerSummary = { count: number; bestValuePct: number | null };

/** For a beer's key or list row: how many offers, and the best verified saving among them. */
export function summarize(offers: Pick<Offer, "value_pct">[]): BeerSummary {
  const values = offers.map((offer) => offer.value_pct).filter((v): v is number => v !== null);
  return { count: offers.length, bestValuePct: values.length ? Math.max(...values) : null };
}

/** Freshness of a list of offers: the newest observation time, or null when none has one. */
export function newestObservation(offers: Pick<Offer, "observed_at">[]): string | null {
  const times = offers.map((offer) => offer.observed_at).filter((t): t is string => Boolean(t));
  return times.length ? times.reduce((a, b) => (a > b ? a : b)) : null;
}

/**
 * Regular prices inside one pack group, in the order the person asked for. "Best saving" means
 * nothing for a regular price (there is no saving), so it orders them cheapest first like price_asc.
 */
export function sortRegular(prices: RegularPrice[], mode: SortMode, perLiter = false): RegularPrice[] {
  const key = (p: RegularPrice) => (perLiter ? p.unit_price_per_liter_agorot : p.price_agorot);
  const dir = mode === "price_desc" ? -1 : 1;
  return [...prices].sort((a, b) => dir * (key(a) - key(b)) || a.store_name.localeCompare(b.store_name, "he"));
}
