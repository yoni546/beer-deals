/**
 * The town table, as SQL rows.
 *
 * `src/data/israel-cities.ts` is the app's copy of "where each town is" — one
 * approximate centre per settlement, hand-compiled, every row marked as such. The
 * database needs the same list, because the thing that places 1,160 branches on the
 * map runs in Postgres (migration 0045) and because `save_location` fills a missing
 * point from it.
 *
 * Two copies of a list is how a list goes wrong, so this is the only way the SQL one
 * is written, and `tests/town-centres.test.ts` fails if they drift apart.
 *
 *   node scripts/build-town-centres-sql.mjs            # print the rows
 *   node scripts/build-town-centres-sql.mjs --out f    # write them to a file
 *
 * ADDING A TOWN LATER. Add it to the TypeScript file and add a NEW migration with
 * its row (this prints one). Migration 0045 has been applied; it is not edited.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "src", "data", "israel-cities.ts");

/**
 * The same normalisation migration 0045's `norm_place()` performs, so a row's key
 * here is the key a lookup there computes. Kept in both places on purpose: the
 * test compares what they produce rather than trusting either comment.
 */
export function normPlace(raw) {
  return String(raw ?? "")
    .replace(/[־‐-―-]/g, " ")
    .replace(/[׳״'’"״׳.,]/g, "")
    .replace(/קרית/g, "קריית")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Every `city(...)` call in the TypeScript file, read as text.
 *
 * Parsing rather than importing keeps this a plain script with no build step; the
 * test imports the module itself and compares, which is what makes the parse safe.
 */
export function townsFromSource(text = readFileSync(SOURCE, "utf8")) {
  const call = /city\(\s*"([^"]+)"\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*\[([^\]]*)\])?\s*\)/g;
  const towns = [];
  for (const match of text.matchAll(call)) {
    const [, name, lat, lon, akaBlock] = match;
    const aka = akaBlock ? [...akaBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
    towns.push({ name, lat: Number(lat), lon: Number(lon), aka });
  }
  if (towns.length === 0) throw new Error(`found no city() rows in ${SOURCE}`);
  return towns;
}

/** One row per spelling a person or a Stores file might use. The point travels with each. */
export function rowsFor(towns) {
  const rows = [];
  const seen = new Map();
  for (const town of towns) {
    for (const spelling of [town.name, ...town.aka]) {
      const key = normPlace(spelling);
      const held = seen.get(key);
      if (held) {
        // Two towns answering to one spelling would make the lookup a coin toss.
        if (held !== town.name) throw new Error(`"${spelling}" is claimed by both ${held} and ${town.name}`);
        continue;
      }
      seen.set(key, town.name);
      rows.push({ norm: key, name: town.name, lat: town.lat, lon: town.lon });
    }
  }
  return rows;
}

const quote = (s) => `'${s.replace(/'/g, "''")}'`;

export function sqlFor(rows) {
  const values = rows.map((r) => `  (${quote(r.norm)}, ${quote(r.name)}, ${r.lat}, ${r.lon}, 'compiled')`).join(",\n");
  return `insert into public.town_centres (norm_name, name, lat, lon, source) values\n${values}\non conflict (norm_name) do update\n  set name = excluded.name, lat = excluded.lat, lon = excluded.lon, source = excluded.source;\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const towns = townsFromSource();
  const sql = sqlFor(rowsFor(towns));
  const i = process.argv.indexOf("--out");
  if (i !== -1 && process.argv[i + 1]) {
    writeFileSync(join(ROOT, process.argv[i + 1]), sql);
    console.error(`${towns.length} towns, ${sql.split("\n").length - 4} spellings → ${process.argv[i + 1]}`);
  } else {
    process.stdout.write(sql);
  }
}
