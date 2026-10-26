#!/usr/bin/env node
/**
 * BRANCH SCAN — every branch every publisher lists, not one sample (0.9.0). READ-ONLY: it downloads public
 * price-transparency files and writes only under .ingest-cache/ (git-ignored). No database is touched.
 *
 *   node scripts/ingest/scan.mjs [--full] [--publishers rami-levy,victory] [--concurrency 4]
 *
 *   1. INVENTORY  each publisher's newest Stores file → every branch it lists, mapped to our retailer
 *                 (branches of banners we do not carry are counted and left out);
 *   2. SELECT     per branch, the newest PriceFull and PromoFull the publisher lists right now; a file
 *                 older than FRESH_HOURS is stale — it is not current evidence;
 *   3. SKIP       (incremental) when both newest files are the ones already read (by name, then by
 *                 content hash), nothing is downloaded or parsed;
 *   4. READ       otherwise download (bounded concurrency, retries), run the installed skill's parser, add
 *                 the one field it drops (DiscountedPrice), and keep a SLIM copy: the beer-like rows and
 *                 the promotions that touch them, with the totals. The raw files are dropped (--keep-raw
 *                 keeps them).
 *
 * Output: .ingest-cache/scans/<scan id>.json (every branch's outcome, with the reason) — read by
 * lib/plan.mjs (loadScan) and by run.mjs, which records each branch's outcome in the database
 * (branch_scans, migration 0017) so a promotion's reach is measured against what was really checked.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "./lib/normalize.mjs";
import { discountedPrices, withDiscountedPrices } from "./lib/promo-supplement.mjs";
import { PUBLISHERS } from "./lib/publishers.mjs";
import { parseFileName } from "./lib/files.mjs";
import { fetchBuffer, listing, newest, newestStores, unzipSingle } from "./lib/sources.mjs";
import { parseStores, sameStore } from "./lib/stores-file.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? "" : (args[i + 1] ?? "");
};
const FULL = args.includes("--full");
const KEEP_RAW = args.includes("--keep-raw");
const CONCURRENCY = Number(flag("concurrency") || 4);
/** A file older than this is not current evidence of what a branch offers now. */
export const FRESH_HOURS = 36;

const CACHE = join(ROOT, ".ingest-cache");
const FILES = join(CACHE, "files");
const SCANS = join(CACHE, "scans");
const MANIFEST = join(CACHE, "manifest.json");
const PARSER = join(ROOT, ".claude", "skills", "israeli-grocery-price-intelligence", "scripts", "parse_price_xml.py");
const python = process.platform === "win32" ? "python" : "python3";
if (!existsSync(PARSER)) throw new Error(`The skill's parser is missing (${PARSER}). Install the skill; do not substitute another parser.`);

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const israelDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
/** "20260930051102" (Israel wall clock) → epoch ms. */
const stampMs = (stamp) => {
  const d = String(stamp ?? "").replace(/\D/g, "");
  if (d.length < 12) return NaN;
  const utc = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(8, 10), +d.slice(10, 12), +(d.slice(12, 14) || 0));
  const offset = new Date(utc).toLocaleString("en-US", { timeZone: "Asia/Jerusalem", timeZoneName: "shortOffset" }).match(/GMT([+-]\d+)/);
  return utc - Number(offset?.[1] ?? 2) * 3_600_000;
};

async function pool(items, limit, work) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i], i);
      }
    }),
  );
  return out;
}

/** Parse one downloaded file with the skill, return the JSON. */
function parseWithSkill(publisher, buf, name) {
  const dir = join(CACHE, "tmp");
  mkdirSync(dir, { recursive: true });
  // A ZIP served under a ".gz" name is unpacked to XML first; the skill's parser reads .gz and .xml.
  const zip = buf[0] === 0x50 && buf[1] === 0x4b;
  const input = join(dir, zip ? name.replace(/\.(xml\.)?(gz|zip)$/i, "") + ".xml" : name);
  const output = input.replace(/\.(xml\.)?(gz|xml)$/i, "") + ".json";
  writeFileSync(input, zip ? unzipSingle(buf) : buf);
  try {
    execFileSync(python, [PARSER, "--chain", publisher, "--input", input, "--output", output], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    return JSON.parse(readFileSync(output, "utf8"));
  } finally {
    rmSync(input, { force: true });
    rmSync(output, { force: true });
  }
}

/** The slim copy kept per branch: beer-like rows only, and the promotions that touch them. */
export function slim(prices, promos) {
  const seen = new Set();
  let duplicates = 0;
  for (const item of prices.items) (seen.has(item.item_code) ? duplicates++ : seen.add(item.item_code));
  const items = prices.items.filter((item) => classify(item).verdict !== "not_beer");
  const codes = new Set(items.map((item) => item.item_code));
  const promotions = (promos?.promotions ?? []).filter((p) => p.items.some((i) => codes.has(i.item_code)));
  return {
    chain_id: prices.chain_id,
    sub_chain_id: prices.sub_chain_id,
    store_id: prices.store_id,
    dialect: prices.dialect,
    rows_total: prices.items.length,
    duplicates,
    items,
    promotions_total: promos?.promotions?.length ?? 0,
    promotions,
  };
}

// A cold start has to work. The manifest line below already copes with the file
// being absent, but nothing created the directory it lives in: every run until
// now inherited it from the restored Actions cache, so the first run after that
// cache expires died writing the manifest back —
//
//   ENOENT: no such file or directory, open '.ingest-cache/manifest.json'
//
// which is how a nine-day gap in production data began. The scan is meant to
// work from nothing; now it does.
mkdirSync(CACHE, { recursive: true });

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const wanted = (flag("publishers") || Object.keys(PUBLISHERS).join(",")).split(",").filter(Boolean);
const started = Date.now();
const scanId = new Date().toISOString().replace(/[:.]/g, "-");
const report = { scanId, kind: FULL ? "full" : "incremental", startedAt: new Date(started).toISOString(), israeliDay: israelDay(), freshHours: FRESH_HOURS, publishers: [] };
const totals = { branchesKnown: 0, branchesChecked: 0, branchesFresh: 0, unchanged: 0, downloadedFiles: 0, downloadedBytes: 0, parsedRows: 0, failed: 0 };

for (const publisher of wanted) {
  const p = PUBLISHERS[publisher];
  if (!p) continue;
  const entry = { publisher, scanId, startedAt: new Date(started).toISOString(), source: p.source, chainCode: p.chainCode, status: "OK", note: p.blocked ?? "", inventory: [], branches: [] };
  report.publishers.push(entry);
  if (p.blocked) {
    entry.status = "BLOCKED";
    console.log(`${publisher.padEnd(14)} BLOCKED  ${p.blocked}`);
    continue;
  }
  const t0 = Date.now();
  try {
    const list = await listing(publisher);
    if (list.partial) entry.sourcePartial = list.partial;
    if (list.note) entry.note = list.note;

    // Only the publisher's own chain: an account can also hold another chain's old files (Keshet's holds a
    // Carrefour file from 2024).
    list.files = list.files.filter((f) => !/^\d{13}$/.test(f.chainId ?? "") || f.chainId === p.chainCode);

    // 1. Inventory: the newest Stores file. Kept (small) so a later incremental run can reuse it. When the
    //    source lists none right now (Laib Catalog and Cerberus rotate files at midnight; Fresh Market's is
    //    not listed at all), the newest one read before is used, and the report says so.
    const storesFile = newestStores(list.files);
    let inventory = [];
    if (!storesFile) {
      const cached = [join(FILES, publisher), ...readdirSync(CACHE).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).map((d) => join(CACHE, d, publisher))]
        .filter((dir) => existsSync(dir))
        .flatMap((dir) => readdirSync(dir).filter((n) => /^stores/i.test(n)).map((n) => ({ dir, n, stamp: parseFileName(n).stamp || n })))
        .sort((a, b) => b.stamp.localeCompare(a.stamp))[0];
      if (cached) {
        inventory = parseStores(readFileSync(join(cached.dir, cached.n)));
        entry.storesFile = cached.n;
        entry.inventoryFrom = `the source lists no Stores file now; the last one read (${cached.n}) is used`;
      }
    }
    if (storesFile) {
      const dir = join(FILES, publisher);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, storesFile.name);
      const buf = existsSync(path) ? readFileSync(path) : await fetchBuffer(storesFile.url, storesFile.init);
      if (!existsSync(path)) writeFileSync(path, buf);
      inventory = parseStores(buf);
      entry.storesFile = storesFile.name;
    }
    const withRetailer = inventory.map((b) => ({ ...b, retailer: p.retailer(b) }));
    entry.inventory = withRetailer.filter((b) => b.retailer).map(({ store, name, city, address, subChain, subChainName, retailer }) => ({ store: String(Number(store)), name, city, address, subChain, subChainName, retailer }));
    entry.otherBanners = withRetailer.filter((b) => !b.retailer).length;

    // Branches that publish files but are missing from the Stores file are still branches of the publisher.
    const listedStores = [...new Set(list.files.filter((f) => f.kind === "PriceFull" || f.kind === "PromoFull").map((f) => String(Number(f.store))))];
    for (const store of listedStores) {
      if (Number(store) <= 0 || entry.inventory.some((b) => sameStore(b.store, store)) || withRetailer.some((b) => sameStore(b.store, store) && !b.retailer)) continue;
      const retailer = p.retailer({ store, name: "", subChainName: "" });
      if (retailer) entry.inventory.push({ store, name: "", city: "", address: "", subChain: "", subChainName: "", retailer, notInStoresFile: true });
    }

    // 2–4. Every branch.
    entry.branches = await pool(entry.inventory, CONCURRENCY, async (b) => {
      const price = newest(list.files, "PriceFull", b.store);
      const promo = newest(list.files, "PromoFull", b.store);
      const out = { store: b.store, retailer: b.retailer, priceFile: price?.name ?? null, promoFile: promo?.name ?? null, priceAt: price ? new Date(stampMs(price.stamp)).toISOString() : null, promoAt: promo ? new Date(stampMs(promo.stamp)).toISOString() : null };
      if (!price) return { ...out, status: "not_published", reason: "no PriceFull listed for this branch right now" };
      const fresh = (at) => at && Date.now() - Date.parse(at) <= FRESH_HOURS * 3_600_000;
      const key = `${publisher}|${b.store}`;
      const known = manifest[key];
      if (!FULL && known && known.priceFile === price.name && known.promoFile === (promo?.name ?? null) && existsSync(join(FILES, publisher, known.slim))) {
        totals.unchanged++;
        const status = !fresh(out.priceAt) ? "stale" : promo ? "unchanged" : "no_promo_file";
        const reason = status === "stale" ? `newest file is older than ${FRESH_HOURS}h` : status === "no_promo_file" ? "no PromoFull listed for this branch" : "";
        return { ...out, status, unchanged: true, slim: known.slim, priceSha: known.priceSha, promoSha: known.promoSha, reason };
      }
      try {
        // A signed link that has expired meanwhile is resolved again once (Shufersal).
        const get = (f) => fetchBuffer(f.url, f.init).catch((error) => (f.refresh ? fetchBuffer(f.refresh, f.init) : Promise.reject(error)));
        const priceBuf = await get(price);
        const promoBuf = promo ? await get(promo) : null;
        totals.downloadedFiles += promoBuf ? 2 : 1;
        totals.downloadedBytes += priceBuf.length + (promoBuf?.length ?? 0);
        const prices = parseWithSkill(publisher, priceBuf, price.name);
        const promos = promoBuf ? parseWithSkill(publisher, promoBuf, promo.name) : { promotions: [] };
        promos.promotions = withDiscountedPrices(promos.promotions ?? [], promoBuf ? discountedPrices(promoBuf) : new Map());
        totals.parsedRows += prices.items.length + (promos.promotions?.length ?? 0);
        const slimName = `branch-${b.store}.json`;
        const record = { ...slim(prices, promos), price_file: price.name, promo_file: promo?.name ?? null, price_sha: sha(priceBuf), promo_sha: promoBuf ? sha(promoBuf) : null };
        mkdirSync(join(FILES, publisher), { recursive: true });
        writeFileSync(join(FILES, publisher, slimName), JSON.stringify(record));
        if (KEEP_RAW) {
          writeFileSync(join(FILES, publisher, price.name), priceBuf);
          if (promoBuf) writeFileSync(join(FILES, publisher, promo.name), promoBuf);
        }
        manifest[key] = { priceFile: price.name, promoFile: promo?.name ?? null, priceSha: record.price_sha, promoSha: record.promo_sha, slim: slimName, readAt: new Date().toISOString() };
        const status = !fresh(out.priceAt) ? "stale" : promo ? "ok" : "no_promo_file";
        return { ...out, status, slim: slimName, priceSha: record.price_sha, promoSha: record.promo_sha, beerRows: record.items.length, reason: status === "stale" ? `newest file is older than ${FRESH_HOURS}h` : status === "no_promo_file" ? "no PromoFull listed for this branch" : "" };
      } catch (error) {
        totals.failed++;
        return { ...out, status: "failed", reason: String(error.message ?? error).slice(0, 200) };
      }
    });
    entry.seconds = Math.round((Date.now() - t0) / 1000);
  } catch (error) {
    entry.status = "FAILED";
    entry.note = String(error.message ?? error).slice(0, 300);
  }
  const count = (s) => entry.branches.filter((b) => b.status === s).length;
  totals.branchesKnown += entry.inventory.length;
  totals.branchesChecked += entry.branches.filter((b) => ["ok", "unchanged", "no_promo_file"].includes(b.status)).length;
  totals.branchesFresh += entry.branches.filter((b) => ["ok", "unchanged"].includes(b.status)).length;
  writeFileSync(MANIFEST, JSON.stringify(manifest));
  console.log(
    `${publisher.padEnd(14)} ${entry.status}  known ${entry.inventory.length} · read ${count("ok")} · unchanged ${count("unchanged")} · no promo ${count("no_promo_file")} · not published ${count("not_published")} · stale ${count("stale")} · failed ${count("failed")}${entry.note ? ` · ${entry.note}` : ""} (${entry.seconds ?? 0}s)`,
  );
}

report.finishedAt = new Date().toISOString();
report.seconds = Math.round((Date.now() - started) / 1000);
report.totals = totals;
mkdirSync(SCANS, { recursive: true });
writeFileSync(join(SCANS, `${scanId}.json`), JSON.stringify(report, null, 1));
writeFileSync(join(SCANS, "latest.json"), JSON.stringify({ scanId }));
rmSync(join(CACHE, "tmp"), { recursive: true, force: true });
console.log(`\n${report.kind} scan ${scanId}: ${report.seconds}s · ${JSON.stringify(totals)}`);
