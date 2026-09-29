import "server-only";

import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import type { AppSettings, Beer, Store } from "@/lib/db/types";

/**
 * Catalogue and settings reads. Every one goes through the caller's own session, so Row
 * Level Security — not a WHERE clause here — is what decides what a person may see.
 * Offers and regular prices are read in src/lib/offers.ts.
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
