#!/usr/bin/env node
/**
 * Reads back what a staging ingestion published — as the PUBLIC sees it (anon key, RLS on) and, for
 * the bookkeeping, as the service role. Read-only. Staging only (same guard as run.mjs).
 *
 *   node scripts/ingest/verify-staging.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const file = join(ROOT, ".env.staging.local");
if (!existsSync(file)) throw new Error(".env.staging.local not found");
const env = Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
if (env.APP_ENV !== "staging" || /itpyyexhmvosxcbcagvy/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error("not a staging environment");

const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const all = async (q) => {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
};

const offers = await all(anon.from("offers_feed").select("*"));
const regular = await all(anon.from("regular_prices_feed").select("*"));
const groups = await all(anon.from("group_offers_feed").select("*"));
const ledger = await all(svc.from("price_observations").select("kind, status, audience, deposit_agorot"));
const runs = await all(svc.from("ingestion_runs").select("id, status, file_hash, stats, sources(slug)"));
const review = await all(svc.from("source_products").select("status"));

const count = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
const result = {
  public: {
    offers: offers.length,
    offersRestricted: offers.filter((o) => o.conditions?.audience && o.conditions.audience !== "everyone").length,
    offersExpired: offers.filter((o) => o.valid_to && Date.parse(o.valid_to) < Date.now()).length,
    offersWithSaving: offers.filter((o) => o.value_pct !== null).length,
    offersNeedsReview: offers.filter((o) => o.needs_review).length,
    offersSample: offers.filter((o) => o.is_sample).length,
    duplicateOffers: offers.length - new Set(offers.map((o) => `${o.sku_id}|${o.store_id}|${o.effective_agorot}|${o.promo_type}`)).size,
    regular: regular.length,
    regularByStore: count(regular, (r) => r.store_slug),
    regularWithDeposit: regular.filter((r) => r.deposit_agorot > 0).length,
    groups: groups.length,
  },
  ledger: count(ledger, (o) => `${o.kind}/${o.status}/${o.audience}`),
  runs: runs.map((r) => ({ source: r.sources?.slug, status: r.status })),
  sourceProducts: count(review, (r) => r.status),
  sampleOffers: offers.slice(0, 8).map((o) => ({ store: o.store_slug, pack: o.pack_label, price: o.effective_agorot, ref: o.reference_agorot, pct: o.value_pct, type: o.promo_type, deposit: o.deposit_agorot, until: o.valid_to?.slice(0, 10), branches: o.branch_count })),
  sampleGroups: groups.map((g) => ({ store: g.store_slug, text: g.description_he, qty: g.required_qty, total: g.total_agorot, packs: g.packs.length })),
};
console.log(JSON.stringify(result, null, 1));
