import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";

/**
 * The admin functions of migration 0020, as the database enforces them — the /admin layout's redirect only
 * keeps non-admins out of the UI; these are what keep them out of the data.
 *
 *   admin_overview      any admin; numbers only
 *   admin_add_deal      any admin; approved and attributed; notification OFF unless asked for
 *   admin_delete_deal   super admin only; refused while a report on the deal is open
 */
async function setup() {
  const w = await world();
  const moderator = await createUser(w.db, "moderator@example.test");
  await w.db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [moderator]);
  return { w, moderator };
}

const addDeal = (w: World, who: string | null, notify?: boolean, role: "authenticated" | "anon" = "authenticated") =>
  asUser(
    w.db,
    who,
    () =>
      w.db.query<{ id: string; status: string; created_by: string; approved_by: string; notified_at: string | null }>(
        `select * from public.admin_add_deal($1, $2, 'sixpack', 2490, 3990, null${notify === undefined ? "" : ", $3"})`,
        notify === undefined ? [w.ids.goldstar, w.ids.rami] : [w.ids.goldstar, w.ids.rami, notify],
      ),
    role,
  );

describe("admin RPCs (0020)", () => {
  it("refuse anyone who is not an admin: a signed-in visitor and the anonymous public", async () => {
    const { w } = await setup();
    await expect(asUser(w.db, w.visitor, () => w.db.query("select public.admin_overview()"))).rejects.toThrow(/admin privileges required/);
    await expect(addDeal(w, w.visitor)).rejects.toThrow(/admin privileges required/);
    await expect(asUser(w.db, null, () => w.db.query("select public.admin_overview()"), "anon")).rejects.toThrow(/permission denied/);
    await expect(addDeal(w, null, undefined, "anon")).rejects.toThrow(/permission denied/);
    expect((await w.db.query("select count(*)::int n from public.deals")).rows[0]).toEqual({ n: 0 });
  });

  it("admin_overview answers an admin with counts, never rows", async () => {
    const { w, moderator } = await setup();
    const { rows } = await asUser(w.db, moderator, () => w.db.query<{ o: Record<string, unknown> }>("select public.admin_overview() as o"));
    expect(rows[0].o).toHaveProperty("reports");
    expect(JSON.stringify(rows[0].o)).not.toMatch(/@example\.test/);
  });

  it("a deal added by hand goes up approved, attributed to the admin, and rings no phone unless asked", async () => {
    const { w, moderator } = await setup();
    const quiet = (await addDeal(w, moderator)).rows[0];
    expect(quiet).toMatchObject({ status: "approved", created_by: moderator, approved_by: moderator });
    expect(quiet.notified_at).not.toBeNull(); // marked as already announced: the default is OFF

    await w.db.query("update public.deals set status = 'inactive' where id = $1", [quiet.id]);
    const loud = (await addDeal(w, moderator, true)).rows[0];
    expect(loud.notified_at).toBeNull(); // left for the notification pipeline
  });

  it("a deal added by hand faces the same checks: a real discount, and one approved deal per shelf", async () => {
    const { w, moderator } = await setup();
    await addDeal(w, moderator);
    await expect(addDeal(w, moderator)).rejects.toThrow(/כבר יש מבצע מאושר/);
    await expect(
      asUser(w.db, moderator, () => w.db.query("select public.admin_add_deal($1, $2, 'case', 5000, 4000)", [w.ids.maccabee, w.ids.rami])),
    ).rejects.toThrow(/deals_price_is_a_discount/);
  });

  it("deleting is for the super admin only, and is refused while a report on the deal is open", async () => {
    const { w, moderator } = await setup();
    const deal = (await addDeal(w, moderator)).rows[0];
    const del = (who: string) => asUser(w.db, who, () => w.db.query("select public.admin_delete_deal($1)", [deal.id]));

    await expect(del(w.visitor)).rejects.toThrow(/super admin privileges required/);
    await expect(del(moderator)).rejects.toThrow(/super admin privileges required/);

    const report = (
      await w.db.query<{ id: string }>("insert into public.deal_reports (deal_id, reported_by, reason) values ($1, $2, 'wrong price') returning id", [deal.id, w.visitor])
    ).rows[0];
    await expect(del(w.admin)).rejects.toThrow(/יש דיווח פתוח/);
    expect((await w.db.query("select count(*)::int n from public.deals")).rows[0]).toEqual({ n: 1 });

    await w.db.query("update public.deal_reports set status = 'resolved', resolved_by = $2, resolved_at = now() where id = $1", [report.id, w.admin]);
    await del(w.admin);
    expect((await w.db.query("select count(*)::int n from public.deals")).rows[0]).toEqual({ n: 0 });
  });
});
