#!/usr/bin/env node
/**
 * INGESTION DRY RUN — reads feed files the installed skill has parsed and reports what an import
 * WOULD do. It never writes to any database: it imports no Supabase client, reads no keys, opens
 * no network connection (tests/ingest.test.ts checks the source for all three).
 *
 *   node scripts/ingest/fetch-sample.mjs                    # 1. a small read-only sample → .ingest-cache/<day>/
 *   python .claude/skills/israeli-grocery-price-intelligence/scripts/parse_price_xml.py --chain <slug> --input <file.gz> --output <file>.json
 *   node scripts/ingest/dry-run.mjs [--day 2026-09-29]       # 3. → docs/INGESTION-DRY-RUN.md + .ingest-cache/<day>/dry-run.json
 *
 * Steps (docs/INGESTION-READINESS.md §1): read → identify beer → normalise the pack → map to our
 * beers and propose SKUs → validate prices → de-duplicate → read promotions → report everything
 * that could not be decided.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kindOf, parseFileName } from "./lib/files.mjs";
import { discountedPrices, withDiscountedPrices } from "./lib/promo-supplement.mjs";
import { checkPrice, classify, clean, inForce, isGtin, israelTime, parsePack, readPromotion, reconcileBarcodes } from "./lib/normalize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? "" : (args[i + 1] ?? "");
};
const cache = join(ROOT, ".ingest-cache");
const DAY = flag("day") || (existsSync(cache) ? readdirSync(cache).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop() : "");
if (!DAY) {
  console.error("No .ingest-cache/<day>/ found. Run scripts/ingest/fetch-sample.mjs and the skill's parser first.");
  process.exit(1);
}
const DIR = join(cache, DAY);
const fetchReport = existsSync(join(DIR, "fetch-report.json")) ? JSON.parse(readFileSync(join(DIR, "fetch-report.json"), "utf8")) : { chains: [] };

const chains = [];
const skus = new Map(); // "beer|container|ml|pack" → { chains: Set, rows }
const unresolved = [];
const invalid = [];
const outOfScope = [];
const unknownBeers = [];
const promoRows = [];
const readings = []; // our beers with a readable pack and a believable price, all chains
const perChain = [];

// Pass 1 — per chain: de-duplicate, classify, read the pack, check the price.
for (const chain of readdirSync(DIR).filter((d) => !d.includes("."))) {
  const files = readdirSync(join(DIR, chain)).filter((f) => f.endsWith(".json"));
  const priceFile = files.find((f) => kindOf(f) === "PriceFull");
  const promoFile = files.find((f) => kindOf(f) === "PromoFull");
  if (!priceFile) continue;
  const prices = JSON.parse(readFileSync(join(DIR, chain, priceFile), "utf8"));
  const promos = promoFile ? JSON.parse(readFileSync(join(DIR, chain, promoFile), "utf8")) : { promotions: [] };
  const promoGz = promoFile && join(DIR, chain, promoFile.replace(/.json$/, ".gz"));
  if (promoGz && existsSync(promoGz)) promos.promotions = withDiscountedPrices(promos.promotions, discountedPrices(readFileSync(promoGz)));
  const observedAt = israelTime(parseFileName(priceFile).stamp);

  const c = {
    chain,
    chainId: prices.chain_id,
    subChain: prices.sub_chain_id,
    store: prices.store_id,
    dialect: prices.dialect,
    file: priceFile.replace(/\.json$/, ".gz"),
    observedAt: new Date(observedAt).toISOString(),
    items: prices.items.length,
    promotions: promos.promotions.length,
    duplicates: 0,
    beer: 0,
    outOfScope: 0,
    ours: 0,
    unknownBeer: 0,
    confident: 0,
    partial: 0,
    unresolved: 0,
    invalid: 0,
    internalCodes: 0,
    promo: { touching: 0, inForce: 0, multi_buy: 0, price_cut: 0, club: 0, mixAndMatch: 0, unmapped: 0, excluded: 0, publishable: 0, agree: 0, disagree: 0 },
  };

  // De-duplicate on the source's own identity: (chain, sub-chain, store, item code). Keep the last row.
  const rows = new Map();
  for (const item of prices.items) {
    const key = `${prices.chain_id}|${prices.sub_chain_id}|${prices.store_id}|${item.item_code}`;
    if (rows.has(key)) c.duplicates++;
    rows.set(key, item);
  }

  const beerCodes = new Map(); // item_code → its reading (or just {beer} when it has no SKU)
  for (const item of rows.values()) {
    const verdict = classify(item);
    if (verdict.verdict === "not_beer") continue;
    const sample = { chain, code: item.item_code, name: item.item_name, maker: item.manufacturer, price: item.price, quantity: item.quantity, unit: item.unit_of_measure };
    if (verdict.verdict === "out_of_scope") {
      c.outOfScope++;
      outOfScope.push({ ...sample, reason: verdict.reason });
      continue;
    }
    c.beer++;
    if (!isGtin(item.item_code)) c.internalCodes++;
    if (!verdict.beer) {
      c.unknownBeer++;
      unknownBeers.push(sample);
      beerCodes.set(item.item_code, { beer: null });
      continue;
    }
    c.ours++;
    const pack = parsePack(item);
    const price = checkPrice(item, pack);
    beerCodes.set(item.item_code, { beer: verdict.beer });
    if (!price.ok) {
      // A price that does not fit the pack means the pack was misread: never a SKU.
      c.invalid++;
      invalid.push({ ...sample, beer: verdict.beer, reason: price.reason });
    } else if (pack.confidence === "unresolved") {
      c.unresolved++;
      unresolved.push({ ...sample, beer: verdict.beer, why: pack.why });
    } else {
      const reading = { ...sample, beer: verdict.beer, ...pack, agorot: price.agorot };
      readings.push(reading);
      beerCodes.set(item.item_code, reading);
    }
  }
  perChain.push({ c, promos, observedAt, beerCodes });
  chains.push(c);
}

// Pass 2 — one barcode, one product: readings of a GTIN at several chains must agree.
const barcodes = reconcileBarcodes(readings);
for (const r of readings) {
  const c = chains.find((x) => x.chain === r.chain);
  const verdict = barcodes.get(r.code);
  if (verdict && !verdict.agree) {
    c.unresolved++;
    unresolved.push({ ...r, why: verdict.why });
    continue;
  }
  if (verdict?.container && !r.container) {
    // Filled from the same barcode's name at another chain; a derived pack stays "partial".
    r.container = verdict.container;
    if (!r.why.includes("derived")) r.confidence = "confident";
  }
  r.sku = `${r.beer}|${r.container ?? "?"}|${r.volume_ml}|${r.pack_quantity}`;
  c[r.confidence]++;
  const entry = skus.get(r.sku) ?? { beer: r.beer, container: r.container, volume_ml: r.volume_ml, pack_quantity: r.pack_quantity, returnable: false, chains: new Set(), rows: [] };
  entry.chains.add(r.chain);
  entry.returnable ||= r.returnable;
  entry.rows.push(r);
  skus.set(r.sku, entry);
}

// Pass 3 — promotions that touch a beer row.
for (const { c, promos, observedAt, beerCodes } of perChain) {
  const chain = c.chain;
  for (const promo of promos.promotions) {
    const beerItems = promo.items.filter((i) => beerCodes.has(i.item_code));
    if (beerItems.length === 0) continue;
    c.promo.touching++;
    const live = inForce(promo, observedAt);
    if (live) c.promo.inForce++;
    const read = readPromotion(promo, new Set(beerItems.map((i) => i.item_code)));
    if (read.basis === "description + DiscountedPrice") c.promo.agree++;
    if (read.reason.startsWith("description says")) c.promo.disagree++;
    if (read.kind === "excluded") c.promo.excluded++;
    else if (read.kind === "unmapped") c.promo.unmapped++;
    else c.promo[read.kind]++;
    if (read.club) c.promo.club++;
    const mixes = beerItems.length > 1 && new Set(beerItems.map((i) => beerCodes.get(i.item_code).sku ?? i.item_code)).size > 1;
    if (mixes && read.kind !== "excluded") c.promo.mixAndMatch++;
    // A price shared by several different packs needs a decision (schema note 1): held for now.
    const hold = read.hold || mixes;
    if (!hold && live) c.promo.publishable++;
    promoRows.push({
      chain,
      id: promo.promotion_id,
      description: promo.description,
      items: promo.items.length,
      beerItems: beerItems.length,
      rewardTypes: [...new Set(promo.items.map((i) => i.reward_type))].join(","),
      start: promo.start,
      end: promo.end,
      inForce: live,
      mixAndMatch: mixes,
      ...read,
      hold,
    });
  }
}

const multiChain = [...barcodes.keys()].filter((code) => new Set(readings.filter((r) => r.code === code).map((r) => r.chain)).size > 1);
const conflicts = [...barcodes.entries()].filter(([, v]) => !v.agree);
const proposed = [...skus.entries()]
  .map(([key, e]) => ({ key, ...e, chains: [...e.chains].sort(), prices: e.rows.map((r) => r.agorot) }))
  .sort((a, b) => b.chains.length - a.chains.length || a.key.localeCompare(b.key));

// ----------------------------------------------------------------------------- report
const shekel = (a) => `₪${(a / 100).toFixed(2)}`;
const esc = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const failed = fetchReport.chains.filter((c) => c.status !== "OK");
const total = (f) => chains.reduce((n, c) => n + f(c), 0);
const lines = [];
const out = (s = "") => lines.push(s);

out("# Ingestion dry run");
out();
out(`**Generated ${new Date().toISOString().slice(0, 10)} from the feed files fetched on ${DAY}.** DRY RUN: nothing was written to any`);
out("database. Produced by `node scripts/ingest/dry-run.mjs` from files parsed by the installed skill's");
out("`parse_price_xml.py` (v1.6.0). One store per chain, today's PriceFull + PromoFull; the raw files stay in the");
out("git-ignored `.ingest-cache/` — this report quotes only product names, codes and prices from them.");
out();
out("## Summary");
out();
out(`* Chains detectable: **${chains.length}** fetched and parsed (${chains.map((c) => c.chain).join(", ")})` + (failed.length ? `; **${failed.length} failed**: ${failed.map((f) => `${f.chain} (${esc(f.note)})`).join("; ")}.` : "."));
out(`* Shelf rows read: **${total((c) => c.items).toLocaleString("en")}**; promotions read: **${total((c) => c.promotions).toLocaleString("en")}**.`);
out(`* Beer-like products: **${total((c) => c.beer)}** (${total((c) => c.ours)} of our 22 beers, ${total((c) => c.unknownBeer)} beers we do not carry) + ${total((c) => c.outOfScope)} out of scope by default (non-alcoholic, malt drinks, cider, radler).`);
out(`* Confidently normalised: **${total((c) => c.confident)}** rows (beer + container + volume + pack all read and consistent), ${total((c) => c.partial)} more with container unknown → **${proposed.length} distinct SKUs proposed**, ${proposed.filter((p) => p.chains.length > 1).length} of them seen at 2+ chains.`);
out(`* Unresolved (held for review, never guessed): **${total((c) => c.unresolved)}** rows of our beers whose pack could not be read.`);
out(`* Invalid prices: **${invalid.length}**. Duplicate source rows: **${total((c) => c.duplicates)}**. Same barcode at 2+ chains: **${multiChain.length}**, of which **${conflicts.length}** read as different packs (held).`);
out(`* Promotions touching beer: **${total((c) => c.promo.touching)}** — ${total((c) => c.promo.multi_buy)} multi-buy, ${total((c) => c.promo.price_cut)} price cut, ${total((c) => c.promo.unmapped)} unreadable, ${total((c) => c.promo.excluded)} excluded (coupons), ${total((c) => c.promo.club)} club-only, ${total((c) => c.promo.mixAndMatch)} mix-and-match across packs.`);
out(`* Promotion price, two statements: the description and the item's \`DiscountedPrice\` **agree on ${total((c) => c.promo.agree)}**, disagree on ${total((c) => c.promo.disagree)}. **${total((c) => c.promo.publishable)}** in-force beer promotions would be publishable (both statements agree, one pack, no payment condition); every other one is held.`);
out();
out("## Per chain");
out();
out("| Chain | Feed chain id · store | Dialect | Observed (file time) | Rows | Dup. | Beer | Ours | Other beer | Out of scope | Confident | Partial | Unresolved | Invalid | Internal codes | Beer promos (in force) |");
out("| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const c of chains) {
  out(`| ${c.chain} | ${c.chainId}-${c.subChain} · ${c.store} | ${c.dialect} | ${c.observedAt.slice(0, 16).replace("T", " ")} UTC | ${c.items} | ${c.duplicates} | ${c.beer} | ${c.ours} | ${c.unknownBeer} | ${c.outOfScope} | ${c.confident} | ${c.partial} | ${c.unresolved} | ${c.invalid} | ${c.internalCodes} | ${c.promo.touching} (${c.promo.inForce}) |`);
}
for (const f of failed) out(`| ${f.chain} | — | ${f.platform} | **not fetched**: ${esc(f.note)} | | | | | | | | | | | | |`);
out();
out("The parser reported every chain above as the `shufersal` dialect (Cerberus chains included): its auto-detection keys on");
out("the root element `ChainID`, which all six use. For that dialect the parser does not emit the promotion item's");
out("`<DiscountedPrice>` — though all six files carry it. `scripts/ingest/lib/promo-supplement.mjs` reads that one field from");
out("the same file so the description's price can be cross-checked (below).");
out();
out("## Proposed SKUs");
out();
out("Only rows where the beer, the volume and the pack size were all read — and the name agrees with the feed's");
out("`Quantity` (total volume) — become a SKU. Prices are the regular shelf prices seen, per whole pack.");
out();
out("| SKU (beer · container · ml · pack) | Chains | Prices seen | Example shelf name |");
out("| --- | --- | --- | --- |");
for (const p of proposed) {
  const prices = p.prices.length ? `${shekel(Math.min(...p.prices))}–${shekel(Math.max(...p.prices))}` : "—";
  out(`| ${p.beer} · ${p.container ?? "**container?**"} · ${p.volume_ml} · ${p.pack_quantity}${p.returnable ? " · returnable" : ""} | ${p.chains.join(", ")} | ${prices} | ${esc(p.rows[0].name)} |`);
}
out();
out("## Unresolved — our beers whose pack could not be read");
out();
out("| Chain | Code | Shelf name | Quantity / unit | Beer | Why |");
out("| --- | --- | --- | --- | --- | --- |");
for (const u of unresolved) out(`| ${u.chain} | ${u.code} | ${esc(u.name)} | ${u.quantity} ${esc(u.unit)} | ${u.beer} | ${esc(u.why)} |`);
out();
out("## Invalid prices");
out();
if (invalid.length === 0) out("None.");
else {
  out("| Chain | Code | Shelf name | Price | Why |");
  out("| --- | --- | --- | ---: | --- |");
  for (const i of invalid) out(`| ${i.chain} | ${i.code} | ${esc(i.name)} | ₪${i.price} | ${esc(i.reason)} |`);
}
out();
out("## Beers we do not carry (would go to `needs_review`, not into the catalogue)");
out();
const unknownByName = new Map();
for (const u of unknownBeers) unknownByName.set(clean(u.name), [...(unknownByName.get(clean(u.name)) ?? []), u.chain]);
out(`${unknownByName.size} distinct shelf names. First 40:`);
out();
for (const [n, cs] of [...unknownByName.entries()].slice(0, 40)) out(`* ${esc(n)} — ${[...new Set(cs)].join(", ")}`);
out();
out("## Out of scope by default (owner decision pending, INGESTION-READINESS §6)");
out();
const oos = new Map();
for (const o of outOfScope) oos.set(o.reason, (oos.get(o.reason) ?? 0) + 1);
for (const [r, n] of oos) out(`* ${r}: ${n} rows`);
out();
out("## Promotions touching beer");
out();
out("| Chain | Promotion | Items (beer) | RewardType | Window | In force | Read as | Basis | Club | Publish? | Note |");
out("| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const p of promoRows) {
  const as = p.kind === "multi_buy" ? `multi-buy ${p.qty} for ${shekel(p.total_agorot)}` : p.kind === "price_cut" ? `price cut to ${shekel(p.price_agorot)}` : p.kind;
  out(`| ${p.chain} | ${esc(p.description)} | ${p.items} (${p.beerItems}) | ${p.rewardTypes} | ${String(p.start).slice(0, 10)} → ${String(p.end).slice(0, 10)} | ${p.inForce ? "yes" : "no"} | ${as} | ${p.basis} | ${p.club ? "yes" : ""} | ${p.hold ? "held" : "**yes**"} | ${esc([p.mixAndMatch ? "mix-and-match across packs" : "", p.reason].filter(Boolean).join("; "))} |`);
}
out();
out("## Duplicates");
out();
out(`* Within a file, on (chain id, sub-chain, store, item code): ${total((c) => c.duplicates)} repeated rows (the last one wins).`);
out(`* The same GTIN at 2+ chains (the only codes allowed to match across chains): ${multiChain.length} barcodes. Where the`);
out("  readings agree, one chain's name fills in the container another chain's truncated name lost.");
out(`* A GTIN read as different packs at different chains: ${conflicts.length} — every reading of it is held (listed under Unresolved).`);
out(`* Internal (non-GTIN) item codes among beer rows: ${total((c) => c.internalCodes)} — matched per chain only, never across chains.`);
out();
out("## Schema incompatibilities found");
out();
out("Against migrations 0007–0013 (see INGESTION-READINESS §7 for the full field table):");
out();
out("1. **Mix-and-match promotions** (\"גולדסטאר / מכבי 2 ב 55\") apply one multi-buy across several SKUs. `price_observations` holds");
out("   one SKU per row: each SKU would carry the same `conditions.multi_buy` plus a `conditions.group` id, or the promotion is held.");
out("   Needs a decision; until then these are held.");
out("2. **Banners vs publishers**: the stores table treats יינות ביתן as a chain, but its feed is published by Carrefour");
out("   (7290055700007). A feed chain id → store mapping (and possibly sub-chain) is needed; there is no column for it.");
out("3. **No source product table**: the chain's item code and raw name are kept only in `raw` per observation. Aliases");
out("   (chain + item code → SKU, created by a human) have no table yet (prerequisite 4).");
out("4. **Unit of the Quantity field**: the skill's output drops the XML `UnitQty`, so a pack's total volume is read by magnitude");
out("   (≥ 50 → ml, else litres). Works for beer; the skill (or our fetcher) should pass `UnitQty` through.");
out("5. **`update_date` is the last price change, not the observation**: it runs back to 2015. The file timestamp is used");
out("   for `observed_at`.");
out("6. **Promotion price**: `<DiscountedPrice>` is the total for `MinQty` units (\"2 ב 55\" = MinQty 2, 55.00) — a convention read");
out("   from these files, confirmed where the description agrees. RewardType is not used (unsourced). `promo_type` fits");
out("   (multi_buy, price_cut, club_price); `conditions` holds club, min/max qty. A payment-method condition (\"אשראי\") has no field.");
out("7. **Branches**: each file is one store; `branches` has no rows. Prices are per branch, the app shows chains.");
out("   Chain-wide price = which branch? Decision needed (suggest: the chain's lowest regular price across branches, or one reference branch).");
out();
out("## External prerequisites still missing");
out();
out("* A staging Supabase project to rehearse `start_ingestion_run` → `record_prices` → `rollback_ingestion_run` (owner).");
out("* Each chain's terms of use and attribution (owner / legal).");
out("* Owner decisions: non-alcoholic / malt / radler / cider scope; mix-and-match; chain-wide vs branch price; deposit and VAT (the");
out("  skill says published prices include 18% VAT; deposit is a separate item — see the פקדון rows excluded above).");
out(`* Feeds not reachable this way: ${failed.map((f) => f.chain).join(", ") || "none"}; and victory, mahsanei, hatzi-hinam, king-store, ampm, yeinot-bitan (banner) — see INGESTION-READINESS §7.`);

writeFileSync(join(ROOT, "docs", "INGESTION-DRY-RUN.md"), lines.join("\n") + "\n");
writeFileSync(
  join(DIR, "dry-run.json"),
  JSON.stringify({ day: DAY, chains, conflicts: conflicts.map(([code, v]) => ({ code, why: v.why })), proposed: proposed.map(({ rows, ...p }) => ({ ...p, rows: rows.length })), unresolved, invalid, outOfScope, unknownBeers, promotions: promoRows }, null, 2),
);
console.log(`chains ${chains.length} · beer ${total((c) => c.beer)} · SKUs ${proposed.length} · unresolved ${unresolved.length} · invalid ${invalid.length} · beer promos ${promoRows.length}`);
console.log(`wrote docs/INGESTION-DRY-RUN.md and .ingest-cache/${DAY}/dry-run.json — nothing was written to any database`);
