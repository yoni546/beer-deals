/**
 * Seeds a handful of approved deals so the app has something to show before any
 * real ones arrive.
 *
 * Uses the service role key, which bypasses RLS — which is exactly why this is
 * a script you run deliberately and not something the app can do. The deals it
 * writes are marked in their notes so they are easy to find and delete later.
 *
 * Run: node scripts/seed-demo-deals.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (match) process.env[match[1]] ??= match[2];
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const { data: beers } = await db.from("beers").select("id, slug");
const { data: stores } = await db.from("stores").select("id, slug");

const beerId = (slug) => beers?.find((b) => b.slug === slug)?.id;
const storeId = (slug) => stores?.find((s) => s.slug === slug)?.id;

const DEMO = [
  ["goldstar", "rami-levy", "sixpack", 2490, 3990],
  ["goldstar", "shufersal", "sixpack", 2990, 3990],
  ["goldstar", "yochananof", "sixpack", 3290, 3990],
  ["goldstar", "rami-levy", "case", 8900, 13900],
  ["goldstar", "makolet", "single", 690, 990],
  ["maccabee", "victory", "sixpack", 2690, 3790],
  ["heineken", "shufersal", "sixpack", 3990, 5490],
  ["heineken", "tiv-taam", "case", 14900, 19900],
  ["corona", "yochananof", "sixpack", 4290, 5990],
  ["tuborg", "osher-ad", "sixpack", 2790, 3890],
  ["carlsberg", "rami-levy", "single", 590, 890],
];

const rows = DEMO.map(([beer, store, category, deal, regular]) => ({
  beer_id: beerId(beer),
  store_id: storeId(store),
  category,
  deal_price_agorot: deal,
  regular_price_agorot: regular,
  status: "approved",
  approved_at: new Date().toISOString(),
  // The approval attribution constraint needs a user. Use the first super
  // admin, so the demo rows are attributed to a real person rather than to
  // nobody.
  notes: "מבצע לדוגמה",
})).filter((row) => row.beer_id && row.store_id);

const { data: admin } = await db
  .from("admins")
  .select("user_id")
  .eq("level", "super_admin")
  .limit(1)
  .maybeSingle();

if (!admin) {
  console.error("Create a super admin first — see docs/setup.md step 6.");
  process.exit(1);
}

for (const row of rows) row.approved_by = admin.user_id;

const { error, count } = await db.from("deals").insert(rows, { count: "exact" });
if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`seeded ${count ?? rows.length} demo deals`);
