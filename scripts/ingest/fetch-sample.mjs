#!/usr/bin/env node
/**
 * Fetches a SMALL, READ-ONLY sample of the price-transparency feeds for an ingestion dry run:
 * for each chain, one store's latest PriceFull and PromoFull. Nothing is written anywhere but
 * .ingest-cache/<date>/ (git-ignored). No database is touched.
 *
 *   node scripts/ingest/fetch-sample.mjs [--chains carrefour,shufersal,rami-levy,...] [--store <id>]
 *
 * Access methods follow the installed skill (.claude/skills/israeli-grocery-price-intelligence,
 * references/chain-feeds.md, verified 2026-08-27): Carrefour and Shufersal publish directly;
 * Rami Levy, Yochananof, Osher Ad, Tiv Taam and Super Yuda through Cerberus (login with the chain
 * code and an empty password, CSRF token, POST-only listing). Requests are few and sequential;
 * if a platform refuses automated access, the script reports it and moves on rather than working
 * around it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kindOf, parseFileName } from "./lib/files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? "" : (args[i + 1] ?? "");
};
const DAY = new Date().toISOString().slice(0, 10);
const OUT = join(ROOT, ".ingest-cache", DAY);
const UA = "beer-deals-dry-run/1.0 (+https://github.com/yoni546/beer-deals)";

/** Our chain slug → how its feed is published (from the skill's platform table). */
const CHAINS = {
  carrefour: { platform: "carrefour" },
  shufersal: { platform: "shufersal" },
  "rami-levy": { platform: "cerberus", code: "RamiLevi" },
  yochananof: { platform: "cerberus", code: "yohananof" },
  "osher-ad": { platform: "cerberus", code: "osherad" },
  "tiv-taam": { platform: "cerberus", code: "TivTaam" },
  "super-yuda": { platform: "cerberus", code: "SuperYuda" },
};

const report = [];
const log = (chain, status, detail) => {
  report.push({ chain, status, ...detail });
  console.log(`${chain.padEnd(11)} ${status}${detail.note ? `  ${detail.note}` : ""}`);
};

const isGzip = (buf) => buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;

async function download(chain, url, name, init = {}) {
  const res = await fetch(url, { ...init, headers: { "user-agent": UA, ...(init.headers ?? {}) }, redirect: "manual" });
  const buf = Buffer.from(await res.arrayBuffer());
  // The skill: require a 2xx AND a real payload — a redirect stub or an expired signed URL is not data.
  if (res.status < 200 || res.status >= 300 || !(isGzip(buf) || buf.subarray(0, 200).toString("utf8").includes("<"))) {
    throw new Error(`${name}: HTTP ${res.status}, ${buf.length} bytes, not a feed file`);
  }
  mkdirSync(join(OUT, chain), { recursive: true });
  const path = join(OUT, chain, name);
  writeFileSync(path, buf);
  return { name, path, bytes: buf.length };
}

/** Of a listing, the newest PriceFull and PromoFull of one store that has both. */
function pick(names, store) {
  const byStore = new Map();
  for (const name of names) {
    const kind = kindOf(name);
    if (kind !== "PriceFull" && kind !== "PromoFull") continue;
    const f = { name, kind, ...parseFileName(name) };
    if (store && f.store !== store) continue;
    const entry = byStore.get(f.store) ?? {};
    if (!entry[kind] || entry[kind].stamp < f.stamp) entry[kind] = f;
    byStore.set(f.store, entry);
  }
  const both = [...byStore.entries()].filter(([, e]) => e.PriceFull && e.PromoFull).sort(([a], [b]) => Number(a) - Number(b));
  // Prefer a real branch over the 000/001 placeholders some chains publish.
  const chosen = both.find(([id]) => Number(id) > 1) ?? both[0];
  return chosen ? { store: chosen[0], files: [chosen[1].PriceFull, chosen[1].PromoFull] } : null;
}

async function carrefour(chain) {
  const html = await (await fetch("https://prices.carrefour.co.il/", { headers: { "user-agent": UA } })).text();
  const path = (html.match(/path\s*[=:]\s*["'](\d{8})["']/) ?? [])[1];
  const names = [...html.matchAll(/"name"\s*:\s*"([^"]+\.gz)"/g)].map((m) => m[1]);
  if (!path || names.length === 0) throw new Error("could not read the inline file list");
  const chosen = pick(names, flag("store"));
  if (!chosen) throw new Error("no store with both PriceFull and PromoFull in today's list");
  const got = [];
  for (const f of chosen.files) got.push(await download(chain, `https://prices.carrefour.co.il/${path}/${f.name}`, f.name));
  return { store: chosen.store, files: got, listed: names.length };
}

async function shufersal(chain) {
  const list = async (catID, storeId = 0) => {
    const url = `https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=${catID}&storeId=${storeId}`;
    const html = await (await fetch(url, { headers: { "user-agent": UA } })).text();
    return [...html.matchAll(/href="(https:\/\/pricesprodpublic\.blob\.core\.windows\.net\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  };
  const nameOf = (url) => decodeURIComponent(new URL(url).pathname.split("/").pop());
  // Find a store from the first PriceFull page, then list that store's PromoFull.
  const prices = await list(2);
  const firstPrice = prices.map(nameOf).find((n) => kindOf(n) === "PriceFull" && Number(parseFileName(n).store) > 1);
  if (!firstPrice) throw new Error("no PriceFull links in the listing");
  const store = flag("store") || parseFileName(firstPrice).store;
  const storePrices = await list(2, Number(store));
  const storePromos = await list(4, Number(store));
  const all = [...storePrices, ...storePromos];
  const chosen = pick(all.map(nameOf), store);
  if (!chosen) throw new Error(`store ${store} has no PriceFull + PromoFull pair`);
  const got = [];
  for (const f of chosen.files) {
    // Signed URLs expire within minutes: use the link fetched just now, never a stored one.
    got.push(await download(chain, all.find((u) => nameOf(u) === f.name), f.name));
  }
  return { store: chosen.store, files: got, listed: prices.length };
}

async function cerberus(chain, code) {
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
  const chosen = pick(names, flag("store"));
  if (!chosen) throw new Error(`no store with both PriceFull and PromoFull among ${names.length} files`);
  const got = [];
  for (const f of chosen.files) got.push(await download(chain, `${base}/file/d/${f.name}`, f.name, { headers: { cookie: cookie() } }));
  return { store: chosen.store, files: got, listed: names.length };
}

const wanted = (flag("chains") || Object.keys(CHAINS).join(",")).split(",").filter(Boolean);
for (const chain of wanted) {
  const cfg = CHAINS[chain];
  if (!cfg) {
    log(chain, "SKIPPED", { note: "no known feed platform" });
    continue;
  }
  try {
    const result =
      cfg.platform === "carrefour" ? await carrefour(chain) : cfg.platform === "shufersal" ? await shufersal(chain) : await cerberus(chain, cfg.code);
    log(chain, "OK", {
      platform: cfg.platform,
      store: result.store,
      listed: result.listed,
      files: result.files.map((f) => ({ name: f.name, bytes: f.bytes })),
      note: `store ${result.store}: ${result.files.map((f) => `${f.name} (${(f.bytes / 1024).toFixed(0)} KB)`).join(", ")}`,
    });
  } catch (error) {
    log(chain, "FAILED", { platform: cfg.platform, note: String(error.message ?? error) });
  }
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "fetch-report.json"), JSON.stringify({ fetchedAt: new Date().toISOString(), chains: report }, null, 2));
console.log(`\nwrote .ingest-cache/${DAY}/fetch-report.json`);
