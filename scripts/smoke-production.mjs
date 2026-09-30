#!/usr/bin/env node
/**
 * NON-DESTRUCTIVE deployment check (docs/PRODUCTION-HANDOFF-YONI.md §I, §K).
 *
 *   node scripts/smoke-production.mjs                                   # https://beer-deals.vercel.app
 *   node scripts/smoke-production.mjs --commit <sha> --supabase-ref <production ref> [--expect-data]
 *   node scripts/smoke-production.mjs --url <preview url> ...           # a deployment before it is promoted
 *
 * It behaves as ONE visitor opening the site once: the app gives every first visit an anonymous session
 * (src/middleware.ts), so a run creates one anonymous user — nothing else. It never onboards, never picks
 * favourites, never submits, never calls a write endpoint. Exit code 0 = every check passed.
 *
 * Checks: /api/version (release, commit, environment, Supabase project ≠ staging) · pages render without the
 * error screen · no staging badge · no staging project anywhere in the pages or their scripts · no
 * service-role key in any script · What's New is not found for a
 * visitor · the admin panel sends a visitor to its login · the notification worker refuses an unsigned call.
 * The share button (after onboarding) is checked in the browser, not here.
 * --expect-data (after the import) also requires real rows on a beer page and on Rami Levy's page.
 */
import { readFileSync } from "node:fs";

const STAGING_REF = "qpjwnxptitnmtsznjvkw";
const PRODUCTION_URL = "https://beer-deals.vercel.app";
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? "" : (args[i + 1] ?? "");
};
const BASE = (flag("url") || PRODUCTION_URL).replace(/\/$/, "");
const EXPECT_ENV = flag("expect-env") || "production";
const EXPECT_DATA = args.includes("--expect-data");
const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// One visitor: cookies kept across requests, redirects followed by hand so the cookies travel with them.
const jar = new Map();
async function visit(path, init = {}) {
  let url = new URL(path, BASE).toString();
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(url, { ...init, redirect: "manual", headers: { ...(init.headers ?? {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }, signal: AbortSignal.timeout(60_000) });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const at = pair.indexOf("=");
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location"), url).toString();
      continue;
    }
    return { status: res.status, url: new URL(url).pathname, text: await res.text() };
  }
  throw new Error(`${path}: too many redirects`);
}

const scripts = new Set();
const ERROR_SCREEN = /משהו השתבש|לא הצלחנו להתחבר/;
const BADGE = /bg-fuchsia-700|אזהרה: הסביבה הזו/;
function inspectPage(label, page) {
  check(`${label}: renders (200)`, page.status === 200, `${page.status} at ${page.url}`);
  check(`${label}: no error screen`, !ERROR_SCREEN.test(page.text));
  if (EXPECT_ENV === "production") check(`${label}: no staging/preview badge`, !BADGE.test(page.text));
  check(`${label}: no staging project in the page`, !page.text.includes(STAGING_REF));
  for (const m of page.text.matchAll(/\/_next\/static\/[^"' ]+\.js/g)) scripts.add(m[0]);
}

console.log(`Checking ${BASE} (expected release ${VERSION}, environment ${EXPECT_ENV})\n`);

// 1. What is deployed.
const v = await visit("/api/version");
let info = {};
try {
  info = JSON.parse(v.text);
} catch {
  /* reported below */
}
check("/api/version answers", v.status === 200, v.status === 200 ? JSON.stringify(info) : `${v.status} (a build older than this check has no /api/version)`);
check(`release is ${VERSION}`, info.version === VERSION, info.version ?? "none");
check(`environment is ${EXPECT_ENV}`, info.environment === EXPECT_ENV, info.environment ?? "none");
if (flag("commit")) check(`built from commit ${flag("commit")}`, String(info.commit ?? "").startsWith(flag("commit")), info.commit ?? "unknown");
if (EXPECT_ENV === "production") check("Supabase project is not staging", Boolean(info.supabaseRef) && info.supabaseRef !== STAGING_REF, info.supabaseRef ?? "unknown");
if (flag("supabase-ref")) check(`Supabase project is ${flag("supabase-ref")}`, info.supabaseRef === flag("supabase-ref"), info.supabaseRef ?? "unknown");

// 2. The pages a visitor opens.
inspectPage("/welcome", await visit("/welcome"));
inspectPage("/ (a new visitor is sent to welcome)", await visit("/"));
const beer = await visit("/beer/goldstar");
inspectPage("/beer/goldstar", beer);
const store = await visit("/store/rami-levy");
inspectPage("/store/rami-levy", store);
inspectPage("/store/victory", await visit("/store/victory"));
if (EXPECT_DATA) {
  check("/beer/goldstar: real prices shown", /<article/.test(beer.text));
  check("/store/rami-levy: real prices shown", /<article/.test(store.text));
}

// 3. What a visitor must NOT reach.
const whatsNew = await visit("/whats-new");
check("/whats-new is not found for a visitor", whatsNew.status === 404, String(whatsNew.status));
const admin = await visit("/admin");
check("/admin sends a visitor to the admin login", admin.url === "/admin/login", admin.url);
const worker = await fetch(`${BASE}/api/notifications/run`, { method: "POST", signal: AbortSignal.timeout(60_000) });
check("notification worker refuses an unsigned call", worker.status === 401 || worker.status === 503, `${worker.status}${worker.status === 503 ? " (not configured: nothing can be sent)" : ""}`);

// 4. The scripts every browser downloads.
let shareFound = false;
let leaks = 0;
for (const path of scripts) {
  const js = await (await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(60_000) })).text();
  if (js.includes(PRODUCTION_URL)) shareFound = true;
  if (js.includes(STAGING_REF) && EXPECT_ENV === "production") leaks++;
  for (const jwt of js.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) ?? []) {
    try {
      if (JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).role === "service_role") leaks++;
    } catch {
      /* not a JWT */
    }
  }
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(js)) leaks++;
}
check(`scripts (${scripts.size}): no staging project, no service-role or secret key`, leaks === 0, leaks ? `${leaks} found` : "");
// The share button lives on Home and Settings, which a visitor reaches only after onboarding — and this check
// never onboards (it would write a profile). When its script is not among the pages seen, say so plainly.
if (shareFound) check(`share link is ${PRODUCTION_URL}`, true);
else console.log(`SKIP  share link — the share button is shown only after onboarding; check it in the browser (handoff §K)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — FAILED: ${failed.map((f) => f.name).join("; ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
