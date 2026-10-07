import { nullProvider } from "./null.mjs";
import { nominatim } from "./nominatim.mjs";

/**
 * Turning a branch's address into a point on the map.
 *
 * THE INTERFACE
 *
 *   name     string
 *   geocode(address, city, signal) -> { lat, lon, precision } | null
 *
 *   precision is 'rooftop' | 'street' | 'locality' — how exact the fix is. A
 *   locality fix is the TOWN CENTRE, not the shop, and the app words it differently
 *   because of that. A provider that cannot say must return 'locality', never
 *   'rooftop': overstating precision is worse than admitting coarseness.
 *
 *   Returning null means "I could not place this". It is a normal answer, not an
 *   error, and the caller writes nothing for that branch.
 *
 * THE DEFAULT REFUSES. With nothing configured the null provider is used, and it
 * returns null for everything. That is deliberate: the one failure mode that would
 * genuinely damage this product is a made-up coordinate, because an invented
 * position is indistinguishable from a real one once it is in the table. A missing
 * coordinate is visible everywhere (the admin count, the "closest to me" screen);
 * a wrong one is visible nowhere.
 */

const PROVIDERS = {
  null: nullProvider,
  none: nullProvider,
  nominatim,
};

/**
 * The provider named by the target's env file (GEOCODER), or the one that refuses.
 * Config comes from that file and never from the shell — the same rule the writer
 * follows for its database credentials.
 */
export function providerFrom(env = {}) {
  const name = (env.GEOCODER || "null").trim().toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`GEOCODER=${name} is not a provider I know (${Object.keys(PROVIDERS).join(", ")})`);
  }
  return provider(env);
}

/** Israel, generously bounded — the same window migration 0026 puts on the column. */
export function insideIsrael(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 29.3 && lat <= 33.5 && lon >= 34.0 && lon <= 36.0;
}

export const PRECISIONS = ["rooftop", "street", "locality"];
