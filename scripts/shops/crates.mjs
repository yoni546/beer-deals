#!/usr/bin/env node
/**
 * Reads the crate prices on liquor shops' websites and stores them (migration 0068, shop_crate_prices).
 *
 *   node scripts/shops/crates.mjs                                                  # read and report only
 *   node scripts/shops/crates.mjs --target staging --apply
 *   node scripts/shops/crates.mjs --target production --confirm-ref <ref> --apply
 *
 * Which shops and how each is read: lib/crates.mjs. One request per shop. A shop whose page fails is
 * reported and skipped; its earlier rows simply age out of what the app shows (seen in the last 3 days).
 * Rows a shop no longer lists are deleted after a week. Target checks: scripts/ingest/lib/target.mjs.
 * If the database does not have 0068 yet, it says so and exits 0, so the daily import is never failed by it.
 */
import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRANDS } from "../ingest/lib/normalize.mjs";
import { loadTarget } from "../ingest/lib/target.mjs";
import { SHOPS, fetchShop, readCrate } from "./lib/crates.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const known = new Set(BRANDS.map((b) => b.slug));

const read = {};
for (const shop of Object.keys(SHOPS)) {
  try {
    const rows = await fetchShop(shop);
    const crates = [];
    const skipped = {};
    for (const row of rows) {
      const r = readCrate(row, known);
      if (r.ok) crates.push({ ...r.crate, title: row.title, url: row.url, in_stock: row.inStock, pickup_only: row.pickupOnly });
      else skipped[r.reason] = (skipped[r.reason] ?? 0) + 1;
    }
    read[shop] = crates;
    console.log(`${shop.padEnd(10)} ${rows.length} on the page · ${crates.length} crates of our beers · skipped ${JSON.stringify(skipped)}`);
  } catch (error) {
    console.log(`::warning::${shop}: ${error.message} — skipped this run`);
  }
}

if (!args.includes("--target")) {
  for (const [shop, crates] of Object.entries(read))
    for (const c of crates) console.log(`${shop} ${c.beer}${c.variant ? ` (${c.variant})` : ""} ${c.pack_quantity}×${c.volume_ml ?? "?"} ${c.container ?? ""} ₪${c.price_agorot / 100}${c.in_stock ? "" : " out of stock"}`);
  process.exit(0);
}

const { url, env } = loadTarget(ROOT, args);
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const missingTable = (error) => error && /shop_crate_prices/.test(error.message) && /(not find|does not exist|schema cache)/i.test(error.message);

const { data: beers, error: beersError } = await db.from("beers").select("id, slug");
if (beersError) throw new Error(`beers: ${beersError.message}`);
const beerId = new Map(beers.map((b) => [b.slug, b.id]));

const now = new Date().toISOString();
const rows = Object.entries(read).flatMap(([shop, crates]) =>
  crates
    .filter((c) => beerId.has(c.beer))
    .map((c) => ({
      shop,
      beer_id: beerId.get(c.beer),
      variant: c.variant,
      title: c.title,
      pack_quantity: c.pack_quantity,
      volume_ml: c.volume_ml,
      container: c.container,
      price_agorot: c.price_agorot,
      url: c.url,
      in_stock: c.in_stock,
      pickup_only: c.pickup_only,
      seen_at: now,
    })),
);
console.log(`${rows.length} rows to write${apply ? "" : " (dry run: pass --apply to write)"}`);
if (!apply) process.exit(0);

const { error } = await db.from("shop_crate_prices").upsert(rows, { onConflict: "shop,url" });
if (missingTable(error)) {
  console.log("::warning::shop_crate_prices is not installed on this database (migration 0068) — nothing written.");
  process.exit(0);
}
if (error) throw new Error(`shop_crate_prices: ${error.message}`);

const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
const { error: pruneError, count } = await db.from("shop_crate_prices").delete({ count: "exact" }).lt("seen_at", weekAgo);
if (pruneError) throw new Error(`shop_crate_prices prune: ${pruneError.message}`);
console.log(`wrote ${rows.length} · removed ${count ?? 0} not listed for a week`);
