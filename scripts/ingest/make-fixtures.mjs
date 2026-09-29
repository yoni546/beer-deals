#!/usr/bin/env node
/**
 * Cuts a SMALL excerpt of each chain's real, parsed feed into tests/fixtures/ingest/<chain>.json, so the
 * normaliser is tested against what shelves really write (prerequisite 16). Public price data only —
 * item codes, names, manufacturers, prices, promotions; no personal data exists in these feeds.
 *
 *   node scripts/ingest/make-fixtures.mjs [--day 2026-09-29]
 *
 * Kept per chain: every row naming one of our beers (capped), the look-alikes that must NOT be read as
 * beer (נסטלה, גינסנג, a CORONA-branded wine, deposits), and the promotions touching those rows plus one
 * store-wide coupon (its item list cut to 60 codes: still "store-wide" to the normaliser).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kindOf } from "./lib/files.mjs";
import { classify, clean } from "./lib/normalize.mjs";
import { discountedPrices, withDiscountedPrices } from "./lib/promo-supplement.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const i = process.argv.indexOf("--day");
const cache = join(ROOT, ".ingest-cache");
const DAY = i > -1 ? process.argv[i + 1] : readdirSync(cache).filter((d) => /^\d{4}-/.test(d)).sort().pop();
const OUT = join(ROOT, "tests", "fixtures", "ingest");
mkdirSync(OUT, { recursive: true });

const LOOKALIKE = /נסטלה|גינסנג|CORONA|פקדון|שמרי בירה|מאלט|ללא אלכוהול|סיידר/;

for (const chain of readdirSync(join(cache, DAY)).filter((d) => !d.includes("."))) {
  const files = readdirSync(join(cache, DAY, chain));
  const read = (kind) => JSON.parse(readFileSync(join(cache, DAY, chain, files.find((f) => f.endsWith(".json") && kindOf(f) === kind)), "utf8"));
  const prices = read("PriceFull");
  const promos = read("PromoFull");
  const gz = files.find((f) => f.endsWith(".gz") && kindOf(f) === "PromoFull");
  promos.promotions = withDiscountedPrices(promos.promotions, discountedPrices(readFileSync(join(cache, DAY, chain, gz))));

  const ours = prices.items.filter((it) => classify(it).beer).slice(0, 60);
  const others = prices.items.filter((it) => classify(it).verdict === "beer" && !classify(it).beer).slice(0, 8);
  const lookalikes = prices.items.filter((it) => LOOKALIKE.test(clean(it.item_name)) && !ours.includes(it)).slice(0, 10);
  const items = [...ours, ...others, ...lookalikes];
  const codes = new Set(items.map((it) => it.item_code));

  const touching = promos.promotions.filter((p) => p.items.length <= 50 && p.items.some((x) => codes.has(x.item_code))).slice(0, 25);
  const coupon = promos.promotions.find((p) => p.items.length > 500 && p.items.some((x) => codes.has(x.item_code)));
  const promotions = [...touching, ...(coupon ? [{ ...coupon, items: [...coupon.items.filter((x) => codes.has(x.item_code)), ...coupon.items].slice(0, 60) }] : [])].map((p) => ({
    ...p,
    items: p.items.length > 50 ? p.items : p.items.filter((x) => codes.has(x.item_code) || p.items.length <= 12),
  }));

  const fixture = {
    _source: `${chain} PriceFull/PromoFull of ${DAY}, store ${prices.store_id}, parsed by israeli-grocery-price-intelligence v1.6.0 parse_price_xml.py, + discounted_price from lib/promo-supplement.mjs; excerpt`,
    chain: prices.chain,
    dialect: prices.dialect,
    chain_id: prices.chain_id,
    sub_chain_id: prices.sub_chain_id,
    store_id: prices.store_id,
    items,
    promotions,
  };
  writeFileSync(join(OUT, `${chain}.json`), JSON.stringify(fixture, null, 1) + "\n");
  console.log(`${chain}: ${items.length} items, ${promotions.length} promotions`);
}
