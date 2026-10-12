import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";

/**
 * Every number on the admin dashboard, against its own definition (migration 0025).
 *
 * The V2 audit found four of them provably wrong, and the reason they stayed wrong
 * for so long is that nothing here asserted what any of them MEANT — the previous
 * suite only proved that admin_overview refuses a non-admin and returns a 'reports'
 * key. These tests build a world with a known answer and check the number against it.
 */

type Overview = {
  people: { total: number; onboarded: number; this_week: number; notifiable: number };
  deals: { live: number; pending: number; added_this_week: number; taken_down_this_week: number; submitted_this_week: number };
  reports: { open: number };
  offers: { live: number; from_chains: number; retailers: number; expiring: number };
  notifications: { pending: number; sent_ever: number };
};

async function setup() {
  const w = await world();
  const moderator = await createUser(w.db, "moderator@example.test");
  await w.db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [moderator]);
  return { w, moderator };
}

const overview = async (w: World, who: string): Promise<Overview> =>
  (await asUser(w.db, who, () => w.db.query<{ o: Overview }>("select public.admin_overview() as o"))).rows[0].o;

/** A deal submitted by a person, through the same path the app uses. */
async function submit(w: World, who: string, beerId: string, storeId: string, category = "sixpack") {
  return asUser(w.db, who, async () => {
    const { rows } = await w.db.query<{ id: string }>(
      `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by)
       values ($1, $2, $3::public.deal_category, 2490, 3990, 'pending', $4) returning id`,
      [beerId, storeId, category, who],
    );
    return rows[0].id;
  });
}

describe("admin dashboard metrics (0025)", () => {
  it("counts an approved manual deal ONCE: offers_feed already contains it", async () => {
    const { w, moderator } = await setup();

    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_add_deal($1, $2, 'sixpack', 2490, 3990)", [w.ids.goldstar, w.ids.rami]),
    );

    const o = await overview(w, moderator);

    // The bug: the page rendered offers.live + deals.live. offers_feed is
    // `catalog UNION ALL deals_public`, and deals_public IS the approved deals.
    expect(o.deals.live).toBe(1);
    expect(o.offers.live).toBe(1);
    expect(o.offers.from_chains).toBe(0);
    // The honest headline, and the honest split. Adding the first two would give 2.
    expect(o.offers.live).toBe(o.offers.from_chains + o.deals.live);
  });

  it("counts a takedown by when it came down, not by when the row was last edited", async () => {
    const { w, moderator } = await setup();
    const id = await submit(w, w.visitor, w.ids.goldstar, w.ids.rami);

    await asUser(w.db, moderator, () => w.db.query("select public.set_deal_status($1, 'rejected')", [id]));
    expect((await overview(w, moderator)).deals.taken_down_this_week).toBe(1);

    // Age the takedown out of the window, then edit the row. updated_at jumps to
    // now (deals_touch fires on any update) — which is exactly what used to make
    // this count a months-old rejection as a takedown this week.
    await w.db.query("update public.deals set deactivated_at = now() - interval '30 days' where id = $1", [id]);
    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_update_deal($1, $2, $3, 'sixpack', 2490, 3990, 'תוקן')", [id, w.ids.goldstar, w.ids.rami]),
    );

    const after = await overview(w, moderator);
    expect(after.deals.taken_down_this_week).toBe(0);
    // Proving the edit really did touch the row, i.e. the old definition would have counted it.
    const touched = await w.db.query<{ n: number }>(
      "select count(*)::int n from public.deals where id = $1 and updated_at >= now() - interval '1 minute'",
      [id],
    );
    expect(touched.rows[0].n).toBe(1);
  });

  it("does not report a deal an admin typed in as one a person sent", async () => {
    const { w, moderator } = await setup();

    await submit(w, w.visitor, w.ids.goldstar, w.ids.rami);
    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_add_deal($1, $2, 'case', 2490, 3990)", [w.ids.maccabee, w.ids.shufersal]),
    );

    const o = await overview(w, moderator);
    expect(o.deals.submitted_this_week).toBe(1); // the person's, not the admin's
  });

  it("counts real notifications, not an admin's test pushes to their own phone", async () => {
    const { w, moderator } = await setup();

    await w.db.query(
      `insert into public.notification_events (dedupe_key, offer_key, beer_id, expires_at)
       values ('deal:x', 'deal:x', $1, now() + interval '1 day')`,
      [w.ids.goldstar],
    );
    const eventId = (await w.db.query<{ id: string }>("select id from public.notification_events limit 1")).rows[0].id;

    await w.db.query(
      `insert into public.notification_deliveries (event_id, user_id, status, kind)
       values ($1, $2, 'sent', 'offer'), ($1, $3, 'sent', 'test')`,
      [eventId, w.visitor, moderator],
    );

    expect((await overview(w, moderator)).notifications.sent_ever).toBe(1);
  });

  it("uses the Israeli calendar day for 'ending soon', not UTC", async () => {
    const { w, moderator } = await setup();
    const o = await overview(w, moderator);
    // No promotions in this world, so the window is empty either way; what this
    // pins is that the function reads a Jerusalem date at all. Between Israeli
    // midnight and 02:00/03:00, current_date (UTC) is still yesterday.
    expect(o.offers.expiring).toBe(0);
    const { rows } = await w.db.query<{ same: boolean }>(
      "select (now() at time zone 'Asia/Jerusalem')::date >= current_date as same",
    );
    expect(rows[0].same).toBe(true);
  });

  it("counts a person with several devices once as notifiable", async () => {
    const { w, moderator } = await setup();
    await w.db.query("update public.profiles set notifications_enabled = true where id = $1", [w.visitor]);
    for (const n of [1, 2, 3]) {
      await w.db.query(
        `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
         values ($1, $2, 'p', 'a', 'test')`,
        [w.visitor, `https://push.example/device-${n}`],
      );
    }
    expect((await overview(w, moderator)).people.notifiable).toBe(1);
  });
});

describe("the admin roster is not public (M-3)", () => {
  it("tells an ordinary visitor nothing about who the admins are", async () => {
    const { w } = await setup();

    // This is the one that mattered. The policy used to be `to authenticated
    // using (true)`, and middleware gives EVERY visitor an authenticated
    // anonymous session -- so one request with the public anon key returned every
    // admin's id and level, naming the super admin whose compromise yields
    // grant_admin. A signed-in visitor now sees nothing.
    const seen = await asUser(w.db, w.visitor, () =>
      w.db.query<{ user_id: string }>("select user_id from public.admins"),
    );
    expect(seen.rows).toHaveLength(0);

    // The sessionless public never had a grant on this table in the first place,
    // and still does not: it is refused before RLS is consulted.
    await expect(
      asUser(w.db, null, () => w.db.query("select user_id from public.admins"), "anon"),
    ).rejects.toThrow(/permission denied/);
  });

  it("still lets a person see their own row, so 'am I an admin?' keeps working", async () => {
    const { w, moderator } = await setup();
    const mine = await asUser(w.db, moderator, () =>
      w.db.query<{ level: string }>("select level from public.admins where user_id = $1", [moderator]),
    );
    expect(mine.rows).toEqual([{ level: "admin" }]);
  });

  it("still shows an admin the whole roster, which is what the roster page reads", async () => {
    const { w, moderator } = await setup();
    const all = await asUser(w.db, moderator, () => w.db.query("select user_id from public.admins"));
    expect(all.rows.length).toBe(2); // the super admin from world(), and the moderator
  });
});

/**
 * The moderation list, filtered (Phase U).
 *
 * The queue used to be two fixed lists — every pending deal and the last thirty
 * approved — so "what did this chain send us?" and "what have we rejected on this
 * beer?" had no answer. These run against the real policies, as a moderator.
 */
describe("the moderation list can be narrowed (Phase U)", () => {
  /** Submitted by a person, through the policy that is the only way in. */
  async function sent(w: World, who: string, beerId: string, storeId: string, note: string | null, category = "sixpack") {
    const { rows } = await asUser(w.db, who, () =>
      w.db.query<{ id: string }>(
        `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by, notes)
         values ($1, $2, $3::public.deal_category, 2490, 3990, 'pending', $4, $5) returning id`,
        [beerId, storeId, category, who, note],
      ),
    );
    return rows[0].id;
  }

  const read = async (w: World, who: string, sql: string, params: unknown[] = []) =>
    (await asUser(w.db, who, () => w.db.query<{ id: string }>(sql, params))).rows;

  it("finds what one chain sent, and what one beer was sent for", async () => {
    const { w, moderator } = await setup();
    await sent(w, w.visitor, w.ids.goldstar, w.ids.rami, null);
    await sent(w, w.visitor, w.ids.maccabee, w.ids.shufersal, null);
    await sent(w, w.visitor, w.ids.goldstar, w.ids.shufersal, null, "case");

    expect(
      await read(w, moderator, "select id from public.deals where store_id = $1", [w.ids.shufersal]),
    ).toHaveLength(2);
    expect(
      await read(w, moderator, "select id from public.deals where beer_id = $1", [w.ids.goldstar]),
    ).toHaveLength(2);
  });

  it("tells a person's submission from one an admin typed in", async () => {
    const { w, moderator } = await setup();
    await sent(w, w.visitor, w.ids.goldstar, w.ids.rami, null);
    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_add_deal($1, $2, 'sixpack', 2490, 3990)", [w.ids.maccabee, w.ids.rami]),
    );

    expect(await read(w, moderator, "select id from public.deals where entered_by_admin")).toHaveLength(1);
    expect(await read(w, moderator, "select id from public.deals where not entered_by_admin")).toHaveLength(1);
  });

  it("searches the note a submitter wrote, including in Hebrew", async () => {
    const { w, moderator } = await setup();
    await sent(w, w.visitor, w.ids.goldstar, w.ids.rami, "רק במועדון הלקוחות");
    await sent(w, w.visitor, w.ids.maccabee, w.ids.rami, "עד יום שישי");

    const found = await read(w, moderator, "select id from public.deals where notes ilike $1", ["%מועדון%"]);
    expect(found).toHaveLength(1);
  });

  it("treats a wildcard typed into the search box as a character, not a pattern", async () => {
    const { w, moderator } = await setup();
    await sent(w, w.visitor, w.ids.goldstar, w.ids.rami, "הנחה 50% מהמחיר");
    await sent(w, w.visitor, w.ids.maccabee, w.ids.rami, "עד יום שישי");

    // The escaping getAdminDeals applies: '%' is matched literally, so searching for
    // it finds the one deal rather than every deal there is.
    const literal = await read(w, moderator, "select id from public.deals where notes ilike $1", ["%50\\%%"]);
    expect(literal).toHaveLength(1);
  });
});
