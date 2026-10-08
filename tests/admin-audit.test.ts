import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";

/**
 * The admin audit log (migration 0032).
 *
 * Why it exists: nothing in this database recorded what an administrator did.
 * Each table kept at most the LATEST actor on a column, and some actions erase
 * even that — `set_deal_status` deliberately nulls `approved_by`/`approved_at`,
 * and `admin_delete_deal` destroys the row. After one click there was no record
 * anywhere that a deal was ever approved, by whom, or who took it down.
 *
 * The tests that matter here are the ones about what the log REFUSES to lose:
 * the actor it cannot blank, the entry nobody can edit, and the before-image of
 * a row that no longer exists.
 */

type Entry = {
  id: number;
  actor: string;
  actor_email: string | null;
  action: string;
  subject_kind: string;
  subject_id: string | null;
  details: Record<string, unknown>;
  is_me: boolean;
};

async function setup() {
  const w = await world();
  const moderator = await createUser(w.db, "moderator@example.test");
  await w.db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [moderator]);
  return { w, moderator };
}

/** The log, as an administrator reads it. */
const audit = async (w: World, who: string): Promise<Entry[]> =>
  (await asUser(w.db, who, () => w.db.query<Entry>("select * from public.admin_audit()"))).rows;

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

describe("what an administrator did is recorded", () => {
  it("names the person, not just the action", async () => {
    const { w, moderator } = await setup();
    const deal = await submit(w, w.visitor, w.ids.goldstar, w.ids.rami);
    await asUser(w.db, moderator, () => w.db.query("select public.approve_deal($1)", [deal]));

    const [entry] = await audit(w, moderator);
    expect(entry).toMatchObject({
      action: "deal.approve",
      subject_kind: "deal",
      subject_id: deal,
      actor: moderator,
      actor_email: "moderator@example.test",
      is_me: true,
    });
    // And who submitted it, which is what a moderator is actually judging.
    expect(entry.details.submitted_by).toBe(w.visitor);
  });

  it("keeps who approved a deal AFTER the removal erases it from the deal", async () => {
    const { w, moderator } = await setup();
    const deal = await submit(w, w.visitor, w.ids.goldstar, w.ids.rami);
    await asUser(w.db, moderator, () => w.db.query("select public.approve_deal($1)", [deal]));
    await asUser(w.db, moderator, () => w.db.query("select public.set_deal_status($1, 'inactive')", [deal]));

    // The deal itself no longer says it was ever approved. That is correct (0025)
    // and it is exactly why the log has to.
    const [row] = (await w.db.query<{ approved_by: string | null }>(
      "select approved_by from public.deals where id = $1",
      [deal],
    )).rows;
    expect(row.approved_by).toBeNull();

    const entries = await audit(w, moderator);
    const removal = entries.find((e) => e.action === "deal.remove")!;
    expect(removal.details.was_approved_by).toBe(moderator);
    expect(removal.details.was_approved_at).toBeTruthy();
    expect(removal.details.from_status).toBe("approved");
  });

  it("tells rejecting a submission apart from taking a live deal down", async () => {
    const { w, moderator } = await setup();
    const deal = await submit(w, w.visitor, w.ids.goldstar, w.ids.rami);
    await asUser(w.db, moderator, () => w.db.query("select public.set_deal_status($1, 'rejected')", [deal]));

    expect((await audit(w, moderator)).map((e) => e.action)).toEqual(["deal.reject"]);
  });

  it("keeps the whole deal when a super admin destroys the row", async () => {
    const { w } = await setup();
    const deal = await submit(w, w.visitor, w.ids.goldstar, w.ids.rami);
    await asUser(w.db, w.admin, () => w.db.query("select public.admin_delete_deal($1)", [deal]));

    expect((await w.db.query("select 1 from public.deals where id = $1", [deal])).rows).toHaveLength(0);

    const [entry] = await audit(w, w.admin);
    expect(entry.action).toBe("deal.delete");
    // Enough to put it back by hand, which is the only reason to record a deletion.
    expect(entry.details).toMatchObject({
      beer_id: w.ids.goldstar,
      store_id: w.ids.rami,
      category: "sixpack",
      deal_price_agorot: 2490,
      regular_price_agorot: 3990,
      submitted_by: w.visitor,
    });
  });

  it("records only what an edit actually changed", async () => {
    const { w, moderator } = await setup();
    const deal = await submit(w, w.visitor, w.ids.goldstar, w.ids.rami);
    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_update_deal($1, $2, $3, 'sixpack', 1990, 3990, null)", [
        deal,
        w.ids.goldstar,
        w.ids.rami,
      ]),
    );

    const [entry] = await audit(w, moderator);
    expect(entry.action).toBe("deal.edit");
    expect(entry.details).toEqual({ deal_price_agorot: [2490, 1990] });
  });

  it("records the most consequential action of all: who was made an admin", async () => {
    const { w } = await setup();
    const newcomer = await createUser(w.db, "newcomer@example.test");

    await asUser(w.db, w.admin, () => w.db.query("select public.grant_admin('newcomer@example.test', 'admin')"));
    await asUser(w.db, w.admin, () => w.db.query("select public.grant_admin('newcomer@example.test', 'super_admin')"));
    await asUser(w.db, w.admin, () => w.db.query("select public.revoke_admin($1)", [newcomer]));

    const entries = await audit(w, w.admin);
    expect(entries.map((e) => e.action)).toEqual(["admin.revoke", "admin.change_level", "admin.grant"]);
    expect(entries[1].details).toMatchObject({ from_level: "admin", to_level: "super_admin" });
    expect(entries[2].details).toMatchObject({ email: "newcomer@example.test", to_level: "admin" });
    // Revoked, and the log still says what they had. The admins row is gone.
    expect(entries[0].details).toMatchObject({ from_level: "super_admin" });
    expect((await w.db.query("select 1 from public.admins where user_id = $1", [newcomer])).rows).toHaveLength(0);
  });

  it("records a change to the six numbers that decide whose phone rings", async () => {
    const { w } = await setup();
    await asUser(w.db, w.admin, () =>
      w.db.query("select public.update_notification_rules(40, 3000, 12, 2, 22, 8)"),
    );

    const [entry] = await audit(w, w.admin);
    expect(entry.action).toBe("settings.notifications");
    expect(entry.subject_kind).toBe("settings");
    // Only what moved; the defaults that stayed put are absent rather than echoed.
    expect(Object.keys(entry.details).length).toBeGreaterThan(0);
    for (const value of Object.values(entry.details)) {
      expect(Array.isArray(value), `${JSON.stringify(value)} is not a before/after pair`).toBe(true);
    }
  });

  it("records the weekly pick, including taking it away", async () => {
    const { w, moderator } = await setup();
    const deal = await submit(w, w.visitor, w.ids.goldstar, w.ids.rami);
    await asUser(w.db, moderator, () => w.db.query("select public.approve_deal($1)", [deal]));
    await asUser(w.db, moderator, () => w.db.query("select public.set_weekly_deal($1)", [deal]));
    await asUser(w.db, moderator, () => w.db.query("select public.set_weekly_deal(null)"));

    const entries = await audit(w, moderator);
    expect(entries.map((e) => e.action).slice(0, 2)).toEqual(["weekly.clear", "weekly.set"]);
    expect(entries[0].details).toMatchObject({ from_deal_id: deal, to_deal_id: null });
  });

  it("records a deal an admin typed in, and whether they asked it to ring phones", async () => {
    const { w, moderator } = await setup();
    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_add_deal($1, $2, 'sixpack', 2490, 3990, null, true)", [
        w.ids.goldstar,
        w.ids.rami,
      ]),
    );

    const [entry] = await audit(w, moderator);
    expect(entry.action).toBe("deal.add");
    expect(entry.details).toMatchObject({ notify: true, deal_price_agorot: 2490 });
  });
});

describe("an action that did not happen leaves no trace", () => {
  it("writes nothing when the action raises", async () => {
    const { w, moderator } = await setup();
    const deal = await submit(w, w.visitor, w.ids.goldstar, w.ids.rami);
    await asUser(w.db, moderator, () => w.db.query("select public.approve_deal($1)", [deal]));

    // A second deal on the same shelf cannot be approved (0005).
    const clash = await submit(w, w.visitor, w.ids.goldstar, w.ids.rami);
    await expect(
      asUser(w.db, moderator, () => w.db.query("select public.approve_deal($1)", [clash])),
    ).rejects.toThrow();

    // One entry, for the approval that happened.
    const entries = await audit(w, moderator);
    expect(entries).toHaveLength(1);
    expect(entries[0].subject_id).toBe(deal);
  });

  it("writes nothing when a non-admin tries", async () => {
    const { w } = await setup();
    const deal = await submit(w, w.visitor, w.ids.goldstar, w.ids.rami);
    await expect(
      asUser(w.db, w.visitor, () => w.db.query("select public.approve_deal($1)", [deal])),
    ).rejects.toThrow(/admin privileges required/);
    expect((await w.db.query("select 1 from public.admin_actions")).rows).toHaveLength(0);
  });
});

describe("the log cannot be rewritten by the people it is about", () => {
  it("refuses an update, even from a super admin", async () => {
    const { w } = await setup();
    const deal = await submit(w, w.visitor, w.ids.goldstar, w.ids.rami);
    await asUser(w.db, w.admin, () => w.db.query("select public.approve_deal($1)", [deal]));

    await expect(
      w.db.query("update public.admin_actions set actor_email = 'somebody.else@example.test'"),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses a delete", async () => {
    const { w } = await setup();
    const deal = await submit(w, w.visitor, w.ids.goldstar, w.ids.rami);
    await asUser(w.db, w.admin, () => w.db.query("select public.approve_deal($1)", [deal]));

    await expect(w.db.query("delete from public.admin_actions")).rejects.toThrow(/append-only/);
    expect((await w.db.query("select 1 from public.admin_actions")).rows).toHaveLength(1);
  });

  it("has no write grant for anybody to use directly", async () => {
    const { w, moderator } = await setup();
    await expect(
      asUser(w.db, moderator, () =>
        w.db.query(
          "insert into public.admin_actions (actor, action, subject_kind) values ($1, 'deal.approve', 'deal')",
          [moderator],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("is not readable by somebody who is not an administrator", async () => {
    const { w } = await setup();
    await expect(
      asUser(w.db, w.visitor, () => w.db.query("select public.admin_audit()")),
    ).rejects.toThrow(/admin privileges required/);
    await expect(
      asUser(w.db, w.visitor, () => w.db.query("select 1 from public.admin_actions"), "anon"),
    ).rejects.toThrow(/permission denied/);
  });
});
