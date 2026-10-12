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
 *   node scripts/bench/feed-at-scale.mjs                 # staging's shape
 *   node scripts/bench/feed-at-scale.mjs --history 60    # four months of ledger
 *
 * MEASURED 2026-10-12 (PGlite, warm, this container):
 *
 *   ledger      live rows   regular_prices_current   offers_feed
 *   747,540        53,860                   82 ms        148 ms
 * 3,202,100        53,860                  102 ms        145 ms
 *
 * The ledger grew 4.3× and the read did not move. `price_obs_live_regular`
 * (0022) indexes only the live rows, so history is invisible to the feed —
 * which is the property worth protecting, and the reason the answer to
 * staging's 10,192 ms is NOT a rewrite of the read model.
 *
 * What does scale with the ledger is anything that reads all of it: counting
 * the table went 166 ms → 766 ms. Nothing on a page does, and nothing should.
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

// Staging, measured 2026-10-12: 1,160 branches, 737,404 price observations,
// 490 live offers, and a reference probe whose inner loop reported 53,402 rows.
//
// That last pair is the shape that matters and the one a naive seed gets wrong:
// the ledger is append-only, so most of it is HISTORY. Each (pack, branch) has
// one `live` regular price and a tail of `superseded` ones behind it. Seeding
// 737k rows that are all live measures a database nobody has.
const BRANCHES = arg("branches", 1160);
const SKUS = arg("skus", 150);
const PER_BRANCH = arg("per-branch", 46);   // packs priced at each branch → ~53k live rows
const HISTORY = arg("history", 14);          // observations kept per pack+branch, newest live
const PROMOTIONS = arg("promotions", 500);

const db = new PGlite();
await db.exec(readFileSync(join(ROOT, "tests/sql/bootstrap.sql"), "utf8"));
for (const file of readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(readFileSync(join(ROOT, "supabase/migrations", file), "utf8"));
}

console.log(
  `building: ${BRANCHES} branches · ${SKUS} packs · ${PER_BRANCH} packs per branch · ` +
    `${HISTORY} observations each (1 live + ${HISTORY - 1} superseded) · ${PROMOTIONS} promotions`,
);

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

// The price ledger, as an append-only ledger actually looks: one live regular
// price per (pack, branch), and a tail of superseded ones behind each.
await db.exec(`
  insert into public.price_observations
    (sku_id, store_id, branch_id, kind, price_agorot, observed_at, identity_key, source_id, status)
  select k.id, br.store_id, br.id, 'regular',
         1200 + ((h.n * 37 + k.seq) % 3000),
         now() - (h.n || ' days')::interval,
         'regular',
         (select id from public.sources where kind = 'chain_feed' limit 1),
         case when h.n = 0 then 'live' else 'superseded' end
    from public.branches br
    cross join lateral (
      select id, row_number() over () as seq
        from public.skus order by md5(br.id::text || id::text) limit ${PER_BRANCH}
    ) k
    cross join generate_series(0, ${HISTORY - 1}) as h(n);
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
  ["…of them live", "select count(*)::int n from public.price_observations where status = 'live'"],
  ["promotions", "select count(*)::int n from public.promotions"],
  ["offers_feed rows", "select count(*)::int n from public.offers_feed"],
]) {
  console.log(`  ${what.padEnd(20)}`, (await db.query(sql)).rows[0].n);
}

await db.exec("analyze;");

// The query the chain listing runs, as the app runs it — and the layers under
// it, so the cost can be attributed instead of guessed at.
const time = async (label, sql) => {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const started = performance.now();
    await db.query(sql);
    runs.push(Math.round(performance.now() - started));
  }
  console.log(`  ${label.padEnd(34)} ${String(Math.min(...runs)).padStart(6)} ms   (${runs.join(", ")})`);
  return Math.min(...runs);
};

console.log("\nwhere the time goes:");
await time("price_observations, whole table", "select count(*) from public.price_observations");
await time("regular_prices_current", "select count(*) from public.regular_prices_current");
await time("promotions_current", "select count(*) from public.promotions_current");
await time("offers_ranked", "select count(*) from public.offers_ranked");
const feed = await time("offers_feed (what the app reads)", "select store_slug, value_pct from public.offers_feed");

console.log(`\nthe chain listing waits ${feed} ms for a page that shows ${(await db.query("select count(*)::int n from public.stores")).rows[0].n} rows.`);

if (process.argv.includes("--plan")) {
  const { rows } = await db.query(`explain (analyze, buffers) ${QUERY}`);
  console.log("\n" + rows.map((r) => r["QUERY PLAN"]).join("\n"));
}
