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

/**
 * Is a new answer worth overwriting what the branch already has?
 *
 * Only when it is strictly more precise. Every branch whose town we recognise
 * already sits on that town's centre (0045), so without this an upgrade run would
 * either skip them all or, worse, replace a coarse position with a coarse position
 * from a different source and call it progress.
 *
 * Unknown precisions are not trusted and never win. A row with no precision at all
 * has nothing to lose, so anything we know beats it.
 */
/**
 * Some chains write the settlement's NUMBER where its name goes (0047): production
 * holds "אשקלון, 0", "33 סוקולוב, 2650", "דרך השלום 13, 2500" — a real street, and a
 * CBS settlement symbol in the city column. A geocoder asked that way has a street
 * and a number that means nothing to it, which is most of why a dry run over 25
 * branches placed four.
 *
 * 0045's town matching already resolves these through town_centres.code. This is the
 * same rule for the geocoder: an all-digit city is a symbol and is looked up, leading
 * zeros ignored on both sides; anything else is already a name. A symbol we do not
 * know yields "" rather than itself, because sending "2650" to a geocoder is worse
 * than sending nothing — it is the kind of input that comes back confidently wrong.
 */
/**
 * One spelling key for a place name — the same rule as public.norm_place (0045),
 * so a town this script recognises is exactly a town the database recognises.
 * Mechanical only: maqaf and hyphens to space, geresh and punctuation dropped,
 * קרית unified with קריית, whitespace collapsed.
 */
export function normPlace(raw) {
  return String(raw ?? "")
    .replace(/[־‐‑‒–—―-]/g, " ")
    .replace(/[׳״'’".,]/g, "")
    .replace(/קרית(?!י)/g, "קריית")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Where to ask about a branch — or nothing, which means do not ask at all.
 *
 * A STREET WITH NO TOWN IS NOT AN ADDRESS. Nominatim is called with limit=1 and
 * countrycodes=il, so "יהודה הלוי 113, ישראל" returns the first יהודה הלוי in
 * the country and answers with complete confidence. There is a יהודה הלוי in
 * dozens of towns. That is not a near miss, it is a pin in another city, and a
 * wrong pin is the failure nobody can see — the whole reason 0026 shipped with
 * no provider configured at all.
 *
 * So a branch is only asked about when we can name its town:
 *   - the city column resolves (a name, or a CBS symbol we know — 0047);
 *   - or the ADDRESS is itself a town we know, which is how rows like
 *     "אור יהודה" with city "0" still place at their town centre.
 * Anything else returns null and is counted, not guessed.
 */
export function placeToAsk({ address, city }, { resolveCity, knownTowns }) {
  const town = resolveCity(city);
  const street = String(address ?? "").trim();
  if (town) return { address: street, city: town };
  if (street && knownTowns.has(normPlace(street))) return { address: "", city: street };
  return null;
}

export function cityResolver(towns) {
  const byCode = new Map(
    (towns ?? [])
      .filter((t) => t && t.code != null && t.name)
      .map((t) => [String(t.code).replace(/^0+/, ""), t.name]),
  );
  return (city) => {
    const value = String(city ?? "").trim();
    if (!value) return "";
    if (!/^\d+$/.test(value)) return value;
    return byCode.get(value.replace(/^0+/, "")) ?? "";
  };
}

export function isBetterFix(next, current) {
  const rank = (p) => PRECISIONS.indexOf(p);
  if (rank(next) === -1) return false;
  if (!current || rank(current) === -1) return true;
  return rank(next) < rank(current);
}
