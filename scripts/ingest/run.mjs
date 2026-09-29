#!/usr/bin/env node
/**
 * WRITES one day's ingestion plan (lib/plan.mjs — the same plan the dry run reports) to a database.
 * STAGING ONLY until docs/INGESTION-READINESS.md says otherwise.
 *
 *   node scripts/ingest/run.mjs --target staging [--day 2026-09-29]
 *
 * Safety:
 *   - reads credentials ONLY from .env.staging.local (git-ignored), never from the shell or .env.local;
 *   - refuses the production project (PRODUCTION_REFS) and any APP_ENV other than "staging";
 *   - every publisher's files are one ingestion run: start_ingestion_run(source, file hash) answers
 *     already_imported for a file seen before, so a re-run writes nothing;
 *   - prices go through record_prices (sanity gates hold implausible ones), group promotions through
 *     record_promotion_group; restricted and uncertain promotions are written as HELD, never live;
 *   - any run can be undone: select rollback_ingestion_run('<run id>', 'reason').
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan, loadDay } from "./lib/plan.mjs";
import { renderReport } from "./lib/report.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The production project (docs/for-collaborators.md). Never a target of this script. */
export const PRODUCTION_REFS = ["itpyyexhmvosxcbcagvy"];

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? "" : (args[i + 1] ?? "");
};

if (flag("target") !== "staging") {
  console.error("Refusing: pass --target staging. Production ingestion is not enabled (docs/INGESTION-READINESS.md).");
  process.exit(1);
}
const envFile = join(ROOT, ".env.staging.local");
if (!existsSync(envFile)) {
  console.error("Refusing: .env.staging.local not found (docs/STAGING.md).");
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ref = (url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co/) ?? [])[1];
if (!ref || PRODUCTION_REFS.includes(ref) || env.APP_ENV !== "staging" || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Refusing: .env.staging.local does not describe a staging project (URL, APP_ENV=staging, service key).");
  process.exit(1);
}

const cache = join(ROOT, ".ingest-cache");
const DAY = flag("day") || readdirSync(cache).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
const { units, fetchReport } = loadDay(join(cache, DAY));
const plan = buildPlan(units);
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const must = async (what, promise) => {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

// Reference data.
const stores = new Map((await must("stores", db.from("stores").select("id, slug"))).map((s) => [s.slug, s.id]));
const beers = new Map((await must("beers", db.from("beers").select("id, slug, name_he"))).map((b) => [b.slug, b]));

// 1. Runs: one per publisher, keyed by the hash of its files.
const runs = new Map();
for (const publisher of [...new Set(plan.units.map((u) => u.publisher))]) {
  const us = plan.units.filter((u) => u.publisher === publisher);
  const hash = us.map((u) => u.fileHash).sort().join(":");
  const started = await must(`start run ${publisher}`, db.rpc("start_ingestion_run", { p_source_slug: us[0].source, p_file_hash: hash }));
  runs.set(publisher, { publisher, source: us[0].source, run_id: started.run_id, already: started.already_imported });
  console.log(`${publisher}: ${started.already_imported ? "already imported — skipped" : `run ${started.run_id}`}`);
}
const active = (publisher) => runs.get(publisher) && !runs.get(publisher).already;

// 2. Branches: the feed's own codes, pointing at the retailer.
const branchIds = new Map();
const branchKey = (b) => `${b.feed_chain_code}|${b.feed_sub_chain_code ?? ""}|${b.feed_store_code}`;
for (const u of plan.units) {
  const b = u.branch;
  const existing = await must(
    "branch lookup",
    db.from("branches").select("id, store_id").eq("feed_chain_code", b.feed_chain_code).eq("feed_store_code", b.feed_store_code).eq("feed_sub_chain_code", b.feed_sub_chain_code ?? ""),
  );
  let id = existing[0]?.id;
  const row = { store_id: stores.get(u.retailer), external_ref: `${b.feed_chain_code}-${b.feed_sub_chain_code ?? ""}-${b.feed_store_code}`, name_he: b.name_he, city: b.city, address: b.address, feed_chain_code: b.feed_chain_code, feed_sub_chain_code: b.feed_sub_chain_code ?? "", feed_store_code: b.feed_store_code, last_seen_at: u.observedAt };
  if (!row.store_id) throw new Error(`unknown retailer ${u.retailer}`);
  if (id) await must("branch update", db.from("branches").update({ last_seen_at: u.observedAt, name_he: b.name_he, city: b.city, address: b.address }).eq("id", id));
  else id = (await must("branch insert", db.from("branches").insert(row).select("id")))[0].id;
  branchIds.set(branchKey(b), id);
}

// 3. SKUs (created when a pack was read with confidence), with their barcodes.
const CONTAINER_HE = { can: "פחית", bottle: "בקבוק" };
const displayHe = (s) =>
  [beers.get(s.beer).name_he, s.variant, `${s.pack_quantity > 1 ? `${s.pack_quantity}×` : ""}${s.volume_ml} מ״ל`, CONTAINER_HE[s.container] ?? ""].filter(Boolean).join(" ");
const skuIds = new Map();
for (const s of plan.skus) {
  const beer = beers.get(s.beer);
  if (!beer) throw new Error(`unknown beer ${s.beer}`);
  const found = await must(
    "sku lookup",
    db.from("skus").select("id").eq("beer_id", beer.id).eq("variant", s.variant).eq("container", s.container).eq("volume_ml", s.volume_ml).eq("pack_quantity", s.pack_quantity),
  );
  let id = found[0]?.id;
  if (!id) {
    id = (await must("sku insert", db.from("skus").insert({ beer_id: beer.id, variant: s.variant, category: s.category, container: s.container, volume_ml: s.volume_ml, pack_quantity: s.pack_quantity, display_he: displayHe(s) }).select("id")))[0].id;
  }
  skuIds.set(s.key, id);
  for (const code of s.barcodes) {
    const known = await must("barcode lookup", db.from("sku_barcodes").select("sku_id").eq("barcode", code).is("store_id", null));
    if (known.length === 0) await must("barcode insert", db.from("sku_barcodes").insert({ sku_id: id, barcode: code, is_gtin: true }));
    else if (known[0].sku_id !== id) console.warn(`barcode ${code} already belongs to another SKU — left as it is, review it`);
  }
}

// 4. Source products: the alias table and the review queue.
const now = new Date().toISOString();
for (let i = 0; i < plan.sourceProducts.length; i += 200) {
  const batch = plan.sourceProducts.slice(i, i + 200).map((p) => ({
    feed_chain_code: p.feed_chain_code,
    item_code: p.item_code,
    raw_name: p.raw_name,
    manufacturer: p.manufacturer,
    sku_id: p.sku ? skuIds.get(p.sku) : null,
    status: p.status,
    match_basis: p.match_basis,
    reason: p.reason,
    last_seen_at: now,
  }));
  await must("source products", db.from("source_products").upsert(batch, { onConflict: "feed_chain_code,item_code" }));
}

// 5. Prices and single-pack promotions, through record_prices (sanity gates apply).
const written = { projectRef: ref, runs: [...runs.values()], regular: { accepted: 0, held: 0, rejected: 0 }, promotions: { accepted: 0, held: 0, rejected: 0 }, groups: 0, errors: [] };
const toItem = (o) => ({
  sku_id: skuIds.get(o.sku),
  store_id: stores.get(o.retailer),
  branch_id: branchIds.get(branchKey(o.branch)),
  kind: o.kind,
  price_agorot: o.price_agorot,
  observed_at: o.observed_at,
  valid_from: o.valid_from ?? null,
  valid_to: o.valid_to ?? null,
  promo_type: o.promo_type ?? null,
  conditions: o.conditions,
  natural_key: o.natural_key,
  content_hash: o.content_hash,
  raw: o.raw,
  status: o.status ?? "live",
});
for (const [kind, list] of [["regular", plan.regular], ["promotions", plan.promotions]]) {
  for (const publisher of runs.keys()) {
    if (!active(publisher)) continue;
    const mine = list.filter((o) => plan.units.some((u) => u.publisher === publisher && u.retailer === o.retailer && u.branch.feed_store_code === o.branch.feed_store_code));
    for (let i = 0; i < mine.length; i += 100) {
      const res = await must(`record ${kind}`, db.rpc("record_prices", { p_source_slug: runs.get(publisher).source, p_items: mine.slice(i, i + 100).map(toItem), p_run_id: runs.get(publisher).run_id }));
      written[kind].accepted += res.accepted - res.held;
      written[kind].held += res.held;
      written[kind].rejected += res.rejected;
      for (const e of res.errors) written.errors.push({ kind, publisher, ...e });
    }
  }
}

// 6. Group promotions.
for (const g of plan.groups) {
  const publisher = plan.units.find((u) => u.retailer === g.retailer && u.branch.feed_store_code === g.branch.feed_store_code)?.publisher;
  if (!active(publisher)) continue;
  await must(
    "group promotion",
    db.rpc("record_promotion_group", {
      p_source_slug: g.source,
      p_run_id: runs.get(publisher).run_id,
      p_group: {
        store_id: stores.get(g.retailer),
        branch_id: branchIds.get(branchKey(g.branch)),
        natural_key: g.natural_key,
        description_he: g.description_he,
        required_qty: g.required_qty,
        total_agorot: g.total_agorot,
        audience: g.audience,
        deposit_agorot: g.deposit_agorot,
        deposit_included: g.deposit_included,
        valid_from: g.valid_from,
        valid_to: g.valid_to,
        observed_at: g.observed_at,
        status: g.status,
        sku_ids: g.skus.map((k) => skuIds.get(k)),
        raw: g.raw,
        content_hash: g.content_hash,
      },
    }),
  );
  written.groups++;
}

// 7. Close the runs.
for (const r of runs.values()) {
  if (r.already) continue;
  const stats = {
    branches: plan.units.filter((u) => u.publisher === r.publisher).map((u) => ({ retailer: u.retailer, store: u.store, rows: u.rows, beer: u.beer, promo: u.promo })),
  };
  await must("finish run", db.rpc("finish_ingestion_run", { p_run_id: r.run_id, p_status: "succeeded", p_stats: stats }));
}

writeFileSync(join(ROOT, "docs", "INGESTION-STAGING-REPORT.md"), renderReport(plan, { mode: "staging", day: DAY, fetchReport, written, generatedAt: new Date().toISOString() }));
writeFileSync(join(cache, DAY, "staging-write.json"), JSON.stringify(written, null, 2));
console.log(JSON.stringify({ regular: written.regular, promotions: written.promotions, groups: written.groups, errors: written.errors.length }));
if (written.errors.length) console.log(written.errors.slice(0, 10));
console.log("wrote docs/INGESTION-STAGING-REPORT.md");

// Quality gate: a record the database refused means the plan and the schema disagree. The run stays
// (it can be inspected, or undone with rollback_ingestion_run), but the caller must not go on to
// announce anything: exit non-zero so the scheduled workflow skips the notification step.
const rejected = written.regular.rejected + written.promotions.rejected;
if (written.errors.length > 0 || rejected > 0) {
  console.error(`QUALITY GATE FAILED: ${rejected} records rejected, ${written.errors.length} errors. Nothing will be announced.`);
  process.exit(2);
}
