/**
 * The places a person can say they live, with a point to measure from.
 *
 * WHAT THIS IS, EXACTLY
 * ---------------------
 * Each entry is a settlement's APPROXIMATE CENTRE — not a boundary centroid, not
 * an address, and not where the person lives. It is good to roughly a kilometre
 * or two, which is the right precision for its only job: a radius the person
 * picks in 5 km steps. Nothing here is precise enough to place a shop, and
 * nothing in the app uses it for that.
 *
 * PROVENANCE
 * ----------
 * Compiled by hand from well-established public geographic knowledge of Israeli
 * settlements. It is NOT a copy of an official dataset, and it does not claim to
 * be complete: it covers the cities and larger towns most people would name,
 * which is enough for a radius search, and the app works for someone whose
 * village is missing (they can pick the nearest town, or share their location).
 *
 * This is deliberately a weaker claim than the project makes about prices. A
 * price has to be right or it is not shown; a town centre only has to be close
 * enough to measure a 15 km radius from, and saying so plainly is better than
 * implying an authority this file does not have.
 *
 * REFRESHING IT PROPERLY
 * ----------------------
 * The authoritative source is the Israeli government's open settlements dataset
 * on data.gov.il (the "רשימת יישובים" resource, which carries each settlement's
 * name, symbol and coordinates). Replacing this file from it is the right move
 * the moment the build has outbound network access:
 *
 *   1. Fetch the settlements resource from data.gov.il's datastore API.
 *   2. Keep name_he, the settlement symbol as `code`, and the coordinates,
 *      converting from the Israeli Transverse Mercator grid to WGS84 if the
 *      resource serves ITM rather than lat/lon.
 *   3. Write this file with `source: "data.gov.il"` on every row and record the
 *      fetch date, the way scripts/prepare-bottle.mjs records a photo's source.
 *
 * Until then every row says `source: "compiled"`, so a later import can tell
 * what it is replacing.
 */

export type City = {
  /** As people write it. */
  name: string;
  /** Approximate centre, WGS84. */
  lat: number;
  lon: number;
  /** Where this row came from. "compiled" = this file's own hand-made list. */
  source: "compiled" | "data.gov.il";
  /** Other spellings people type, so search finds it. */
  aka?: string[];
};

const city = (name: string, lat: number, lon: number, aka?: string[]): City => ({
  name,
  lat,
  lon,
  source: "compiled",
  ...(aka ? { aka } : {}),
});

/**
 * Ordered roughly north to south within each block, so a reviewer can scan it
 * geographically rather than alphabetically.
 */
export const ISRAEL_CITIES: City[] = [
  // ---- North ----
  city("קריית שמונה", 33.207, 35.572),
  city("מטולה", 33.279, 35.578),
  city("צפת", 32.965, 35.498),
  city("חצור הגלילית", 32.98, 35.545),
  city("ראש פינה", 32.969, 35.542),
  city("מעלות־תרשיחא", 33.016, 35.272, ["מעלות", "תרשיחא"]),
  city("נהריה", 33.006, 35.095),
  city("שלומי", 33.072, 35.145),
  city("עכו", 32.928, 35.082),
  city("כרמיאל", 32.916, 35.296),
  city("סחנין", 32.865, 35.3, ["סח׳נין"]),
  city("טמרה", 32.853, 35.198),
  city("שפרעם", 32.806, 35.172),
  city("נצרת", 32.702, 35.303),
  city("נוף הגליל", 32.713, 35.32, ["נצרת עילית"]),
  city("טבריה", 32.79, 35.531),
  city("מגדל העמק", 32.675, 35.245),
  city("עפולה", 32.607, 35.289),
  city("בית שאן", 32.497, 35.5),
  city("יקנעם עילית", 32.661, 35.11, ["יקנעם"]),
  city("קריית טבעון", 32.721, 35.127),

  // ---- Haifa and the bay ----
  city("חיפה", 32.794, 34.99),
  city("קריית ביאליק", 32.831, 35.081),
  city("קריית מוצקין", 32.839, 35.077),
  city("קריית ים", 32.845, 35.069),
  city("קריית אתא", 32.804, 35.106),
  city("נשר", 32.767, 35.043),
  city("טירת כרמל", 32.76, 34.972),

  // ---- Sharon and the coast ----
  city("חדרה", 32.434, 34.92),
  city("אור עקיבא", 32.509, 34.918),
  city("זכרון יעקב", 32.573, 34.952),
  city("פרדס חנה־כרכור", 32.474, 34.975, ["פרדס חנה", "כרכור"]),
  city("בנימינה", 32.515, 34.949),
  city("נתניה", 32.321, 34.853),
  city("אבן יהודה", 32.271, 34.888),
  city("כפר יונה", 32.317, 34.937),
  city("טירה", 32.234, 34.951),
  city("טייבה", 32.267, 35.01),
  city("קלנסווה", 32.285, 34.981),
  city("רעננה", 32.185, 34.871),
  city("כפר סבא", 32.175, 34.907),
  city("הוד השרון", 32.15, 34.889),
  city("הרצליה", 32.166, 34.843),
  city("רמת השרון", 32.146, 34.839),

  // ---- Tel Aviv and the Dan ----
  city("תל אביב-יפו", 32.085, 34.782, ["תל אביב", "יפו", "ת״א"]),
  city("בני ברק", 32.084, 34.833),
  city("גבעתיים", 32.072, 34.81),
  city("רמת גן", 32.082, 34.814),
  city("פתח תקווה", 32.088, 34.887),
  city("קריית אונו", 32.056, 34.855),
  city("אור יהודה", 32.03, 34.853),
  city("יהוד־מונוסון", 32.033, 34.889, ["יהוד"]),
  city("חולון", 32.015, 34.774),
  city("בת ים", 32.017, 34.75),
  city("ראשון לציון", 31.964, 34.805),
  city("נס ציונה", 31.929, 34.799),
  city("רחובות", 31.894, 34.809),
  city("רמלה", 31.928, 34.866),
  city("לוד", 31.952, 34.896),
  city("שוהם", 31.999, 34.948),
  city("מודיעין־מכבים־רעות", 31.899, 35.01, ["מודיעין"]),
  city("אלעד", 32.051, 34.951),
  city("ראש העין", 32.096, 34.956),

  // ---- Jerusalem and the hills ----
  city("ירושלים", 31.769, 35.217, ["י-ם", "ירושלם"]),
  city("בית שמש", 31.747, 34.988),
  city("מבשרת ציון", 31.797, 35.148),
  city("ביתר עילית", 31.698, 35.113),
  city("מעלה אדומים", 31.773, 35.298),
  city("גבעת זאב", 31.86, 35.168),

  // ---- Shfela and the south coast ----
  city("יבנה", 31.878, 34.739),
  city("גדרה", 31.813, 34.778),
  city("אשדוד", 31.802, 34.655),
  city("אשקלון", 31.669, 34.574),
  city("קריית מלאכי", 31.728, 34.747),
  city("קריית גת", 31.61, 34.764),
  city("שדרות", 31.525, 34.596),
  city("נתיבות", 31.422, 34.589),
  city("אופקים", 31.311, 34.62),

  // ---- Negev ----
  city("באר שבע", 31.252, 34.791),
  city("רהט", 31.393, 34.754),
  city("עומר", 31.267, 34.846),
  city("מיתר", 31.322, 34.933),
  city("להבים", 31.371, 34.816),
  city("דימונה", 31.07, 35.033),
  city("ערד", 31.259, 35.212),
  city("ירוחם", 30.988, 34.929),
  city("מצפה רמון", 30.61, 34.801),
  city("אילת", 29.557, 34.952),

  // ---- Jordan valley and east ----
  city("אריאל", 32.106, 35.187),
  city("מעלה אפרים", 32.07, 35.333),
];

/** Every name a person might type for a place, for the search index. */
export const namesOf = (place: City): string[] => [place.name, ...(place.aka ?? [])];

/** The place with this exact name, or null. */
export const cityByName = (name: string): City | null =>
  ISRAEL_CITIES.find((place) => place.name === name) ?? null;
