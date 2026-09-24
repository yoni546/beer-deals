import "server-only";

import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import type { DealCategory } from "@/lib/categories";
import type { AppSettings, Beer, PublicDeal, Store } from "@/lib/db/types";

/**
 * All public reads. Every one of these goes through the caller's own session,
 * so Row Level Security — not a WHERE clause here — is what keeps unapproved
 * deals out of them. The `deals_public` view filters on approved status as
 * well, which is belt and braces rather than the belt.
 */

export const getBeers = cache(async (): Promise<Beer[]> => {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("beers")
    .select("*")
    .eq("is_active", true)
    .order("sort_order")
    .order("name_he");
  return (data ?? []) as Beer[];
});

export const getStores = cache(async (): Promise<Store[]> => {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("stores")
    .select("*")
    .eq("is_active", true)
    .order("name_he");
  return (data ?? []) as Store[];
});

export const getBeerBySlug = cache(async (slug: string): Promise<Beer | null> => {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("beers").select("*").eq("slug", slug).maybeSingle();
  return (data as Beer | null) ?? null;
});

export const getStoreBySlug = cache(async (slug: string): Promise<Store | null> => {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("stores").select("*").eq("slug", slug).maybeSingle();
  return (data as Store | null) ?? null;
});

/**
 * Deals for one beer in one category, cheapest first.
 *
 * The category is a required argument rather than an optional filter. Comparing
 * a sixpack against a single is meaningless, and the cheapest row of a mixed
 * list would always be a single — so the type system refuses to let a caller
 * forget.
 */
export async function getDealsForBeer(
  beerId: string,
  category: DealCategory,
): Promise<PublicDeal[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("deals_public")
    .select("*")
    .eq("beer_id", beerId)
    .eq("category", category)
    .order("deal_price_agorot", { ascending: true });
  return (data ?? []) as PublicDeal[];
}

/**
 * Deals at one store in one category, best first.
 *
 * "Best" here is the discount, not the price: at a single store the question is
 * which of these is the bargain, and a ₪8.90 single is not a better deal than a
 * ₪24.90 sixpack at 40% off. Price breaks ties.
 */
export async function getDealsForStore(
  storeId: string,
  category: DealCategory,
): Promise<PublicDeal[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("deals_public")
    .select("*")
    .eq("store_id", storeId)
    .eq("category", category)
    .order("discount_percent", { ascending: false })
    .order("deal_price_agorot", { ascending: true });
  return (data ?? []) as PublicDeal[];
}

/** The cheapest live deal for each of several beers, in one query. */
export async function getBestDealPerBeer(
  beerIds: string[],
  category: DealCategory,
): Promise<Map<string, PublicDeal>> {
  const best = new Map<string, PublicDeal>();
  if (beerIds.length === 0) return best;

  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("deals_public")
    .select("*")
    .in("beer_id", beerIds)
    .eq("category", category)
    .order("deal_price_agorot", { ascending: true });

  for (const deal of (data ?? []) as PublicDeal[]) {
    // Ordered cheapest first, so the first row seen for a beer is its best.
    if (!best.has(deal.beer_id)) best.set(deal.beer_id, deal);
  }
  return best;
}

/** The single best deal at a store for each of the user's beers. */
export async function getBestDealPerBeerAtStore(
  storeId: string,
  beerIds: string[],
  category: DealCategory,
): Promise<Map<string, PublicDeal>> {
  const best = new Map<string, PublicDeal>();
  if (beerIds.length === 0) return best;

  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("deals_public")
    .select("*")
    .eq("store_id", storeId)
    .in("beer_id", beerIds)
    .eq("category", category)
    .order("deal_price_agorot", { ascending: true });

  for (const deal of (data ?? []) as PublicDeal[]) {
    if (!best.has(deal.beer_id)) best.set(deal.beer_id, deal);
  }
  return best;
}

export const getSettings = cache(async (): Promise<AppSettings | null> => {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("app_settings")
    .select(
      "weekly_deal_id, notify_min_discount_percent, notify_max_price_agorot, " +
        "notify_cooldown_hours, weekly_deal_preferred_beer_slug",
    )
    .eq("id", true)
    .maybeSingle();
  return (data as AppSettings | null) ?? null;
});

/**
 * The Weekly Deal. Chosen by an admin — there is no automatic fallback.
 *
 * If nobody has picked one, the home screen simply does not show the section.
 * Quietly promoting "the biggest discount this week" instead would put a badge
 * on a deal no human vouched for.
 */
export async function getWeeklyDeal(): Promise<PublicDeal | null> {
  const settings = await getSettings();
  if (!settings?.weekly_deal_id) return null;

  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("deals_public")
    .select("*")
    .eq("id", settings.weekly_deal_id)
    .maybeSingle();

  // Null if the deal has since been deactivated: the view only exposes approved
  // rows, so a stale pointer resolves to nothing rather than to a dead deal.
  return (data as PublicDeal | null) ?? null;
}

/** The newest approved deals, for the "what's on right now" list at the bottom of home. */
export async function getLatestDeals(limit = 8): Promise<PublicDeal[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("deals_public")
    .select("*")
    .order("approved_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? []) as PublicDeal[];
}
