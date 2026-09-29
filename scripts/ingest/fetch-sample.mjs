#!/usr/bin/env node
/**
 * Fetches a SMALL, READ-ONLY sample of the price-transparency feeds: for each publisher, its Stores file
 * and, for the chosen branches, the latest PriceFull and PromoFull. Nothing is written anywhere but
 * .ingest-cache/<date>/<publisher>/ (git-ignored). No database is touched.
 *
 *   node scripts/ingest/fetch-sample.mjs [--publishers carrefour,shufersal,...] [--branches 1]
 *
 * Branches are chosen from the publisher's own Stores file so that every retailer it carries is covered
 * (Carrefour → a Carrefour branch AND the Yeinot Bitan one; Dor Alon → an AM:PM branch).
 *
 * Access follows the installed skill (references/chain-feeds.md). Requests are few and sequential; if a
 * platform refuses automated access the script reports it and moves on rather than working around it.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kindOf, parseFileName } from "./lib/files.mjs";
import { PUBLISHERS } from "./lib/publishers.mjs";
import { decode, parseStores, sameStore } from "./lib/stores-file.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? "" : (args[i + 1] ?? "");
};
const DAY = new Date().toISOString().slice(0, 10);
const OUT = join(ROOT, ".ingest-cache", DAY);
const UA = "beer-deals-dry-run/1.0 (+https://github.com/yoni546/beer-deals)";
const PER_RETAILER = Number(flag("branches") || 1);

const isPayload = (buf) => (buf[0] === 0x1f && buf[1] === 0x8b) || buf.subarray(0, 400).toString("latin1").replace(/\0/g, "").includes("<");

async function download(publisher, url, name, init = {}) {
  // Some portals hand out a pointer first (Bina Projects: Download.aspx → {"SPath": "<real url>"}).
  if (typeof url === "function") url = await url();
  const res = await fetch(url, { ...init, headers: { "user-agent": UA, ...(init.headers ?? {}) }, redirect: "follow" });
  const buf = Buffer.from(await res.arrayBuffer());
  // The skill: require a 2xx AND a real payload — a redirect stub or an expired signed URL is not data.
  if (res.status < 200 || res.status >= 300 || !isPayload(buf)) throw new Error(`${name}: HTTP ${res.status}, ${buf.length} bytes, not a feed file`);
  mkdirSync(join(OUT, publisher), { recursive: true });
  writeFileSync(join(OUT, publisher, name), buf);
  return { name, bytes: buf.length, buf };
}

/**
 * From a listing of file names (+ how to download each), the newest Stores file and, for the chosen
 * branches, the newest PriceFull + PromoFull.
 * @param {string} publisher
 * @param {Array<{name: string, url: string, init?: RequestInit}>} listing
 */
async function takeFromListing(publisher, listing, fetchStoresFile) {
  const p = PUBLISHERS[publisher];
  const files = listing.map((f) => ({ ...f, kind: kindOf(f.name), ...parseFileName(f.name) }));
  const newest = (kind, store) =>
    files.filter((f) => f.kind === kind && (store === undefined || sameStore(f.store, store))).sort((a, b) => b.stamp.localeCompare(a.stamp))[0];

  let storesBuf = null;
  const storesFile = files.filter((f) => /^stores/i.test(f.name)).sort((a, b) => b.name.localeCompare(a.name))[0];
  if (storesFile) storesBuf = (await download(publisher, storesFile.url, storesFile.name, storesFile.init)).buf;
  else if (fetchStoresFile) storesBuf = await fetchStoresFile();
  const branches = storesBuf ? parseStores(storesBuf) : [];

  // Branches with both a PriceFull and a PromoFull, grouped by the retailer they belong to.
  const priced = [...new Set(files.filter((f) => f.kind === "PriceFull").map((f) => String(Number(f.store))))].filter((s) => newest("PromoFull", s));
  const byRetailer = new Map();
  for (const store of priced) {
    const b = branches.find((x) => sameStore(x.store, store)) ?? { store };
    const retailer = p.retailer(b);
    if (!retailer || Number(store) <= 1) continue; // 000/001 are often placeholders
    byRetailer.set(retailer, [...(byRetailer.get(retailer) ?? []), store]);
  }
  // Per retailer, the first branch (of up to four tried) whose price file lists beer at all — some
  // branches sell none (King Store's Daburiyya branch, small Hatzi Hinam outlets).
  const got = [];
  for (const [retailer, stores] of byRetailer) {
    let taken = 0;
    for (const store of stores.slice(0, 4)) {
      if (taken >= PER_RETAILER) break;
      const price = newest("PriceFull", store);
      const file = await download(publisher, price.url, price.name, price.init);
      if (!decode(file.buf).includes("בירה")) {
        rmSync(join(OUT, publisher, price.name));
        continue;
      }
      const promo = newest("PromoFull", store);
      got.push({ retailer, store, kind: "PriceFull", ...file }, { retailer, store, kind: "PromoFull", ...(await download(publisher, promo.url, promo.name, promo.init)) });
      taken++;
    }
  }
  return { listed: files.length, branchesInStoresFile: branches.length, retailers: [...byRetailer.keys()], files: got };
}

async function text(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { "user-agent": UA, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const platforms = {
  async carrefour(publisher) {
    const html = await text("https://prices.carrefour.co.il/");
    const path = (html.match(/path\s*[=:]\s*["'](\d{8})["']/) ?? [])[1];
    const names = [...html.matchAll(/"name"\s*:\s*"([^"]+\.(?:gz|xml))"/g)].map((m) => m[1]);
    if (!path || names.length === 0) throw new Error("could not read the inline file list");
    return takeFromListing(publisher, names.map((name) => ({ name, url: `https://prices.carrefour.co.il/${path}/${name}` })));
  },

  async shufersal(publisher) {
    const list = async (catID, storeId = 0) => {
      const html = await text(`https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=${catID}&storeId=${storeId}`);
      return [...html.matchAll(/href="(https:\/\/pricesprodpublic\.blob\.core\.windows\.net\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    };
    const nameOf = (url) => decodeURIComponent(new URL(url).pathname.split("/").pop());
    // Signed URLs expire within minutes: list, then download straight away.
    const stores = await list(5);
    const firstPrice = (await list(2)).map(nameOf).find((n) => kindOf(n) === "PriceFull" && Number(parseFileName(n).store) > 1);
    if (!firstPrice) throw new Error("no PriceFull links in the listing");
    const store = Number(parseFileName(firstPrice).store);
    const urls = [...stores.slice(0, 1), ...(await list(2, store)), ...(await list(4, store))];
    return takeFromListing(publisher, urls.map((url) => ({ name: nameOf(url), url })));
  },

  async cerberus(publisher) {
    const code = PUBLISHERS[publisher].code;
    const base = "https://url.publishedprices.co.il";
    const jar = new Map();
    const keep = (res) => {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        const at = pair.indexOf("=");
        jar.set(pair.slice(0, at).trim(), pair.slice(at + 1));
      }
    };
    const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const csrf = (html) => (html.match(/name="csrftoken"\s+content="([^"]+)"/) ?? [])[1];
    let res = await fetch(`${base}/login`, { headers: { "user-agent": UA } });
    keep(res);
    const token = csrf(await res.text());
    if (!token) throw new Error("no csrftoken on the login page");
    res = await fetch(`${base}/login/user`, {
      method: "POST",
      redirect: "manual",
      headers: { "user-agent": UA, cookie: cookie(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: code, password: "", csrftoken: token }),
    });
    keep(res);
    if (res.status !== 302) throw new Error(`login as ${code} answered ${res.status} (a valid chain code answers 302)`);
    res = await fetch(`${base}/file`, { headers: { "user-agent": UA, cookie: cookie() } });
    keep(res);
    const token2 = csrf(await res.text());
    res = await fetch(`${base}/file/json/dir`, {
      method: "POST",
      headers: { "user-agent": UA, cookie: cookie(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ sEcho: "1", iDisplayStart: "0", iDisplayLength: "100000", cd: "/", csrftoken: token2 ?? "" }),
    });
    const json = await res.json();
    // The skill: an empty list with an `error` key is NOT "no files".
    if (json.error) throw new Error(`listing error: ${json.error}`);
    const names = (json.aaData ?? []).map((row) => row.fname ?? row.name ?? row[0]).filter(Boolean);
    return takeFromListing(publisher, names.map((name) => ({ name, url: `${base}/file/d/${name}`, init: { headers: { cookie: cookie() } } })));
  },

  async laib(publisher) {
    // Laib Catalog (Victory, Mahsanei HaShuk). Until 0.8.0 this read the site's ASP.NET search form, which
    // answers an automated POST with an empty table — so Victory never had a single row. The page itself
    // is fed by a public JSON API: getfiles lists every file of the chain (name, type, branch, time) and
    // /webapi/<chain>/<file> serves it.
    const code = PUBLISHERS[publisher].chainCode;
    const res = await fetch(`https://laibcatalog.co.il/webapi/api/getfiles?edi=${code}`, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!res.ok) throw new Error(`laibcatalog getfiles for ${code}: HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`laibcatalog.co.il lists no files for chain ${code}`);
    return takeFromListing(publisher, rows.map((row) => ({ name: row.fileName, url: `https://laibcatalog.co.il/webapi/${code}/${row.fileName}` })));
  },

  async "hatzi-hinam"(publisher) {
    const listing = [];
    for (let page = 1; page <= 3; page++) {
      const html = await text(`https://shop.hazi-hinam.co.il/Prices?p=${page}&s=&f=&t=&d=`);
      for (const [, url] of html.matchAll(/href="(https:\/\/hazihinamprod01\.blob\.core\.windows\.net\/regulatories\/[^"]+)"/g)) {
        listing.push({ name: url.split("/").pop(), url });
      }
    }
    return takeFromListing(publisher, listing);
  },

  async bina(publisher) {
    const host = PUBLISHERS[publisher].host;
    const today = new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Jerusalem" });
    const listing = [];
    for (const type of [1, 4, 5]) {
      const res = await fetch(`https://${host}/MainIO_Hok.aspx`, {
        method: "POST",
        headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ WStore: "0", WDate: today, WFileType: String(type) }),
      });
      for (const row of await res.json()) listing.push({ name: row.FileNm.replace(/\.GZ$/, ".gz"), url: `https://${host}/Download.aspx?FileNm=${row.FileNm}` });
    }
    // Download.aspx answers with a JSON pointer to the real file: resolved only for the files taken.
    return takeFromListing(
      publisher,
      listing.map((f) => ({
        ...f,
        url: async () => {
          const body = await text(f.url);
          const real = (body.match(/"SPath"\s*:\s*"([^"]+)"/) ?? [])[1];
          if (!real) throw new Error(`${f.name}: no download pointer`);
          return real.replace(/\\\//g, "/");
        },
      })),
    );
  },
};

const wanted = (flag("publishers") || Object.keys(PUBLISHERS).join(",")).split(",").filter(Boolean);
const report = [];
for (const publisher of wanted) {
  const p = PUBLISHERS[publisher];
  if (!p) {
    report.push({ publisher, status: "UNKNOWN" });
    continue;
  }
  if (p.blocked) {
    report.push({ publisher, status: "BLOCKED", note: p.blocked });
    console.log(`${publisher.padEnd(12)} BLOCKED  ${p.blocked}`);
    continue;
  }
  try {
    const r = await platforms[p.platform](publisher);
    if (r.files.length === 0) throw new Error(`listed ${r.listed} files; none of the branches tried (up to 4) lists any beer`);
    const files = r.files.map(({ buf, ...f }) => f);
    report.push({ publisher, status: "OK", platform: p.platform, chainCode: p.chainCode, ...r, files });
    console.log(`${publisher.padEnd(12)} OK  ${r.retailers.join(", ")}: ${files.map((f) => `${f.kind} ${f.store} (${(f.bytes / 1024).toFixed(0)} KB)`).join(", ")}`);
  } catch (error) {
    report.push({ publisher, status: "FAILED", platform: p.platform, note: String(error.message ?? error) });
    console.log(`${publisher.padEnd(12)} FAILED  ${error.message ?? error}`);
  }
}
mkdirSync(OUT, { recursive: true });
// Merge with an earlier run of the same day: a partial re-fetch replaces only its own publishers.
const reportPath = join(OUT, "fetch-report.json");
const earlier = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")).publishers ?? [] : [];
const merged = [...earlier.filter((e) => !report.some((r) => r.publisher === e.publisher)), ...report];
writeFileSync(reportPath, JSON.stringify({ fetchedAt: new Date().toISOString(), publishers: merged }, null, 2));
console.log(`\nwrote .ingest-cache/${DAY}/fetch-report.json`);
