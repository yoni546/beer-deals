/**
 * Is this Supabase project (and, optionally, the site in front of it) set up the
 * way the app needs? Run it after creating staging, after applying a migration,
 * and after a deploy.
 *
 *   node scripts/check-environment.mjs --url https://<ref>.supabase.co --anon-key <publishable key> \
 *        [--site https://<the deployed site>] [--expect staging|production]
 *
 * Read-only apart from one side effect on the target: it creates ONE anonymous user
 * (the same thing every visitor gets). It also ATTEMPTS three writes that are all
 * supposed to be refused — a forbidden column on that throwaway user's own profile
 * (0010), a row in the audit log (0032), and a watch on a beer that does not exist
 * (0037) — and the refusal is the thing being checked, so nothing is written. It
 * never touches anyone else's data and needs no secret: the URL and the publishable
 * key are the same values the browser already receives.
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
  ["0011       regular prices feed", "regular_prices_feed?select=sku_id&limit=1"],
  ["0012       notification rules (daily cap, quiet hours)", "app_settings?select=notify_daily_cap,notify_quiet_start,notify_quiet_end&limit=1"],
  ["0013       ingestion runs are de-duplicated by file", "ingestion_runs?select=file_hash&limit=1"],
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

// --- 2b. V2: migrations 0024–0042 ---------------------------------------------
//
// Two kinds of check, because the two things that can go wrong are different.
//
// A table or column either arrived or it did not, so it is read as a visitor and
// the read either answers or 404s. A FUNCTION, though, is supposed to refuse an
// ordinary user — so "it refused" is a pass and only "there is no such function"
// is a failure. PostgREST says that one thing exactly: PGRST202. Anything else,
// including 403 and 500, means the function is there and guarded, which is the
// state we are verifying.

const v2Tables = [
  ["0026       branches have somewhere to put a position", "branches?select=latitude,longitude,geocode_source&limit=1"],
  ["0026       profiles carry the town and the radius", "profiles?select=home_city,search_radius_km&limit=1"],
  ["0027       the Deal Score table", "offer_scores?select=offer_key,score,band,basis&limit=1"],
  ["0030       contributors, with their tallies", "contributors?select=display_name,approved&limit=1"],
  ["0031       offer feedback", "offer_feedback?select=offer_key,verdict&limit=1"],
  ["0037       the watchlist", "watchlist?select=beer_id,max_price_agorot&limit=1"],
];
for (const [name, path] of v2Tables) {
  const response = await rest(path, token);
  response.ok ? record("ok", name) : record("fail", name, `not applied? (HTTP ${response.status})`);
}

// The three tables nobody may read through the API. No grant was ever issued for
// them, so a visitor asking is refused — and a visitor who is NOT refused is the
// whole finding.
const v2Closed = [
  ["0032       the audit log is not readable through the API", "admin_actions"],
  ["0033       name changes are not readable through the API", "display_name_changes"],
  ["0035       submission blocks are not readable through the API", "submission_blocks"],
];
for (const [name, table] of v2Closed) {
  // `select=*`, not a named column: a probe that names a column reports a missing
  // column instead of a missing grant, which is a different fact.
  const response = await rest(`${table}?select=*&limit=1`, token);
  const code = response.ok ? null : (await response.json().catch(() => ({})))?.code;
  if (code === "42501" || response.status === 401 || response.status === 403 || response.status === 404) {
    record("ok", name);
  } else {
    record("fail", name, `a visitor could read it (HTTP ${response.status})`);
  }
}

// The manual theme picker that an early draft of 0011 added was removed before
// release: favourite #1 alone decides the app's look (CLAUDE.md, and two tests).
// A database built from that draft still has the columns, and this is where that
// shows up — so here the columns being GONE is the pass.
{
  const response = await rest("profiles?select=theme_override&limit=1", token);
  const code = response.ok ? null : (await response.json().catch(() => ({})))?.code;
  code === "42703" || response.status === 400
    ? record("ok", "0011       no manual theme picker on profiles")
    : record("fail", "0011       no manual theme picker on profiles", "theme_override still exists — docs/STAGING.md has the cleanup");
}

{
  const rpcs = [
    ["0025       admin_overview()", "admin_overview", {}],
    ["0027       refresh_offer_scores()", "refresh_offer_scores", {}],
    ["0031       report_offer() / offer_standings()", "offer_standings", {}],
    ["0032       admin_audit()", "admin_audit", { p_limit: 1 }],
    ["0034       admin_beers()", "admin_beers", {}],
    ["0036       admin_coverage()", "admin_coverage", {}],
    // A uuid that is nobody's beer: the function refuses it on the foreign key, so
    // this proves the function exists without putting a row on anybody's watchlist.
    ["0037       watch_beer()", "watch_beer", { p_beer_id: "00000000-0000-0000-0000-000000000000" }],
    ["0038       contributor_trust() / my_standing()", "my_standing", {}],
    ["0039       promotion_branches_near()", "promotion_branches_near", { p_promotion_id: 0 }],
    ["0040       is_moderator()", "is_moderator", {}],
    ["0041       admin_people() / admin_people_by_city()", "admin_people", { p_limit: 1 }],
    ["0042       admin_highlights()", "admin_highlights", {}],
  ];
  for (const [name, fn, body] of rpcs) {
    const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    payload?.code === "PGRST202"
      ? record("fail", name, "no such function — the migration is not applied")
      : record("ok", name, response.ok ? "present" : "present, and refuses an ordinary user");
  }
}

// 0040 tightened is_admin(): a plain visitor must read false. If this says true,
// something is very wrong and no admin screen is protected.
{
  const response = await fetch(`${url}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  const value = await response.json().catch(() => null);
  if (value === true) record("fail", "0040       a visitor is not an admin", "is_admin() answered TRUE for an anonymous user");
  else record("ok", "0040       a visitor is not an admin");
}

// 0032 — the audit log refuses a write even when asked directly. No role has the
// grant, which is what makes it append-only in the sense that matters.
{
  const response = await rest("admin_actions", token, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ actor: userId, action: "check.environment", subject_kind: "probe" }),
  });
  response.status === 401 || response.status === 403 || response.status === 404
    ? record("ok", "0032       the audit log refuses a write from a visitor")
    : record("fail", "0032       the audit log refuses a write", `the write was accepted (HTTP ${response.status})`);
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
