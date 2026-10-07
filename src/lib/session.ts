import "server-only";

import { cache } from "react";
import { report } from "@/lib/log";
import { supabaseServer } from "@/lib/supabase/server";
import type { AdminLevel, Beer, Profile } from "@/lib/db/types";

export type Viewer = {
  userId: string | null;
  profile: Profile | null;
  /** Rank 1 first. Empty until onboarding finishes. */
  favorites: Beer[];
  /** Favourite #1 — drives the theme, and is ranked first for notifications. */
  primaryBeer: Beer | null;
  adminLevel: AdminLevel | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /** False before onboarding, and the reason `/` redirects to `/welcome`. */
  isOnboarded: boolean;
  /**
   * At least one of the three reads failed, so this Viewer describes what we could
   * reach, not who the person is. Nothing may conclude an absence from it — above
   * all, nothing may send them back through onboarding or out of the admin panel.
   */
  degraded: boolean;
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
  degraded: false,
};

/**
 * Everything a page needs to know about who is asking, in one round trip.
 *
 * `cache()` dedupes it across the whole render, so the layout and the page can
 * each ask independently without a second query.
 *
 * All three reads used to discard their errors, which made a transient failure
 * indistinguishable from "this person has no profile and no favourites" — and the
 * consequence was not an error screen but something worse: an onboarded person was
 * sent back through onboarding, and a signed-in admin was bounced to the sign-in
 * page. A failed read now sets `degraded`, and every redirect checks it.
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

  const degraded = Boolean(profileResult.error || favoritesResult.error || adminResult.error);
  if (degraded) {
    report("viewer.read_failed", {
      profile: profileResult.error?.message,
      favorites: favoritesResult.error?.message,
      admin: adminResult.error?.message,
    });
  }

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
    // One beer is enough (V2: a person picks between one and four). `onboarded_at` is
    // the real signal; the favourites check only guards the window between the profile
    // being stamped and the rows landing.
    isOnboarded: Boolean(profile?.onboarded_at && favorites.length >= 1),
    degraded,
  };
});
