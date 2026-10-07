import type { Offer, Packaging, RegularPrice } from "@/lib/db/types";

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

/**
 * The three kinds of pack, and the ONLY three categories a person sees (PRODUCT.md, "Beer for home"):
 *
 *   single           1 unit                          "בודדים"
 *   small_multipack  a MULTIPACK: 4, 6, 8 mostly;    "שישיות" (the everyday word for a pack of beer; each
 *                    also 24 cans, a carton or tray   product still says what it is: רביעייה · 4×330 מ״ל,
 *                    of bottles, any big pack whose   מארז 24 · 24×500 מ״ל · פחית — never called a ארגז)
 *                    form the chain did not state
 *   case             a BOTTLE CRATE, on evidence:     "ארגזים"
 *                    skus.packaging = 'bottle_crate'
 *                    (0021: the chain's title says
 *                    ארגז on 12+ bottles), or a deal
 *                    an admin labelled ארגז
 *
 * A ארגז is a crate of bottles, and the count alone never makes one: 24 bottles in a carton and 24 cans are
 * multipacks. Without packaging data (null) a pack is never a crate.
 * (The identifiers stay `small_multipack` / `case`: `?pack=case` is in shared links and notifications.)
 */
export type PackClass = "single" | "small_multipack" | "case";
export type PackFilter = "all" | PackClass;

export const SORT_MODES: SortMode[] = ["value", "price_asc", "price_desc"];
/** In the order a page shows them: packs first, then cases, then singles (beer for home). */
export const PACK_CLASSES: PackClass[] = ["small_multipack", "case", "single"];
export const PACK_FILTERS: PackFilter[] = ["all", ...PACK_CLASSES];

/** What a pack's kind depends on: how many units, and its stored form (skus.packaging; null = unknown). */
export type PackShapeIn = { pack_quantity: number | null | undefined; packaging?: Packaging | null };

/** A pack → which kind: a crate only on evidence (packaging 'bottle_crate'), never by its count. */
export const classOfPack = ({ pack_quantity, packaging }: PackShapeIn): PackClass => {
  const units = pack_quantity ?? 1;
  if (units <= 1) return "single";
  return packaging === "bottle_crate" ? "case" : "small_multipack";
};

/**
 * Inside one kind, the order a shopper looks for packs: six-packs, then eights, then fours, then the rare
 * others by size (a 24-can tray last; crates by size, smallest first). Lower comes first.
 */
export function packOrder(n: number | null | undefined): number {
  const units = n ?? 1;
  return ({ 6: 0, 8: 1, 4: 2 } as Record<number, number>)[units] ?? 3 + units / 100;
}

/**
 * Home's order (beer for home): true six-packs, then crates, then eights and fours, then any other
 * multipack. Singles never reach Home. Lower comes first.
 */
export function homeOrder(pack: PackShapeIn): number {
  const units = pack.pack_quantity ?? 1;
  const kind = classOfPack(pack);
  if (kind === "single") return 9;
  if (kind === "case") return 1;
  return units === 6 ? 0 : units === 8 || units === 4 ? 2 : 3;
}

export const parseSort = (value: string | undefined | null): SortMode =>
  SORT_MODES.includes(value as SortMode) ? (value as SortMode) : "value";

/**
 * The pack filter from the URL. `c=` is the OLD pack category (sixpack | case | single) that
 * older links and push notifications still carry; it is mapped rather than broken.
 */
export function parsePack(pack: string | undefined | null, legacyCategory?: string | null): PackFilter {
  if (PACK_FILTERS.includes(pack as PackFilter)) return pack as PackFilter;
  if (pack === "multi") return "small_multipack"; // 0.7.x links ("מארזים")
  if (legacyCategory === "single") return "single";
  if (legacyCategory === "sixpack") return "small_multipack";
  if (legacyCategory === "case") return "case";
  return "all";
}

/** Which of the three kinds of pack an offer is. */
export function packClass(offer: Pick<Offer, "origin" | "pack_label" | "pack_quantity"> & { packaging?: Packaging | null }): PackClass {
  if (offer.origin === "legacy") {
    if (offer.pack_label === "בודד") return "single";
    if (offer.pack_label === "ארגז") return "case";
    return "small_multipack";
  }
  return classOfPack(offer);
}

/**
 * A mix-and-match offer's kind: the kind most of its packs are (they are nearly always one kind;
 * a tie goes to the kind shown first).
 */
export function groupPackClass(group: { packs: Array<{ pack_quantity: number; packaging?: Packaging | null }> }): PackClass {
  const counts = PACK_CLASSES.map((kind) => group.packs.filter((p) => classOfPack(p) === kind).length);
  return PACK_CLASSES[counts.indexOf(Math.max(...counts))];
}

/** Items split into the three kinds, in page order, leaving out kinds with nothing in them. */
export function byPackClass<T>(items: T[], kindOf: (item: T) => PackClass): Array<{ kind: PackClass; items: T[] }> {
  return PACK_CLASSES.map((kind) => ({ kind, items: items.filter((item) => kindOf(item) === kind) })).filter((part) => part.items.length > 0);
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

/**
 * What the person is after RIGHT NOW.
 *
 * Deliberately NOT a stored profile preference. The brief is explicit, and it is
 * right: the same person wants the nearest shop when they need beer this evening and
 * the best price when they are willing to drive on Friday. It belongs in the URL, like
 * the sort and the pack filter, so a shared link reproduces what the sender saw — and
 * so nothing has to guess which mood somebody is in.
 */
export type SearchIntent = "best" | "near";
export const SEARCH_INTENTS: SearchIntent[] = ["best", "near"];
export const parseIntent = (raw?: string): SearchIntent => (raw === "near" ? "near" : "best");

/** How far each offer is, in km, by offer_key. An ABSENT key means we do not know. */
export type Distances = Record<string, number>;

/**
 * The result of ordering by intent, including what had to be left out.
 *
 * `unplaceable` is not a detail: under "closest to me" an offer we cannot measure is
 * not shown at all, because putting it at the bottom of a list labelled by distance
 * would be claiming a distance we do not have. The caller says so in words instead.
 */
export type IntentResult = { offers: Offer[]; unplaceable: number };

const scoreOf = (offer: Offer) => offer.deal_score?.score ?? -1;

/**
 * Order a list for the chosen intent.
 *
 *   best  — the deal score first, then the existing value ordering, then distance.
 *           Everything is shown: a deal with no score or no distance is still a deal.
 *   near  — distance first, the score as the tie-breaker, and ONLY offers we can
 *           actually place. See IntentResult.
 */
export function orderByIntent(
  offers: Offer[],
  intent: SearchIntent,
  distances: Distances,
  mode: SortMode = "value",
  perLiter = false,
): IntentResult {
  const km = (offer: Offer) => distances[offer.offer_key];

  if (intent === "near") {
    const placeable = offers.filter((offer) => km(offer) !== undefined);
    const sorted = [...placeable].sort(
      (a, b) => km(a)! - km(b)! || scoreOf(b) - scoreOf(a) || a.effective_agorot - b.effective_agorot,
    );
    return { offers: sorted, unplaceable: offers.length - placeable.length };
  }

  // Best value. The score leads where there is one; the existing value ordering decides
  // the rest, so an unscored offer keeps its place rather than sinking to the bottom.
  const byValue = sortOffers(offers, mode, perLiter);
  const position = new Map(byValue.map((offer, index) => [offer, index]));
  const sorted = [...byValue].sort((a, b) => {
    const [sa, sb] = [scoreOf(a), scoreOf(b)];
    if (sa !== sb) return sb - sa;
    const [da, db] = [km(a), km(b)];
    if (da !== undefined && db !== undefined && da !== db) return da - db;
    return position.get(a)! - position.get(b)!;
  });
  return { offers: sorted, unplaceable: 0 };
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

type PackShape = { volume_ml: number | null; pack_quantity: number | null; packaging?: Packaging | null };

/** The default order of packs of one beer: by kind, then 6 → 8 → 4 (crates by size), then volume. */
const packShapeOrder = (a: PackShape, b: PackShape) =>
  PACK_CLASSES.indexOf(classOfPack(a)) - PACK_CLASSES.indexOf(classOfPack(b)) ||
  packOrder(a.pack_quantity) - packOrder(b.pack_quantity) ||
  totalMl(a) - totalMl(b);

/**
 * Pack groups in the default order (six-packs, eights, fours, then cases, then singles; 6×330 before
 * 6×500). When the person picks a price sort, packs of the same kind follow it instead: the group whose
 * best offer is cheapest (or dearest) first — still never mixing two packs in one group.
 */
export function orderPackGroups(groups: PackGroup[], mode: SortMode = "value", perLiter = false): PackGroup[] {
  const explicit = mode !== "value" || perLiter;
  const best = (group: PackGroup) => {
    const values = group.offers.map((offer) => comparable(offer, perLiter)).filter(Number.isFinite);
    if (values.length === 0) return Number.POSITIVE_INFINITY;
    return mode === "price_desc" ? -Math.max(...values) : Math.min(...values);
  };
  return [...groups].sort((a, b) => {
    const kind = PACK_CLASSES.indexOf(packClass(a.offers[0])) - PACK_CLASSES.indexOf(packClass(b.offers[0]));
    if (kind !== 0) return kind;
    if (explicit) return best(a) - best(b) || packShapeOrder(a.offers[0], b.offers[0]);
    return packShapeOrder(a.offers[0], b.offers[0]) || a.label.localeCompare(b.label, "he");
  });
}

/**
 * One beer's offers inside one kind (a chain page's strip): by default in pack order — six-packs, eights,
 * fours (cases by size), smaller units first — then by saving; a price sort, when chosen, wins.
 */
export function orderByPack(offers: Offer[], mode: SortMode, perLiter = false): Offer[] {
  const sorted = sortOffers(offers, mode, perLiter);
  if (mode !== "value" || perLiter) return sorted;
  const position = new Map(sorted.map((offer, index) => [offer, index]));
  return [...sorted].sort((a, b) => packShapeOrder(a, b) || position.get(a)! - position.get(b)!);
}

/**
 * Home's order for a list of offers: favourites first (in the person's order), then six-packs, cases,
 * eights and fours, other multipacks — and inside each, the chosen sort. An explicit price sort wins over
 * the pack order.
 */
export function orderForHome(offers: Offer[], favouriteOrder: string[], mode: SortMode, perLiter = false): Offer[] {
  const sorted = sortOffers(offers, mode, perLiter);
  if (mode !== "value" || perLiter) return sorted;
  const rank = (offer: Offer) => {
    const at = favouriteOrder.indexOf(offer.beer_id);
    return at === -1 ? Number.POSITIVE_INFINITY : at;
  };
  const position = new Map(sorted.map((offer, index) => [offer, index]));
  return [...sorted].sort(
    (a, b) =>
      (rank(a) === rank(b) ? 0 : rank(a) < rank(b) ? -1 : 1) ||
      homeOrder(a) - homeOrder(b) ||
      position.get(a)! - position.get(b)!,
  );
}

export type RegularGroup = { key: string; label: string; prices: RegularPrice[] };

const cheapestFirst = (a: RegularPrice, b: RegularPrice) => a.price_agorot - b.price_agorot || a.store_name.localeCompare(b.store_name, "he");

/** Regular prices grouped by pack (SKU), in the default pack order (as orderPackGroups), cheapest chain first inside each. */
export function groupRegularByPack(prices: RegularPrice[], mode: SortMode = "value", perLiter = false): RegularGroup[] {
  const explicit = mode !== "value" || perLiter;
  const key = (p: RegularPrice) => (perLiter ? p.unit_price_per_liter_agorot : p.price_agorot);
  const best = (group: RegularGroup) => (mode === "price_desc" ? -Math.max(...group.prices.map(key)) : Math.min(...group.prices.map(key)));
  const groups = new Map<string, RegularGroup>();
  for (const price of prices) {
    const existing = groups.get(price.sku_id);
    if (existing) existing.prices.push(price);
    else groups.set(price.sku_id, { key: price.sku_id, label: price.pack_label, prices: [price] });
  }
  return [...groups.values()]
    .map((group) => ({ ...group, prices: [...group.prices].sort(cheapestFirst) }))
    .sort((a, b) => {
      const kind = PACK_CLASSES.indexOf(regularPackClass(a.prices[0])) - PACK_CLASSES.indexOf(regularPackClass(b.prices[0]));
      if (kind !== 0) return kind;
      if (explicit) return best(a) - best(b) || packShapeOrder(a.prices[0], b.prices[0]);
      return packShapeOrder(a.prices[0], b.prices[0]) || a.label.localeCompare(b.label, "he");
    });
}

/** The pack kind of a regular price, mirroring `packClass` for offers. */
export const regularPackClass = (price: Pick<RegularPrice, "pack_quantity"> & { packaging?: Packaging | null }): PackClass => classOfPack(price);

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
      prices: [...group.prices].sort((a, b) => packShapeOrder(a, b) || cheapestFirst(a, b)),
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
