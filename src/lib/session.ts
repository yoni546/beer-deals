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
  /**
   * May they review deals? True for all three levels (0040) — an administrator
   * does not lose the job by gaining others. This is what opens the panel.
   */
  isModerator: boolean;
  /**
   * May they manage? Admin or owner, and since 0040 NOT a moderator. It mirrors
   * `public.is_admin()` exactly, so a screen and the database cannot disagree
   * about who somebody is.
   */
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
  isModerator: false,
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

  const CORE = "id, first_name, primary_beer_id, notifications_enabled, onboarded_at";
  const WITH_PLACE = `${CORE}, home_city, home_lat, home_lon, search_radius_km`;

  // Before 0026 there are no location columns. Asking for them on a database that has
  // not had the migration applied yet would fail the whole profile read — and a failed
  // profile read is the thing that used to throw people out of the app. Ask for them,
  // and fall back to what every database has. Same pattern as getSkuIndex.
  const readProfile = async () => {
    const full = await supabase.from("profiles").select(WITH_PLACE).eq("id", user.id).maybeSingle();
    if (!full.error) return full;
    return supabase.from("profiles").select(CORE).eq("id", user.id).maybeSingle();
  };

  const [profileResult, favoritesResult, adminResult] = await Promise.all([
    readProfile(),
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
    isModerator: adminLevel !== null,
    isAdmin: adminLevel === "admin" || adminLevel === "super_admin",
    isSuperAdmin: adminLevel === "super_admin",
    // One beer is enough (V2: a person picks between one and four). `onboarded_at` is
    // the real signal; the favourites check only guards the window between the profile
    // being stamped and the rows landing.
    isOnboarded: Boolean(profile?.onboarded_at && favorites.length >= 1),
    degraded,
  };
});
