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
export const skuKey = (r) => `${r.beer}|${r.variant}|${r.container}|${r.volume_ml}|${r.pack_quantity}`;

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
 * @param {ReturnType<typeof loadDay>["units"]} units
 * @param {number} now epoch ms — promotions not in force at `now` are not written
 */
export function buildPlan(units, now = Date.now()) {
  const readings = [];
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
    const stats = { publisher: u.publisher, retailer: u.retailer, store: u.branch.feed_store_code, name: u.branch.name_he, rows: u.items.length, duplicates: 0, beer: 0, ours: 0, otherBeer: 0, outOfScope: 0 };
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
      if (!price.ok) hold(price.reason, invalid);
      else if (!known) hold(`which ${verdict.beer} beer? the name names no known variant`);
      else if (pack.confidence === "unresolved") hold(pack.why);
      else {
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
    // A pack whose container is still unknown, or was derived from a total, is not published.
    if (!r.container || r.confidence !== "confident") {
      const why = !r.container ? "container unknown" : r.why;
      unresolved.push({ ...r, unit: undefined, item: undefined, why });
      noteProduct(r.unit, r.item, "review", why);
      continue;
    }
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
      key, beer: r.beer, variant: r.variant, category: r.category, container: r.container, volume_ml: r.volume_ml, pack_quantity: r.pack_quantity,
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
      const log = { retailer: u.retailer, store: u.branch.feed_store_code, id: promo.promotion_id, description: promo.description, items: promo.items.length, beerItems: beerItems.length, ...read };
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
      const reasons = [read.reason, unknownItems ? `${unknownItems} of its items are packs we could not read` : ""].filter(Boolean);
      const status = read.hold || unknownItems ? "held" : "live";
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
        raw: { promotion_id: promo.promotion_id, description: promo.description, club_id_raw: promo.club_id_raw, reward_types: [...new Set(promo.items.map((i) => i.reward_type))], basis: read.basis, ...(status === "held" ? { held_reason: reasons.join("; ") } : {}) },
      };
      if (read.audience === "everyone" && status === "held") stats.promo.held++;

      if (skuSet.length === 1) {
        const sku = skuSet[0];
        const qty = read.kind === "multi_buy" ? read.qty : 1;
        const total = read.kind === "multi_buy" ? read.total_agorot : read.price_agorot;
        // The price must still be believable for the pack.
        const perUnit = Math.ceil(total / qty);
        const check = checkPrice({ price: perUnit / 100, is_weighted: false }, sample);
        if (!check.ok) {
          stats.promo.held++;
          log.outcome = `held: ${check.reason}`;
          continue;
        }
        promotions.push({
          ...common,
          sku,
          kind: "promotion",
          promo_type: read.kind,
          price_agorot: perUnit,
          conditions: {
            audience: read.audience,
            ...(deposit ? { deposit: depositNote } : {}),
            ...(read.kind === "multi_buy" ? { multi_buy: { qty, total_agorot: total }, min_qty: qty } : {}),
            note_he: clean(promo.description),
          },
          natural_key: `${u.publisher}:${promo.promotion_id}`,
          content_hash: sha(u.publisher, u.branch.feed_store_code, promo.promotion_id, sku, total, qty, promo.start, promo.end),
        });
        log.outcome = status === "live" ? (read.audience === "everyone" ? "published" : "restricted") : `held: ${reasons.join("; ")}`;
        if (status === "live") stats.promo.published++;
      } else {
        if (read.kind !== "multi_buy") {
          stats.promo.held++;
          log.outcome = "held: one price across several packs without a quantity";
          continue;
        }
        groups.push({
          ...common,
          skus: skuSet,
          natural_key: `${u.publisher}:${promo.promotion_id}`,
          description_he: clean(promo.description).slice(0, 200),
          required_qty: read.qty,
          total_agorot: read.total_agorot,
          audience: read.audience,
          deposit_agorot: deposit ? deposit : null,
          deposit_included: deposit ? false : null,
          content_hash: sha(u.publisher, u.branch.feed_store_code, promo.promotion_id, skuSet.join(","), read.total_agorot, read.qty, promo.start, promo.end),
        });
        log.outcome = status === "live" ? (read.audience === "everyone" ? "published as a group" : "restricted") : `held: ${reasons.join("; ")}`;
        if (status === "live" && read.audience === "everyone") stats.promo.groups++;
      }
    }
  }

  return {
    units: perUnit.map(({ unit, stats }) => ({ ...stats, source: unit.source, branch: unit.branch, observedAt: unit.observedAt, fileHash: unit.fileHash, files: unit.files, dialect: unit.dialect })),
    skus: [...skus.values()].map((s) => ({ ...s, barcodes: [...s.barcodes], retailers: [...s.retailers].sort() })),
    sourceProducts: [...sourceProducts.values()],
    regular,
    promotions,
    groups,
    unresolved: unresolved.map(({ unit, item, ...r }) => r),
    invalid,
    outOfScope,
    otherBeers,
    promoLog,
    barcodeConflicts: [...barcodes.entries()].filter(([, v]) => !v.agree).map(([code, v]) => ({ code, why: v.why })),
    multiChainBarcodes: [...barcodes.keys()].filter((code) => new Set(readings.filter((r) => r.code === code).map((r) => r.retailer)).size > 1).length,
  };
}
