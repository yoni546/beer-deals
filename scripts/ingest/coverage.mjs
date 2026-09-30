#!/usr/bin/env node
/**
 * RETAILER COVERAGE v2 (0.9.0) — per retailer, how many of its branches exist, how many were really checked,
 * what their files hold (by kind of pack), what reached the staging database, what the app's views return
 * and what the pages render; and where each promotion runs. Read-only. Staging only (same guard as run.mjs).
 *
 *   node scripts/ingest/coverage.mjs [--scan <id>] [--ui http://localhost:3300]
 *
 * Denominators are explicit: KNOWN branches (the publisher's Stores file), CHECKED (a current price file read),
 * PROMO-CHECKED (a current promotions file read). A retailer is FULL BRANCH VERIFIED only when every known
 * branch was checked in this scan — never on a sample.
 *
 * Writes docs/RETAILER-COVERAGE.md (the tables; the hand-written findings below the marker are kept).
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify, parsePack } from "./lib/normalize.mjs";
import { buildPlan, loadScan } from "./lib/plan.mjs";
import { PUBLISHERS } from "./lib/publishers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? "" : (args[i + 1] ?? "");
};

const envFile = join(ROOT, ".env.staging.local");
if (!existsSync(envFile)) throw new Error(".env.staging.local not found (docs/STAGING.md)");
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
if (env.APP_ENV !== "staging" || /itpyyexhmvosxcbcagvy/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error("not a staging environment");

const cache = join(ROOT, ".ingest-cache");
const { units, scan } = loadScan(cache, flag("scan") || undefined);
const plan = buildPlan(units);

const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function all(make) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    // A page that hits the statement timeout while the database is busy is asked again (twice) before giving up.
    let data, error;
    for (let attempt = 0; attempt < 3; attempt++) {
      ({ data, error } = await make().range(from, from + 999));
      if (!error || !/statement timeout/.test(error.message)) break;
    }
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const stores = await all(() => svc.from("stores").select("id, slug, name_he, kind").order("slug"));
// The feeds are read one chain at a time: a filter on store_id reaches the base tables (~1 s a chain), while
// paging through a whole feed in one order exceeds the public role's statement timeout at full-branch scale.
const offers = [];
const regular = [];
const groups = [];
for (const s of stores) {
  offers.push(...(await all(() => anon.from("offers_feed").select("store_slug, beer_slug, pack_quantity, origin, is_sample, promotion_id, scope").eq("store_id", s.id).order("offer_key"))));
  regular.push(...(await all(() => anon.from("regular_prices_feed").select("store_slug, beer_slug, pack_quantity, is_sample").eq("store_id", s.id).order("observation_id"))));
  groups.push(...(await all(() => anon.from("group_offers_feed").select("store_slug, is_sample, promotion_id, scope").eq("store_id", s.id).order("offer_key"))));
}
const skuRows = await all(() => svc.from("skus").select("id, pack_quantity, beers(slug)").order("id"));
const skus = new Map(skuRows.map((s) => [s.id, s.pack_quantity]));
const skuBeer = new Map(skuRows.map((s) => [s.id, s.beers?.slug]));
// Stored regular prices — only case SKUs are counted, so only those are read (tens of thousands of rows otherwise).
const caseSkuIds = skuRows.filter((s) => (s.pack_quantity ?? 0) >= 12).map((s) => s.id);
const stored = caseSkuIds.length
  ? await all(() => svc.from("price_observations").select("id, store_id, sku_id").eq("status", "live").eq("kind", "regular").in("sku_id", caseSkuIds).order("id"))
  : [];

// UI: rows each chain's page renders, by section.
const ui = new Map();
if (flag("ui")) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const s of stores) {
    await page.goto(`${flag("ui")}/store/${s.slug}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    ui.set(
      s.slug,
      await page.evaluate(() => ({
        deals: document.querySelectorAll("[data-part='deals'] article").length,
        regular: document.querySelectorAll("[data-part='regular'] article").length,
        caseRows: document.querySelectorAll("section[data-pack-section='case'] article").length,
      })),
    );
  }
  await browser.close();
}

const qty = (sku) => Number(sku.split("|").pop());
const kindOf = (n) => (n <= 1 ? "single" : n >= 12 ? "case" : "pack");
/** A row that looks like a case/crate in the source, whatever we made of it. */
const CASE_LIKE = /ארגז|קרטון|(\d)\s*שישיות|(^|\D)(12|15|18|20|24|30)\s*(\*|x|×|יח|פחיות|בקבוק)|(\*|x|×)\s*(12|15|18|20|24)(\D|$)|מארז\s*(12|15|18|20|24)/i;
const caseLike = (item) => CASE_LIKE.test(item.item_name) || (parsePack(item).pack_quantity ?? 0) >= 12;

const FEED_OF = { "yeinot-bitan": "carrefour", ampm: "dor-alon", "keshet-taamim": "keshet", "fresh-market": "freshmarket" };
const publisherOf = (slug) => FEED_OF[slug] ?? (PUBLISHERS[slug] ? slug : null);

const rows = [];
for (const s of stores.filter((x) => x.kind !== "category")) {
  const publisher = publisherOf(s.slug);
  const entry = scan.publishers.find((e) => e.publisher === publisher);
  const branches = (entry?.branches ?? []).filter((b) => b.retailer === s.slug);
  const count = (...st) => branches.filter((b) => st.includes(b.status)).length;
  const us = units.filter((u) => u.retailer === s.slug);
  const reg = plan.regular.filter((r) => r.retailer === s.slug);
  const distinct = (list, f) => new Set(list.filter(f).map((r) => r.sku)).size;
  const q = { offers: offers.filter((o) => o.store_slug === s.slug && !o.is_sample), regular: regular.filter((r) => r.store_slug === s.slug && !r.is_sample), groups: groups.filter((g) => g.store_slug === s.slug && !g.is_sample) };
  const canonical = new Map();
  for (const o of [...q.offers, ...q.groups]) if (o.promotion_id) canonical.set(o.promotion_id, o.scope);
  const scopeCount = (sc) => [...canonical.values()].filter((v) => v === sc).length;
  const liveCases = plan.promotions.filter((p) => p.retailer === s.slug && p.status === "live" && qty(p.sku) >= 12);
  const row = {
    slug: s.slug,
    name: s.name_he,
    provider: PUBLISHERS[publisher]?.platform ?? "—",
    blocked: PUBLISHERS[publisher]?.blocked ?? null,
    sourcePartial: entry?.sourcePartial ?? null,
    scanStatus: entry?.status ?? "not scanned",
    note: entry?.note ?? "",
    known: branches.length,
    checked: count("ok", "unchanged", "no_promo_file"),
    promoChecked: count("ok", "unchanged"),
    notPublished: count("not_published"),
    stale: count("stale"),
    failed: count("failed"),
    failures: [...new Set(branches.filter((b) => ["failed", "stale", "not_published"].includes(b.status)).map((b) => `${b.status}: ${b.reason}`))].slice(0, 3),
    rawRows: us.reduce((n, u) => n + (u.rowsTotal ?? u.items.length), 0),
    beerRows: plan.units.filter((u) => u.retailer === s.slug).reduce((n, u) => n + u.beer, 0),
    singles: distinct(reg, (r) => kindOf(qty(r.sku)) === "single"),
    four: distinct(reg, (r) => qty(r.sku) === 4),
    six: distinct(reg, (r) => qty(r.sku) === 6),
    eight: distinct(reg, (r) => qty(r.sku) === 8),
    ten: distinct(reg, (r) => qty(r.sku) === 10),
    cases: distinct(reg, (r) => qty(r.sku) >= 12),
    rawCaseLike: us.reduce((n, u) => n + u.items.filter((i) => classify(i).verdict === "beer" && caseLike(i)).length, 0),
    casePriceRows: reg.filter((r) => qty(r.sku) >= 12).length,
    casePromotions: new Set(liveCases.map((p) => p.natural_key)).size,
    storedCaseRows: stored.filter((o) => o.store_id === s.id && (skus.get(o.sku_id) ?? 0) >= 12).length,
    queryCaseRows: q.regular.filter((r) => r.pack_quantity >= 12).length + q.offers.filter((o) => (o.pack_quantity ?? 0) >= 12).length,
    uiCaseRows: ui.get(s.slug)?.caseRows ?? null,
    regularRows: reg.length,
    queryRegular: q.regular.length,
    universal: canonical.size,
    chainwide: scopeCount("chainwide"),
    partial: scopeCount("participating_branches"),
    single: scopeCount("single_branch"),
    unknown: scopeCount("unknown"),
    uiDeals: ui.get(s.slug)?.deals ?? null,
    uiRegular: ui.get(s.slug)?.regular ?? null,
    occurrences: plan.occurrences.filter((o) => o.retailer === s.slug).length,
  };
  row.status = statusOf(row);
  rows.push(row);
}

/** The coverage status: what the evidence supports, never more. */
function statusOf(r) {
  if (r.blocked) return ["BLOCKED", r.blocked];
  if (r.known === 0) return ["NO BRANCHES", r.note || "the publisher's files list no branch of this retailer"];
  if (r.checked === 0) return ["SOURCE PARTIAL", `no current file for any of ${r.known} branches${r.note ? ` (${r.note})` : ""}`];
  if (r.checked === r.known && r.promoChecked === r.known) return ["FULL BRANCH VERIFIED", `all ${r.known} branches checked in this scan`];
  if ((r.notPublished > 0 || r.sourcePartial) && r.failed === 0) {
    return ["SOURCE PARTIAL", `${r.checked} of ${r.known} branches have a current file at the source${r.sourcePartial ? ` — ${r.sourcePartial}` : ""}`];
  }
  if (r.checked === r.known && r.failed === 0 && r.stale === 0) {
    return ["SOURCE PARTIAL", `all ${r.known} branches checked; the source publishes a current promotions file for ${r.promoChecked} of them`];
  }
  if (r.checked === 1) return ["SAMPLE VERIFIED", `1 of ${r.known} branches checked`];
  return ["PARTIAL COVERAGE", `${r.checked} of ${r.known} branches checked; ${r.failed} failed, ${r.stale} stale`];
}

// Popular beers: are there cases at the source, and where do they stop?
const POPULAR = ["goldstar", "maccabee", "carlsberg", "corona", "heineken", "tuborg", "stella", "tuborg-red", "becks", "budweiser"];
const popular = POPULAR.map((beer) => {
  const raw = units.flatMap((u) => u.items.filter((i) => classify(i).beer === beer && caseLike(i)).map((i) => ({ retailer: u.retailer, name: i.item_name, price: i.price })));
  const normalized = new Set(plan.regular.filter((r) => r.sku.startsWith(`${beer}|`) && qty(r.sku) >= 12).map((r) => r.sku)).size;
  const storedN = stored.filter((o) => skuBeer.get(o.sku_id) === beer && (skus.get(o.sku_id) ?? 0) >= 12).length;
  const query = regular.filter((r) => r.beer_slug === beer && r.pack_quantity >= 12).length + offers.filter((o) => o.beer_slug === beer && (o.pack_quantity ?? 0) >= 12).length;
  const verdict = raw.length === 0 ? "A — no case SKU in any checked branch's files" : normalized === 0 ? "B — case rows exist, the parser does not read them" : storedN === 0 || query === 0 ? "C — read, but not stored or not shown" : "shown";
  const unresolved = plan.unresolved.filter((r) => r.beer === beer && CASE_LIKE.test(r.name)).map((r) => `${r.retailer}: ${r.name} (${r.why})`);
  return { beer, raw: raw.length, rawExamples: [...new Set(raw.map((x) => `${x.retailer}: ${x.name} ₪${x.price}`))].slice(0, 3), normalized, stored: storedN, query, verdict, unresolved: unresolved.slice(0, 3) };
});

const cell = (v) => (v === null || v === undefined ? "—" : String(v).replace(/\|/g, "/"));
const cols = [
  ["provider", "source / provider"], ["known", "known branches"], ["checked", "branches checked (price file)"], ["promoChecked", "branches checked (promotions file)"],
  ["notPublished", "no current file at the source"], ["stale", "stale files"], ["failed", "fetch/parse failures"], ["rawRows", "raw price rows"], ["beerRows", "beer-like rows"],
  ["singles", "single SKUs"], ["four", "4-pack SKUs"], ["six", "6-pack SKUs"], ["eight", "8-pack SKUs"], ["ten", "10-pack SKUs"], ["cases", "12+ case SKUs"],
  ["rawCaseLike", "raw case-like rows"], ["casePriceRows", "case prices (branch rows)"], ["casePromotions", "case promotions"], ["storedCaseRows", "stored case prices"],
  ["queryCaseRows", "case rows the app's views return"], ["uiCaseRows", "case rows on the page"], ["regularRows", "regular prices (branch rows)"], ["queryRegular", "regular prices shown (pack × chain)"],
  ["occurrences", "promotion occurrences (branch listings)"], ["universal", "public promotions (canonical)"], ["chainwide", "…chainwide"], ["partial", "…participating branches"],
  ["single", "…single branch"], ["unknown", "…unknown scope"], ["uiDeals", "deal rows on the page"], ["uiRegular", "regular rows on the page"],
];
const md = [
  "# Retailer coverage",
  "",
  `Generated by \`node scripts/ingest/coverage.mjs${flag("ui") ? " --ui <staging app>" : ""}\` from branch scan **${scan.scanId}** (${scan.kind}, Israeli day ${scan.israeliDay}, ${scan.seconds}s) and the **staging** database. Every number is counted, none estimated.`,
  "",
  "Denominators: **known** = branches the publisher's own Stores file lists for the retailer (banners we do not carry excluded) · **checked** = a current price file (≤ 36 h) was read this scan · **promotions checked** = a current promotions file too. A promotion's scope is measured only against branches checked in the same scan (migration 0017, `promotion_scope`).",
  "",
  "## Status",
  "",
  "| Retailer | Status | Why | As of |",
  "|---|---|---|---|",
  ...rows.map((r) => `| ${r.name} (\`${r.slug}\`) | **${r.status[0]}** | ${cell(r.status[1])} | ${scan.startedAt.slice(0, 16).replace("T", " ")} UTC |`),
  "",
  "Status model: **FULL BRANCH VERIFIED** — every known branch checked in this scan · **SOURCE PARTIAL** — the source itself does not offer a current file for every branch (not our failure) · **PARTIAL COVERAGE** — several branches checked, not all, with failures on our side · **SAMPLE VERIFIED** — one branch · **BLOCKED** — the source needs credentials we do not have. Never \"complete\" on a sample.",
  "",
  "## Every retailer, every stage",
  "",
  `| | ${rows.map((r) => r.name).join(" | ")} |`,
  `|---|${rows.map(() => "---:").join("|")}|`,
  ...cols.map(([key, label]) => `| ${label} | ${rows.map((r) => cell(r[key])).join(" | ")} |`),
  "",
  "## Source failures (first three reasons per retailer)",
  "",
  ...rows.filter((r) => r.failures.length).map((r) => `- **${r.name}**: ${r.failures.join(" · ")}`),
  "",
  "## Cases of the popular beers",
  "",
  "| Beer | case-like rows at the source | case SKUs read | case prices stored | case rows the views return | Verdict | Examples | Unresolved |",
  "|---|---:|---:|---:|---:|---|---|---|",
  ...popular.map((p) => `| ${p.beer} | ${p.raw} | ${p.normalized} | ${p.stored} | ${p.query} | ${p.verdict} | ${cell(p.rawExamples.join("; ")) || "—"} | ${cell(p.unresolved.join("; ")) || "—"} |`),
  "",
].join("\n");

const MARKER = "<!-- Everything below is written by hand and kept when the tables above are regenerated. -->";
const out = join(ROOT, "docs", "RETAILER-COVERAGE.md");
const kept = existsSync(out) && readFileSync(out, "utf8").includes(MARKER) ? readFileSync(out, "utf8").split(MARKER)[1] : "\n";
writeFileSync(out, `${md}\n${MARKER}${kept}`);
writeFileSync(join(cache, "scans", `${scan.scanId}-coverage.json`), JSON.stringify({ rows, popular }, null, 1));
console.log(rows.map((r) => `${r.slug.padEnd(14)} ${r.status[0]} · ${r.checked}/${r.known}`).join("\n"));
console.log("wrote docs/RETAILER-COVERAGE.md");
