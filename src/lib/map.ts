import "server-only";

import { cachedFeed, publicReader } from "@/lib/feeds";

/**
 * What the map screen reads: the deals around a point, one row per shop that has
 * one (migration 0057).
 *
 * This is a thin call on purpose. The decisions that matter — a branch we cannot
 * place is not returned, no point means no rows rather than the whole country,
 * the radius is applied in SQL — are all in the function, where they cannot be
 * bypassed by a caller who forgets them.
 */
export type MapOffer = {
  branch_id: string;
  branch_name: string | null;
  branch_city: string | null;
  latitude: number;
  longitude: number;
  geo_precision: "rooftop" | "street" | "locality" | null;
  km: number | null;
  offer_key: string;
  store_slug: string;
  store_name: string;
  beer_slug: string;
  beer_name: string;
  pack_label: string | null;
  effective_agorot: number;
  value_pct: number | null;
  promo_type: string | null;
  valid_to: string | null;
  observed_at: string | null;
};

/** One pin: a branch, and every deal that branch has. */
export type MapPin = {
  branchId: string;
  name: string;
  city: string | null;
  lat: number;
  lon: number;
  precision: MapOffer["geo_precision"];
  km: number | null;
  storeSlug: string;
  storeName: string;
  offers: MapOffer[];
};

const readOffersNear = cachedFeed(
  "map",
  async (lat: number, lon: number, radiusKm: number): Promise<MapOffer[]> => {
    const { data, error } = await publicReader().rpc("offers_near", {
      p_lat: lat,
      p_lon: lon,
      p_radius_km: radiusKm,
      p_limit: 400,
    });
    // Before 0057 the function does not exist, which is the same "we have nothing to
    // draw" the screen already has words for. It is not an error worth a paper jam.
    if (error) return [];
    return (data ?? []) as MapOffer[];
  },
);

/**
 * The pins for a point, each with its branch's deals, best saving first.
 *
 * Grouping happens here rather than in SQL because a pin is a screen idea, not a
 * data one: two deals at one shop are one pin with two lines, and the SQL stays
 * the plain list of (branch, deal) that it is easiest to reason about.
 */
export async function getMapPins(lat: number, lon: number, radiusKm: number): Promise<MapPin[]> {
  const rows = await readOffersNear(lat, lon, radiusKm);
  const pins = new Map<string, MapPin>();

  for (const row of rows) {
    const existing = pins.get(row.branch_id);
    if (existing) {
      existing.offers.push(row);
      continue;
    }
    pins.set(row.branch_id, {
      branchId: row.branch_id,
      name: row.branch_name ?? row.store_name,
      city: row.branch_city,
      lat: row.latitude,
      lon: row.longitude,
      precision: row.geo_precision,
      km: row.km,
      storeSlug: row.store_slug,
      storeName: row.store_name,
      offers: [row],
    });
  }

  return [...pins.values()];
}
