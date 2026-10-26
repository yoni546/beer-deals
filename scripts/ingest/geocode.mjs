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
 *   node scripts/ingest/geocode.mjs --target staging --upgrade    # ALSO re-ask for the town-centre ones
 *
 * --UPGRADE, and why it does not clear anything first. Every branch we recognise the
 * town of already holds the town's centre (0045). Without this flag they are skipped
 * forever, because they are not missing a position — they are holding a bad one, and
 * on a map a thousand shops stacked on twenty town squares is worse than useless.
 * The obvious way to re-do them is to blank the column and let the normal pass pick
 * them up. That trades a coarse position for NO position the moment a lookup fails,
 * and a failed lookup is the common case, not the rare one. So instead the row is
 * read with its precision, the geocoder is asked, and the write happens ONLY when the
 * answer is strictly better than what is already there. A branch can move from the
 * town square to its door; it can never move back to nothing.
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
import { cityResolver, fixForBranch, insideIsrael, isBetterFix, normPlace, placeToAsk, PRECISIONS, providerFrom } from "./lib/geocode/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? "" : (args[i + 1] ?? "");
};

const { target, env, url } = loadTarget(ROOT, args);
const APPLY = args.includes("--apply");
const UPGRADE = args.includes("--upgrade");
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

// What has no position at all, and — with --upgrade — what only has its town's centre.
// A branch already placed at street level is never looked up again.
let query = db
  .from("branches")
  .select("id, name_he, city, address, store_id, geocode_precision, stores(slug, name_he)")
  .eq("is_active", true)
  .order("city", { nullsFirst: false });
query = UPGRADE ? query.or("latitude.is.null,geocode_precision.eq.locality") : query.is("latitude", null);
if (LIMIT) query = query.limit(LIMIT);

const { data: branches, error } = await query;
if (error) {
  console.error(`Refusing: could not read the branches — ${error.message}`);
  process.exit(1);
}

// SOME CHAINS WRITE THE SETTLEMENT'S NUMBER WHERE ITS NAME GOES (0047). Production
// holds 'אשקלון, 0', '33 סוקולוב, 2650', 'דרך השלום 13, 2500' — a real street and a
// CBS settlement symbol in the city column. Asked that way, a geocoder has a street
// and a number that means nothing to it: a dry run over 25 branches placed 4, and
// three of those only as far as the town. 0045's town matching already resolves these
// through town_centres.code; the geocoder never got the same treatment.
// PAGINATED, because PostgREST caps a response at 1,000 rows and the settlement
// list is 1,172. Taking the default would have loaded part of the country and
// then skipped every branch in the towns that fell off the end — silently, since
// a short answer looks exactly like a complete one.
const towns = [];
for (let from = 0; ; from += 1000) {
  const { data, error: townsError } = await db
    .from("town_centres")
    .select("code, name, norm_name, lat, lon")
    .range(from, from + 999);
  if (townsError) {
    console.error(`Refusing: could not read the settlement list — ${townsError.message}`);
    process.exit(1);
  }
  towns.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
console.log(`${towns.length} settlements known`);
const townFor = cityResolver((towns ?? []).filter((t) => t.code));
// The town's own centre, by its name — what every street-level answer is checked
// against, and what we fall back to when there is no usable street answer.
const centreOf = new Map((towns ?? []).map((t) => [normPlace(t.name), { lat: t.lat, lon: t.lon }]));
const knownTowns = new Set((towns ?? []).map((t) => t.norm_name ?? normPlace(t.name)));
const askAbout = (branch) => placeToAsk({ ...branch, name: branch.name_he }, { resolveCity: townFor, knownTowns });
const cityOf = (branch) => townFor(branch.city);

const inScope = (branches ?? []).filter((b) => (STORE ? b.stores?.slug === STORE : true));
const todo = inScope.filter((b) => askAbout(b));
const skippedNoTown = inScope.length - todo.length;
const codesResolved = inScope.filter((b) => /^\d+$/.test((b.city ?? "").trim()) && cityOf(b)).length;
if (codesResolved) console.log(`${codesResolved} name their town by its CBS symbol; resolved through town_centres (0047)`);
if (skippedNoTown) console.log(`${skippedNoTown} skipped: no town we can name, and a street alone is not an address (see placeToAsk)`);

console.log(`${todo.length} branches to place
`);

const tally = { placed: 0, refused: 0, failed: 0, written: 0, kept: 0, outOfTown: 0, byPrecision: {} };

/** Great-circle kilometres, the same formula public.km_between uses. */
function kmBetween(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const examples = [];

for (const branch of todo) {
  const ask = askAbout(branch);
  const where = [ask.address, ask.city].filter(Boolean).join(", ");
  let fix = null;
  try {
    fix = await provider.geocode(ask.address, ask.city);
  } catch (failure) {
    tally.failed += 1;
    console.error(`! ${branch.stores?.name_he ?? "?"} · ${where}: ${failure.message}`);
    continue;
  }

  if (fix && (!insideIsrael(fix.lat, fix.lon) || !PRECISIONS.includes(fix.precision))) {
    // A provider that answers out of bounds, or with a precision we do not know, is
    // not trusted for that row. Better one unplaced branch than one wrong pin.
    console.error(`! ${where}: refused an implausible answer (${fix.lat}, ${fix.lon}, ${fix.precision})`);
    fix = null;
  }

  // THE TOWN DECIDES. A street-level answer is kept only when it lands inside the
  // town we asked about; otherwise the town's own centre is the answer, which the
  // screen already words as "מרכז העיר". Asking for "street, town" does not
  // guarantee an answer in that town, and the street was never what was being
  // asked for — it only refines a town we are already sure of.
  const chosen = fixForBranch({ fix, town: centreOf.get(normPlace(ask.city)) ?? null, distanceKm: kmBetween });
  if (chosen && chosen.rejected !== undefined) {
    tally.outOfTown += 1;
    console.error(`! ${where}: the answer was ${chosen.rejected.toFixed(0)} km from ${ask.city} — kept the town centre instead`);
  }
  if (!chosen) {
    tally.refused += 1;
    continue;
  }
  fix = { lat: chosen.lat, lon: chosen.lon, precision: chosen.precision };

  // A branch sitting on its town's centre keeps it unless the answer improves on it.
  if (branch.geocode_precision && !isBetterFix(fix.precision, branch.geocode_precision)) {
    tally.kept += 1;
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
      geocode_source: fix.precision === "locality" ? `${provider.name} (town centre)` : provider.name,
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
      answer_was_in_another_town: tally.outOfTown,
      no_town_to_ask_about: skippedNoTown,
      kept_what_they_had: tally.kept,
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
