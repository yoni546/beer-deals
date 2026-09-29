import "server-only";

import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import type { AppSettings, Beer, Store } from "@/lib/db/types";

/**
 * Catalogue and settings reads. Every one goes through the caller's own session, so Row
 * Level Security — not a WHERE clause here — is what decides what a person may see.
 * Offers and regular prices are read in src/lib/offers.ts.
 */

/**
 * The beers people can choose: active, and in a category the app shows (product_categories.in_scope,
 * migration 0014 — cider and malt drinks are out for now). A beer someone already chose stays theirs:
 * favourites are read with the person, not from this list.
 */
export const getBeers = cache(async (): Promise<Beer[]> => {
  const supabase = await supabaseServer();
  const [{ data }, { data: categories }] = await Promise.all([
    supabase.from("beers").select("*").eq("is_active", true).order("sort_order").order("name_he"),
    supabase.from("product_categories").select("slug").eq("in_scope", true),
  ]);
  const shown = new Set((categories ?? []).map((c: { slug: string }) => c.slug));
  return ((data ?? []) as Beer[]).filter((beer) => shown.size === 0 || shown.has(beer.category ?? "beer"));
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

export const getSettings = cache(async (): Promise<AppSettings | null> => {
  const supabase = await supabaseServer();
  const { data } = await supabase
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
