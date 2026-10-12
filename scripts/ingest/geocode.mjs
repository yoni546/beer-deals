/**
 * Give the branches a position on the map.
 *
 * Migration 0026 added latitude/longitude to `branches` and left them empty on
 * purpose: the price-transparency Stores file carries a branch's name, address and
 * city and NEVER a coordinate, so a position has to come from a geocoder.
 *
 * SINCE MIGRATION 0045 every branch whose town we recognise already has a position:
 * the centre of that town, recorded as geocode_precision = 'locality' and worded on
 * the screen as "מרכז העיר". That is enough to answer "is there a Rami Levy in my
 * town", and openly not enough to point at the shop's door.
 *
 * This is the upgrade from that floor: a real street-level fix. It only ever looks at
 * branches with NO position, so run it after clearing the town-centre fix from the
 * rows you want re-done (or before 0045 runs on a fresh import).
 *
 *   node scripts/ingest/geocode.mjs --target staging              # dry run: says what it WOULD write
 *   node scripts/ingest/geocode.mjs --target staging --apply      # writes
 *   node scripts/ingest/geocode.mjs --target staging --limit 50   # a slice, to try it out
 *   node scripts/ingest/geocode.mjs --target staging --store rami-levy
 *
 * DRY RUN IS THE DEFAULT. Nothing is written without --apply.
 *
 * SAFETY
 *   - credentials and configuration come ONLY from the target's git-ignored env file
 *     (.env.staging.local / .env.production.local), never from the shell. Production
 *     additionally needs APP_ENV=production and --confirm-ref, as every writer here does.
 *   - with no GEOCODER configured the provider REFUSES everything and this run writes
 *     nothing. An invented coordinate is the one failure this product cannot absorb:
 *     a missing position is visible in the admin count and on the screen, a wrong one
 *     is visible nowhere, and somebody is standing outside the wrong supermarket.
 *   - every write carries geocoded_at, geocode_source and geocode_precision together
 *     with the point. The table's own CHECK refuses a coordinate without them (0026).
 *   - a point outside Israel is refused before it reaches the database.
 *   - only branches that have no position yet are looked up, so a re-run costs nothing
 *     and the provider's rate limit is respected.
 */
import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTarget } from "./lib/target.mjs";
import { insideIsrael, PRECISIONS, providerFrom } from "./lib/geocode/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? "" : (args[i + 1] ?? "");
};

const { target, env, url } = loadTarget(ROOT, args);
const APPLY = args.includes("--apply");
const LIMIT = Number(flag("limit") || 0) || null;
const STORE = flag("store") || null;

const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let provider;
try {
  provider = providerFrom(env);
} catch (error) {
  console.error(`Refusing: ${error.message}`);
  process.exit(1);
}

console.log(`geocoder: ${provider.name} — ${provider.note}`);
if (!provider.configured) {
  console.log("\nNothing will be looked up and nothing will be written.");
  console.log("To configure one, add to the target's env file:");
  console.log('  GEOCODER="nominatim"');
  console.log('  GEOCODER_CONTACT="you@example.com"   # Nominatim requires an identifiable client');
  console.log("\nSee docs/GEOCODING.md.");
  process.exit(0);
}
if (!APPLY) console.log("DRY RUN — nothing will be written. Add --apply to write.\n");

// Only what is missing. A branch we have already placed is never looked up again.
let query = db
  .from("branches")
  .select("id, name_he, city, address, store_id, stores(slug, name_he)")
  .is("latitude", null)
  .eq("is_active", true)
  .order("city", { nullsFirst: false });
if (LIMIT) query = query.limit(LIMIT);

const { data: branches, error } = await query;
if (error) {
  console.error(`Refusing: could not read the branches — ${error.message}`);
  process.exit(1);
}

const todo = (branches ?? []).filter((b) => (STORE ? b.stores?.slug === STORE : true)).filter((b) => b.address || b.city);
const skippedNoAddress = (branches ?? []).length - (branches ?? []).filter((b) => b.address || b.city).length;

console.log(`${todo.length} branches to place${skippedNoAddress ? ` (${skippedNoAddress} have neither an address nor a city)` : ""}\n`);

const tally = { placed: 0, refused: 0, failed: 0, written: 0, byPrecision: {} };
const examples = [];

for (const branch of todo) {
  const where = [branch.address, branch.city].filter(Boolean).join(", ");
  let fix = null;
  try {
    fix = await provider.geocode(branch.address, branch.city);
  } catch (failure) {
    tally.failed += 1;
    console.error(`! ${branch.stores?.name_he ?? "?"} · ${where}: ${failure.message}`);
    continue;
  }

  if (!fix) {
    tally.refused += 1;
    continue;
  }
  if (!insideIsrael(fix.lat, fix.lon) || !PRECISIONS.includes(fix.precision)) {
    // A provider that answers out of bounds, or with a precision we do not know, is
    // not trusted for that row. Better one unplaced branch than one wrong pin.
    tally.refused += 1;
    console.error(`! ${where}: refused an implausible answer (${fix.lat}, ${fix.lon}, ${fix.precision})`);
    continue;
  }

  tally.placed += 1;
  tally.byPrecision[fix.precision] = (tally.byPrecision[fix.precision] ?? 0) + 1;
  if (examples.length < 10) examples.push(`${branch.stores?.name_he ?? "?"} · ${where} → ${fix.lat.toFixed(4)}, ${fix.lon.toFixed(4)} (${fix.precision})`);

  if (!APPLY) continue;

  // The point and its provenance go together, always. 0026's CHECK refuses the row otherwise.
  const { error: writeError } = await db
    .from("branches")
    .update({
      latitude: fix.lat,
      longitude: fix.lon,
      geocoded_at: new Date().toISOString(),
      geocode_source: provider.name,
      geocode_precision: fix.precision,
    })
    .eq("id", branch.id);

  if (writeError) {
    tally.failed += 1;
    console.error(`! ${where}: ${writeError.message}`);
    continue;
  }
  tally.written += 1;
}

console.log(examples.length ? `\n${examples.join("\n")}\n` : "");
console.log(
  JSON.stringify(
    {
      target,
      provider: provider.name,
      applied: APPLY,
      looked_at: todo.length,
      placed: tally.placed,
      written: tally.written,
      could_not_place: tally.refused,
      failed: tally.failed,
      precision: tally.byPrecision,
    },
    null,
    2,
  ),
);

if (!APPLY && tally.placed > 0) console.log(`\nNothing was written. Re-run with --apply to place ${tally.placed} branches.`);
// A failure is worth a non-zero exit so a scheduled run is not reported as clean.
if (tally.failed > 0) process.exit(2);
