import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world } from "./helpers/catalog";

/**
 * Deleting your own account from inside the app (migration 0070) — required by both app stores of
 * any app that creates an account, and this one creates one for every visitor.
 */
describe("a person deletes their account", () => {
  it("removes them and everything about them; an approved deal they sent stays, without their name", async () => {
    const w = await world();
    const me = await createUser(w.db);
    await w.db.query("update public.profiles set first_name = 'דנה', home_city = 'חיפה' where id = $1", [me]);
    await asUser(w.db, me, () => w.db.query("select public.watch_beer($1, 2500)", [w.ids.goldstar]));
    const deal = (
      await w.db.query<{ id: string }>(
        `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by, approved_by, approved_at)
         values ($1, $2, 'sixpack', 2490, 3990, 'approved', $3, $4, now()) returning id`,
        [w.ids.goldstar, w.ids.rami, me, w.admin],
      )
    ).rows[0].id;

    await asUser(w.db, me, () => w.db.query("select public.delete_my_account()"));

    const count = async (sql: string) => Number((await w.db.query<{ n: number }>(sql, [me])).rows[0].n);
    expect(await count("select count(*)::int as n from auth.users where id = $1")).toBe(0);
    expect(await count("select count(*)::int as n from public.profiles where id = $1")).toBe(0);
    expect(await count("select count(*)::int as n from public.watchlist where profile_id = $1")).toBe(0);
    const kept = (await w.db.query<{ created_by: string | null; status: string }>("select created_by, status from public.deals where id = $1", [deal])).rows[0];
    expect(kept).toEqual({ created_by: null, status: "approved" });
  });

  it("deletes only the caller: it takes no argument, and somebody else is untouched", async () => {
    const w = await world();
    const me = await createUser(w.db);
    const other = await createUser(w.db);
    await asUser(w.db, me, () => w.db.query("select public.delete_my_account()"));
    expect((await w.db.query("select 1 from auth.users where id = $1", [other])).rows).toHaveLength(1);
  });

  it("stays fast: every column that points at a person is indexed (0071)", async () => {
    // 0070 timed out in production on its first use: deleting a user visits every referencing row, and
    // price_observations.created_by (810 MB) had no index. A new unindexed link would bring that back.
    const w = await world();
    const { rows } = await w.db.query<{ link: string }>(
      `select c.conrelid::regclass::text || '.' || a.attname as link
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
          and c.conrelid::regclass::text like 'public.%'
          and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = a.attnum)
        order by 1`,
    );
    expect(rows.map((r) => r.link)).toEqual([]);
  });

  it("refuses a caller who is not signed in, and an administrator", async () => {
    const w = await world();
    await expect(asUser(w.db, null, () => w.db.query("select public.delete_my_account()"), "anon")).rejects.toThrow();
    await expect(asUser(w.db, w.admin, () => w.db.query("select public.delete_my_account()"))).rejects.toThrow(/administrator/);
    expect((await w.db.query("select 1 from auth.users where id = $1", [w.admin])).rows).toHaveLength(1);
  });
});
