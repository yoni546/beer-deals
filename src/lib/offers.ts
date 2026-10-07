import "server-only";

import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { publicEnv } from "@/lib/env";
import { isProductionEnvironment } from "@/lib/demo";
import { getBeerBySlug, getStoreBySlug } from "@/lib/queries";
import { supabaseServer } from "@/lib/supabase/server";
import type { GroupOffer, Offer, Packaging, RegularPrice } from "@/lib/db/types";

export type { RegularPrice };

/**
 * Everything the screens read about offers and regular prices.
 *
 * The screens read two views (migrations 0009 and 0011), never the ledger:
 *   offers_feed          promotions in force now, with unit price and a VERIFIED saving
 *   regular_prices_feed  the latest regular price per pack and chain
 *
 * Two behaviours worth knowing:
 *  - A production server never returns sample rows (`is_sample`), whatever the
 *    database contains. The app must never show a fake price as a real one.
 *  - A failed read THROWS instead of returning an empty list. An empty list would
 *    say "no deals" when the truth is "we could not look" — for example when a
 *    migration has not been applied yet — and the error screen tells people that.
 */

export class DataUnavailableError extends Error {
  constructor(what: string, cause: string) {
    super(`${what} unavailable: ${cause}`);
    this.name = "DataUnavailableError";
  }
}

const hideSamples = isProductionEnvironment;

/**
 * The SKU table, read once per request (a few hundred rows), for two things the feeds cannot do cheaply:
 *  - each SKU's pack form (skus.packaging, migration 0021) — what decides "ארגזים". If it cannot be read
 *    (the migration not applied), every pack stays null, and a null pack is never a crate;
 *  - a beer's SKU ids. The feeds are partitioned by store and SKU: a filter on store_id or sku_id reaches the
 *    base tables, while one on a slug or on beer_id makes Postgres compute the WHOLE feed first (measured on
 *    production 2026-10-06: a beer's deals 1.3 s by beer_slug, 0.32 s by its SKU ids; a chain's 1.3 s by
 *    store_slug, 0.22 s by store_id). So pages filter by those, never by slug.
 */
type SkuIndex = { packaging: Map<string, Packaging>; skusOfBeer: Map<string, string[]> };
const getSkuIndex = cache(async (): Promise<SkuIndex> => {
  const supabase = await supabaseServer();
  let { data, error } = await supabase.from("skus").select("id, beer_id, packaging");
  // Before 0021 there is no packaging column: still index the beers' SKUs.
  if (error) ({ data, error } = await supabase.from("skus").select("id, beer_id"));
  if (error) throw new DataUnavailableError("packs", error.message);
  const index: SkuIndex = { packaging: new Map(), skusOfBeer: new Map() };
  for (const row of (data ?? []) as Array<{ id: string; beer_id: string; packaging?: Packaging }>) {
    if (row.packaging) index.packaging.set(row.id, row.packaging);
    index.skusOfBeer.set(row.beer_id, [...(index.skusOfBeer.get(row.beer_id) ?? []), row.id]);
  }
  return index;
});

async function withPackaging<T extends { sku_id: string | null }>(rows: T[]): Promise<Array<T & { packaging: Packaging | null }>> {
  if (rows.length === 0) return [];
  const { packaging } = await getSkuIndex();
  return rows.map((row) => ({ ...row, packaging: (row.sku_id && packaging.get(row.sku_id)) || null }));
}

/** The beers' SKU ids (empty when they have none). */
async function skuIdsOf(beerIds: string[]): Promise<string[]> {
  const { skusOfBeer } = await getSkuIndex();
  return beerIds.flatMap((id) => skusOfBeer.get(id) ?? []);
}

/**
 * Reads that need the WHOLE feed (every chain) — Home's freshness and "more deals", the beer and chain
 * listings — cost ~1.2 s each at production scale and give every visitor the same answer, which changes
 * only when an import or an admin changes deals. They are cached for five minutes (FEEDS_TAG is cleared by
 * the admin actions) and read with a cookie-less client: the same public (anon) view of the data a signed-out
 * visitor gets — these views show nothing per person.
 */
export const FEEDS_TAG = "feeds";
const FEEDS_TTL_SECONDS = 300;
const publicReader = () => createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const cachedFeed = <A extends unknown[], R>(key: string, read: (...args: A) => Promise<R>) =>
  unstable_cache(read, ["feeds", key], { revalidate: FEEDS_TTL_SECONDS, tags: [FEEDS_TAG] });

/** The best verified savings across every chain, packs only — Home's "more deals", before excluding favourites. */
const MORE_DEALS_POOL = 200;
const getTopPackOffers = cachedFeed("top-pack-offers", async (hide: boolean): Promise<Offer[]> => {
  let query = publicReader().from("offers_feed").select("*");
  if (hide) query = query.eq("is_sample", false);
  const { data, error } = await query
    .or("pack_quantity.gte.2,pack_quantity.is.null")
    .order("value_pct", { ascending: false, nullsFirst: false })
    .limit(MORE_DEALS_POOL);
  if (error) throw new DataUnavailableError("offers", error.message);
  return (data ?? []) as Offer[];
});

/** The order "more deals" uses (best verified saving first), for merging two partial lists. */
const byValue = (a: Offer, b: Offer) => (b.value_pct ?? -1) - (a.value_pct ?? -1);

export type OfferFilter = {
  beerSlug?: string;
  storeSlug?: string;
  /** Only these beers. */
  beerIds?: string[];
  /** Everything except these beers. */
  excludeBeerIds?: string[];
  /** Best verified savings first, capped — for "more deals" lists that could otherwise be huge. */
  topByValue?: number;
  /** Leave out single units (Home is beer for home: packs and cases). Legacy deals without a count stay. */
  packsOnly?: boolean;
};

export async function getOffers(filter: OfferFilter = {}): Promise<Offer[]> {
  const supabase = await supabaseServer();
  // Slugs become the ids the feed is partitioned by (see getSkuIndex).
  let beerIds = filter.beerIds;
  if (filter.beerSlug) {
    const beer = await getBeerBySlug(filter.beerSlug);
    if (!beer) return [];
    beerIds = beerIds ? beerIds.filter((id) => id === beer.id) : [beer.id];
  }
  let storeId: string | undefined;
  if (filter.storeSlug) {
    const store = await getStoreBySlug(filter.storeSlug);
    if (!store) return [];
    storeId = store.id;
  }
  if (beerIds && beerIds.length === 0) return [];

  // Home's "more deals": everything except the person's beers, best first. From the shared cached pool.
  if (filter.excludeBeerIds && filter.topByValue && filter.packsOnly && !beerIds && !storeId) {
    const excluded = new Set(filter.excludeBeerIds);
    const pool = await getTopPackOffers(hideSamples());
    return withPackaging(pool.filter((offer) => !excluded.has(offer.beer_id)).slice(0, filter.topByValue));
  }

  const base = () => {
    let query = supabase.from("offers_feed").select("*");
    if (hideSamples()) query = query.eq("is_sample", false);
    if (storeId) query = query.eq("store_id", storeId);
    if (filter.excludeBeerIds?.length) query = query.not("beer_id", "in", `(${filter.excludeBeerIds.join(",")})`);
    if (filter.packsOnly) query = query.or("pack_quantity.gte.2,pack_quantity.is.null");
    if (filter.topByValue) query = query.order("value_pct", { ascending: false, nullsFirst: false }).limit(filter.topByValue);
    return query;
  };

  let rows: Offer[];
  if (beerIds) {
    // Catalogue offers by the beers' SKUs; legacy deals (no SKU) by beer — that half of the view is tiny.
    const skuIds = await skuIdsOf(beerIds);
    const [catalog, legacy] = await Promise.all([
      skuIds.length ? base().in("sku_id", skuIds) : Promise.resolve({ data: [] as Offer[], error: null }),
      base().eq("origin", "legacy").in("beer_id", beerIds),
    ]);
    const error = catalog.error ?? legacy.error;
    if (error) throw new DataUnavailableError("offers", error.message);
    rows = [...((catalog.data ?? []) as Offer[]), ...((legacy.data ?? []) as Offer[])];
    if (filter.topByValue) rows = rows.sort(byValue).slice(0, filter.topByValue);
  } else {
    const { data, error } = await base();
    if (error) throw new DataUnavailableError("offers", error.message);
    rows = (data ?? []) as Offer[];
  }
  return withPackaging(rows);
}


export async function getRegularPrices(filter: { beerSlug?: string; storeSlug?: string } = {}): Promise<RegularPrice[]> {
  const supabase = await supabaseServer();
  let query = supabase.from("regular_prices_feed").select("*");

  if (hideSamples()) query = query.eq("is_sample", false);
  // By the ids the feed is partitioned by, never by slug (see getSkuIndex).
  if (filter.beerSlug) {
    const beer = await getBeerBySlug(filter.beerSlug);
    const skuIds = beer ? await skuIdsOf([beer.id]) : [];
    if (skuIds.length === 0) return [];
    query = query.in("sku_id", skuIds);
  }
  if (filter.storeSlug) {
    const store = await getStoreBySlug(filter.storeSlug);
    if (!store) return [];
    query = query.eq("store_id", store.id);
  }

  const { data, error } = await query;
  if (error) throw new DataUnavailableError("regular prices", error.message);
  return withPackaging((data ?? []) as RegularPrice[]);
}

/**
 * "Any N of these for ₪X" offers (group_offers_feed, migration 0014): one row per chain promotion.
 * Filter by a beer (any of its packs is eligible) or a chain.
 */
export async function getGroupOffers(filter: { beerSlug?: string; storeSlug?: string; beerIds?: string[] } = {}): Promise<GroupOffer[]> {
  if (filter.beerIds && filter.beerIds.length === 0) return [];
  const supabase = await supabaseServer();
  let query = supabase.from("group_offers_feed").select("*");
  if (hideSamples()) query = query.eq("is_sample", false);
  if (filter.beerSlug) query = query.contains("beer_slugs", [filter.beerSlug]);
  if (filter.storeSlug) {
    // By store_id: 16 ms instead of 499 ms for Shufersal by slug (production, 2026-10-06).
    const store = await getStoreBySlug(filter.storeSlug);
    if (!store) return [];
    query = query.eq("store_id", store.id);
  }
  if (filter.beerIds) query = query.overlaps("beer_ids", filter.beerIds);
  const { data, error } = await query.order("per_unit_agorot");
  if (error) throw new DataUnavailableError("group offers", error.message);
  const groups = (data ?? []) as GroupOffer[];
  if (groups.length === 0) return groups;
  const { packaging } = await getSkuIndex();
  return groups.map((group) => ({ ...group, packs: group.packs.map((pack) => ({ ...pack, packaging: packaging.get(pack.sku_id) ?? null })) }));
}

/** One row per beer or chain: how many offers there are, and the best verified saving. */
export type ListingRow = { slug: string; count: number; bestValuePct: number | null };

export const getListing = cache((by: "beer" | "store") => readListing(by, hideSamples()));
const readListing = cachedFeed("listing", async (by: "beer" | "store", hide: boolean): Promise<ListingRow[]> => {
  const key = by === "beer" ? "beer_slug" : "store_slug";
  let query = publicReader().from("offers_feed").select(`${key}, value_pct`);
  if (hide) query = query.eq("is_sample", false);

  const { data, error } = await query;
  if (error) throw new DataUnavailableError("the listing", error.message);

  const rows = new Map<string, ListingRow>();
  for (const row of (data ?? []) as unknown as Array<Record<string, string | number | null>>) {
    const slug = String(row[key]);
    const current = rows.get(slug) ?? { slug, count: 0, bestValuePct: null };
    current.count += 1;
    const value = row.value_pct as number | null;
    if (value !== null && (current.bestValuePct === null || value > current.bestValuePct)) current.bestValuePct = value;
    rows.set(slug, current);
  }
  return [...rows.values()];
});

/** When the newest price on the site was observed — the honest "last updated". */
export const getFreshness = cache(() => readFreshness(hideSamples()));
const readFreshness = cachedFeed("freshness", async (hide: boolean): Promise<string | null> => {
  let query = publicReader().from("offers_feed").select("observed_at");
  if (hide) query = query.eq("is_sample", false);
  const { data, error } = await query.not("observed_at", "is", null).order("observed_at", { ascending: false }).limit(1);
  if (error) throw new DataUnavailableError("freshness", error.message);
  return (data?.[0] as { observed_at: string } | undefined)?.observed_at ?? null;
});

/**
 * One offer by its key ('obs:12' or 'deal:<uuid>') — used for the editorial "deal of the week".
 *
 * `offer_key` is a computed expression in both halves of the view ('obs:' || observation_id,
 * 'deal:' || d.id), so a filter on it alone cannot prune either branch of the UNION: Postgres
 * computes the WHOLE feed and then string-compares every row. On Home, where the editor's pick
 * is the default state, that was a full-feed scan on every single render — measured in
 * `docs/V2-AUDIT-2026-10-07.md` as one of the two leading causes of the error screen.
 *
 * `origin` IS a plan-time constant per branch ('catalog' / 'legacy', migration 0017:332,383), so
 * pairing the two filters prunes the other half to a one-time false and a 'deal:' lookup reads
 * only `deals_public`.
 */
export async function getOfferByKey(key: string): Promise<Offer | null> {
  const supabase = await supabaseServer();
  let query = supabase
    .from("offers_feed")
    .select("*")
    .eq("origin", key.startsWith("deal:") ? "legacy" : "catalog")
    .eq("offer_key", key);
  if (hideSamples()) query = query.eq("is_sample", false);
  const { data, error } = await query.maybeSingle();
  if (error) throw new DataUnavailableError("the featured deal", error.message);
  return data ? (await withPackaging([data as Offer]))[0] : null;
}
