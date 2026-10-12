#!/usr/bin/env node
/**
 * WRITES an ingestion plan (lib/plan.mjs — the same plan the dry run reports) to a database.
 *
 *   node scripts/ingest/run.mjs --target staging [--scan <id>] [--reprocess] [--publishers a,b]
 *   node scripts/ingest/run.mjs --target production --confirm-ref <production ref> [--publishers rami-levy]
 *   node scripts/ingest/run.mjs --target staging --day 2026-09-29     # a one-branch sample day (fetch-sample.mjs)
 *
 * From a scan it also writes the branch INVENTORY (every branch the Stores files list), each branch's scan
 * outcome (record_branch_scan), closes promotions a branch's newest file no longer lists
 * (close_missing_promotions), recomputes every chain's promotion scope (refresh_promotion_scope, 0017),
 * rescores every deal (refresh_offer_scores, 0027), rebuilds the chain half of the feed
 * (refresh_offers_catalog, 0044), places any new branch at its town centre
 * (place_branches_by_town, 0045) and rings the app's cache doorbell.
 * Incremental: branches whose newest files were already imported are not sent again.
 *
 * Safety:
 *   - reads credentials ONLY from the target's git-ignored file (.env.staging.local / .env.production.local),
 *     never from the shell; production needs APP_ENV=production AND --confirm-ref equal to the file's project
 *     ref AND a ref that is not staging's (lib/target.mjs) — docs/PRODUCTION-HANDOFF-YONI.md;
 *   - --publishers limits the run to some publishers (the production canary: --publishers rami-levy);
 *   - every publisher's files are one ingestion run: start_ingestion_run(source, file hash) answers
 *     already_imported for a file seen before, so a re-run writes nothing;
 *   - prices go through record_prices (sanity gates hold implausible ones), group promotions through
 *     record_promotion_group; restricted and uncertain promotions are written as HELD, never live;
 *   - any run can be undone: select rollback_ingestion_run('<run id>', 'reason').
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inventoryPatch, withoutBlanks } from "./lib/branches.mjs";
import { buildPlan, loadDay, loadScan } from "./lib/plan.mjs";
import { renderReport } from "./lib/report.mjs";
import { loadTarget } from "./lib/target.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? "" : (args[i + 1] ?? "");
};

const { target, ref, env, url } = loadTarget(ROOT, args);
const onlyPublishers = flag("publishers") ? new Set(flag("publishers").split(",").map((p) => p.trim()).filter(Boolean)) : null;

const cache = join(ROOT, ".ingest-cache");
const FROM_DAY = Boolean(flag("day"));
if (FROM_DAY && target !== "staging") {
  console.error("Refusing: a one-branch sample day (--day) is for staging; production writes a branch scan (scan.mjs).");
  process.exit(1);
}
const loaded = FROM_DAY ? loadDay(join(cache, flag("day"))) : loadScan(cache, flag("scan") || undefined);
const { fetchReport } = loaded;
const units = onlyPublishers ? loaded.units.filter((u) => onlyPublishers.has(u.publisher)) : loaded.units;
const scan = loaded.scan && onlyPublishers ? { ...loaded.scan, publishers: loaded.scan.publishers.filter((p) => onlyPublishers.has(p.publisher)) } : loaded.scan;
if (onlyPublishers) {
  const unknown = [...onlyPublishers].filter((p) => !loaded.units.some((u) => u.publisher === p));
  if (unknown.length) {
    console.error(`Refusing: nothing scanned for ${unknown.join(", ")} (run scan.mjs --publishers ${[...onlyPublishers].join(",")} first)`);
    process.exit(1);
  }
  console.log(`publishers: ${[...onlyPublishers].join(", ")} only`);
}
const DAY = FROM_DAY ? flag("day") : scan.israeliDay;
const OUT = FROM_DAY ? join(cache, DAY) : join(cache, "scans");
const plan = buildPlan(units);
const t0 = Date.now();
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// A statement the database cancels for its timeout (PostgREST: 8 s) was rolled back whole, so asking again is
// safe. A busy or cold staging instance hits that limit now and then: such a call is retried after a pause.
// Anything else — or a timeout that keeps coming back — ends the write, and the runs it started are closed as
// failed (never left "running": a running run blocks its files from being imported again).
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isTimeout = (error) => error?.code === "57014" || /statement timeout/.test(error?.message ?? "");
const PAUSES = [5_000, 20_000, 60_000];
const runs = new Map();
async function abort(message) {
  for (const r of runs.values()) {
    if (r.already) continue;
    const { error } = await db.rpc("finish_ingestion_run", { p_run_id: r.run_id, p_status: "failed", p_stats: { error: message } });
    console.error(`${r.publisher}: run ${r.run_id} closed as failed${error ? ` (could not record it: ${error.message})` : ""}`);
  }
  throw new Error(message);
}
/** `call` makes the request (a function, so a retry sends it again). */
const must = async (what, call) => {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await call();
    if (!error) return data;
    if (!isTimeout(error) || attempt === PAUSES.length) await abort(`${what}: ${error.message}`);
    console.warn(`${what}: statement timeout — asking again in ${PAUSES[attempt] / 1000}s`);
    await sleep(PAUSES[attempt]);
  }
};

// Reference data.
const stores = new Map((await must("stores", () => db.from("stores").select("id, slug"))).map((s) => [s.slug, s.id]));
const beers = new Map((await must("beers", () => db.from("beers").select("id, slug, name_he"))).map((b) => [b.slug, b]));

// 1. Branches: the inventory (every branch a Stores file lists, read or not) and every branch read.
//    Keyed by the publisher's chain code and store number (sub-chain codes are written differently in the
//    Stores file and the price file: "1" / "001").
const branchIds = new Map();
const branchKey = (b) => `${b.feed_chain_code}|${Number(b.feed_store_code)}`;
const existingBranches = await must("branches", () => db.from("branches").select("id, store_id, feed_chain_code, feed_store_code").not("feed_chain_code", "is", null).limit(10000));
for (const b of existingBranches) branchIds.set(branchKey(b), b.id);
// One write per branch at a time (a Stores file can list a branch twice; the inventory and the files name it again).
const inFlight = new Map();
const upsertBranch = (retailer, b, patchRow) => {
  const key = branchKey(b);
  const previous = inFlight.get(key) ?? Promise.resolve();
  const next = previous.then(() => writeBranch(key, retailer, b, patchRow));
  inFlight.set(key, next.catch(() => {}));
  return next;
};
async function writeBranch(key, retailer, b, patchRow) {
  const store_id = stores.get(retailer);
  if (!store_id) throw new Error(`unknown retailer ${retailer}`);
  if (branchIds.has(key)) {
    if (Object.keys(patchRow).length) await must("branch update", () => db.from("branches").update(patchRow).eq("id", branchIds.get(key)));
    return branchIds.get(key);
  }
  const external_ref = `${b.feed_chain_code}-${b.feed_sub_chain_code ?? ""}-${String(Number(b.feed_store_code))}`;
  const found = await must("branch lookup", () => db.from("branches").select("id").eq("store_id", store_id).in("external_ref", [external_ref, `${b.feed_chain_code}-${b.feed_sub_chain_code ?? ""}-${b.feed_store_code}`]));
  if (found[0]) {
    branchIds.set(key, found[0].id);
    await must("branch update", () => db.from("branches").update({ ...patchRow, feed_chain_code: b.feed_chain_code, feed_store_code: String(Number(b.feed_store_code)) }).eq("id", found[0].id));
    return found[0].id;
  }
  const row = { store_id, external_ref, feed_chain_code: b.feed_chain_code, feed_sub_chain_code: b.feed_sub_chain_code ?? "", feed_store_code: String(Number(b.feed_store_code)), ...patchRow };
  const id = (await must("branch insert", () => db.from("branches").insert(row).select("id")))[0].id;
  branchIds.set(key, id);
  return id;
}
async function pool(items, limit, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; await work(items[i]); } }));
}
if (scan) {
  // Without a Stores file (Fresh Market lists none; a cold runner has no earlier copy) a branch is known only
  // from its price file: nothing empty overwrites what is stored (lib/branches.mjs).
  const inventory = scan.publishers.flatMap((e) => (e.inventory ?? []).map((b) => ({ chain: e.chainCode, at: e.startedAt ?? scan.startedAt, storesFileRead: Boolean(e.storesFile), b })));
  await pool(inventory, 8, ({ chain, at, storesFileRead, b }) =>
    upsertBranch(b.retailer, { feed_chain_code: chain, feed_sub_chain_code: b.subChain || "", feed_store_code: b.store }, inventoryPatch(b, { at, storesFileRead })),
  );
}
await pool(plan.units, 8, (u) => upsertBranch(u.retailer, u.branch, { last_seen_at: u.observedAt, ...withoutBlanks({ name_he: u.branch.name_he, city: u.branch.city, address: u.branch.address }) }));

// Incremental: a branch whose newest price file was already imported is not sent again.
// --reprocess: send every branch again (after a change to the rules); replays of identical rows are no-ops.
let alreadyImported = new Set();
if (scan && !args.includes("--reprocess")) {
  const files = [...new Set(plan.units.map((u) => u.files[0]))];
  for (let i = 0; i < files.length; i += 200) {
    const seen = await must("imported files", () => db.from("branch_scans").select("branch_id, price_file").in("price_file", files.slice(i, i + 200)).in("status", ["ok", "unchanged", "no_promo_file"]));
    for (const s of seen) alreadyImported.add(`${s.branch_id}|${s.price_file}`);
  }
}
const toSend = plan.units.filter((u) => !alreadyImported.has(`${branchIds.get(branchKey(u.branch))}|${u.files[0]}`));
const sendKey = new Set(toSend.map((u) => `${u.retailer}|${Number(u.branch.feed_store_code)}`));
const isSent = (o) => sendKey.has(`${o.retailer}|${Number(o.branch.feed_store_code)}`);
console.log(`branches in the plan ${plan.units.length} · already imported ${plan.units.length - toSend.length} · to write ${toSend.length}`);

// 2. Runs: one per publisher, keyed by the hash of the files actually written.
for (const publisher of [...new Set(toSend.map((u) => u.publisher))]) {
  const us = toSend.filter((u) => u.publisher === publisher);
  // One hash for the set of files (hundreds of branches do not fit an index as a joined list).
  const joined = us.map((u) => u.fileHash).sort().join(":");
  const hash = us.length === 1 ? joined : createHash("sha256").update(joined).digest("hex");
  const started = await must(`start run ${publisher}`, () => db.rpc("start_ingestion_run", { p_source_slug: us[0].source, p_file_hash: hash }));
  runs.set(publisher, { publisher, source: us[0].source, run_id: started.run_id, already: started.already_imported });
  console.log(`${publisher}: ${started.already_imported ? "already imported — skipped" : `run ${started.run_id}`}`);
}
const active = (publisher) => runs.get(publisher) && !runs.get(publisher).already;


// 3. SKUs (created when a pack was read with confidence), with their barcodes.
const CONTAINER_HE = { can: "פחית", bottle: "בקבוק" };
const displayHe = (s) =>
  [beers.get(s.beer).name_he, s.variant, s.packaging === "bottle_crate" ? "ארגז" : "", `${s.pack_quantity > 1 ? `${s.pack_quantity}×` : ""}${s.volume_ml} מ״ל`, CONTAINER_HE[s.container] ?? ""].filter(Boolean).join(" ");
const skuIds = new Map();
// All SKUs and chain-wide barcodes in two reads, then only what is missing is written.
const identity = (beerId, s) => `${beerId}|${s.variant}|${s.container}|${s.volume_ml}|${s.pack_quantity}|${s.packaging}`;
const knownSkus = new Map((await must("skus", () => db.from("skus").select("id, beer_id, variant, container, volume_ml, pack_quantity, packaging").limit(20000))).map((k) => [identity(k.beer_id, k), k.id]));
const knownBarcodes = new Map((await must("barcodes", () => db.from("sku_barcodes").select("barcode, sku_id").is("store_id", null).limit(50000))).map((b) => [b.barcode, b.sku_id]));
for (const s of plan.skus) {
  const beer = beers.get(s.beer);
  if (!beer) await abort(`unknown beer ${s.beer}`);
  let id = knownSkus.get(identity(beer.id, s));
  if (!id) {
    id = (await must("sku insert", () => db.from("skus").insert({ beer_id: beer.id, variant: s.variant, category: s.category, container: s.container, volume_ml: s.volume_ml, pack_quantity: s.pack_quantity, packaging: s.packaging, display_he: displayHe(s) }).select("id")))[0].id;
    knownSkus.set(identity(beer.id, s), id);
  }
  skuIds.set(s.key, id);
  const fresh = s.barcodes.filter((code) => !knownBarcodes.has(code));
  if (fresh.length) await must("barcode insert", () => db.from("sku_barcodes").insert(fresh.map((code) => ({ sku_id: id, barcode: code, is_gtin: true }))));
  for (const code of fresh) knownBarcodes.set(code, id);
  for (const code of s.barcodes) if (knownBarcodes.get(code) !== id) console.warn(`barcode ${code} already belongs to another SKU — left as it is, review it`);
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
  await must("source products", () => db.from("source_products").upsert(batch, { onConflict: "feed_chain_code,item_code" }));
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
    const theirs = new Set(toSend.filter((u) => u.publisher === publisher).map((u) => `${u.retailer}|${Number(u.branch.feed_store_code)}`));
    const mine = list.filter((o) => theirs.has(`${o.retailer}|${Number(o.branch.feed_store_code)}`));
    for (let i = 0; i < mine.length; i += 100) await recordPrices(kind, publisher, mine.slice(i, i + 100).map(toItem));
  }
}
// A batch the database cancels for its timeout is sent again as two halves (it was rolled back whole, and each
// row is idempotent by its content hash); a single row falls back to must()'s pauses.
async function recordPrices(kind, publisher, items) {
  const call = () => db.rpc("record_prices", { p_source_slug: runs.get(publisher).source, p_items: items, p_run_id: runs.get(publisher).run_id });
  const first = await call();
  if (first.error && isTimeout(first.error) && items.length > 1) {
    console.warn(`record ${kind}: statement timeout on ${items.length} rows — sending them as two halves`);
    const half = Math.ceil(items.length / 2);
    await recordPrices(kind, publisher, items.slice(0, half));
    await recordPrices(kind, publisher, items.slice(half));
    return;
  }
  const res = first.error ? await must(`record ${kind}`, call) : first.data;
  written[kind].accepted += res.accepted - res.held;
  written[kind].held += res.held;
  written[kind].rejected += res.rejected;
  for (const e of res.errors) written.errors.push({ kind, publisher, ...e });
}

// 6. Group promotions.
for (const g of plan.groups.filter(isSent)) {
  const publisher = toSend.find((u) => u.retailer === g.retailer && Number(u.branch.feed_store_code) === Number(g.branch.feed_store_code))?.publisher;
  if (!active(publisher)) continue;
  await must(
    "group promotion",
    () => db.rpc("record_promotion_group", {
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

// 6b. Where each public promotion is listed — every branch's current file, shown or not (0017).
if (scan) {
  const byStore = new Map();
  const chainOf = new Map(toSend.map((u) => [`${u.retailer}|${Number(u.branch.feed_store_code)}`, u.branch.feed_chain_code]));
  for (const o of plan.occurrences) {
    const at = `${o.retailer}|${Number(o.store)}`;
    if (!sendKey.has(at)) continue;
    const store = stores.get(o.retailer);
    const branch_id = branchIds.get(`${chainOf.get(at)}|${Number(o.store)}`);
    if (!branch_id) continue;
    const { retailer, store: _s, ...row } = o;
    byStore.set(store, [...(byStore.get(store) ?? []), { ...row, branch_id }]);
  }
  written.occurrences = 0;
  for (const [store, rows] of byStore) {
    for (let i = 0; i < rows.length; i += 500) written.occurrences += await must("occurrences", () => db.rpc("record_promotion_occurrences", { p_store_id: store, p_rows: rows.slice(i, i + 500) }));
  }
}

// 7. What each branch's newest promotions file no longer lists is over (0017).
if (scan) {
  written.closed = 0;
  // Only where a promotions file was read: without one, nothing is known about the branch's promotions.
  await pool(toSend.filter((u) => u.files.length === 2), 8, async (u) => {
    written.closed += await must("close missing", () => db.rpc("close_missing_promotions", { p_branch_id: branchIds.get(branchKey(u.branch)), p_observed_at: u.observedAt }));
  });
}

// 8. Every known branch's outcome in this scan, then each chain's promotion scope from it.
if (scan) {
  // Per retailer, under the scan that saw its publisher (each keeps its own id and time).
  const byStore = new Map();
  for (const e of scan.publishers) {
    for (const b of e.branches ?? []) {
      const id = branchIds.get(`${e.chainCode}|${Number(b.store)}`);
      if (!id) continue;
      const store = stores.get(b.retailer);
      const at = byStore.get(store) ?? { scanId: e.scanId ?? scan.scanId, startedAt: e.startedAt ?? scan.startedAt, rows: [] };
      at.rows.push({ branch_id: id, status: b.status, price_file: b.priceFile, promo_file: b.promoFile, price_file_at: b.priceAt, promo_file_at: b.promoAt, reason: b.reason || null });
      byStore.set(store, at);
    }
  }
  written.scope = {};
  for (const [store, { scanId, startedAt, rows }] of byStore) {
    for (let i = 0; i < rows.length; i += 500) await must("branch scan", () => db.rpc("record_branch_scan", { p_scan_id: scanId, p_store_id: store, p_scanned_at: startedAt, p_branches: rows.slice(i, i + 500) }));
    written.scope[[...stores].find(([, id]) => id === store)[0]] = await must("scope", () => db.rpc("refresh_promotion_scope", { p_store_id: store }));
  }
}

// 9. Close the runs.
for (const r of runs.values()) {
  if (r.already) continue;
  const stats = {
    branches: plan.units.filter((u) => u.publisher === r.publisher).map((u) => ({ retailer: u.retailer, store: u.store, rows: u.rows, beer: u.beer, promo: u.promo })),
  };
  await must("finish run", () => db.rpc("finish_ingestion_run", { p_run_id: r.run_id, p_status: "succeeded", p_stats: stats }));
}

// 10. Score the deals, and tell the app its catalogue moved.
//
// The Deal Score reads 180 days of the price ledger (docs/DEAL-SCORE.md), so it is
// computed here, once, and never on a page. Neither of these is allowed to fail the
// run: the prices are in and correct either way, they would simply be unscored or
// briefly stale.
{
  // Not `must`: that aborts the run, and a run whose prices are in and correct must
  // not be undone because a score would not compute.
  const { data, error } = await db.rpc("refresh_offer_scores");
  written.scores = error ? { failed: error.message } : data;
  if (error) console.error(`deal scores: ${error.message}`);
}

// A branch that appeared in this import has no position yet, and a branch with no
// position is invisible to "closest to me" (0045). This gives it the centre of its
// town — recorded as precision=locality, which the screen words as "מרכז העיר" —
// and never touches a branch that already has a better fix.
//
// Not `must`, for the same reason as the scores: the prices are in and correct
// either way, and an unplaced branch is a state the app already says out loud.
{
  const { data, error } = await db.rpc("place_branches_by_town");
  written.placed_branches = error ? { failed: error.message } : data;
  if (error) console.error(`place branches: ${error.message}`);
}

// The chain half of the feed, computed once here instead of on every page (0044).
// Production measured 15,306 ms for one read of offers_feed, past the 8-second
// cancellation Supabase applies to anon and authenticated: 18,627 live promotion
// rows, each probing an index for its reference price, to show 526 offers.
//
// Also not `must`, and for a sharper reason than the scores: if this fails the
// table keeps the PREVIOUS run's rows, so the app serves yesterday's chain offers
// rather than none. Undoing a correct import over it would be the worse outcome.
{
  const { data, error } = await db.rpc("refresh_offers_catalog");
  written.catalog = error ? { failed: error.message } : data;
  if (error) console.error(`offers catalog: ${error.message}`);
}

// The app holds the catalogue and the feeds for five minutes under one cache tag, and
// an import writes straight to Postgres — so without this it serves the previous
// catalogue, and the SKU index decides which offers a beer page can find at all.
//
// The address and the secret come from the TARGET'S env file, never from the shell:
// this run proved which project it is talking to from that file, and a cache doorbell
// read from the environment could point at a different deployment than the data.
if (env.NEXT_PUBLIC_SITE_URL && env.CRON_SECRET) {
  try {
    const response = await fetch(`${env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/api/cache/revalidate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
    written.revalidated = response.ok;
    if (!response.ok) console.error(`cache revalidate: HTTP ${response.status}`);
  } catch (error) {
    written.revalidated = false;
    console.error(`cache revalidate: ${error.message}`);
  }
} else {
  written.revalidated = "skipped (NEXT_PUBLIC_SITE_URL or CRON_SECRET not in the target's env file)";
}

// Every branch and promotion of a full scan is megabytes: that report stays beside the scan (the committed
// summary is docs/RETAILER-COVERAGE.md, from coverage.mjs). A one-branch sample run still writes the doc.
const reportPath = scan ? join(OUT, `${scan.scanId}-${target}-report.md`) : join(ROOT, "docs", "INGESTION-STAGING-REPORT.md");
writeFileSync(reportPath, renderReport(plan, { mode: target, day: DAY, fetchReport: fetchReport ?? { publishers: scan.publishers.map((p) => ({ publisher: p.publisher, status: p.status, note: p.note, files: [] })) }, written, generatedAt: new Date().toISOString() }));
written.seconds = Math.round((Date.now() - t0) / 1000);
written.branchesWritten = toSend.length;
written.branchesSkippedAsImported = plan.units.length - toSend.length;
writeFileSync(join(OUT, scan ? `${scan.scanId}-${target}-write.json` : `${target}-write.json`), JSON.stringify(written, null, 2));
console.log(JSON.stringify({ seconds: written.seconds, branchesWritten: toSend.length, regular: written.regular, promotions: written.promotions, groups: written.groups, closed: written.closed, errors: written.errors.length }));
if (written.errors.length) console.log(written.errors.slice(0, 10));
console.log(`wrote ${reportPath}`);

// Quality gate: a record the database refused means the plan and the schema disagree. The run stays
// (it can be inspected, or undone with rollback_ingestion_run), but the caller must not go on to
// announce anything: exit non-zero so the scheduled workflow skips the notification step.
const rejected = written.regular.rejected + written.promotions.rejected;
if (written.errors.length > 0 || rejected > 0) {
  console.error(`QUALITY GATE FAILED: ${rejected} records rejected, ${written.errors.length} errors. Nothing will be announced.`);
  process.exit(2);
}
