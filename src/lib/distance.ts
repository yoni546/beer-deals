import "server-only";
import { reasonWithoutPosition } from "@/lib/distance-reason";

import { cache } from "react";
import { attempt, or } from "@/lib/attempt";
import { supabaseServer } from "@/lib/supabase/server";
import type { Offer } from "@/lib/db/types";
import type { Viewer } from "@/lib/session";

/**
 * How far each offer is from the person.
 *
 * THE RULE THE BRIEF SETS. A deal reported at a chain is usually the chain's, and the
 * person should not have to care which branch it was seen at — what they want to know
 * is "where is the nearest Rami Levy, and is this deal there". So an offer's distance
 * is the distance to the NEAREST LOCATED BRANCH OF ITS CHAIN, except where the deal is
 * known to run at one branch only, where it is that branch's.
 *
 * AND WHAT IT REFUSES. An offer we cannot place gets NO distance — not a large one,
 * not the city's, not zero. The caller is told how many such offers there were and
 * says so in words. Dropping a deal to the bottom of a list labelled by distance would
 * be claiming a distance we do not have, which is the same mistake as showing a price
 * we have not verified.
 *
 * TODAY THIS RETURNS NOTHING, and that is expected: migration 0026 shipped the branch
 * coordinate columns deliberately empty, because the price-transparency Stores file
 * gives an address and never a position, and geocoding needs a provider credential
 * this repository does not have. The code below is what starts working the moment
 * those columns are filled — nothing here invents a coordinate in the meantime.
 */

export type NearbyChain = { storeId: string; km: number; branchName: string | null; city: string | null };

export type Distances =
  | { available: true; byOffer: Record<string, number>; nearestChain: Record<string, NearbyChain> }
  /** We cannot measure anything, and the screen must say which of these is why. */
  | { available: false; reason: "no_home" | "no_home_position" | "no_located_branches" };

export const NO_DISTANCES: Distances = { available: false, reason: "no_home" };

type BranchRow = { branch_id: string; store_id: string; name_he: string | null; city: string | null; km: number };

/**
 * Every branch within the person's radius, nearest first.
 *
 * `search_radius_km = 0` means nationwide: the SQL takes 0 as "no distance limit" and
 * still orders by distance, so "closest to me" keeps working for somebody who did not
 * want to be fenced in.
 */
const nearbyBranches = cache(async (lat: number, lon: number, radiusKm: number): Promise<BranchRow[]> => {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("branches_within_km", {
    p_lat: lat,
    p_lon: lon,
    p_radius_km: radiusKm,
    p_limit: 500,
  });
  // Before 0026 the function does not exist. That is not an error worth a screen: it
  // is the same "we do not know where the branches are" the feature already handles.
  if (error) return [];
  return (data ?? []) as BranchRow[];
});

/** The distances for one page's offers, or the reason there are none. */
export async function distancesFor(viewer: Viewer, offers: Offer[]): Promise<Distances> {
  const { home_city: city, home_lat: lat, home_lon: lon, search_radius_km: radius } = viewer.profile ?? {};
  if (lat === null || lat === undefined || lon === null || lon === undefined) {
    // Telling somebody who HAS set their town that they never told us is simply
    // false, and it sends them to a settings screen where the thing is already
    // filled in. A town without a position is our gap, not theirs: nothing
    // geocodes it yet (docs/GEOCODING.md), exactly as nothing geocodes the
    // branches. Say which of the two it is.
    return { available: false, reason: reasonWithoutPosition(Boolean(city)) };
  }

  const branches = or(await attempt("branches.nearby", () => nearbyBranches(lat, lon, radius ?? 0)), []);
  if (branches.length === 0) return { available: false, reason: "no_located_branches" };

  // Nearest branch per chain, and every branch we could place.
  const nearestChain: Record<string, NearbyChain> = {};
  const byBranch: Record<string, number> = {};
  for (const row of branches) {
    byBranch[row.branch_id] = row.km;
    const held = nearestChain[row.store_id];
    if (!held || row.km < held.km) {
      nearestChain[row.store_id] = { storeId: row.store_id, km: row.km, branchName: row.name_he, city: row.city };
    }
  }

  const byOffer: Record<string, number> = {};
  for (const offer of offers) {
    // A deal known to run at one branch is that branch's distance, or nothing.
    if (offer.branch_id) {
      const km = byBranch[offer.branch_id];
      if (km !== undefined) byOffer[offer.offer_key] = km;
      continue;
    }
    const chain = nearestChain[offer.store_id];
    if (chain) byOffer[offer.offer_key] = chain.km;
  }

  return { available: true, byOffer, nearestChain };
}
