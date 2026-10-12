import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";

/**
 * Four roles (migration 0040): User, Moderator, Admin, Owner.
 *
 * The separation is the point: reviewing prices is the job you hand to somebody
 * else, and managing beers and granting privileges is the job you do not.
 *
 * `is_admin()` was TIGHTENED rather than widened — it means admin-or-owner now,
 * and a moderator is not one — so every policy and every `require_admin()` that
 * already existed closed to moderators by default, and 0040 re-opened the ones
 * the job needs by name. This file walks every door for each role, because the
 * mistake you cannot recover from is a new role silently inheriting a permission
 * nobody listed.
 */

async function at(w: World, level: "moderator" | "admin" | "super_admin", label: string) {
  const id = await createUser(w.db, `${label}@example.test`);
  await w.db.query("insert into public.admins (user_id, level) values ($1, $2::public.admin_level)", [id, level]);
  return id;
}

/** A pending submission from an ordinary person. */
async function submitted(w: World, store?: string) {
  const { rows } = await asUser(w.db, w.visitor, () =>
    w.db.query<{ id: string }>(
      `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by)
       values ($1, $2, 'sixpack', 2490, 3990, 'pending', $3) returning id`,
      [w.ids.goldstar, store ?? w.ids.rami, w.visitor],
    ),
  );
  return rows[0].id;
}

const can = async (w: World, who: string, sql: string) => {
  await expect(asUser(w.db, who, () => w.db.query(sql)), sql).resolves.toBeTruthy();
};
const cannot = async (w: World, who: string, sql: string, why = /privileges required/) => {
  await expect(asUser(w.db, who, () => w.db.query(sql)), sql).rejects.toThrow(why);
};

describe("a moderator reviews deals, and does nothing else", () => {
  it("can approve, reject and close a report", async () => {
    const w = await world();
    const mod = await at(w, "moderator", "mod");

    const one = await submitted(w);
    await can(w, mod, `select public.approve_deal('${one}')`);
    const two = await submitted(w, w.ids.shufersal);
    await can(w, mod, `select public.set_deal_status('${two}', 'rejected')`);

    const { rows } = await asUser(w.db, w.visitor, () =>
      w.db.query<{ id: string }>(
        "insert into public.deal_reports (deal_id, reported_by, reason) values ($1, $2, 'לא קיים') returning id",
        [one, w.visitor],
      ),
    );
    await can(w, mod, `select public.resolve_report('${rows[0].id}', 'resolved')`);
  });

  it("can see the queue, the reports and the audit log", async () => {
    const w = await world();
    const mod = await at(w, "moderator", "mod");
    await submitted(w);

    const queue = await asUser(w.db, mod, () => w.db.query("select id from public.deals where status = 'pending'"));
    expect(queue.rows).toHaveLength(1);
    await can(w, mod, "select public.admin_submitters()");
    await can(w, mod, "select public.admin_offer_feedback()");
    // Their own actions are in it, so they can read it. A log only the most
    // powerful person can see is not accountability, it is a privilege.
    await can(w, mod, "select public.admin_audit()");
  });

  it("cannot manage the catalogue", async () => {
    const w = await world();
    const mod = await at(w, "moderator", "mod");

    await cannot(w, mod, "select public.admin_beers()");
    await cannot(w, mod, "select public.admin_coverage()");
    await cannot(w, mod, `select public.admin_set_beer_active('${w.ids.goldstar}', false)`);
    await cannot(w, mod, `select public.admin_update_beer('${w.ids.goldstar}', 'x', 'x', 'beer', 1)`);
    // And not through the table either: beers_admin_update still asks is_admin().
    // RLS on an UPDATE filters the rows rather than raising, so the honest
    // assertion is the outcome — nothing matched, and nothing changed. That is the
    // stronger property anyway: an error can be caught, a no-op cannot be undone.
    const before = (
      await w.db.query<{ sort_order: number }>("select sort_order from public.beers where id = $1", [w.ids.goldstar])
    ).rows[0].sort_order;
    await asUser(w.db, mod, () =>
      w.db.query("update public.beers set sort_order = 99 where id = $1", [w.ids.goldstar]),
    );
    const after = (
      await w.db.query<{ sort_order: number }>("select sort_order from public.beers where id = $1", [w.ids.goldstar])
    ).rows[0].sort_order;
    expect(after).toBe(before);
  });

  it("cannot choose the weekly deal, read the dashboard, or hand out privileges", async () => {
    const w = await world();
    const mod = await at(w, "moderator", "mod");
    const deal = await submitted(w);
    await asUser(w.db, mod, () => w.db.query("select public.approve_deal($1)", [deal]));

    await cannot(w, mod, `select public.set_weekly_deal('${deal}')`);
    await cannot(w, mod, "select public.admin_overview()");
    await cannot(w, mod, "select public.grant_admin('x@example.test', 'admin')", /super admin/);
    await cannot(w, mod, `select public.admin_delete_deal('${deal}')`, /super admin/);
    await cannot(w, mod, "select public.update_notification_rules(40, 3000, 12, 2, 22, 8)", /super admin/);
  });

  it("cannot block somebody at their own level or above", async () => {
    const w = await world();
    const mod = await at(w, "moderator", "mod");
    const other = await at(w, "moderator", "mod2");
    const admin = await at(w, "admin", "adm");

    await cannot(w, mod, `select public.admin_block_submitter('${other}', 'סיבה כלשהי')`, /דרגה שלכם או מעליה/);
    await cannot(w, mod, `select public.admin_block_submitter('${admin}', 'סיבה כלשהי')`, /דרגה שלכם או מעליה/);
    // An ordinary person they can.
    await can(w, mod, `select public.admin_block_submitter('${w.visitor}', 'מחירים שלא קיימים')`);
  });
});

describe("an admin manages, and still cannot hand out privileges", () => {
  it("can do everything a moderator can, and the catalogue too", async () => {
    const w = await world();
    const admin = await at(w, "admin", "adm");
    const deal = await submitted(w);

    await can(w, admin, `select public.approve_deal('${deal}')`);
    await can(w, admin, "select public.admin_beers()");
    await can(w, admin, "select public.admin_coverage()");
    await can(w, admin, "select public.admin_overview()");
    await can(w, admin, `select public.set_weekly_deal('${deal}')`);
  });

  it("cannot grant, revoke, delete or change the notification rules", async () => {
    const w = await world();
    const admin = await at(w, "admin", "adm");
    const deal = await submitted(w);
    await asUser(w.db, admin, () => w.db.query("select public.approve_deal($1)", [deal]));

    await cannot(w, admin, "select public.grant_admin('x@example.test', 'moderator')", /super admin/);
    await cannot(w, admin, `select public.revoke_admin('${admin}')`, /super admin/);
    await cannot(w, admin, `select public.admin_delete_deal('${deal}')`, /super admin/);
    await cannot(w, admin, "select public.update_notification_rules(40, 3000, 12, 2, 22, 8)", /super admin/);
  });

  it("can block a moderator, because they out-rank one", async () => {
    const w = await world();
    const admin = await at(w, "admin", "adm");
    const mod = await at(w, "moderator", "mod");
    await can(w, admin, `select public.admin_block_submitter('${mod}', 'סיבה כלשהי')`);
  });
});

describe("the owner is the only one who hands out privileges", () => {
  it("can make somebody a moderator", async () => {
    const w = await world();
    await createUser(w.db, "newcomer@example.test");
    await can(w, w.admin, "select public.grant_admin('newcomer@example.test', 'moderator')");

    const { rows } = await w.db.query<{ level: string }>(
      "select level::text from public.admins a join auth.users u on u.id = a.user_id where u.email = 'newcomer@example.test'",
    );
    expect(rows[0].level).toBe("moderator");
  });

  it("cannot be blocked by anybody", async () => {
    const w = await world();
    const admin = await at(w, "admin", "adm");
    await cannot(w, admin, `select public.admin_block_submitter('${w.admin}', 'סיבה כלשהי')`, /דרגה שלכם או מעליה/);
  });
});

describe("an ordinary person has none of it", () => {
  it("is refused at every door, including the moderation ones", async () => {
    const w = await world();
    const deal = await submitted(w);

    for (const call of [
      `select public.approve_deal('${deal}')`,
      `select public.set_deal_status('${deal}', 'rejected')`,
      "select public.admin_submitters()",
      "select public.admin_audit()",
      "select public.admin_offer_feedback()",
    ]) {
      await cannot(w, w.visitor, call, /moderator privileges required/);
    }
    await cannot(w, w.visitor, "select public.admin_beers()", /admin privileges required/);
  });

  it("still sees only their own submission in the queue", async () => {
    const w = await world();
    await submitted(w);
    const other = await createUser(w.db, "other@example.test");
    const theirs = await asUser(w.db, other, () =>
      w.db.query("select id from public.deals where status = 'pending'"),
    );
    expect(theirs.rows).toEqual([]);
  });
});
