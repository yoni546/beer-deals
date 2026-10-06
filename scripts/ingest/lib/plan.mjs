/**
 * THE INGESTION PLAN — what an import would write, built from one day of fetched and parsed feed files
 * (.ingest-cache/<day>/<publisher>/). Pure data in, pure data out: the dry run renders it as a report,
 * the staging writer (scripts/ingest/run.mjs) writes it. Nothing here touches a database.
 *
 * Rules (docs/INGESTION-READINESS.md §2–§4):
 *   - only rows that are one of OUR beers, in scope, with a pack read with confidence become prices;
 *   - one barcode is one product: readings that disagree anywhere are held;
 *   - two different items at one branch that read as the same pack are held (an unlisted variant);
 *   - a promotion is published only when its two price statements agree and it is for everyone;
 *     "any N of these" across several packs is a GROUP promotion, never a per-pack price;
 *   - prices are per branch; the retailer of each branch comes from the publisher's Stores file;
 *   - prices exclude the bottle deposit, which travels beside them.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { kindOf, parseFileName } from "./files.mjs";
import {
  DEPOSIT_AGOROT,
  checkPrice,
  classify,
  clean,
  inForce,
  isGtin,
  packagingOf,
  israelTime,
  parsePack,
  readPromotion,
  reconcileBarcodes,
  variantOf,
} from "./normalize.mjs";
import { discountedPrices, withDiscountedPrices } from "./promo-supplement.mjs";
import { PUBLISHERS } from "./publishers.mjs";
import { parseStores, sameStore } from "./stores-file.mjs";

const sha = (...parts) => createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
// A crate and a carton of the same 24 bottles are different products (0021): packaging is part of the identity.
export const skuKey = (r) => `${r.beer}|${r.variant}|${r.container}|${r.volume_ml}|${r.pack_quantity}|${r.packaging}`;

/** ₪0.30 per container up to 1.5 L (cans and bottles). */
export const depositFor = (pack) =>
  (pack.container === "can" || pack.container === "bottle") && pack.volume_ml <= 1500 ? DEPOSIT_AGOROT * pack.pack_quantity : null;

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** Every branch file pair of a day, with its publisher, retailer and Stores-file identity. */
export function loadDay(dir) {
  const report = existsSync(join(dir, "fetch-report.json")) ? JSON.parse(readFileSync(join(dir, "fetch-report.json"), "utf8")) : { publishers: [] };
  const units = [];
  for (const publisher of readdirSync(dir).filter((d) => !d.includes(".") && PUBLISHERS[d])) {
    const p = PUBLISHERS[publisher];
    const files = readdirSync(join(dir, publisher));
    const storesName = files.filter((f) => /^stores/i.test(f)).sort().pop();
    const branches = storesName ? parseStores(readFileSync(join(dir, publisher, storesName))) : [];
    const json = files.filter((f) => f.endsWith(".json"));
    const stores = [...new Set(json.filter((f) => kindOf(f) === "PriceFull").map((f) => parseFileName(f).store))];
    for (const store of stores) {
      const priceFile = json.filter((f) => kindOf(f) === "PriceFull" && parseFileName(f).store === store).sort().pop();
      const promoFile = json.filter((f) => kindOf(f) === "PromoFull" && sameStore(parseFileName(f).store, store)).sort().pop();
      const prices = JSON.parse(readFileSync(join(dir, publisher, priceFile), "utf8"));
      const promos = promoFile ? JSON.parse(readFileSync(join(dir, publisher, promoFile), "utf8")) : { promotions: [] };
      const promoGz = promoFile && files.find((f) => f.replace(/\.(xml\.)?gz$/i, ".json") === promoFile);
      if (promoGz) promos.promotions = withDiscountedPrices(promos.promotions, discountedPrices(readFileSync(join(dir, publisher, promoGz))));
      const info = branches.find((b) => sameStore(b.store, store)) ?? { store, name: "", subChain: prices.sub_chain_id, subChainName: "", address: "", city: "" };
      const retailer = p.retailer(info);
      if (!retailer) continue;
      const fileHash = sha(
        ...[priceFile, promoFile].filter(Boolean).map((f) => {
          const gz = files.find((x) => x.replace(/\.(xml\.)?gz$/i, ".json") === f);
          return createHash("sha256").update(readFileSync(join(dir, publisher, gz ?? f))).digest("hex");
        }),
      );
      units.push({
        publisher,
        source: p.source,
        retailer,
        branch: {
          feed_chain_code: prices.chain_id || p.chainCode,
          feed_sub_chain_code: prices.sub_chain_id || info.subChain || null,
          feed_store_code: String(Number(store)),
          name_he: info.name || null,
          address: info.address || null,
          city: info.city || null,
        },
        observedAt: iso(israelTime(parseFileName(priceFile).stamp)),
        files: [priceFile, promoFile].filter(Boolean),
        fileHash,
        dialect: prices.dialect,
        items: prices.items,
        promotions: promos.promotions,
      });
    }
  }
  return { units, fetchReport: report };
}

/**
 * Every branch a scan read (scripts/ingest/scan.mjs, 0.9.0): the same units as loadDay, from the slim
 * per-branch files, plus the scan itself (inventory and every branch's outcome) for the coverage rules.
 * Branches whose newest file is stale, or that failed, give no unit: they are not current evidence.
 */
export function loadScan(cacheDir, scanId) {
  const dir = join(cacheDir, "scans");
  let scan;
  if (scanId) {
    scan = JSON.parse(readFileSync(join(dir, `${scanId}.json`), "utf8"));
  } else {
    // Each publisher as its MOST RECENT scan saw it: a scan of a few publishers does not hide the others.
    // Every entry keeps its own scan id and time (branch_scans records them as they were).
    const scans = readdirSync(dir)
      .filter((n) => /^\d{4}-.*Z\.json$/.test(n))
      .sort()
      .map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")));
    const latest = scans[scans.length - 1];
    const byPublisher = new Map();
    // A publisher whose listing FAILED this time keeps its last good scan — a failure to look is not evidence
    // that its branches changed — and the failure is carried as a note.
    for (const s of scans) {
      for (const e of s.publishers) {
        const previous = byPublisher.get(e.publisher);
        if (e.status === "FAILED" && previous && previous.status !== "FAILED") {
          byPublisher.set(e.publisher, { ...previous, lastFailure: { scanId: s.scanId, note: e.note } });
        } else {
          byPublisher.set(e.publisher, { scanId: s.scanId, startedAt: s.startedAt, ...e });
        }
      }
    }
    scan = { ...latest, composite: scans.length > 1, publishers: [...byPublisher.values()] };
  }
  const units = [];
  for (const entry of scan.publishers) {
    const p = PUBLISHERS[entry.publisher];
    for (const b of entry.branches ?? []) {
      if (!["ok", "unchanged", "no_promo_file"].includes(b.status) || !b.slim) continue;
      const path = join(cacheDir, "files", entry.publisher, b.slim);
      if (!existsSync(path)) continue;
      const data = JSON.parse(readFileSync(path, "utf8"));
      const info = entry.inventory.find((x) => sameStore(x.store, b.store)) ?? { store: b.store };
      units.push({
        publisher: entry.publisher,
        source: p.source,
        retailer: b.retailer,
        branch: {
          feed_chain_code: data.chain_id || p.chainCode,
          feed_sub_chain_code: data.sub_chain_id || info.subChain || null,
          feed_store_code: String(Number(b.store)),
          name_he: info.name || null,
          address: info.address || null,
          city: info.city || null,
        },
        observedAt: iso(israelTime(parseFileName(b.priceFile).stamp)),
        files: [b.priceFile, b.promoFile].filter(Boolean),
        fileHash: sha(b.priceSha, b.promoSha ?? ""),
        dialect: data.dialect,
        items: data.items,
        rowsTotal: data.rows_total,
        promotionsTotal: data.promotions_total,
        promotions: data.promotions,
      });
    }
  }
  return { units, scan };
}

/**
 * Terms written in a promotion's text that change who gets the price, shown beside it (never dropped):
 * "מעל 75" — only on a basket over ₪75; "מו2" / "מוגבל ל־2" — at most 2 per customer.
 */
/**
 * The identity of a promotion across a chain's branches (0.9.0) — the same promotion seen at 30 branches is ONE
 * offer. Two listings (a promotion in one branch's file) are the same promotion when:
 *   1. their TERMS are identical — the kind, quantity and price, who may redeem it, the written terms (minimum
 *      basket, per-customer limit) and the day it ends (termsKey, below); AND
 *   2. they share at least one item, or the chain's promotion id (connected through listings that do —
 *      computed over the whole chain; Victory lists "2ב26 מלכה/נגב" as one id twice, once per item).
 * Measured on the 2026-09-30 baseline scan, both halves are needed:
 *   - a branch lists only the items it stocks (Tiv Taam's "ויינשטפן 3 ב 33": 3 items at some branches, 4 at
 *     others) — the item LIST cannot be part of the identity (it split one promotion into six);
 *   - chains issue one deal under several ids, one per group of branches (Mahsanei's "ג/…" and "ק/…" copies,
 *     Keshet, Rami Levy) — the id cannot be the identity either;
 *   - "2 ב־35" on different beers shares no item — never merged; the same items ending another day, or with
 *     other terms, are a different promotion;
 *   - the day it STARTED is not part of it: only promotions in force at the scan are listings at all, and two
 *     ids that started on different days but run now, on the same items, at the same price, to the same day
 *     (Rami Levy's "קורונה שישייה ב29.90 נקודתי" and "…כולל נתניה") are one deal where a shopper stands — its
 *     branches are the union of both;
 *   - one chain writes one promotion two ways in different branches' files (Keshet's 1153220: "2026-10-03" with
 *     end_hour "23:59:00" at some, "2026-10-03T23:59:00.000" and id "0001153220" at others) — so dates are
 *     compared as calendar days and ids and item codes without leading zeros (111 duplicate lines on staging,
 *     2026-09-30, before this).
 */
const day = (text) => String(text ?? "").replace(/\D/g, "").slice(0, 8);
const code = (value) => String(value ?? "").replace(/^0+(?=.)/, "");
export function termsKey(retailer, promo, read) {
  const terms = termsOf(promo.description);
  const price = read.kind === "multi_buy" ? `${read.qty}/${read.total_agorot}` : String(read.price_agorot);
  return sha(retailer, read.kind, price, read.audience, terms.min_basket_agorot ?? "", terms.max_qty ?? "", day(promo.end));
}

/**
 * Canonical keys for every listing: listings with the same terms that share an item (directly or through
 * others) are one promotion. The key is stable for the same promotion: its terms and its smallest item code.
 * @param {Array<{retailer: string, terms: string, id: string, items: string[]}>} listings
 * @returns {string[]} one key per listing
 */
export function canonicalKeys(listings) {
  const parent = listings.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const firstWithItem = new Map();
  listings.forEach((l, i) => {
    for (const item of [...l.items, `id:${l.id}`]) {
      const k = `${l.retailer}|${l.terms}|${item}`;
      if (firstWithItem.has(k)) parent[find(i)] = find(firstWithItem.get(k));
      else firstWithItem.set(k, i);
    }
  });
  const smallest = new Map();
  listings.forEach((l, i) => {
    const root = find(i);
    const min = [...l.items].sort()[0] ?? `#${i}`;
    if (!smallest.has(root) || min < smallest.get(root)) smallest.set(root, min);
  });
  return listings.map((l, i) => `${l.retailer}:p:${sha(l.terms, smallest.get(find(i)))}`);
}

export function termsOf(description) {
  const text = clean(description);
  const terms = {};
  const basket = text.match(/מעל\s*(\d{2,4})(?!\d)/);
  if (basket) terms.min_basket_agorot = Number(basket[1]) * 100;
  const limit = text.match(/(?:^|\s)(?:מוגבל\s*ל?-?\s*|מו)(\d{1,2})(?=\s|$)/);
  if (limit) terms.max_qty = Number(limit[1]);
  return terms;
}

/**
 * @param {ReturnType<typeof loadDay>["units"]} units
 * @param {number} now epoch ms — promotions not in force at `now` are not written
 */
export function buildPlan(units, now = Date.now()) {
  const listings = [];
  const readings = [];
  const packless = [];
  const unresolved = [];
  const invalid = [];
  const outOfScope = [];
  const otherBeers = [];
  const sourceProducts = new Map(); // `${chainCode}|${code}` → row
  const perUnit = [];

  const noteProduct = (u, item, status, reason, basis = null) => {
    const key = `${u.branch.feed_chain_code}|${item.item_code}`;
    const prior = sourceProducts.get(key);
    // A product stays "matched" only if every sighting matched.
    if (prior && prior.status !== "matched") return;
    sourceProducts.set(key, {
      feed_chain_code: u.branch.feed_chain_code,
      item_code: item.item_code,
      raw_name: item.item_name,
      manufacturer: item.manufacturer || null,
      status,
      reason,
      match_basis: basis,
      sku: null,
    });
  };

  // Pass 1 — every row of every branch: classify, read the pack and variant, check the price.
  for (const u of units) {
    const stats = { publisher: u.publisher, retailer: u.retailer, store: u.branch.feed_store_code, name: u.branch.name_he, rows: u.rowsTotal ?? u.items.length, promosInFile: u.promotionsTotal ?? u.promotions.length, duplicates: 0, beer: 0, ours: 0, otherBeer: 0, outOfScope: 0 };
    const rows = new Map();
    for (const item of u.items) {
      if (rows.has(item.item_code)) stats.duplicates++;
      rows.set(item.item_code, item);
    }
    const beerCodes = new Map();
    for (const item of rows.values()) {
      const verdict = classify(item);
      if (verdict.verdict === "not_beer") continue;
      const sample = { retailer: u.retailer, store: u.branch.feed_store_code, code: item.item_code, name: item.item_name, price: item.price, quantity: item.quantity, uom: item.unit_of_measure };
      if (verdict.verdict === "out_of_scope") {
        stats.outOfScope++;
        outOfScope.push({ ...sample, category: verdict.category, reason: verdict.reason });
        noteProduct(u, item, "ignored", `out of scope: ${verdict.reason}`);
        continue;
      }
      stats.beer++;
      if (!verdict.beer) {
        stats.otherBeer++;
        otherBeers.push(sample);
        beerCodes.set(item.item_code, null);
        noteProduct(u, item, "ignored", "a beer the app does not carry");
        continue;
      }
      stats.ours++;
      const pack = parsePack(item);
      const { variant, known } = variantOf(verdict.beer, item.item_name, verdict.category);
      const price = checkPrice(item, pack);
      beerCodes.set(item.item_code, null);
      const hold = (why, list = unresolved) => {
        list.push({ ...sample, beer: verdict.beer, why });
        noteProduct(u, item, "review", why);
      };
      // Too dear for the pack the name suggests — typically a six-pack whose name was cut before the pack
      // word ("בירה קרלסברג לומה שי"). Its barcode may say which pack it is (pass 1b); otherwise it is rejected.
      const lostPack = !price.ok && /multipack/.test(price.reason) && isGtin(item.item_code) && known;
      if (lostPack) packless.push({ u, item, sample, verdict, variant, pack: { ...pack, why: price.reason }, hold: (why) => hold(why, invalid) });
      else if (!price.ok) hold(price.reason, invalid);
      else if (!known) hold(`which ${verdict.beer} beer? the name names no known variant`);
      else if (pack.confidence === "unresolved") {
        // The barcode may still say which pack it is (below, once every branch has been read).
        if (isGtin(item.item_code)) packless.push({ u, item, sample, verdict, variant, pack, hold });
        else hold(pack.why);
      } else {
        const reading = {
          unit: u,
          item,
          ...sample,
          beer: verdict.beer,
          category: verdict.category,
          variant,
          ...pack,
          agorot: price.agorot,
        };
        readings.push(reading);
        beerCodes.set(item.item_code, reading);
      }
    }
    perUnit.push({ unit: u, stats, beerCodes });
  }

  // Pass 1b — a row whose own text does not say the pack ("בירה קרלסברג שישייה", Quantity "2") takes the
  // pack that every other reading of the SAME barcode agrees on (a barcode is one physical product), and
  // only when the price is believable for that pack. No reading elsewhere, or readings that disagree → held.
  for (const { u, item, sample, verdict, variant, pack, hold } of packless) {
    const others = readings.filter((r) => r.code === item.item_code);
    const shapes = new Set(others.map((r) => `${r.volume_ml}×${r.pack_quantity}`));
    if (shapes.size !== 1) {
      hold(pack.why);
      continue;
    }
    const from = others[0];
    const adopted = { ...pack, volume_ml: from.volume_ml, pack_quantity: from.pack_quantity, container: pack.container ?? from.container, confidence: "partial", why: `pack read from the same barcode at ${[...new Set(others.map((r) => r.retailer))].join(", ")}` };
    const price = checkPrice(item, adopted);
    if (!price.ok) {
      hold(`${pack.why}; the same barcode elsewhere is ${from.pack_quantity}×${from.volume_ml} ml, but ${price.reason}`);
      continue;
    }
    const reading = { unit: u, item, ...sample, beer: verdict.beer, category: verdict.category, variant, ...adopted, agorot: price.agorot };
    readings.push(reading);
    perUnit.find((p) => p.unit === u).beerCodes.set(item.item_code, reading);
  }

  // Pass 2 — one barcode, one product (across all branches and chains).
  const barcodes = reconcileBarcodes(readings.map((r) => ({ ...r, chain: r.retailer })));
  const accepted = [];
  for (const r of readings) {
    const verdict = barcodes.get(r.code);
    if (verdict && !verdict.agree) {
      unresolved.push({ ...r, unit: undefined, item: undefined, why: verdict.why });
      noteProduct(r.unit, r.item, "review", verdict.why);
      continue;
    }
    if (verdict?.container && !r.container) r.container = verdict.container;
    // A short (truncated) name takes the specific identity the full names of the same barcode agree on.
    if (verdict?.agree) Object.assign(r, { beer: verdict.beer, variant: verdict.variant, category: verdict.category });
    // Count and volume are what make a pack (and are always shown); the container is a detail several
    // chains never write on multipacks ("בירה גולדסטאר שישייה", names cut at 20 characters). Until
    // 0.8.0 an unknown container HELD the row — which dropped every Rami Levy six-pack and, through
    // them, 26 of its 34 beer promotions. Now it is published as "container not stated" ('other'),
    // never guessed; a barcode seen at another chain with a full name fills it in (above). A pack
    // derived from the feed's total volume is kept only when exactly one standard multipack makes
    // that total (parsePack guarantees it) and the price per litre is plausible (checkPrice).
    if (!r.container) {
      r.container = "other";
      r.containerKnown = false;
    }
    r.packaging = packagingOf({ name: r.name, container: r.container, pack_quantity: r.pack_quantity });
    r.confidence = "confident";
    accepted.push(r);
  }

  // Pass 2b — two different items at one branch reading as the same pack: a variant we cannot tell apart.
  const byBranchSku = new Map();
  for (const r of accepted) {
    const k = `${r.unit.publisher}|${r.store}|${skuKey(r)}`;
    byBranchSku.set(k, [...(byBranchSku.get(k) ?? []), r]);
  }
  const final = [];
  for (const group of byBranchSku.values()) {
    const codes = new Set(group.map((r) => r.code));
    // The same pack listed under two codes at the SAME price (a re-barcoded or promo pack) is one
    // product: keep one listing. Different prices mean the name hides a difference — hold them.
    if (codes.size > 1 && new Set(group.map((r) => r.agorot)).size === 1) {
      final.push(group.sort((a, b) => a.code.localeCompare(b.code))[0]);
      continue;
    }
    if (codes.size > 1) {
      for (const r of group) {
        const why = `${codes.size} different items at this branch read as the same pack (${[...codes].join(", ")}) — an unlisted variant`;
        unresolved.push({ ...r, unit: undefined, item: undefined, why });
        noteProduct(r.unit, r.item, "review", why);
      }
    } else final.push(...group);
  }

  // SKUs, regular prices, source products.
  const skus = new Map();
  const regular = [];
  for (const r of final) {
    const key = skuKey(r);
    const sku = skus.get(key) ?? {
      key, beer: r.beer, variant: r.variant, category: r.category, container: r.container, volume_ml: r.volume_ml, pack_quantity: r.pack_quantity, packaging: r.packaging,
      barcodes: new Set(), retailers: new Set(), prices: [],
    };
    if (isGtin(r.code)) sku.barcodes.add(r.code);
    sku.retailers.add(r.retailer);
    sku.prices.push(r.agorot);
    skus.set(key, sku);
    const sp = sourceProducts.get(`${r.unit.branch.feed_chain_code}|${r.code}`);
    if (sp && sp.status !== "review" && sp.status !== "ignored") Object.assign(sp, { status: "matched", sku: key, reason: null, match_basis: isGtin(r.code) ? "barcode" : "rules" });
    else if (!sp) sourceProducts.set(`${r.unit.branch.feed_chain_code}|${r.code}`, { feed_chain_code: r.unit.branch.feed_chain_code, item_code: r.code, raw_name: r.name, manufacturer: r.item.manufacturer || null, status: "matched", sku: key, reason: null, match_basis: isGtin(r.code) ? "barcode" : "rules" });
    const deposit = depositFor(r);
    regular.push({
      retailer: r.retailer,
      branch: r.unit.branch,
      source: r.unit.source,
      sku: key,
      kind: "regular",
      price_agorot: r.agorot,
      observed_at: r.unit.observedAt,
      conditions: deposit ? { deposit: { agorot: deposit, included: false, basis: "shelf price; the deposit is charged on top" } } : {},
      natural_key: `${r.unit.publisher}:${r.code}`,
      content_hash: sha(r.unit.publisher, r.store, r.code, "regular", r.agorot, r.unit.observedAt),
      raw: { item_code: r.code, item_name: r.name, manufacturer: r.item.manufacturer, feed_store: r.store, quantity: r.quantity, unit_of_measure: r.item.unit_of_measure },
    });
  }

  // Pass 3 — promotions, per branch.
  const promotions = [];
  const groups = [];
  const promoLog = [];
  const byCode = new Map(final.map((r) => [`${r.unit.publisher}|${r.store}|${r.code}`, r]));
  for (const { unit: u, stats, beerCodes } of perUnit) {
    stats.promo = { touching: 0, notInForce: 0, published: 0, groups: 0, restricted: 0, held: 0, excluded: 0, unreadable: 0 };
    for (const promo of u.promotions) {
      const beerItems = promo.items.filter((i) => beerCodes.has(i.item_code));
      if (beerItems.length === 0) continue;
      stats.promo.touching++;
      const read = readPromotion(promo, new Set(beerItems.map((i) => i.item_code)));
      const start = israelTime(promo.start);
      const end = israelTime(promo.end);
      const log = {
        retailer: u.retailer,
        store: u.branch.feed_store_code,
        id: promo.promotion_id,
        description: promo.description,
        items: promo.items.length,
        beerItems: beerItems.length,
        ...read,
        // Where it is listed (0.9.0): a promotion in force now is a listing, for its canonical identity (filled in
        // after every branch is read); the file and the dates, for promotion_occurrences.
        listing: (read.kind === "price_cut" || read.kind === "multi_buy") && inForce(promo, now) ? listings.push({ retailer: u.retailer, terms: termsKey(u.retailer, promo, read), id: code(promo.promotion_id), items: [...new Set(promo.items.map((i) => code(i.item_code)))] }) - 1 : null,
        file: u.files[1] ?? null,
        observedAt: u.observedAt,
        validFrom: iso(start),
        validTo: iso(end),
      };
      promoLog.push(log);
      if (read.audience !== "everyone" && read.kind !== "excluded") stats.promo.restricted++;
      if (read.kind === "excluded") {
        stats.promo.excluded++;
        log.outcome = "excluded";
        continue;
      }
      if (!inForce(promo, now)) {
        stats.promo.notInForce++;
        log.outcome = "not in force";
        continue;
      }
      if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
        stats.promo.held++;
        log.outcome = "held: invalid dates";
        continue;
      }
      if (read.kind === "unmapped") {
        stats.promo.unreadable++;
        log.outcome = `held: ${read.reason}`;
        continue;
      }
      // Which of our packs it covers. Every beer item must be one we priced with confidence.
      const covered = beerItems.map((i) => byCode.get(`${u.publisher}|${u.branch.feed_store_code}|${i.item_code}`));
      const unknownItems = beerItems.filter((_, n) => !covered[n]).length;
      const skuSet = [...new Set(covered.filter(Boolean).map(skuKey))];
      if (skuSet.length === 0) {
        stats.promo.held++;
        log.outcome = "held: none of its items is a pack we could read";
        continue;
      }
      // One statement of the price (the description OR DiscountedPrice) is confirmed by a second one: the
      // same branch's shelf price of every item it covers. The promotion must be a real saving on each —
      // below the shelf price, and not by more than 70% (a larger "saving" is a misread). Yochananof, for
      // one, never writes the price in the description; without this every one of its offers was held.
      const perUnitPromo = read.kind === "multi_buy" ? read.total_agorot / read.qty : read.price_agorot;
      const shelfConfirms =
        read.audience === "everyone" &&
        read.hold &&
        /only$/.test(read.basis) &&
        covered.filter(Boolean).every((r) => perUnitPromo < r.agorot && perUnitPromo >= r.agorot * 0.3);
      if (shelfConfirms) Object.assign(read, { hold: false, reason: "", basis: `${read.basis} + the branch's shelf price` });
      // Items we could not read are left out, not guessed: the offer is published for the packs we did read
      // (what it says about them is true either way) and the omission is recorded.
      const reasons = [read.reason].filter(Boolean);
      const status = read.hold ? "held" : "live";
      const sample = covered.find(Boolean);
      const deposit = depositFor(sample);
      const depositNote = { agorot: deposit, included: false, basis: read.depositInDescription ? "the description quotes the price without the deposit; DiscountedPrice included it" : "assumed charged on top, like the shelf price" };
      const common = {
        retailer: u.retailer,
        branch: u.branch,
        source: u.source,
        observed_at: u.observedAt,
        valid_from: iso(start),
        valid_to: iso(end),
        status,
        raw: { promotion_id: promo.promotion_id, description: promo.description, club_id_raw: promo.club_id_raw, reward_types: [...new Set(promo.items.map((i) => i.reward_type))], basis: read.basis, ...(unknownItems ? { items_left_out: unknownItems } : {}), ...(status === "held" ? { held_reason: reasons.join("; ") } : {}) },
      };
      if (read.audience === "everyone" && status === "held") stats.promo.held++;

      // One pack, or one price for each of several packs ("קרלסברג/טובורג שישייה ב־29.90": each six-pack
      // costs 29.90 — no mixing involved): a promotion per pack. Several packs that must be MIXED to reach
      // a quantity are a group (below).
      if (skuSet.length === 1 || read.kind === "price_cut") {
        const qty = read.kind === "multi_buy" ? read.qty : 1;
        const total = read.kind === "multi_buy" ? read.total_agorot : read.price_agorot;
        const perUnit = Math.ceil(total / qty);
        // The price must still be believable for every pack it names.
        const failed = skuSet.map((sku) => checkPrice({ price: perUnit / 100, is_weighted: false }, covered.find((r) => r && skuKey(r) === sku))).find((c) => !c.ok);
        if (failed) {
          stats.promo.held++;
          log.outcome = `held: ${failed.reason}`;
          continue;
        }
        for (const sku of skuSet) promotions.push({
          ...common,
          sku,
          kind: "promotion",
          promo_type: read.kind,
          price_agorot: perUnit,
          conditions: {
            audience: read.audience,
            ...(deposit ? { deposit: depositNote } : {}),
            ...(read.kind === "multi_buy" ? { multi_buy: { qty, total_agorot: total }, min_qty: qty } : {}),
            ...termsOf(promo.description),
            note_he: clean(promo.description),
          },
          natural_key: "", // the canonical key, filled in below once every branch is read
          listing: log.listing,
          // The file's time is part of the record, as for a regular price: each file re-records what it lists (the
          // newer row supersedes the older under the same identity), so close_missing_promotions closes only what
          // the newest file no longer lists — never a promotion that is still running.
          content_hash: sha(u.publisher, u.branch.feed_store_code, promo.promotion_id, sku, total, qty, promo.start, promo.end, u.observedAt),
        });
        log.outcome = status === "live" ? (read.audience === "everyone" ? "published" : "restricted") : `held: ${reasons.join("; ")}`;
        log.shape = "price";
        if (status === "live") stats.promo.published++;
      } else {
        groups.push({
          ...common,
          skus: skuSet,
          natural_key: "", // the canonical key, filled in below once every branch is read
          listing: log.listing,
          description_he: clean(promo.description).slice(0, 200),
          required_qty: read.qty,
          total_agorot: read.total_agorot,
          audience: read.audience,
          deposit_agorot: deposit ? deposit : null,
          deposit_included: deposit ? false : null,
          content_hash: sha(u.publisher, u.branch.feed_store_code, promo.promotion_id, skuSet.join(","), read.total_agorot, read.qty, promo.start, promo.end, u.observedAt),
        });
        log.outcome = status === "live" ? (read.audience === "everyone" ? "published as a group" : "restricted") : `held: ${reasons.join("; ")}`;
        log.shape = "group";
        if (status === "live" && read.audience === "everyone") stats.promo.groups++;
      }
    }
  }

  // Canonical identity (0.9.0): one key per promotion across the chain's branches.
  const keys = canonicalKeys(listings);
  for (const row of [...promotions, ...groups]) row.natural_key = keys[row.listing];
  for (const l of promoLog) l.canonical = l.listing === null || l.listing === undefined ? null : keys[l.listing];

  // The same offer published twice (two promotion ids, same pack, price, terms and dates — Rami Levy does
  // this): one line, not two identical ones.
  const once = (key) => {
    const seen = new Set();
    return (row) => (seen.has(key(row)) ? false : (seen.add(key(row)), true));
  };
  // (Both are in force today, so their start dates do not matter to the shopper — the end date does.)
  const where = (row) => `${row.retailer}|${row.branch.feed_chain_code}|${row.branch.feed_store_code}|${row.status}|${row.valid_to}`;
  // Lowest promotion id first, so every branch keeps the same one of the two.
  const byId = (x, y) => String(x.raw.promotion_id).localeCompare(String(y.raw.promotion_id));
  const uniquePromotions = [...promotions].sort(byId).filter(once((p) => `${where(p)}|${p.sku}|${p.promo_type}|${p.price_agorot}|${JSON.stringify(p.conditions.multi_buy ?? null)}`));
  const uniqueGroups = [...groups].sort(byId).filter(once((g) => `${where(g)}|${[...g.skus].sort().join(",")}|${g.required_qty}|${g.total_agorot}`));

  return {
    units: perUnit.map(({ unit, stats }) => ({ ...stats, source: unit.source, branch: unit.branch, observedAt: unit.observedAt, fileHash: unit.fileHash, files: unit.files, dialect: unit.dialect })),
    skus: [...skus.values()].map((s) => ({ ...s, barcodes: [...s.barcodes], retailers: [...s.retailers].sort() })),
    sourceProducts: [...sourceProducts.values()],
    regular,
    promotions: uniquePromotions,
    groups: uniqueGroups,
    unresolved: unresolved.map(({ unit, item, ...r }) => r),
    invalid,
    outOfScope,
    otherBeers,
    promoLog,
    // Every public promotion a branch's current file lists, shown or not (promotion_occurrences, 0017): the
    // evidence of where it runs. One the source did not describe clearly enough to identify is left out.
    occurrences: promoLog
      .filter((l) => l.audience === "everyone" && l.canonical && l.file && !/not in force|invalid dates/.test(l.outcome ?? ""))
      // A file can list the same promotion twice: one listing per branch, file, promotion and id.
      .filter(once((l) => `${l.retailer}|${l.store}|${l.file}|${l.canonical}|${l.id}`))
      .map((l) => {
        const published = /^published/.test(l.outcome ?? "");
        return {
          retailer: l.retailer,
          store: l.store,
          canonical_key: l.canonical,
          source_promotion_id: l.id,
          source_file: l.file,
          observed_at: l.observedAt,
          valid_from: l.validFrom,
          valid_to: l.validTo,
          kind: l.shape ?? (l.kind === "multi_buy" && l.beerItems > 1 ? "group" : "price"),
          price_agorot: l.kind === "price_cut" ? (l.price_agorot ?? null) : l.total_agorot && l.qty ? Math.ceil(l.total_agorot / l.qty) : null,
          required_qty: l.qty ?? null,
          total_agorot: l.total_agorot ?? null,
          conditions: { audience: l.audience, ...termsOf(l.description) },
          published,
          reason: published ? null : (l.outcome ?? null),
        };
      }),
    barcodeConflicts: [...barcodes.entries()].filter(([, v]) => !v.agree).map(([code, v]) => ({ code, why: v.why })),
    multiChainBarcodes: [...barcodes.keys()].filter((code) => new Set(readings.filter((r) => r.code === code).map((r) => r.retailer)).size > 1).length,
  };
}
