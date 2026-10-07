import "server-only";

import { cache } from "react";
import { cachedFeed, publicReader } from "@/lib/feeds";
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
  const [{ data }, { data: categories }] = await Promise.all([
    supabase.from("beers").select(BEER_COLUMNS).eq("is_active", true).order("sort_order").order("name_he"),
    supabase.from("product_categories").select("slug").eq("in_scope", true),
  ]);
  const shown = new Set((categories ?? []).map((c: { slug: string }) => c.slug));
  return ((data ?? []) as unknown as Beer[]).filter((beer) => shown.size === 0 || shown.has(beer.category ?? "beer"));
});
export const getBeers = cache(readBeers);

const readStores = cachedFeed("stores", async (): Promise<Store[]> => {
  const { data } = await publicReader().from("stores").select(STORE_COLUMNS).eq("is_active", true).order("name_he");
  return (data ?? []) as unknown as Store[];
});
export const getStores = cache(readStores);

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
  const { data } = await publicReader().from("beers").select(BEER_COLUMNS);
  return Object.fromEntries(((data ?? []) as unknown as Beer[]).map((beer) => [beer.slug, beer]));
});

const readStoreIndex = cachedFeed("stores-by-slug", async (): Promise<Record<string, Store>> => {
  const { data } = await publicReader().from("stores").select(STORE_COLUMNS);
  return Object.fromEntries(((data ?? []) as unknown as Store[]).map((store) => [store.slug, store]));
});

export const getBeerBySlug = cache(async (slug: string): Promise<Beer | null> => {
  return (await readBeerIndex())[slug] ?? null;
});

export const getStoreBySlug = cache(async (slug: string): Promise<Store | null> => {
  return (await readStoreIndex())[slug] ?? null;
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
