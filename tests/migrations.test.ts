import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMigration, asUser, createUser, freshDatabase } from "./helpers/db";
import { joinSetLines, renderCombinedSql } from "../scripts/build-combined-sql.mjs";

describe("supabase/RUN_THIS_IN_SUPABASE.sql", () => {
  // The file itself is generated and is no longer kept in git -- tracked, it was
  // touched by every pull request that added a migration, and so collided with
  // every other such pull request: four were stopped by it in two days, none
  // over a real disagreement. So what is checked here is what the generator
  // renders, not a copy of it on disk: every migration present, in order.
  it("is every migration joined in order", () => {
    const dir = join(__dirname, "..", "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    expect(files.length).toBeGreaterThan(60);

    const combined = renderCombinedSql();
    let at = -1;
    for (const file of files) {
      // joinSetLines, because the generated paste file rewrites one line shape
      // (see the generator); the migrations themselves keep their formatting.
      const body = joinSetLines(readFileSync(join(dir, file), "utf8").split("\r\n").join("\n")).trim();
      const found = combined.indexOf(body);
      expect(found, `${file} is missing from the combined file`).toBeGreaterThan(-1);
      expect(found, `${file} is out of order in the combined file`).toBeGreaterThan(at);
      at = found;
    }
  });

  it("can build the whole schema from scratch", async () => {
    const db = await freshDatabase();
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.beers");
    expect(rows[0].n).toBe(40); // 22 (0004) + 12 (0016) + 6 (0063)
  });
});

/**
 * 0006 runs against a database that already has the state production was in:
 * approved sample deals, one of them the weekly deal, and profiles that claim
 * to want notifications without ever having subscribed.
 */
describe("0006 · retire sample deals, honest notification default, service-role grants", () => {
  async function productionLikeDatabase() {
    const db = await freshDatabase({ through: "0005" });
    const admin = await createUser(db, "admin@example.test");
    await db.query("insert into public.admins (user_id, level) values ($1, 'super_admin')", [admin]);

    const add = async (beer: string, store: string, notes: string | null) =>
      (
        await db.query<{ id: string }>(
          `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot,
                                     status, approved_by, approved_at, notes)
           select b.id, s.id, 'sixpack', 2490, 3990, 'approved', $3, now(), $4
             from public.beers b, public.stores s where b.slug = $1 and s.slug = $2
           returning id`,
          [beer, store, admin, notes],
        )
      ).rows[0].id;

    const demo = await add("goldstar", "rami-levy", "מבצע לדוגמה");
    const demoTwo = await add("maccabee", "victory", "מבצע לדוגמה");
    const real = await add("heineken", "shufersal", null);
    const realWithNote = await add("corona", "yochananof", "עד יום שישי");
    await db.query("update public.app_settings set weekly_deal_id = $1 where id", [demo]);

    const subscribed = await createUser(db);
    const neverSubscribed = await createUser(db);
    await db.query("update public.profiles set notifications_enabled = true"); // the old default
    await db.query(
      "insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/1', 'p', 'a')",
      [subscribed],
    );
    return { db, admin, demo, demoTwo, real, realWithNote, subscribed, neverSubscribed };
  }

  it("takes sample deals out of the public view and leaves real ones alone", async () => {
    const { db, demo, demoTwo, real, realWithNote } = await productionLikeDatabase();
    await applyMigration(db, "0006");

    const visible = await asUser(db, null, async () => (await db.query<{ id: string }>("select id from public.deals_public")).rows, "anon");
    const ids = visible.map((r) => r.id);
    expect(ids).toContain(real);
    expect(ids).toContain(realWithNote);
    expect(ids).not.toContain(demo);
    expect(ids).not.toContain(demoTwo);
  });

  it("keeps the sample rows (retired, not destroyed) and clears who approved them", async () => {
    const { db, demo } = await productionLikeDatabase();
    await applyMigration(db, "0006");
    const { rows } = await db.query<{ status: string; approved_by: string | null; approved_at: string | null }>(
      "select status, approved_by, approved_at from public.deals where id = $1",
      [demo],
    );
    expect(rows[0]).toEqual({ status: "inactive", approved_by: null, approved_at: null });
  });

  it("removes a retired sample deal as the weekly deal", async () => {
    const { db } = await productionLikeDatabase();
    await applyMigration(db, "0006");
    const { rows } = await db.query<{ weekly_deal_id: string | null }>("select weekly_deal_id from public.app_settings");
    expect(rows[0].weekly_deal_id).toBeNull();
  });

  it("is safe to run twice", async () => {
    const { db, real } = await productionLikeDatabase();
    await applyMigration(db, "0006");
    await applyMigration(db, "0006");
    const { rows } = await db.query<{ status: string }>("select status from public.deals where id = $1", [real]);
    expect(rows[0].status).toBe("approved");
  });

  it("stops claiming notifications for profiles that never subscribed", async () => {
    const { db, subscribed, neverSubscribed } = await productionLikeDatabase();
    await applyMigration(db, "0006");

    const flag = async (id: string) =>
      (await db.query<{ notifications_enabled: boolean }>("select notifications_enabled from public.profiles where id = $1", [id])).rows[0]
        .notifications_enabled;

    expect(await flag(subscribed)).toBe(true); // has a real subscription: keeps its choice
    expect(await flag(neverSubscribed)).toBe(false);

    const fresh = await createUser(db); // new visitors default to "not subscribed"
    expect(await flag(fresh)).toBe(false);
  });

  it("gives the push sender's service role every privilege it uses", async () => {
    const { db, real, subscribed } = await productionLikeDatabase();
    await applyMigration(db, "0006");

    await asUser(
      db,
      null,
      async () => {
        // reads (notify.ts)
        await db.query("select id, first_name from public.profiles");
        await db.query("select id, notified_at, category, deal_price_agorot, discount_percent, beer_id from public.deals");
        await db.query("select name_he from public.beers");
        await db.query("select notify_min_discount_percent from public.app_settings");
        await db.query("select endpoint, p256dh, auth, user_id from public.push_subscriptions");
        // writes (notify.ts)
        await db.query("update public.deals set notified_at = now() where id = $1", [real]);
        await db.query("insert into public.push_log (user_id, deal_id) values ($1, $2)", [subscribed, real]);
        await db.query("delete from public.push_subscriptions where endpoint = 'https://push.example/1'");

        // The matching "…and nothing more" lives in tests/security-sweep.test.ts,
        // against the whole schema, because it is not true here. A Supabase
        // project grants the API roles everything in `public` by default, and
        // nothing took that back until 0043 — so at 0006 the worker's role really
        // could rewrite a price, on the real thing as much as in this test. The
        // guarantee is real from 0043 onward, and that is where it is asserted.
      },
      "service_role",
    );
  });
});
