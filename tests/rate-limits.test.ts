import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";

/**
 * What a stranger can write before the database says no (migration 0033, M-2).
 *
 * The finding: every visitor gets an anonymous session automatically, and
 * `deals_submit` (0003) checks that a submission is theirs and pending — not how
 * many. A loop over the PostgREST endpoint could put ten thousand rows in front
 * of the moderators and make the queue useless, without a server action anywhere
 * in the path. So the limits are in Postgres, where they cover the direct insert
 * too, and they count the rows themselves rather than a separate ledger that
 * could drift from them.
 *
 * These tests go through the same door the attack would: a plain INSERT under
 * RLS, not the server action.
 */

const HOUR = 60 * 60 * 1000;

/** A submission the way the app and a script both make one: a direct insert. */
const submit = (w: World, who: string, store: string, category = "sixpack") =>
  asUser(w.db, who, () =>
    w.db.query(
      `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by)
       values ($1, $2, $3::public.deal_category, 2490, 3990, 'pending', $4)`,
      [w.ids.goldstar, store, category, who],
    ),
  );

/** Backdates somebody's submissions, so a window can be tested without waiting. */
const backdate = (w: World, who: string, ms: number) =>
  w.db.query("update public.deals set created_at = created_at - $2::interval where created_by = $1", [
    who,
    `${Math.round(ms / 1000)} seconds`,
  ]);

describe("the moderation queue cannot be flooded from one session", () => {
  it("takes eight submissions in an hour and refuses the ninth", async () => {
    const w = await world();
    for (let i = 0; i < 8; i++) await submit(w, w.visitor, w.ids.rami, i % 2 ? "sixpack" : "case");

    await expect(submit(w, w.visitor, w.ids.shufersal)).rejects.toThrow(/בזמן קצר/);
    expect((await w.db.query("select 1 from public.deals")).rows).toHaveLength(8);
  });

  it("lets them carry on once the hour has passed", async () => {
    const w = await world();
    for (let i = 0; i < 8; i++) await submit(w, w.visitor, w.ids.rami, i % 2 ? "sixpack" : "case");
    await backdate(w, w.visitor, 2 * HOUR);

    await expect(submit(w, w.visitor, w.ids.shufersal)).resolves.toBeTruthy();
  });

  it("counts the rejected ones too — being rejected is not a reset", async () => {
    const w = await world();
    const moderator = await createUser(w.db, "mod@example.test");
    await w.db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [moderator]);

    for (let i = 0; i < 8; i++) await submit(w, w.visitor, w.ids.rami, i % 2 ? "sixpack" : "case");
    await asUser(w.db, moderator, () =>
      w.db.query("update public.deals set status = 'rejected' where created_by = $1", [w.visitor]),
    );

    await expect(submit(w, w.visitor, w.ids.shufersal)).rejects.toThrow(/בזמן קצר/);
  });

  it("holds a day's worth as well, so the hour cannot just be waited out", async () => {
    const w = await world();
    // Twenty-five across the day, spread so no single hour trips first.
    for (let hour = 0; hour < 5; hour++) {
      for (let i = 0; i < 5; i++) await submit(w, w.visitor, w.ids.rami, i % 2 ? "sixpack" : "case");
      await backdate(w, w.visitor, HOUR);
    }
    expect((await w.db.query("select 1 from public.deals")).rows).toHaveLength(25);

    await expect(submit(w, w.visitor, w.ids.shufersal)).rejects.toThrow(/ביום/);
  });

  it("is one quota per person, not one for everybody", async () => {
    const w = await world();
    const other = await createUser(w.db, "other@example.test");
    for (let i = 0; i < 8; i++) await submit(w, w.visitor, w.ids.rami, i % 2 ? "sixpack" : "case");

    await expect(submit(w, other, w.ids.shufersal)).resolves.toBeTruthy();
  });

  it("does not stand in a moderator's way", async () => {
    const w = await world();
    const moderator = await createUser(w.db, "mod@example.test");
    await w.db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [moderator]);

    // Nine deals typed in by hand, on nine different shelves. An administrator
    // vouching for a deal is not a stranger filling a queue.
    const { rows: stores } = await w.db.query<{ id: string }>("select id from public.stores limit 9");
    for (const store of stores) {
      await asUser(w.db, moderator, () =>
        w.db.query("select public.admin_add_deal($1, $2, 'sixpack', 2490, 3990)", [w.ids.goldstar, store.id]),
      );
    }
    expect((await w.db.query("select 1 from public.deals")).rows).toHaveLength(9);
  });

  it("refuses with a limit, not with 'you have no permission'", async () => {
    const w = await world();
    for (let i = 0; i < 8; i++) await submit(w, w.visitor, w.ids.rami, i % 2 ? "sixpack" : "case");

    // 54000 is program_limit_exceeded. 42501 would become "you have no permission
    // for this" in the UI (src/lib/actions/result.ts), which would be a lie told to
    // somebody who simply found four deals tonight.
    await expect(submit(w, w.visitor, w.ids.shufersal)).rejects.toMatchObject({ code: "54000" });
  });
});

describe("feedback is bounded without punishing the useful person", () => {
  const report = (w: World, who: string, key: string) =>
    asUser(w.db, who, () => w.db.query("select public.report_offer($1, 'still_there')", [key]));

  it("takes a whole aisle's worth before it says anything", async () => {
    const w = await world();
    for (let i = 0; i < 59; i++) await report(w, w.visitor, `obs:${i}`);
    await expect(report(w, w.visitor, "obs:59")).resolves.toBeTruthy();
  });

  it("stops a script at sixty an hour", async () => {
    const w = await world();
    for (let i = 0; i < 60; i++) await report(w, w.visitor, `obs:${i}`);
    await expect(report(w, w.visitor, "obs:60")).rejects.toThrow(/דיווחים/);
  });

  it("still lets somebody change their mind at the limit", async () => {
    const w = await world();
    for (let i = 0; i < 60; i++) await report(w, w.visitor, `obs:${i}`);
    await w.db.query(
      "update public.offer_feedback set created_at = created_at - interval '2 hours' where reported_by = $1",
      [w.visitor],
    );
    // A revision is a write like any other, and it counts once rather than twice.
    await expect(
      asUser(w.db, w.visitor, () => w.db.query("select public.report_offer('obs:1', 'ended')")),
    ).resolves.toBeTruthy();
    expect((await w.db.query("select 1 from public.offer_feedback")).rows).toHaveLength(60);
  });
});

describe("the public name is not a billboard", () => {
  const rename = (w: World, who: string, name: string | null) =>
    asUser(w.db, who, () => w.db.query("select public.set_display_name($1)", [name]));

  it("allows ten changes an hour", async () => {
    const w = await world();
    for (let i = 0; i < 10; i++) await rename(w, w.visitor, `שם ${i}`);
    await expect(rename(w, w.visitor, "שם אחד עשר")).rejects.toThrow(/השם/);
  });

  it("counts clearing it as a change, which is the obvious way round the limit", async () => {
    const w = await world();
    for (let i = 0; i < 5; i++) {
      await rename(w, w.visitor, `שם ${i}`);
      await rename(w, w.visitor, null);
    }
    await expect(rename(w, w.visitor, "עוד אחד")).rejects.toThrow(/השם/);
  });

  it("leaves a first name alone", async () => {
    const w = await world();
    await expect(rename(w, w.visitor, "יוני")).resolves.toBeTruthy();
    const { rows } = await w.db.query<{ display_name: string }>("select display_name from public.contributors");
    expect(rows).toEqual([{ display_name: "יוני" }]);
  });
});
