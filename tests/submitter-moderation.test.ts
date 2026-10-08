import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";

/**
 * Moderating the people who submit (migration 0035).
 *
 * The constraint this lives inside: "Admins are deliberately NOT given read access
 * to every profile. Moderating deals does not require knowing who else uses the
 * app" (0003). So this is NOT a people directory. The tests below care as much
 * about what the screen cannot learn as about what the block does.
 */

type Submitter = {
  user_id: string;
  display_name: string | null;
  approved: number;
  rejected: number;
  pending: number;
  is_blocked: boolean;
  block_reason: string | null;
};

async function setup() {
  const w = await world();
  const moderator = await createUser(w.db, "moderator@example.test");
  await w.db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [moderator]);
  return { w, moderator };
}

const submitters = async (w: World, who: string): Promise<Submitter[]> =>
  (await asUser(w.db, who, () => w.db.query<Submitter>("select * from public.admin_submitters()"))).rows;

/**
 * A submission through the door the app and a script both use.
 *
 * Always inserted as `pending`, because that is the only thing `deals_submit`
 * (0003) permits — a crafted insert asking for 'approved' is refused by the
 * database, which is the point of that policy. A moderated outcome is then set
 * the way a moderator sets it.
 */
async function submit(w: World, who: string, store: string, status = "pending", category = "sixpack") {
  const { rows } = await asUser(w.db, who, () =>
    w.db.query<{ id: string }>(
      `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by)
       values ($1, $2, $3::public.deal_category, 2490, 3990, 'pending', $4) returning id`,
      [w.ids.goldstar, store, category, who],
    ),
  );
  if (status !== "pending") {
    // An approved deal has to say who stands behind it (deals_approved_is_attributed).
    await w.db.query(
      `update public.deals
          set status = $2::public.deal_status,
              approved_by = case when $2 = 'approved' then $3::uuid end,
              approved_at = case when $2 = 'approved' then now() end
        where id = $1`,
      [rows[0].id, status, w.admin],
    );
  }
  return rows[0].id;
}

describe("the block stops new submissions and nothing else", () => {
  it("refuses a submission from a blocked account, through the direct insert", async () => {
    const { w, moderator } = await setup();
    await submit(w, w.visitor, w.ids.rami);

    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_block_submitter($1, 'שלח חמישה מחירים שלא קיימים')", [w.visitor]),
    );

    // The same door the app and a script both use.
    await expect(submit(w, w.visitor, w.ids.shufersal)).rejects.toThrow(/לא יכול לשלוח מבצעים חדשים/);

    // P0001, not 42501: describeDbError replaces a 42501 message with the fixed
    // "you have no permission for this", which would throw away the one sentence
    // this person needs. src/lib/actions/result.ts records the convention.
    await expect(submit(w, w.visitor, w.ids.victory)).rejects.toMatchObject({ code: "P0001" });
  });

  it("leaves everything else about the account untouched", async () => {
    const { w, moderator } = await setup();
    await w.db.query("insert into public.profiles (id, first_name) values ($1, 'דנה') on conflict (id) do update set first_name = 'דנה'", [w.visitor]);
    await w.db.query("insert into public.user_favorite_beers (profile_id, beer_id, rank) values ($1, $2, 1)", [
      w.visitor,
      w.ids.goldstar,
    ]);
    await asUser(w.db, w.visitor, () => w.db.query("select public.set_display_name('דנה')"));
    await submit(w, w.visitor, w.ids.rami, "approved");

    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_block_submitter($1, 'מחירים שלא קיימים')", [w.visitor]),
    );

    // Favourites, their public name, and the credit for what was already approved.
    expect(
      (await w.db.query("select 1 from public.user_favorite_beers where profile_id = $1", [w.visitor])).rows,
    ).toHaveLength(1);
    const { rows } = await w.db.query<{ display_name: string; approved: number }>(
      "select display_name, approved from public.contributors where profile_id = $1",
      [w.visitor],
    );
    expect(rows).toEqual([{ display_name: "דנה", approved: 1 }]);
  });

  it("lifts, and the person can submit again", async () => {
    const { w, moderator } = await setup();
    await submit(w, w.visitor, w.ids.rami);
    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_block_submitter($1, 'מחירים שלא קיימים')", [w.visitor]),
    );
    await asUser(w.db, moderator, () => w.db.query("select public.admin_unblock_submitter($1)", [w.visitor]));

    await expect(submit(w, w.visitor, w.ids.shufersal)).resolves.toBeTruthy();
  });

  it("does not stand in an admin's way", async () => {
    const { w, moderator } = await setup();
    // A moderator's own hand-entered deal is exempt from the submission path entirely.
    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_add_deal($1, $2, 'sixpack', 2490, 3990)", [w.ids.goldstar, w.ids.rami]),
    );
    expect((await w.db.query("select 1 from public.deals")).rows).toHaveLength(1);
  });
});

describe("a block is a judgement, so it is explained and recorded", () => {
  it("refuses a block with no reason", async () => {
    const { w, moderator } = await setup();
    for (const reason of ["", "   ", "לא"]) {
      await expect(
        asUser(w.db, moderator, () => w.db.query("select public.admin_block_submitter($1, $2)", [w.visitor, reason])),
      ).rejects.toThrow(/צריך לכתוב למה/);
    }
  });

  it("records the reason AND the record that justified it", async () => {
    const { w, moderator } = await setup();
    await submit(w, w.visitor, w.ids.rami, "approved");
    await submit(w, w.visitor, w.ids.shufersal, "rejected");
    await submit(w, w.visitor, w.ids.victory, "rejected");

    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_block_submitter($1, 'שלושה מחירים שלא קיימים')", [w.visitor]),
    );

    const [entry] = (await asUser(w.db, moderator, () =>
      w.db.query<{ action: string; details: Record<string, unknown> }>(
        "select action, details from public.admin_audit()",
      ),
    )).rows;
    expect(entry.action).toBe("submitter.block");
    // Both halves: a block reviewed in six months needs the reason and the counts as
    // they stood, because the counts will have moved.
    expect(entry.details).toMatchObject({ reason: "שלושה מחירים שלא קיימים", approved: 1, rejected: 2 });
  });

  it("records lifting it too, with what the reason had been", async () => {
    const { w, moderator } = await setup();
    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_block_submitter($1, 'מחירים שלא קיימים')", [w.visitor]),
    );
    await asUser(w.db, moderator, () => w.db.query("select public.admin_unblock_submitter($1)", [w.visitor]));

    const [entry] = (await asUser(w.db, moderator, () =>
      w.db.query<{ action: string; details: Record<string, unknown> }>(
        "select action, details from public.admin_audit()",
      ),
    )).rows;
    expect(entry.action).toBe("submitter.unblock");
    expect(entry.details).toMatchObject({ was_reason: "מחירים שלא קיימים" });
  });

  it("refuses blocking yourself, and blocking another admin", async () => {
    const { w, moderator } = await setup();
    await expect(
      asUser(w.db, moderator, () => w.db.query("select public.admin_block_submitter($1, 'סיבה כלשהי')", [moderator])),
    ).rejects.toThrow(/את עצמכם/);
    await expect(
      asUser(w.db, moderator, () => w.db.query("select public.admin_block_submitter($1, 'סיבה כלשהי')", [w.admin])),
    ).rejects.toThrow(/אי אפשר לחסום מנהל/);
  });

  it("refuses lifting a block that is not there", async () => {
    const { w, moderator } = await setup();
    await expect(
      asUser(w.db, moderator, () => w.db.query("select public.admin_unblock_submitter($1)", [w.visitor])),
    ).rejects.toThrow(/לא חסום/);
  });
});

describe("it is not a directory of people", () => {
  it("shows only what they published and what they sent us", async () => {
    const { w, moderator } = await setup();
    await w.db.query(
      "insert into public.profiles (id, first_name, home_city) values ($1, 'דנה', 'חיפה') on conflict (id) do update set first_name = 'דנה', home_city = 'חיפה'",
      [w.visitor],
    );
    await submit(w, w.visitor, w.ids.rami, "approved");
    await submit(w, w.visitor, w.ids.shufersal, "rejected");
    await submit(w, w.visitor, w.ids.victory, "pending");

    const [row] = await submitters(w, moderator);
    expect(row).toMatchObject({ user_id: w.visitor, approved: 1, rejected: 1, pending: 1 });
    // They never chose a public name, so the row says nothing about who they are --
    // not their first name, which is private, and not "anonymous".
    expect(row.display_name).toBeNull();
    // And the row carries no private field at all.
    for (const forbidden of ["first_name", "home_city", "email", "home_lat"]) {
      expect(Object.keys(row), forbidden).not.toContain(forbidden);
    }
  });

  it("shows the name somebody DID choose, because they published it", async () => {
    const { w, moderator } = await setup();
    await submit(w, w.visitor, w.ids.rami, "approved");
    await asUser(w.db, w.visitor, () => w.db.query("select public.set_display_name('יוני')"));

    const [row] = await submitters(w, moderator);
    expect(row.display_name).toBe("יוני");
  });

  it("leaves out people who never submitted anything", async () => {
    const { w, moderator } = await setup();
    await createUser(w.db, "lurker@example.test");
    expect(await submitters(w, moderator)).toEqual([]);
  });

  it("puts the blocked and the most-rejected first", async () => {
    const { w, moderator } = await setup();
    const careless = await createUser(w.db, "careless@example.test");
    const careful = await createUser(w.db, "careful@example.test");
    await submit(w, careful, w.ids.rami, "approved");
    await submit(w, careless, w.ids.shufersal, "rejected");
    await submit(w, careless, w.ids.victory, "rejected");

    expect((await submitters(w, moderator)).map((r) => r.user_id)).toEqual([careless, careful]);
  });

  it("is reachable by nobody who is not an admin", async () => {
    const { w } = await setup();
    for (const call of [
      "select public.admin_submitters()",
      `select public.admin_block_submitter('${w.visitor}', 'סיבה כלשהי')`,
      `select public.admin_unblock_submitter('${w.visitor}')`,
    ]) {
      await expect(asUser(w.db, w.visitor, () => w.db.query(call)), call).rejects.toThrow(
        /admin privileges required/,
      );
    }
    // And the table itself is closed to everybody, admins included.
    await expect(
      asUser(w.db, w.visitor, () => w.db.query("select 1 from public.submission_blocks")),
    ).rejects.toThrow(/permission denied/);
  });
});
