/**
 * How each publisher's files are LISTED and DOWNLOADED (read-only, public access routes — the skill's
 * references/chain-feeds.md, each verified). Used by fetch-sample.mjs (one branch per retailer) and scan.mjs
 * (every branch). Listing and downloading are separate so a scan can decide, per branch, whether the newest
 * file is one it already has (incremental) before downloading anything.
 *
 *   listing(publisher) → { files: [{ name, url, init? }], storesFile?: { name, url, init? } }
 *
 * `url` may be a function returning the real URL (Bina's Download.aspx pointer; Shufersal's signed links,
 * which expire within minutes and are therefore fetched fresh at download time).
 */
import { PUBLISHERS } from "./publishers.mjs";
import { inflateRawSync } from "node:zlib";
import { kindOf, parseFileName } from "./files.mjs";

export const UA = "beer-deals-ingest/1.0 (+https://github.com/yoni546/beer-deals)";

const isZip = (buf) => buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
const isPayload = (buf) => (buf[0] === 0x1f && buf[1] === 0x8b) || isZip(buf) || buf.subarray(0, 400).toString("latin1").replace(/\0/g, "").includes("<");

/**
 * Some publishers serve a ZIP under a ".gz" name (Rami Levy's older-format files). The first entry of a
 * single-file archive, stored or deflated, read with Node's own zlib; anything else is refused, not guessed.
 */
export function unzipSingle(buf) {
  if (!isZip(buf)) return buf;
  const method = buf.readUInt16LE(8);
  const flags = buf.readUInt16LE(6);
  let size = buf.readUInt32LE(18);
  const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  // Sizes in a trailing data descriptor (flag bit 3): take the entry up to the central directory.
  if (flags & 0x08 || size === 0) {
    const central = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), start);
    size = (central > 0 ? central : buf.length) - start;
  }
  const data = buf.subarray(start, start + size);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data, { finishFlush: 2 });
  throw new Error(`zip method ${method} is not supported`);
}

/** GET with a timeout and a small retry for transient failures (5xx, network). Throws on anything else. */
export async function fetchBuffer(url, init = {}, { retries = 2, timeoutMs = 60_000 } = {}) {
  if (typeof url === "function") url = await url();
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { "user-agent": UA, ...(init.headers ?? {}) }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { retry: true });
      // The skill: require a 2xx AND a real payload — a redirect stub or an expired signed URL is not data.
      if (res.status < 200 || res.status >= 300 || !isPayload(buf)) throw new Error(`HTTP ${res.status}, ${buf.length} bytes, not a feed file`);
      return buf;
    } catch (error) {
      last = error;
      const transient = error.retry || error.name === "TimeoutError" || /fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(String(error.message));
      if (!transient || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw last;
}

/** A listing page: slow sources (Shufersal answers in ~20 s, sometimes far longer) get two minutes and one retry. */
async function text(url, init = {}) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { "user-agent": UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

const platforms = {
  async carrefour() {
    const html = await text("https://prices.carrefour.co.il/");
    const path = (html.match(/path\s*[=:]\s*["'](\d{8})["']/) ?? [])[1];
    const names = [...html.matchAll(/"name"\s*:\s*"([^"]+\.(?:gz|xml))"/g)].map((m) => m[1]);
    if (!path || names.length === 0) throw new Error("could not read the inline file list");
    return { files: names.map((name) => ({ name, url: `https://prices.carrefour.co.il/${path}/${name}` })) };
  },

  async shufersal() {
    const base = "https://prices.shufersal.co.il/FileObject/UpdateCategory";
    const links = async (catID, storeId = 0, page = 1) => {
      const html = await text(`${base}?catID=${catID}&storeId=${storeId}&page=${page}`);
      return {
        urls: [...html.matchAll(/href="(https:\/\/pricesprodpublic\.blob\.core\.windows\.net\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")),
        pages: Math.max(1, ...[...html.matchAll(/page=(\d+)/g)].map((m) => Number(m[1]))),
      };
    };
    const nameOf = (url) => decodeURIComponent(new URL(url).pathname.split("/").pop());
    const all = [];
    // PriceFull (2) and PromoFull (4) across every store, page by page (each page answers in ~20 s, so the
    // pages are read in parallel). The links are signed for ~30 minutes: a file is downloaded with the listed
    // link, and only if that has expired is its store listed again (`refresh`).
    for (const cat of [2, 4]) {
      const first = await links(cat);
      const pages = [first, ...(await Promise.all(Array.from({ length: first.pages - 1 }, (_, i) => links(cat, 0, i + 2))))];
      for (const { urls } of pages) for (const url of urls) all.push({ name: nameOf(url), cat, url });
    }
    const files = [...new Map(all.map((f) => [f.name, f])).values()].map((f) => ({
      name: f.name,
      url: f.url,
      refresh: async () => {
        const store = Number(parseFileName(f.name).store);
        const fresh = (await links(f.cat, store)).urls.find((u) => nameOf(u) === f.name);
        if (!fresh) throw new Error(`${f.name} is no longer listed`);
        return fresh;
      },
    }));
    const stores = (await links(5)).urls.map((url) => ({ name: nameOf(url), url }));
    return { files: [...files, ...stores] };
  },

  async cerberus(publisher) {
    const { code, password = "" } = PUBLISHERS[publisher];
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
      body: new URLSearchParams({ username: code, password, csrftoken: token }),
    });
    keep(res);
    if (res.status !== 302) throw new Error(`login as ${code} answered ${res.status} (a valid chain code answers 302)`);
    res = await fetch(`${base}/file`, { headers: { "user-agent": UA, cookie: cookie() } });
    keep(res);
    const token2 = csrf(await res.text());
    const list = async (cd) => {
      const answer = await fetch(`${base}/file/json/dir`, {
        method: "POST",
        headers: { "user-agent": UA, cookie: cookie(), "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ sEcho: "1", iDisplayStart: "0", iDisplayLength: "100000", cd, csrftoken: token2 ?? "" }),
      });
      const json = await answer.json();
      // The skill: an empty list with an `error` key is NOT "no files".
      if (json.error) throw new Error(`listing error: ${json.error}`);
      return (json.aaData ?? []).filter((row) => row && (row.fname ?? row.name ?? row[0]));
    };

    // SOME ACCOUNTS KEEP THEIR FILES ONE FOLDER DOWN. Super Yuda's root holds a
    // single folder named "Yuda" and no files at all, which read exactly like an
    // empty account — it was recorded as blocked on a password for weeks, and
    // inside that folder are 422 files. So: list the root, and where it offers
    // folders instead of files, look in them. One level only; nothing here nests
    // deeper, and a crawler that wanders is a crawler that gets itself banned.
    const rows = await list("/");
    const named = (row) => row.fname ?? row.name ?? row[0];
    const folders = rows.filter((row) => row.type === "folder").map(named);
    const atRoot = rows.filter((row) => row.type !== "folder").map(named);

    const found = atRoot.map((name) => ({ name, path: name }));
    if (!found.length) {
      for (const folder of folders) {
        for (const row of await list(`/${folder}`)) {
          if (row.type === "folder") continue;
          found.push({ name: named(row), path: `${folder}/${named(row)}` });
        }
      }
    }

    return {
      files: found.map(({ name, path }) => ({
        name,
        // The download path carries the folder; without it the server answers 200
        // with an HTML page, which is not a gzip and fails much later and worse.
        url: `${base}/file/d/${path}`,
        init: { headers: { cookie: cookie() } },
      })),
    };
  },

  async laib(publisher) {
    // Laib Catalog (Victory, Mahsanei HaShuk): a public JSON API lists every file of the chain for the
    // CURRENT Israeli day only — right after midnight it is empty until the chain publishes again.
    const code = PUBLISHERS[publisher].chainCode;
    const res = await fetch(`https://laibcatalog.co.il/webapi/api/getfiles?edi=${code}`, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`laibcatalog getfiles for ${code}: HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("laibcatalog getfiles answered something other than a list");
    return { files: rows.map((row) => ({ name: row.fileName, url: `https://laibcatalog.co.il/webapi/${code}/${row.fileName}` })), note: rows.length === 0 ? "the source lists no files yet for the current Israeli day" : undefined };
  },

  async "hatzi-hinam"() {
    // The public page lists only the ~15 newest files of each type at any moment (no store filter, no paging,
    // the storage container is not publicly listable): coverage builds up over the day, never all at once.
    const listing = [];
    for (const t of ["", "1", "2", "3"]) {
      const html = await text(`https://shop.hazi-hinam.co.il/Prices?p=1&s=&f=&t=${t}&d=`);
      for (const [, url] of html.matchAll(/href="(https:\/\/hazihinamprod01\.blob\.core\.windows\.net\/regulatories\/[^"]+)"/g)) listing.push({ name: url.split("/").pop(), url });
    }
    return { files: [...new Map(listing.map((f) => [f.name, f])).values()], partial: "the public page lists only the newest files; branches appear as they publish" };
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
        signal: AbortSignal.timeout(60_000),
      });
      for (const row of await res.json()) listing.push({ name: row.FileNm.replace(/\.GZ$/, ".gz"), url: `https://${host}/Download.aspx?FileNm=${row.FileNm}` });
    }
    // Download.aspx answers with a JSON pointer to the real file: resolved only for the files taken.
    return {
      files: listing.map((f) => ({
        ...f,
        url: async () => {
          const body = await text(f.url);
          const real = (body.match(/"SPath"\s*:\s*"([^"]+)"/) ?? [])[1];
          if (!real) throw new Error(`${f.name}: no download pointer`);
          return real.replace(/\\\//g, "/");
        },
      })),
    };
  },
};

/** Every file the publisher lists right now, with its kind, store and time stamp. */
export async function listing(publisher) {
  const p = PUBLISHERS[publisher];
  const out = await platforms[p.platform](publisher);
  const files = out.files.map((f) => ({ ...f, kind: kindOf(f.name), ...parseFileName(f.name) }));
  return { ...out, files };
}

/** The newest file of a kind for a store (store codes compared as numbers). */
export function newest(files, kind, store) {
  return files
    .filter((f) => f.kind === kind && (store === undefined || String(Number(f.store)) === String(Number(store))))
    .sort((a, b) => b.stamp.localeCompare(a.stamp))[0];
}

/** The newest Stores file (the branch inventory). */
export const newestStores = (files) => files.filter((f) => f.kind === "Stores" || /^storesfull/i.test(f.name)).sort((a, b) => (b.stamp || b.name).localeCompare(a.stamp || a.name))[0];
