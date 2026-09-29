// Read-only schema probe: applies the repo's real migrations to an in-memory
// Postgres (PGlite) and tries the scenarios the audit cares about.
// Nothing here touches the repo or the production database.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.cwd(); // run from the repo root: node docs/audit-2026-09-29/schema-probe.mjs
const { PGlite } = await import(
  pathToFileURL(join(REPO, "node_modules/@electric-sql/pglite/dist/index.js")).href
);

const db = new PGlite();
await db.exec(readFileSync(join(REPO, "tests/sql/bootstrap.sql"), "utf8"));
for (const f of readdirSync(join(REPO, "supabase/migrations")).filter((n) => n.endsWith(".sql")).sort()) {
  await db.exec(readFileSync(join(REPO, "supabase/migrations", f), "utf8"));
}

const out = [];
const log = (k, v) => { out.push(`${k}: ${v}`); console.log(`${k}: ${v}`); };

async function asUser(uid, fn) {
  await db.exec("set role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  try { return await fn(); } finally {
    await db.exec("reset role;");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
const q = async (sql, p) => (await db.query(sql, p)).rows;
const tryQ = async (label, fn) => {
  try { const r = await fn(); log(label, "OK " + JSON.stringify(r?.rows ?? r ?? "")); }
  catch (e) { log(label, "ERROR [" + (e.code ?? "?") + "] " + e.message); }
};

const mkUser = async (email) => (await q("insert into auth.users (email) values ($1) returning id", [email]))[0].id;
const admin = await mkUser("admin@x.test");
await q("insert into public.admins (user_id, level) values ($1,'super_admin')", [admin]);
const u1 = await mkUser(null);
const u2 = await mkUser(null);

const beer = async (slug) => (await q("select id from public.beers where slug=$1", [slug]))[0].id;
const store = async (slug) => (await q("select id from public.stores where slug=$1", [slug]))[0].id;
const gs = await beer("goldstar"), rl = await store("rami-levy");

// --- A. Two different Goldstar packs at the same chain, same "category"
const mk = async (deal, reg, note) =>
  (await q(
    `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, notes, status, created_by)
     values ($1,$2,'sixpack',$3,$4,$5,'pending',$6) returning id`, [gs, rl, deal, reg, note, u1]))[0].id;
const d330 = await mk(2500, 3790, "Goldstar 6x330");
const d500 = await mk(3400, 4990, "Goldstar 6x500");
await asUser(admin, async () => {
  await tryQ("A1 approve Goldstar 6x330 @Rami Levy", () => db.query("select id from public.approve_deal($1)", [d330]));
  await tryQ("A2 approve Goldstar 6x500 @Rami Levy (different pack, same beer/store/category)", () => db.query("select id from public.approve_deal($1)", [d500]));
});

// --- B. Cross-user push endpoint re-subscribe (same browser, new anonymous user)
await asUser(u1, () => tryQ("B1 user1 saves endpoint E", () => db.query("select public.save_push_subscription('https://push.example/E','p','a','ua')")));
await asUser(u2, () => tryQ("B2 user2 (same browser, new anon id) saves the SAME endpoint E", () => db.query("select public.save_push_subscription('https://push.example/E','p2','a2','ua')")));
log("B3 subscription rows / owner now", JSON.stringify(await q("select user_id = $1 as owned_by_user1, count(*) over () as n from public.push_subscriptions", [u1])));

// --- C. Profile self-update of primary_beer_id
await asUser(u1, async () => {
  await tryQ("C1 profile: default notifications_enabled", () => db.query("select notifications_enabled, primary_beer_id, onboarded_at from public.profiles where id=$1", [u1]));
  await tryQ("C2 user forges primary_beer_id + onboarded_at directly", () => db.query("update public.profiles set primary_beer_id=$2, onboarded_at=now() where id=$1 returning primary_beer_id", [u1, gs]));
});

// --- D. Can a regular (non-promo) price exist?
await asUser(u1, async () => {
  await tryQ("D1 regular price only (deal == regular)", () => db.query("insert into public.deals (beer_id,store_id,category,deal_price_agorot,regular_price_agorot,created_by) values ($1,$2,'sixpack',3790,3790,$3)", [gs, rl, u1]));
  await tryQ("D2 unknown category 'sixpack' vs 12-pack / 4-pack / 24-can", () => db.query("insert into public.deals (beer_id,store_id,category,deal_price_agorot,regular_price_agorot,created_by) values ($1,$2,'twelvepack',1,2,$3)", [gs, rl, u1]));
});

// --- E. Columns available for pricing intelligence
log("E1 public.deals columns", (await q("select string_to_array(string_agg(column_name, ',' order by ordinal_position), ',') as c from information_schema.columns where table_schema='public' and table_name='deals'"))[0].c.join(", "));
log("E2 public.beers columns", (await q("select string_agg(column_name, ', ' order by ordinal_position) as c from information_schema.columns where table_schema='public' and table_name='beers'"))[0].c);
log("E3 public.stores columns", (await q("select string_agg(column_name, ', ' order by ordinal_position) as c from information_schema.columns where table_schema='public' and table_name='stores'"))[0].c);
log("E4 deals_public columns", (await q("select string_agg(column_name, ', ' order by ordinal_position) as c from information_schema.columns where table_schema='public' and table_name='deals_public'"))[0].c);
log("E5 tables in public", (await q("select string_agg(table_name, ', ' order by table_name) as c from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"))[0].c);

// --- F. In-place edit destroys history?
await asUser(admin, async () => {
  await tryQ("F1 admin edits approved deal price in place", () => db.query("select deal_price_agorot, regular_price_agorot, discount_percent, updated_at > created_at as touched from public.admin_update_deal($1,$2,$3,'sixpack',2200,3790,'edit')", [d330, gs, rl]));
});
log("F2 rows for that deal after edit (history rows)", JSON.stringify(await q("select count(*) from public.deals where id=$1", [d330])));

// --- G. 0005 nulls provenance on duplicates; take-down nulls approver
await asUser(admin, async () => {
  await tryQ("G1 set_deal_status inactive", () => db.query("select status, approved_by, approved_at from public.set_deal_status($1,'inactive')", [d330]));
});

// --- H. Seed beers: what the 'beer' catalogue actually is
log("H1 beers seeded", (await q("select count(*)::int as n from public.beers"))[0].n);
log("H2 sample beer rows", JSON.stringify(await q("select slug, name_en from public.beers where slug in ('tuborg','tuborg-red','goldstar','heineken') order by slug")));
log("H3 stores that are not retail chains", JSON.stringify(await q("select slug, name_he from public.stores where slug in ('liquor-store','makolet')")));
