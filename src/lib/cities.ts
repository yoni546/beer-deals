import { ISRAEL_CITIES, namesOf, type City } from "@/data/israel-cities";
import { score } from "@/lib/search";

export type { City };
export { ISRAEL_CITIES, cityByName } from "@/data/israel-cities";

/**
 * Finding the place somebody means, typed on a phone, in Hebrew.
 *
 * It reuses src/lib/search.ts rather than growing a second idea of what matching
 * means: the same folding that lets "שופר-סל" find שופרסל and forgives one typo
 * also has to let "תל אביב" find תל אביב-יפו and "מעלות" find מעלות־תרשיחא.
 * Nothing here is ever an error — an unrecognised query simply ranks nothing,
 * and the person can still carry on without a city.
 */

const SUGGESTIONS = 8;

/** The best matches for what has been typed, best first. An empty query gives nothing. */
export function searchCities(query: string, limit = SUGGESTIONS): City[] {
  if (!query.trim()) return [];
  return ISRAEL_CITIES.map((place) => ({ place, rank: score(query, namesOf(place)) }))
    .filter((row) => row.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.place.name.localeCompare(b.place.name, "he"))
    .slice(0, limit)
    .map((row) => row.place);
}

/**
 * The listed place nearest a point — for "use my location", where the browser
 * gives coordinates and the person still deserves to be told, in words, where we
 * think they are. Returns null when the point is nowhere near the list, rather
 * than naming somewhere absurd.
 */
export function nearestCity(lat: number, lon: number, withinKm = 25): City | null {
  let best: { place: City; km: number } | null = null;
  for (const place of ISRAEL_CITIES) {
    const km = kmBetween(lat, lon, place.lat, place.lon);
    if (!best || km < best.km) best = { place, km };
  }
  return best && best.km <= withinKm ? best.place : null;
}

/**
 * Haversine, the same formula as public.km_between (migration 0026), so the
 * client and the database never disagree about how far away something is.
 */
export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/**
 * The distances the app offers. 0 is nationwide; the set matches the CHECK on
 * profiles.search_radius_km, so a choice here can never be refused by the database.
 */
export const RADIUS_CHOICES = [5, 10, 15, 20, 25, 50, 0] as const;

export const radiusLabel = (km: number): string => (km === 0 ? "בכל הארץ" : `עד ${km} ק״מ`);
