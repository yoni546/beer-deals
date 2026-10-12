/**
 * The settlement table, as SQL rows.
 *
 * `src/data/israel-cities.ts` is the app's copy of "where each settlement is" — the
 * browser needs it to turn what somebody types into a point. The database needs the
 * same list, because the thing that places 1,160 branches on the map runs in Postgres
 * (migrations 0045 and 0046) and because `save_location` fills a missing point from it.
 *
 * Two copies of a list is how a list goes wrong, so both are produced from ONE place —
 * scripts/build-settlements.mjs, which validates the vendored dataset — and
 * `tests/town-centres.test.ts` fails if the database and the module drift apart.
 *
 *   node scripts/build-town-centres-sql.mjs            # print the rows
 *   node scripts/build-town-centres-sql.mjs --out f    # write them to a file
 *
 * ADDING OR CORRECTING A SETTLEMENT LATER. Edit scripts/data/curated-towns.json, run
 * `npm run settlements` to rebuild the TypeScript, then add a NEW migration with the
 * rows this prints. Applied migrations are not edited.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, normPlace } from "./build-settlements.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export { normPlace };

/**
 * One row per SPELLING a person or a Stores file might use, each carrying the
 * settlement's display name and its point, so a lookup is a primary-key hit.
 */
export function rowsFor(places) {
  const rows = [];
  const seen = new Map();
  for (const place of places) {
    for (const spelling of [place.name, ...(place.aka ?? [])]) {
      const key = normPlace(spelling);
      const held = seen.get(key);
      if (held) {
        // Two settlements answering to one spelling would make the lookup a coin toss.
        if (held !== place.name) throw new Error(`"${spelling}" is claimed by both ${held} and ${place.name}`);
        continue;
      }
      seen.set(key, place.name);
      rows.push({ norm: key, name: place.name, lat: place.lat, lon: place.lon, source: place.source });
    }
  }
  return rows;
}

/** Every spelling in the app's list, ready for `insert into public.town_centres`. */
export const allRows = () => rowsFor(build().kept);

const quote = (s) => `'${s.replace(/'/g, "''")}'`;

export function sqlFor(rows) {
  const values = rows.map((r) => `  (${quote(r.norm)}, ${quote(r.name)}, ${r.lat}, ${r.lon}, ${quote(r.source)})`).join(",\n");
  return (
    `insert into public.town_centres (norm_name, name, lat, lon, source) values\n${values}\n` +
    `on conflict (norm_name) do update\n  set name = excluded.name, lat = excluded.lat, lon = excluded.lon, source = excluded.source;\n`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = allRows();
  const sql = sqlFor(rows);
  const i = process.argv.indexOf("--out");
  if (i !== -1 && process.argv[i + 1]) {
    writeFileSync(join(ROOT, process.argv[i + 1]), sql);
    console.error(`${rows.length} spellings → ${process.argv[i + 1]}`);
  } else {
    process.stdout.write(sql);
  }
}
