/**
 * Every settlement in Israel, with a point to measure from.
 *
 *   node scripts/build-settlements.mjs            # report only: what it would keep and refuse
 *   node scripts/build-settlements.mjs --write    # rewrite src/data/israel-cities.ts
 *
 * WHY THIS EXISTS. The app asks a person which settlement they live in and measures
 * distances from its centre. Until now that list was 90 towns compiled by hand, which
 * covers cities and misses the kibbutz, the moshav and the village — so the people who
 * most need "where is the nearest branch" were the ones told we could not measure.
 *
 * WHAT IT READS. `data-sources/israel-geolocation-1.0.1/locations.json`, vendored with
 * its licence and its provenance so that this runs with no network and no dependency.
 * 1,264 settlements from the government's list, keyed by CBS settlement symbol, with
 * coordinates from OpenStreetMap and from Google's geocoder.
 *
 * WHY IT DOES NOT SIMPLY COPY IT. Because the upstream package did not check its own
 * geocoding, and a wrong coordinate is the one failure this product cannot absorb: it
 * is indistinguishable from a right one once it is in the table, and the person it
 * misleads is standing outside the wrong supermarket. Measured here: 85 settlements
 * share a single point in the Negev that is plainly a geocoder's fallback, four
 * military camps sit on Jerusalem's exact point, three settlements hundreds of
 * kilometres apart share one point, and עטרת is in Los Angeles.
 *
 * So every row goes through a gate, and what the gate refuses is printed rather than
 * quietly dropped. A settlement that cannot be placed keeps no coordinates, which the
 * app already handles: it is a town you can still type and still be known by, with no
 * distances — the state the feature was built around.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "data-sources", "israel-geolocation-1.0.1", "locations.json");
const TARGET = join(ROOT, "src", "data", "israel-cities.ts");

/** Israel, generously bounded — the same window migration 0026 puts on the column. */
const inIsrael = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= 29.3 && lat <= 33.5 && lon >= 34.0 && lon <= 36.0;

/** The same haversine as public.km_between and src/lib/cities.ts. */
function km(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/**
 * The 90 towns this project compiled by hand, before the dataset existed.
 *
 * They are kept for three reasons, and the order matters: they carry the alternative
 * spellings people actually type ("נצרת עילית", "ת״א", "מודיעין"), they are a second
 * opinion the import is checked against, and where the two disagree by more than two
 * kilometres they WIN — every such case so far turned out to be one of the dataset's
 * fallback points, so the independently compiled value is the one standing.
 */
const CURATED = JSON.parse(readFileSync(join(ROOT, "scripts", "data", "curated-towns.json"), "utf8")).towns;

/** Two spellings of one place, compared. Mirrors public.norm_place() (migration 0045). */
export function normPlace(raw) {
  return String(raw ?? "")
    .replace(/[־‐‑‒–—―()\-]/g, " ")
    .replace(/[׳״'’"״׳.,]/g, "")
    .replace(/קרית/g, "קריית")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function build(rows = JSON.parse(readFileSync(SOURCE, "utf8")), curated = CURATED) {
  const refused = { outside: [], shared: [], incomplete: [] };

  // A coordinate that two settlements share is not a place, it is a geocoder giving up.
  //
  // The line was three at first, to spare the genuine pairs — עין חרוד (איחוד) and
  // (מאוחד) really are neighbours. Checking the pairs that survived settled it: קרית
  // ארבע came back at KIRYAT SHMONA's coordinates, 190 km away, sharing them with
  // קרית שלמה; עופרה sat on עופר near Haifa; קרני שומרון sat near Jenin; טייבה (בעמק)
  // took the Triangle Taybe's point, 40 km from itself. A shared point is not evidence
  // of neighbours, it is evidence that something was not looked up.
  //
  // So two is the line. It costs about two dozen settlements their position — the real
  // neighbours among them included — and each of those is a place you can still type
  // and still be known by, with no distances, which is a state the app already says
  // out loud. The alternative is a confident pin on the wrong end of the country.
  const atPoint = new Map();
  for (const row of rows) {
    const key = `${Number(row.lat).toFixed(4)},${Number(row.lon).toFixed(4)}`;
    atPoint.set(key, (atPoint.get(key) ?? 0) + 1);
  }

  const kept = [];
  /** The CBS symbol of a settlement whose coordinate we refused, by spelling key. */
  const refusedCode = new Map();
  for (const row of rows) {
    const name = String(row.name ?? "").trim();
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      refused.incomplete.push(name || "(unnamed)");
      continue;
    }
    if (!inIsrael(lat, lon)) {
      refused.outside.push(`${name} (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
      refusedCode.set(normPlace(name), String(row.id ?? ""));
      continue;
    }
    if (atPoint.get(`${lat.toFixed(4)},${lon.toFixed(4)}`) >= 2) {
      refused.shared.push(name);
      // Its COORDINATE is refused; its identity is not. The CBS symbol is the
      // government's own key for the settlement and is right whatever the geocoder
      // did with it — and some publishers' Stores files carry that number where the
      // town's name goes (0047), so throwing it away costs real branches their
      // position. טירה 2720, טייבה 2730, מעלה אדומים 3616 and ביתר עילית 3780 were
      // all refused here, re-added by hand below, and arrived with no code at all.
      refusedCode.set(normPlace(name), String(row.id ?? ""));
      continue;
    }
    kept.push({ name, lat, lon, code: String(row.id ?? ""), source: "data.gov.il+osm" });
  }

  // The hand-compiled list, laid over the top: its spellings, and its coordinates
  // wherever the two disagree enough to matter.
  const byKey = new Map(kept.map((place) => [normPlace(place.name), place]));
  const overridden = [];
  const disagreed = [];
  const added = [];
  for (const town of curated) {
    const held = byKey.get(normPlace(town.name));
    if (!held) {
      // If the dataset knew this settlement and we refused only its coordinate, keep
      // the symbol it was keyed by.
      const code = refusedCode.get(normPlace(town.name));
      const place = {
        name: town.name,
        lat: town.lat,
        lon: town.lon,
        source: "compiled",
        ...(code ? { code } : {}),
        ...(town.aka ? { aka: town.aka } : {}),
      };
      kept.push(place);
      byKey.set(normPlace(town.name), place);
      added.push(town.name);
      continue;
    }
    // The hand-compiled spelling is the one the app shows and the one every caller
    // looks a town up by: the dataset writes "תל אביב - יפו" with spaces around the
    // dash, which is not how anyone writes it. The dataset's spelling is kept as an
    // alternative so a Stores file using it still finds the town.
    const aka = new Set(town.aka ?? []);
    if (held.name !== town.name) {
      aka.add(held.name);
      held.name = town.name;
    }
    for (const spelling of held.aka ?? []) aka.add(spelling);
    if (aka.size) held.aka = [...aka];
    const apart = km(town.lat, town.lon, held.lat, held.lon);
    // Five kilometres, not two. Under that the two are the same settlement with
    // different ideas of where its centre is — Haifa's downtown against its middle is
    // 3 km and neither is wrong — and the dataset's choice is the systematic one, so
    // it stands. Over it they cannot be the same place: תמרה came back 31 km away,
    // at the OTHER Tamra. Those are still reported, because a disagreement nobody
    // reads is a disagreement nobody fixes.
    if (apart > 5) {
      overridden.push(`${town.name} — the dataset put it ${apart.toFixed(0)} km away, at somewhere else`);
      held.lat = town.lat;
      held.lon = town.lon;
      held.source = "compiled";
    } else if (apart > 1) {
      disagreed.push(`${town.name} — ${apart.toFixed(1)} km apart; the dataset's point stands`);
    }
  }

  // Alphabetical by Hebrew name: 1,100 rows have no geography a reader can scan, and
  // a stable order keeps the diff of a re-import readable.
  kept.sort((a, b) => a.name.localeCompare(b.name, "he"));

  // One spelling must mean one place, or the lookup is a coin toss.
  const collisions = [];
  const seen = new Map();
  for (const place of kept) {
    for (const spelling of [place.name, ...(place.aka ?? [])]) {
      const key = normPlace(spelling);
      const held = seen.get(key);
      if (held && held !== place.name) collisions.push(`"${spelling}": ${held} / ${place.name}`);
      else seen.set(key, place.name);
    }
  }

  return { kept, refused, overridden, disagreed, added, collisions, read: rows.length };
}

const quote = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function renderTypeScript(kept) {
  const compiled = kept.filter((p) => p.source === "compiled").length;
  const lines = kept.map((p) => {
    const args = [quote(p.name), p.lat, p.lon];
    if (p.source === "compiled") {
      const code = p.code ? quote(p.code) : "null";
      return `  c(${args.join(", ")}, ${code}${p.aka ? `, ${JSON.stringify(p.aka)}` : ""}),`;
    }
    return `  s(${args.join(", ")}, ${quote(p.code)}${p.aka ? `, ${JSON.stringify(p.aka)}` : ""}),`;
  });

  return `/**
 * The places a person can say they live, with a point to measure from.
 *
 * GENERATED by scripts/build-settlements.mjs. Do not edit by hand: a correction goes
 * into scripts/data/curated-towns.json (which wins over the dataset) and the file is
 * rebuilt, so the next import does not quietly undo it.
 *
 * WHAT THIS IS, EXACTLY
 * ---------------------
 * ${kept.length} settlements — every city, town, kibbutz, moshav and village the
 * government's list holds and that could be placed. Each entry is a settlement's
 * APPROXIMATE CENTRE: not a boundary centroid, not an address, and not where the
 * person lives. That is the right precision for its only job, a radius the person
 * picks in 5 km steps, and it is openly not enough to point at a shop's door.
 *
 * PROVENANCE
 * ----------
 * ${kept.length - compiled} rows (source "data.gov.il+osm") come from the vendored
 * dataset in data-sources/israel-geolocation-1.0.1/ — the government's settlement
 * list, keyed by CBS settlement symbol, with coordinates from OpenStreetMap
 * (OpenStreetMap contributors, ODbL) and from Google's geocoder. Read that
 * folder's PROVENANCE.md: the upstream package did not check its own geocoding, and
 * the import refuses 93 rows that are demonstrably not places — 85 of them sharing
 * one fallback point, and one settlement placed in Los Angeles.
 *
 * ${compiled} rows (source "compiled") were compiled by hand for this project before
 * that dataset was used, and stand where the dataset put the settlement somewhere
 * else entirely (more than 5 km) or could not place it at all. The hand-compiled list
 * also carries the alternative spellings people actually type — "נצרת עילית", "ת״א",
 * "מודיעין" — which the dataset has no column for.
 *
 * This is a weaker claim than the project makes about prices. A price has to be right
 * or it is not shown; a town centre only has to be close enough to measure a 15 km
 * radius from, and the app says "מרכז העיר" beside a distance rather than implying a
 * doorstep.
 *
 * A settlement that is not here is still a place a person can type — it is saved as
 * text with no coordinates, and the app says it cannot measure distances for them
 * instead of inventing one.
 */

export type City = {
  /** As people write it. */
  name: string;
  /** Approximate centre, WGS84. */
  lat: number;
  lon: number;
  /** Where this row came from. "compiled" = hand-made for this project. */
  source: "compiled" | "data.gov.il+osm";
  /** The CBS settlement symbol (סמל יישוב), where the dataset supplied one. */
  code?: string;
  /** Other spellings people type, so search finds it. */
  aka?: string[];
};

/** A row from the vendored dataset. */
const s = (name: string, lat: number, lon: number, code: string, aka?: string[]): City => ({
  name,
  lat,
  lon,
  source: "data.gov.il+osm",
  code,
  ...(aka ? { aka } : {}),
});

/**
 * A row compiled by hand for this project.
 *
 * It can still carry the government's symbol: where the dataset knew the settlement
 * and only its COORDINATE was refused, the key it was filed under is right whatever
 * the geocoder did with it — and some publishers write that number where the town's
 * name goes, so throwing it away costs real branches their position.
 */
const c = (name: string, lat: number, lon: number, code: string | null = null, aka?: string[]): City => ({
  name,
  lat,
  lon,
  source: "compiled",
  ...(code ? { code } : {}),
  ...(aka ? { aka } : {}),
});

/** Alphabetical by Hebrew name, so a re-import produces a readable diff. */
export const ISRAEL_CITIES: City[] = [
${lines.join("\n")}
];

/** Every name a person might type for a place, for the search index. */
export const namesOf = (place: City): string[] => [place.name, ...(place.aka ?? [])];

/** The place with this exact name, or null. */
export const cityByName = (name: string): City | null =>
  ISRAEL_CITIES.find((place) => place.name === name) ?? null;
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = build();
  const { kept, refused, overridden, disagreed, added, collisions, read } = result;

  console.log(`read      ${read} settlements`);
  console.log(`refused   ${refused.shared.length} sharing a point with another settlement (a geocoder's fallback)`);
  console.log(`          ${refused.outside.length} outside Israel: ${refused.outside.join("; ") || "none"}`);
  console.log(`          ${refused.incomplete.length} without a name or a coordinate`);
  console.log(`added     ${added.length} from the hand-compiled list: ${added.join(", ") || "none"}`);
  console.log(`overrode  ${overridden.length} where the hand-compiled value put it somewhere else entirely`);
  for (const line of overridden) console.log(`            ${line}`);
  console.log(`checked   ${disagreed.length} smaller disagreements, dataset kept`);
  for (const line of disagreed) console.log(`            ${line}`);
  console.log(`kept      ${kept.length}`);
  if (collisions.length) {
    console.log(`\nSPELLINGS CLAIMED BY TWO PLACES (${collisions.length}) — the lookup would be a coin toss:`);
    for (const line of collisions.slice(0, 20)) console.log(`  ${line}`);
  }

  if (process.argv.includes("--write")) {
    writeFileSync(TARGET, renderTypeScript(kept));
    console.log(`\nwrote ${TARGET}`);
  } else {
    console.log(`\nNothing was written. Add --write to rebuild src/data/israel-cities.ts.`);
  }
}
