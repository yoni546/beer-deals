import "server-only";

import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import type { AdminLevel, Beer, Profile } from "@/lib/db/types";

export type Viewer = {
  userId: string | null;
  profile: Profile | null;
  /** Rank 1 first. Empty until onboarding finishes. */
  favorites: Beer[];
  /** Favourite #1 — drives the theme and is the only beer we notify about. */
  primaryBeer: Beer | null;
  adminLevel: AdminLevel | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /** False before onboarding, and the reason `/` redirects to `/welcome`. */
  isOnboarded: boolean;
};

const EMPTY: Viewer = {
  userId: null,
  profile: null,
  favorites: [],
  primaryBeer: null,
  adminLevel: null,
  isAdmin: false,
  isSuperAdmin: false,
  isOnboarded: false,
};

/**
 * Everything a page needs to know about who is asking, in one round trip.
 *
 * `cache()` dedupes it across the whole render, so the layout and the page can
 * each ask independently without a second query.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return EMPTY;

  const [profileResult, favoritesResult, adminResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, first_name, primary_beer_id, notifications_enabled, onboarded_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("user_favorite_beers")
      .select("rank, beers(*)")
      .eq("profile_id", user.id)
      .order("rank"),
    supabase.from("admins").select("level").eq("user_id", user.id).maybeSingle(),
  ]);

  const profile = (profileResult.data as Profile | null) ?? null;

  const favorites = ((favoritesResult.data ?? []) as unknown as Array<{ beers: Beer | null }>)
    .map((row) => row.beers)
    .filter((beer): beer is Beer => beer !== null);

  const adminLevel = (adminResult.data?.level as AdminLevel | undefined) ?? null;

  return {
    userId: user.id,
    profile,
    favorites,
    primaryBeer: favorites[0] ?? null,
    adminLevel,
    isAdmin: adminLevel !== null,
    isSuperAdmin: adminLevel === "super_admin",
    isOnboarded: Boolean(profile?.onboarded_at && favorites.length === 4),
  };
});
