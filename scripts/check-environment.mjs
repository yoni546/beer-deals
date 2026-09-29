/**
 * Is this Supabase project (and, optionally, the site in front of it) set up the
 * way the app needs? Run it after creating staging, after applying a migration,
 * and after a deploy.
 *
 *   node scripts/check-environment.mjs --url https://<ref>.supabase.co --anon-key <publishable key> \
 *        [--site https://<the deployed site>] [--expect staging|production]
 *
 * Read-only apart from two harmless side effects on the target: it creates ONE
 * anonymous user (the same thing every visitor gets), and it tries to write a
 * forbidden column on that throwaway user's own profile to prove migration 0010 is
 * in force. It never touches anyone else's data and needs no secret — the URL and
 * the publishable key are the same values the browser already receives.
 *
 * Exit code 1 when something the app depends on is missing.
 */
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);

const url = (args.get("url") ?? "").replace(/\/$/, "");
const anonKey = args.get("anon-key") ?? "";
const site = (args.get("site") ?? "").replace(/\/$/, "");
const expect = args.get("expect") ?? "staging";

if (!/^https?:\/\//.test(url) || !anonKey) {
  console.error("usage: node scripts/check-environment.mjs --url <supabase url> --anon-key <publishable key> [--site <site url>] [--expect staging|production]");
  process.exit(2);
}

const results = [];
const record = (status, name, detail = "") => {
  results.push({ status, name, detail });
  const icon = { ok: "✓", fail: "✗", warn: "!" }[status];
  console.log(`  ${icon} ${name}${detail ? `  — ${detail}` : ""}`);
};

const rest = (path, token, init = {}) =>
  fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });

console.log(`\nSupabase: ${url}   (expecting: ${expect})\n`);

// --- 1. reachable, and anonymous sign-in is on -------------------------------
let token = anonKey;
let userId = null;
try {
  const health = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey } });
  health.ok ? record("ok", "project is reachable") : record("fail", "project is reachable", `HTTP ${health.status}`);
} catch (error) {
  record("fail", "project is reachable", String(error.message ?? error));
  process.exit(1);
}

{
  const response = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ data: {} }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.ok && body.access_token) {
    token = body.access_token;
    userId = body.user?.id ?? null;
    record("ok", "anonymous sign-ins are enabled");
  } else {
    record("fail", "anonymous sign-ins are enabled", "Authentication → Sign In / Providers → Anonymous sign-ins must be ON");
  }
}

// --- 2. which migrations are applied ------------------------------------------
const probes = [
  ["0001–0004  base schema, catalogue of beers and chains", "beers?select=slug&limit=1"],
  ["0002       public deals view", "deals_public?select=id&limit=1"],
  ["0007       brands, SKUs (container · volume · pack)", "skus?select=id,container,volume_ml,pack_quantity&limit=1"],
  ["0007       beers have a brand and a variant", "beers?select=brand_id,variant&limit=1"],
  ["0007–0008  append-only price ledger", "price_observations?select=id&limit=1"],
  ["0009       offers_feed read model", "offers_feed?select=offer_key&limit=1"],
];
for (const [name, path] of probes) {
  const response = await rest(path, token);
  response.ok ? record("ok", name) : record("fail", name, `not applied? (HTTP ${response.status})`);
}

// 0006 — sample deals must be gone from anything the public can read.
{
  const legacy = await rest(`deals_public?select=id&notes=eq.${encodeURIComponent("מבצע לדוגמה")}&limit=1`, token);
  const legacyRows = legacy.ok ? await legacy.json() : [];
  const sample = await rest("offers_feed?select=offer_key&is_sample=eq.true&limit=1", token);
  const sampleRows = sample.ok ? await sample.json() : [];
  const present = legacyRows.length + sampleRows.length > 0;
  if (!present) record("ok", "0006       no sample deals visible to the public");
  else if (expect === "production") record("fail", "0006       no sample deals visible to the public", "invented prices are visible on a production database — apply 0006 / remove the sample-data rows");
  else record("warn", "sample data is present", "fine on staging; a production server would refuse to show it");
}

// 0010 — a user must not be able to forge their own profile's derived columns.
if (userId) {
  const beer = await (await rest("beers?select=id&limit=1", token)).json();
  const attempt = await rest(`profiles?id=eq.${userId}`, token, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ primary_beer_id: beer[0]?.id }),
  });
  attempt.status === 403 || attempt.status === 401
    ? record("ok", "0010       profile columns are protected (cannot forge primary_beer_id)")
    : record("fail", "0010       profile columns are protected", `the write was accepted (HTTP ${attempt.status}) — apply 0010`);

  const notifications = await rest(`profiles?id=eq.${userId}&select=notifications_enabled`, token);
  const row = notifications.ok ? (await notifications.json())[0] : null;
  row?.notifications_enabled === false
    ? record("ok", "0006       new profiles start with notifications off")
    : record("fail", "0006       new profiles start with notifications off", `notifications_enabled = ${row?.notifications_enabled} — apply 0006`);
}

// --- 3. the site in front of it ------------------------------------------------
if (site) {
  console.log(`\nSite: ${site}\n`);
  for (const path of ["/whats-new", "/beer", "/store", "/beer/goldstar"]) {
    const response = await fetch(site + path, { redirect: "manual" });
    response.status < 400 || response.status === 307
      ? record("ok", `${path} answers`, `HTTP ${response.status}`)
      : record("fail", `${path} answers`, `HTTP ${response.status}`);
  }
  const head = await fetch(site + "/whats-new");
  const id = head.headers.get("x-vercel-id");
  if (id) record("ok", "function region", id.split("::").slice(0, 2).join(" → ") + "  (compare with the Supabase region, docs/INFRASTRUCTURE.md)");
  const html = await head.text();
  const version = html.match(/גרסה[^0-9]{0,40}(\d+\.\d+\.\d+)/)?.[1];
  version ? record("ok", "deployed app version", version) : record("warn", "deployed app version", "could not read it from /whats-new");
}

const failed = results.filter((r) => r.status === "fail").length;
const warned = results.filter((r) => r.status === "warn").length;
console.log(`\n${failed ? "✗" : "✓"} ${results.length} checks, ${failed} failed, ${warned} warnings\n`);
process.exit(failed ? 1 : 0);
