#!/usr/bin/env node
/**
 * RETAILER COVERAGE — every retailer traced through every stage, with the number that survives each one:
 *
 *   SOURCE → FETCH → PARSE → BEER DETECTION → CATALOGUE MATCH → PACK → PROMOTION → VALIDATION
 *          → STAGING DATABASE → APP QUERY (the views the app reads, as the public) → UI (rendered rows)
 *
 * so a drop is pinned to the stage that made it. Read-only everywhere. Staging only (same guard as
 * run.mjs); writes docs/RETAILER-COVERAGE.md.
 *
 *   node scripts/ingest/coverage.mjs [--day 2026-09-29] [--ui http://localhost:3300]
 *
 * --ui counts the rows each chain's page actually renders, in a real browser, against an app that reads
 * the same staging project (docs/STAGING.md, "run the app against staging").
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan, loadDay } from "./lib/plan.mjs";
import { NO_FEED, PUBLISHERS } from "./lib/publishers.mjs";

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
const DAY = flag("day") || readdirSync(cache).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
const { units, fetchReport } = loadDay(join(cache, DAY));
const plan = buildPlan(units);

const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
/** Every row (PostgREST answers at most 1000 per request). */
async function all(make) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const stores = await all(() => svc.from("stores").select("id, slug, name_he, kind").order("slug"));
const ledger = await all(() => svc.from("price_observations").select("store_id, kind, status, audience").order("id"));
const offers = await all(() => anon.from("offers_feed").select("store_slug, pack_quantity, origin, is_sample").order("offer_key"));
const regular = await all(() => anon.from("regular_prices_feed").select("store_slug, pack_quantity, is_sample").order("observation_id"));
const groups = await all(() => anon.from("group_offers_feed").select("store_slug, is_sample").order("offer_key"));

// UI: what each chain's page renders (deal lines, regular lines), in a real browser.
const ui = new Map();
if (flag("ui")) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const s of stores) {
    await page.goto(`${flag("ui")}/store/${s.slug}`, { waitUntil: "domcontentloaded" });
    ui.set(
      s.slug,
      await page.evaluate(() => ({
        deals: document.querySelectorAll("[data-part='deals'] article").length,
        regular: document.querySelectorAll("[data-part='regular'] article").length,
      })),
    );
  }
  await browser.close();
}

const qty = (sku) => Number(sku.split("|").pop());
const kindOf = (n) => (n <= 1 ? "single" : n >= 12 ? "case" : "pack");
/** Which publisher's feed carries a retailer (the key differs where one publisher carries several banners). */
const FEED_OF = { "yeinot-bitan": "carrefour", ampm: "dor-alon", "keshet-taamim": "keshet", "fresh-market": "freshmarket" };
const publisherOf = (retailer) => plan.units.find((u) => u.retailer === retailer)?.publisher ?? FEED_OF[retailer] ?? (PUBLISHERS[retailer] ? retailer : null);

const rows = [];
for (const s of stores) {
  const us = plan.units.filter((u) => u.retailer === s.slug);
  const sum = (f) => us.reduce((n, u) => n + f(u), 0);
  const reg = plan.regular.filter((r) => r.retailer === s.slug);
  const promos = plan.promotions.filter((p) => p.retailer === s.slug);
  const grp = plan.groups.filter((g) => g.retailer === s.slug);
  const live = promos.filter((p) => p.status === "live");
  const inLedger = ledger.filter((o) => o.store_id === s.id);
  const q = { offers: offers.filter((o) => o.store_slug === s.slug && !o.is_sample), regular: regular.filter((r) => r.store_slug === s.slug && !r.is_sample), groups: groups.filter((g) => g.store_slug === s.slug && !g.is_sample) };
  const publisher = publisherOf(s.slug);
  const fetched = (fetchReport?.publishers ?? []).find((r) => r.publisher === publisher);
  const u = ui.get(s.slug);
  const row = {
    slug: s.slug,
    name: s.name_he,
    kind: s.kind,
    publisher,
    fetch: fetched?.status ?? (NO_FEED[s.slug] ? "NO FEED" : "—"),
    fetchNote: fetched?.note ?? NO_FEED[s.slug] ?? "",
    branches: us.length,
    rawRows: sum((x) => x.rows),
    beerLike: sum((x) => x.beer),
    catalogue: sum((x) => x.ours),
    notInCatalogue: sum((x) => x.otherBeer),
    singles: reg.filter((r) => kindOf(qty(r.sku)) === "single").length,
    four: reg.filter((r) => qty(r.sku) === 4).length,
    six: reg.filter((r) => qty(r.sku) === 6).length,
    eight: reg.filter((r) => qty(r.sku) === 8).length,
    otherPacks: reg.filter((r) => kindOf(qty(r.sku)) === "pack" && ![4, 6, 8].includes(qty(r.sku))).length,
    cases: reg.filter((r) => kindOf(qty(r.sku)) === "case").length,
    unresolved: plan.unresolved.filter((r) => r.retailer === s.slug).length,
    invalid: plan.invalid.filter((r) => r.retailer === s.slug).length,
    rawPromos: sum((x) => x.promosInFile ?? 0),
    beerPromos: sum((x) => x.promo?.touching ?? 0),
    universal: live.length + grp.filter((g) => g.status === "live").length,
    restricted: sum((x) => x.promo?.restricted ?? 0),
    rejected: sum((x) => (x.promo?.excluded ?? 0) + (x.promo?.unreadable ?? 0)),
    held: sum((x) => x.promo?.held ?? 0),
    published: live.length,
    publishedGroups: grp.filter((g) => g.status === "live").length,
    stagingRegular: inLedger.filter((o) => o.kind === "regular" && o.status === "live").length,
    stagingPromos: inLedger.filter((o) => o.kind === "promotion" && o.status === "live" && o.audience === "everyone").length,
    stagingHeld: inLedger.filter((o) => o.status === "held" || (o.kind === "promotion" && o.status === "live" && o.audience !== "everyone")).length,
    queryOffers: q.offers.length,
    queryRegular: q.regular.length,
    queryGroups: q.groups.length,
    queryPacks: q.offers.filter((o) => (o.pack_quantity ?? 0) >= 2).length,
    uiDeals: u ? u.deals : null,
    uiRegular: u ? u.regular : null,
  };
  row.status = statusOf(row, PUBLISHERS[row.publisher ?? ""]);
  rows.push(row);
}

/** The status model (docs/RETAILER-COVERAGE.md): one word per retailer, and the reason. */
function statusOf(r, p) {
  if (r.kind === "category") return ["NOT A CHAIN", "a category of independent shops; no single publisher"];
  if (p?.blocked) return ["BLOCKED", p.blocked];
  if (r.fetch === "FAILED" && r.branches === 0) return ["SOURCE FOUND – INGESTION BROKEN", r.fetchNote];
  if (r.branches === 0) return ["SOURCE FOUND – INGESTION BROKEN", r.fetchNote || "no branch file was read"];
  const dbRows = r.stagingRegular + r.stagingPromos;
  if (dbRows > 0 && r.queryOffers + r.queryRegular === 0) return ["SOURCE FOUND – INGESTION BROKEN", "rows are in the database but the app's views return none"];
  if (r.uiDeals !== null && r.queryOffers + r.queryRegular > 0 && r.uiDeals + r.uiRegular === 0) return ["SOURCE FOUND – UI BROKEN", "the views return rows the page does not render"];
  const hasPrices = r.queryRegular > 0;
  const hasPromos = r.queryOffers + r.queryGroups > 0;
  if (hasPrices && !hasPromos) return ["PRICES ONLY", "no public beer promotion today"];
  if (!hasPrices && hasPromos) return ["PROMOTIONS ONLY", "no regular beer price was read"];
  if (!hasPrices && !hasPromos) return ["SOURCE FOUND – INGESTION BROKEN", "nothing reached the app"];
  const readable = r.catalogue ? (r.catalogue - r.unresolved - r.invalid) / r.catalogue : 0;
  if (readable < 0.8) return ["PARTIAL", `${Math.round(readable * 100)}% of the catalogue's beer rows could be priced`];
  return ["COMPLETE", `${Math.round(readable * 100)}% of the catalogue's beer rows priced; deals and prices reach the page`];
}

const cols = [
  ["branches", "branches read"], ["rawRows", "raw price rows"], ["beerLike", "beer-like"], ["catalogue", "normalised (our beers)"],
  ["notInCatalogue", "beers we do not carry"], ["singles", "singles"], ["four", "4-packs"], ["six", "6-packs"], ["eight", "8-packs"],
  ["otherPacks", "other packs (2–11)"], ["cases", "cases (12+)"], ["unresolved", "unresolved"], ["invalid", "price rejected"],
  ["rawPromos", "raw promotions"], ["beerPromos", "beer promotions"], ["universal", "universal (published + groups)"],
  ["restricted", "restricted (held)"], ["rejected", "rejected (coupon / unreadable)"], ["held", "held (public, unconfirmed)"],
  ["published", "published promotions"], ["publishedGroups", "published mix-and-match"], ["stagingRegular", "staging: regular rows"],
  ["stagingPromos", "staging: public promotion rows"], ["stagingHeld", "staging: held/restricted rows"], ["queryRegular", "app query: regular"],
  ["queryOffers", "app query: offers"], ["queryPacks", "app query: offers on packs/cases"], ["queryGroups", "app query: mix-and-match"],
  ["uiDeals", "UI: deal rows"], ["uiRegular", "UI: regular rows"],
];
const withFeed = rows.filter((r) => r.kind !== "category");
const md = [
  "# Retailer coverage",
  "",
  `Generated by \`node scripts/ingest/coverage.mjs${flag("ui") ? " --ui <staging app>" : ""}\` from the feed files of **${DAY}** (\`.ingest-cache/${DAY}/\`) and the **staging** database. Every number is counted, none estimated. Sampled: the branches listed per chain (\`fetch-sample.mjs\` reads one branch per retailer by default; prices are per branch, so a chain page says "החל מ־" / names the branch).`,
  "",
  "## Status",
  "",
  "| Retailer | Status | Why |",
  "|---|---|---|",
  ...withFeed.map((r) => `| ${r.name} (\`${r.slug}\`) | **${r.status[0]}** | ${r.status[1].replace(/\|/g, "/")} |`),
  "",
  "Status model: **COMPLETE** — prices and public promotions reach the page and ≥ 80% of our beers' rows are priced · **PARTIAL** — they reach the page but more is dropped · **SOURCE FOUND – INGESTION BROKEN** / **UI BROKEN** — the stage named in *Why* loses them · **PRICES ONLY** / **PROMOTIONS ONLY** · **BLOCKED** — the publisher cannot be read without credentials we do not have (never guessed, never forced).",
  "",
  "## Every stage, every retailer",
  "",
  `| Stage | ${withFeed.map((r) => r.name).join(" | ")} |`,
  `|---|${withFeed.map(() => "---:").join("|")}|`,
  ...cols.map(([key, label]) => `| ${label} | ${withFeed.map((r) => (r[key] === null ? "—" : r[key])).join(" | ")} |`),
  "",
  "How to read a drop: *raw → beer-like* is beer detection; *beer-like → normalised* is the catalogue (a beer we do not carry is counted, not guessed); *normalised → singles…cases + unresolved* is pack reading; *beer promotions → published* is the promotion rules (restricted = club/card/app, held = only one statement of the price and no shelf price to confirm it, rejected = coupons, store-wide or unreadable); *published → staging → app query* is the write path and the views (one row per pack × chain: several branches collapse into one \"החל מ־\" row); *app query → UI* is the page.",
  "",
].join("\n");
// The findings below the marker are written by hand (root causes, cross-checks); regenerating keeps them.
const MARKER = "<!-- Everything below is written by hand and kept when the tables above are regenerated. -->";
const out = join(ROOT, "docs", "RETAILER-COVERAGE.md");
const kept = existsSync(out) && readFileSync(out, "utf8").includes(MARKER) ? readFileSync(out, "utf8").split(MARKER)[1] : "\n";
writeFileSync(out, `${md}\n${MARKER}${kept}`);
console.log(withFeed.map((r) => `${r.slug.padEnd(14)} ${r.status[0]}`).join("\n"));
console.log("wrote docs/RETAILER-COVERAGE.md");
