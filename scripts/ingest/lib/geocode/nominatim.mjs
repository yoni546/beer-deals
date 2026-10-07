import { insideIsrael } from "./index.mjs";

/**
 * OpenStreetMap's Nominatim.
 *
 * WHY THIS ONE. It needs no API key and no account, so the owner can run it the day
 * they want it rather than after a billing decision. The data for Israeli towns and
 * main streets is good; for a specific shop unit inside a mall it is not, which is
 * why anything short of a house number is reported as `street` or `locality` rather
 * than dressed up as a rooftop fix.
 *
 * ITS RULES, WHICH THIS RESPECTS (https://operations.osmfoundation.org/policies/nominatim/):
 *   - at most ONE request per second. Enforced below, not merely documented.
 *   - a real User-Agent identifying the application, with a contact address.
 *     GEOCODER_CONTACT in the target's env file; the run refuses without it, because
 *     an unidentified bulk client is how a project gets the whole service blocked.
 *   - no heavy bulk use. ~1,100 branches at 1/sec is about twenty minutes, run once
 *     and then only for branches that are new. That is within what the policy
 *     contemplates; re-geocoding the whole estate nightly would not be.
 *
 * COST: none. The price is the rate limit and the obligation to be identifiable.
 *
 * IF IT IS NOT GOOD ENOUGH, Google's Geocoding API is the usual next step: far
 * better unit-level coverage in Israeli malls and shopping centres, ~$5 per 1,000
 * requests at the time of writing, needs a key and a billing account. Adding it is
 * one more file in this folder and one more entry in PROVIDERS — the interface was
 * drawn so that the choice is a configuration line, not a rewrite.
 */

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const ONE_SECOND = 1000;

/** How exact a Nominatim answer really is, from what it actually matched. */
function precisionOf(result) {
  const klass = result.class;
  const type = result.type;
  if (result.address?.house_number) return "rooftop";
  if (klass === "shop" || klass === "amenity" || type === "supermarket") return "rooftop";
  if (klass === "highway" || result.address?.road) return "street";
  return "locality";
}

export const nominatim = (env = {}) => {
  const contact = (env.GEOCODER_CONTACT || "").trim();
  let nextAllowedAt = 0;

  return {
    name: "nominatim",
    configured: Boolean(contact),
    note: contact
      ? `nominatim, 1 request/second, identifying as ${contact}`
      : "set GEOCODER_CONTACT (an email address) in the target's env file — Nominatim requires an identifiable client",

    async geocode(address, city, signal) {
      if (!contact) throw new Error("GEOCODER_CONTACT is required for the nominatim provider");

      const query = [address, city, "ישראל"].filter(Boolean).join(", ");
      if (!query.trim()) return null;

      // One request per second, enforced here so no caller can accidentally flood it.
      const wait = nextAllowedAt - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      nextAllowedAt = Date.now() + ONE_SECOND;

      const url = new URL(ENDPOINT);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("limit", "1");
      url.searchParams.set("countrycodes", "il");

      const response = await fetch(url, {
        signal,
        headers: { "User-Agent": `beer-deals/1.0 (${contact})`, "Accept-Language": "he,en" },
      });
      if (!response.ok) throw new Error(`nominatim: HTTP ${response.status}`);

      const [hit] = await response.json();
      if (!hit) return null;

      const lat = Number(hit.lat);
      const lon = Number(hit.lon);
      // A fix outside the country is a mis-match, not a branch: the address was too
      // vague and something elsewhere answered to it. Refuse rather than record it.
      if (!insideIsrael(lat, lon)) return null;

      return { lat, lon, precision: precisionOf(hit) };
    },
  };
};
