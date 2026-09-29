import "server-only";

import { cache } from "react";
import { isProductionEnvironment } from "@/lib/demo";
import { supabaseServer } from "@/lib/supabase/server";
import type { GroupOffer, Offer, RegularPrice } from "@/lib/db/types";

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

export type OfferFilter = {
  beerSlug?: string;
  storeSlug?: string;
  /** Only these beers. */
  beerIds?: string[];
  /** Everything except these beers. */
  excludeBeerIds?: string[];
  /** Best verified savings first, capped — for "more deals" lists that could otherwise be huge. */
  topByValue?: number;
};

export async function getOffers(filter: OfferFilter = {}): Promise<Offer[]> {
  const supabase = await supabaseServer();
  let query = supabase.from("offers_feed").select("*");

  if (hideSamples()) query = query.eq("is_sample", false);
  if (filter.beerSlug) query = query.eq("beer_slug", filter.beerSlug);
  if (filter.storeSlug) query = query.eq("store_slug", filter.storeSlug);
  if (filter.beerIds) {
    if (filter.beerIds.length === 0) return [];
    query = query.in("beer_id", filter.beerIds);
  }
  if (filter.excludeBeerIds?.length) query = query.not("beer_id", "in", `(${filter.excludeBeerIds.join(",")})`);
  if (filter.topByValue) {
    query = query.order("value_pct", { ascending: false, nullsFirst: false }).limit(filter.topByValue);
  }

  const { data, error } = await query;
  if (error) throw new DataUnavailableError("offers", error.message);
  return (data ?? []) as Offer[];
}


export async function getRegularPrices(filter: { beerSlug?: string; storeSlug?: string } = {}): Promise<RegularPrice[]> {
  const supabase = await supabaseServer();
  let query = supabase.from("regular_prices_feed").select("*");

  if (hideSamples()) query = query.eq("is_sample", false);
  if (filter.beerSlug) query = query.eq("beer_slug", filter.beerSlug);
  if (filter.storeSlug) query = query.eq("store_slug", filter.storeSlug);

  const { data, error } = await query;
  if (error) throw new DataUnavailableError("regular prices", error.message);
  return (data ?? []) as RegularPrice[];
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
  if (filter.storeSlug) query = query.eq("store_slug", filter.storeSlug);
  if (filter.beerIds) query = query.overlaps("beer_ids", filter.beerIds);
  const { data, error } = await query.order("per_unit_agorot");
  if (error) throw new DataUnavailableError("group offers", error.message);
  return (data ?? []) as GroupOffer[];
}

/** One row per beer or chain: how many offers there are, and the best verified saving. */
export type ListingRow = { slug: string; count: number; bestValuePct: number | null };

export const getListing = cache(async (by: "beer" | "store"): Promise<ListingRow[]> => {
  const supabase = await supabaseServer();
  const key = by === "beer" ? "beer_slug" : "store_slug";
  let query = supabase.from("offers_feed").select(`${key}, value_pct`);
  if (hideSamples()) query = query.eq("is_sample", false);

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
export const getFreshness = cache(async (): Promise<string | null> => {
  const supabase = await supabaseServer();
  let query = supabase.from("offers_feed").select("observed_at");
  if (hideSamples()) query = query.eq("is_sample", false);
  const { data, error } = await query.not("observed_at", "is", null).order("observed_at", { ascending: false }).limit(1);
  if (error) throw new DataUnavailableError("freshness", error.message);
  return (data?.[0] as { observed_at: string } | undefined)?.observed_at ?? null;
});

/** One offer by its key ('obs:12' or 'deal:<uuid>') — used for the editorial "deal of the week". */
export async function getOfferByKey(key: string): Promise<Offer | null> {
  const supabase = await supabaseServer();
  let query = supabase.from("offers_feed").select("*").eq("offer_key", key);
  if (hideSamples()) query = query.eq("is_sample", false);
  const { data, error } = await query.maybeSingle();
  if (error) throw new DataUnavailableError("the featured deal", error.message);
  return (data as Offer | null) ?? null;
}
