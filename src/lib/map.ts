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
  /** Set only on a country-view pin, where there are counts instead of lines. */
  towns?: { branches: number; deals: number; best: number | null; cheapest: number | null };
};

/**
 * The settlement list, code to name.
 *
 * Some chains write the CBS settlement SYMBOL where the town's name goes (0047):
 * production holds branches whose city is "5000", which is תל אביב-יפו. The
 * database resolves this for placing branches; a map popup headed "5000 · 86
 * חנויות" is the same data reaching a screen unresolved.
 *
 * Read here rather than joined in SQL because it is small, it never changes, and
 * it is the kind of thing a migration should not be spent on.
 */
const readTownNames = cachedFeed("towns", async (): Promise<Record<string, string>> => {
  const names: Record<string, string> = {};
  // PostgREST caps a response at 1,000 rows and the list is longer than that.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await publicReader()
      .from("town_centres")
      .select("code, name")
      .not("code", "is", null)
      .range(from, from + 999);
    if (error) return names;
    for (const row of data ?? []) names[String(row.code).replace(/^0+/, "")] = row.name;
    if (!data || data.length < 1000) return names;
  }
});

/** The town's name, when the chain wrote its number. */
const townName = (city: string | null, names: Record<string, string>) => {
  const value = (city ?? "").trim();
  if (!/^\d+$/.test(value)) return value || null;
  return names[value.replace(/^0+/, "")] ?? null;
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
 * Every place in the country with a live deal, one pin per town (0064).
 *
 * WHY THIS IS A SEPARATE QUERY. offers_near returns one row per (branch, deal)
 * and orders by distance, and PostgREST caps any response at 1,000 rows — so
 * asking it for "no radius" returns the nearest thousand rows, which is about a
 * hundred branches around one city. The radius was honoured and the answer was
 * still wrong. A country needs a coarser unit, and a thousand markers on a phone
 * is not a map anyway.
 */
export type TownPin = {
  town: string | null;
  latitude: number;
  longitude: number;
  branches: number;
  deals: number;
  best_value_pct: number | null;
  cheapest_agorot: number | null;
};

const readDealsByTown = cachedFeed("towns-with-deals", async (): Promise<TownPin[]> => {
  const { data, error } = await publicReader().rpc("deals_by_town");
  // Before 0064 the function does not exist, which the screen already has words
  // for: it is the same "we have nothing to draw" as an empty radius.
  if (error) return [];
  return (data ?? []) as TownPin[];
});

/** The country, as pins. Town names are resolved the same way (0047). */
export async function getTownPins(): Promise<MapPin[]> {
  const [rows, names] = await Promise.all([readDealsByTown(), readTownNames()]);
  return rows
    .filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude))
    .map((row) => {
      const town = townName(row.town, names);
      return {
        branchId: `${row.latitude},${row.longitude}`,
        name: town ?? "",
        city: town,
        lat: row.latitude,
        lon: row.longitude,
        // A town pin IS the town centre, and the popup says so in those words.
        precision: "locality" as const,
        km: null,
        storeSlug: "",
        storeName: town ?? "",
        // A country view carries counts, not lines: the deals themselves are a
        // radius away, and shipping them all is the thing that cannot be done.
        offers: [],
        towns: { branches: row.branches, deals: row.deals, best: row.best_value_pct, cheapest: row.cheapest_agorot },
      } satisfies MapPin;
    });
}

/**
 * The pins for a point, each with its branch's deals, best saving first.
 *
 * Grouping happens here rather than in SQL because a pin is a screen idea, not a
 * data one: two deals at one shop are one pin with two lines, and the SQL stays
 * the plain list of (branch, deal) that it is easiest to reason about.
 */
export async function getMapPins(lat: number, lon: number, radiusKm: number): Promise<MapPin[]> {
  const [rows, names] = await Promise.all([readOffersNear(lat, lon, radiusKm), readTownNames()]);
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
      city: townName(row.branch_city, names),
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
