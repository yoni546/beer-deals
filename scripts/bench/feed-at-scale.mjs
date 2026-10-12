/**
 * How long does one read of `offers_feed` take at the volume a real database holds?
 *
 * The app reads the whole feed for the chain listing, the beer listing and the
 * freshness line. On a development catalogue of a few dozen rows that is instant,
 * which is why every test passed while staging — 1,160 branches and a real price
 * ledger — took 10.2 seconds and was cancelled by Supabase's 8-second statement
 * timeout. The screen said "something went wrong".
 *
 * So this builds a database of that shape against the real migrations and times
 * the real query. It is the measurement 0022 made by hand on a hosted project,
 * except it runs anywhere and needs no credentials.
 *
 *   node scripts/bench/feed-at-scale.mjs                # staging's shape
 *   node scripts/bench/feed-at-scale.mjs --branches 4000 --regulars 200000
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};

// Staging, measured 2026-10-12: 1,160 branches, 490 live offers, and a reference
// probe whose inner loop reported 53,402 rows.
const BRANCHES = arg("branches", 1160);
const SKUS = arg("skus", 150);
const REGULARS = arg("regulars", 53000);
const PROMOTIONS = arg("promotions", 500);

const db = new PGlite();
await db.exec(readFileSync(join(ROOT, "tests/sql/bootstrap.sql"), "utf8"));
for (const file of readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(readFileSync(join(ROOT, "supabase/migrations", file), "utf8"));
}

console.log(`building: ${BRANCHES} branches · ${SKUS} packs · ${REGULARS} regular prices · ${PROMOTIONS} promotions`);

await db.exec(`
  insert into public.brands (slug, name_he, name_en) values ('bench', 'בנצ׳', 'Bench') on conflict do nothing;

  -- Branches spread over the chains, the way a scan of every retailer lands.
  insert into public.branches (store_id, external_ref, name_he, city, is_active, listed_in_stores_file)
  select s.id, 'b' || g, 'סניף ' || g, 'עיר ' || (g % 60), true, true
    from generate_series(1, ${BRANCHES}) g
    join lateral (select id from public.stores order by md5(slug || g) limit 1) s on true;

  -- Packs: real beers, several pack shapes each.
  insert into public.skus (beer_id, container, volume_ml, pack_quantity, display_he, packaging, category)
  select b.id, 'bottle', 200 + g, 1 + (g % 6), 'מארז ' || g, case when 1 + (g % 6) = 1 then 'single' else 'multipack' end, 'beer'
    from generate_series(1, ${SKUS}) g
    join lateral (select id from public.beers order by md5(slug || g) limit 1) b on true;
`);

// The price ledger: a live regular price per (pack, branch) for as many as asked.
await db.exec(`
  insert into public.price_observations
    (sku_id, store_id, branch_id, kind, price_agorot, observed_at, identity_key, source_id, status)
  select k.id, br.store_id, br.id, 'regular',
         1200 + (row_number() over () % 3000),
         now() - ((row_number() over () % 13) || ' days')::interval,
         'regular',
         (select id from public.sources where kind = 'chain_feed' limit 1),
         'live'
    from public.branches br
    cross join lateral (
      select id from public.skus order by md5(br.id::text || id::text)
       limit ${Math.max(1, Math.ceil(REGULARS / BRANCHES))}
    ) k
   limit ${REGULARS};
`);

await db.exec(`
  insert into public.promotions (store_id, canonical_key, kind, valid_from, valid_to, scope, scope_evidence)
  select br.store_id, 'promo-' || g, 'price', now() - interval '2 days', now() + interval '5 days',
         'chainwide', 'source_declared'
    from generate_series(1, ${PROMOTIONS}) g
    join lateral (select store_id from public.branches order by md5(g::text || store_id::text) limit 1) br on true;

  insert into public.price_observations
    (sku_id, store_id, branch_id, kind, promo_type, price_agorot, observed_at, valid_from, valid_to,
     identity_key, source_id, status)
  select k.id, p.store_id, br.id, 'promotion', 'price_cut',
         900 + (p.id % 1500), now() - interval '1 day', p.valid_from, p.valid_to,
         'promo-' || p.id, (select id from public.sources where kind = 'chain_feed' limit 1), 'live'
    from public.promotions p
    join lateral (select id from public.branches b where b.store_id = p.store_id limit 1) br on true
    join lateral (select id from public.skus order by md5(p.id::text) limit 1) k on true;
`);

for (const [what, sql] of [
  ["branches", "select count(*)::int n from public.branches"],
  ["price_observations", "select count(*)::int n from public.price_observations"],
  ["promotions", "select count(*)::int n from public.promotions"],
  ["offers_feed rows", "select count(*)::int n from public.offers_feed"],
]) {
  console.log(`  ${what.padEnd(20)}`, (await db.query(sql)).rows[0].n);
}

await db.exec("analyze;");

// The query the chain listing runs, as the app runs it.
const QUERY = "select store_slug, value_pct from public.offers_feed";
const runs = [];
for (let i = 0; i < 3; i++) {
  const started = performance.now();
  await db.query(QUERY);
  runs.push(Math.round(performance.now() - started));
}
console.log(`\n${QUERY}`);
console.log(`  runs: ${runs.join(" ms, ")} ms`);
console.log(`  best: ${Math.min(...runs)} ms`);

if (process.argv.includes("--plan")) {
  const { rows } = await db.query(`explain (analyze, buffers) ${QUERY}`);
  console.log("\n" + rows.map((r) => r["QUERY PLAN"]).join("\n"));
}
