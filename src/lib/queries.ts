import "server-only";

import { cache } from "react";
import { cachedFeed, orEmpty, publicReader, rows } from "@/lib/feeds";
import { note } from "@/lib/log";
import { supabaseServer } from "@/lib/supabase/server";
import type { AppSettings, Beer, Store } from "@/lib/db/types";

/**
 * Catalogue and settings reads.
 *
 * These are the same for everyone. `beers`, `stores`, `product_categories` and
 * `app_settings` are each `select to anon, authenticated using (true)` with a
 * matching grant, so there is no per-person row to protect here and nothing RLS
 * would withhold from one visitor and not another. (Offers and regular prices are
 * in src/lib/offers.ts; anything that IS per person is in src/lib/session.ts and
 * still goes through the caller's own session.)
 *
 * They used to be wrapped in React `cache()` alone, which dedupes within a single
 * render and nothing more — so every page load re-read the whole catalogue from
 * the database, four or five round trips, with `select("*")`. They are now read
 * once through the shared cookie-less reader and held under FEEDS_TAG, which every
 * admin mutation clears, so an edited beer or a changed setting still shows at once.
 *
 * Column lists, not `select("*")`: `beers` carries four `theme_*` columns that
 * nothing reads (the look comes from src/design/themes.ts, not the database).
 */

const BEER_COLUMNS = "id, slug, name_he, name_en, category, sort_order, is_active";
const STORE_COLUMNS = "id, slug, name_he, is_active";

/**
 * The beers people can choose: active, and in a category the app shows (product_categories.in_scope,
 * migration 0014 — cider and malt drinks are out for now). A beer someone already chose stays theirs:
 * favourites are read with the person, not from this list.
 */
const readBeers = cachedFeed("beers", async (): Promise<Beer[]> => {
  const supabase = publicReader();
  const [beers, categories] = await Promise.all([
    supabase.from("beers").select(BEER_COLUMNS).eq("is_active", true).order("sort_order").order("name_he"),
    supabase.from("product_categories").select("slug").eq("in_scope", true),
  ]);
  // Throws rather than returning [] on a refusal: see rows() in feeds.ts. An
  // empty catalogue cached for five minutes is how a fixed key still shows a
  // screen with nothing on it.
  const shown = new Set(rows<{ slug: string }>(categories, "product_categories").map((c) => c.slug));
  return (rows(beers, "beers") as unknown as Beer[]).filter(
    (beer) => shown.size === 0 || shown.has(beer.category ?? "beer"),
  );
});
export const getBeers = cache(() => orEmpty(readBeers, [] as Beer[], "beers"));

const readStores = cachedFeed("stores", async (): Promise<Store[]> => {
  const result = await publicReader().from("stores").select(STORE_COLUMNS).eq("is_active", true).order("name_he");
  return rows(result, "stores") as unknown as Store[];
});
export const getStores = cache(() => orEmpty(readStores, [] as Store[], "stores"));

/**
 * One beer or chain by slug, from a cached index rather than its own round trip —
 * these sit in the critical path of every beer and chain page, and (through
 * skuIdsOf) of the feed query behind them.
 *
 * Deliberately NOT served from getBeers()/getStores(): those are the lists a person
 * may CHOOSE from, filtered to active rows in an in-scope category. A page for a beer
 * that has been deactivated, or for a cider, must still render what we hold about it
 * rather than turn into a 404 — so these index every row.
 */
const readBeerIndex = cachedFeed("beers-by-slug", async (): Promise<Record<string, Beer>> => {
  const result = await publicReader().from("beers").select(BEER_COLUMNS);
  return Object.fromEntries((rows(result, "beers-by-slug") as unknown as Beer[]).map((beer) => [beer.slug, beer]));
});

const readStoreIndex = cachedFeed("stores-by-slug", async (): Promise<Record<string, Store>> => {
  const result = await publicReader().from("stores").select(STORE_COLUMNS);
  return Object.fromEntries((rows(result, "stores-by-slug") as unknown as Store[]).map((store) => [store.slug, store]));
});

export const getBeerBySlug = cache(async (slug: string): Promise<Beer | null> => {
  return (await orEmpty(readBeerIndex, {} as Record<string, Beer>, "beers-by-slug"))[slug] ?? null;
});

export const getStoreBySlug = cache(async (slug: string): Promise<Store | null> => {
  return (await orEmpty(readStoreIndex, {} as Record<string, Store>, "stores-by-slug"))[slug] ?? null;
});

/**
 * Every beer, by id — including the ones switched off.
 *
 * `getBeers()` returns the list somebody CHOOSES from, which is active beers only.
 * Anything naming a beer somebody already picked or followed has to read this
 * instead, or a beer deactivated by an admin (0034) silently disappears from their
 * own screens while still being theirs. The same mistake getBeerBySlug once made.
 */
export const getBeersById = cache(async (): Promise<Record<string, Beer>> => {
  return Object.fromEntries(Object.values(await readBeerIndex()).map((beer) => [beer.id, beer]));
});

const readSettings = cachedFeed("settings", async (): Promise<AppSettings | null> => {
  const { data } = await publicReader()
    .from("app_settings")
    .select(
      "weekly_deal_id, notify_min_discount_percent, notify_max_price_agorot, " +
        "notify_cooldown_hours, notify_daily_cap, notify_quiet_start, notify_quiet_end, " +
        "weekly_deal_preferred_beer_slug",
    )
    .eq("id", true)
    .maybeSingle();
  return (data as AppSettings | null) ?? null;
});
export const getSettings = cache(readSettings);

/**
 * What this person is following, by beer id (migration 0037).
 *
 * Read per request and not cached site-wide: it is one person's answer, and the
 * shared feed caches exist precisely because everything in them is the same for
 * everybody. Empty for a visitor with no session.
 */
export const getMyWatchlist = cache(async (): Promise<Record<string, { maxPriceAgorot: number | null }>> => {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return {};

  const { data, error } = await supabase.from("watchlist").select("beer_id, max_price_agorot");
  if (error) {
    // A missing table (the migration not applied yet) must not take a beer page down.
    note("watchlist.read_failed", { reason: error.message });
    return {};
  }
  const index: Record<string, { maxPriceAgorot: number | null }> = {};
  for (const row of (data ?? []) as Array<{ beer_id: string; max_price_agorot: number | null }>) {
    index[row.beer_id] = { maxPriceAgorot: row.max_price_agorot };
  }
  return index;
});
