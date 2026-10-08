import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";

/**
 * Trust (migration 0038): one ladder, and what it is explicitly NOT for.
 *
 * Most of this file is about the second half. A reputation number that can publish
 * a price is a reputation number that can be farmed into publishing a wrong one, so
 * the brief rules it out — and "we did not build that" is only worth something if it
 * is hard to build by accident later. These tests give somebody the highest standing
 * in the system and then try every door.
 */

/** Somebody with `points`, through the real path: a name, then the tally set. */
async function withScore(w: World, points: number, label: string) {
  const id = await createUser(w.db, `${label}@example.test`);
  await asUser(w.db, id, () => w.db.query("select public.set_display_name($1)", [label]));
  await w.db.query("update public.contributors set score = $2 where profile_id = $1", [id, points]);
  return id;
}

const trustOf = async (w: World, score: number) =>
  (await w.db.query<{ t: string }>("select public.contributor_trust($1) as t", [score])).rows[0].t;

const weightOf = async (w: World, score: number) =>
  (await w.db.query<{ n: number }>("select public.contributor_weight($1) as n", [score])).rows[0].n;

describe("one ladder", () => {
  it("names the three rungs, at their boundaries", async () => {
    const w = await world();
    expect(await trustOf(w, 0)).toBe("new");
    expect(await trustOf(w, 49)).toBe("new");
    expect(await trustOf(w, 50)).toBe("known");
    expect(await trustOf(w, 99)).toBe("known");
    expect(await trustOf(w, 100)).toBe("trusted");
    expect(await trustOf(w, 100000)).toBe("trusted");
  });

  it("caps the weight at three, whatever the score reaches", async () => {
    const w = await world();
    expect(await weightOf(w, 0)).toBe(1);
    expect(await weightOf(w, 50)).toBe(2);
    expect(await weightOf(w, 100)).toBe(3);
    // Three strangers still outweigh one expert. That is the design, not a limit of
    // the implementation.
    expect(await weightOf(w, 100000)).toBe(3);
  });

  it("treats a missing score as the bottom rung, not as an error", async () => {
    const w = await world();
    const { rows } = await w.db.query<{ t: string; n: number }>(
      "select public.contributor_trust(null) as t, public.contributor_weight(null) as n",
    );
    expect(rows[0]).toEqual({ t: "new", n: 1 });
  });

  it("is the SAME ladder the shelf tally uses", async () => {
    const w = await world();
    const trusted = await withScore(w, 100, "trusted-one");
    // One trusted voice weighs three, which is the threshold 'ended' needs — and is
    // exactly what offer_standings computes. If the two ladders ever drift, this
    // breaks before anybody notices in production.
    await asUser(w.db, trusted, () => w.db.query("select public.report_offer('obs:1', 'ended')"));
    const { rows } = await w.db.query<{ ended_weight: string }>(
      "select ended_weight from public.offer_standing('obs:1')",
    );
    expect(Number(rows[0].ended_weight)).toBe(await weightOf(w, 100));
  });
});

describe("trust is not a permission", () => {
  it("does not let the most trusted person in the system approve a deal", async () => {
    const w = await world();
    const trusted = await withScore(w, 100000, "trusted-one");
    const { rows } = await asUser(w.db, trusted, () =>
      w.db.query<{ id: string }>(
        `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by)
         values ($1, $2, 'sixpack', 2490, 3990, 'pending', $3) returning id`,
        [w.ids.goldstar, w.ids.rami, trusted],
      ),
    );

    for (const call of [
      `select public.approve_deal('${rows[0].id}')`,
      `select public.set_deal_status('${rows[0].id}', 'rejected')`,
      `select public.set_weekly_deal('${rows[0].id}')`,
      "select public.admin_overview()",
      "select public.admin_beers()",
      "select public.admin_audit()",
      `select public.admin_block_submitter('${w.visitor}', 'סיבה כלשהי')`,
    ]) {
      await expect(asUser(w.db, trusted, () => w.db.query(call)), call).rejects.toThrow(
        /admin privileges required/,
      );
    }
  });

  it("does not let them publish without moderation", async () => {
    const w = await world();
    const trusted = await withScore(w, 100000, "trusted-one");

    // The storage layer, not a server action: deals_submit (0003) pins every
    // submission to 'pending' whoever sends it.
    await expect(
      asUser(w.db, trusted, () =>
        w.db.query(
          `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by, approved_by, approved_at)
           values ($1, $2, 'sixpack', 2490, 3990, 'approved', $3, $3, now())`,
          [w.ids.goldstar, w.ids.rami, trusted],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not let them read one thing a stranger cannot", async () => {
    const w = await world();
    const trusted = await withScore(w, 100000, "trusted-one");
    const other = await createUser(w.db, "other@example.test");
    await w.db.query("insert into public.profiles (id, first_name) values ($1, 'דנה') on conflict (id) do update set first_name = 'דנה'", [other]);

    // Somebody else's profile, and the moderation queue.
    const profiles = await asUser(w.db, trusted, () =>
      w.db.query("select id from public.profiles where id = $1", [other]),
    );
    expect(profiles.rows).toEqual([]);
    const pending = await asUser(w.db, trusted, () =>
      w.db.query("select id from public.deals where status = 'pending'"),
    );
    // Their own, if any — never anybody else's.
    expect(pending.rows).toEqual([]);
  });

  it("does not exempt them from the submission limits", async () => {
    const w = await world();
    const trusted = await withScore(w, 100000, "trusted-one");
    const { rows: stores } = await w.db.query<{ id: string }>("select id from public.stores limit 9");

    for (const store of stores.slice(0, 8)) {
      await asUser(w.db, trusted, () =>
        w.db.query(
          `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by)
           values ($1, $2, 'sixpack', 2490, 3990, 'pending', $3)`,
          [w.ids.goldstar, store.id, trusted],
        ),
      );
    }
    // Eight an hour, for everybody (0033). Being trusted is not being exempt.
    await expect(
      asUser(w.db, trusted, () =>
        w.db.query(
          `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by)
           values ($1, $2, 'sixpack', 2490, 3990, 'pending', $3)`,
          [w.ids.goldstar, stores[8].id, trusted],
        ),
      ),
    ).rejects.toThrow(/בזמן קצר/);
  });

  it("can still be blocked from submitting, like anybody else", async () => {
    const w = await world();
    const trusted = await withScore(w, 100000, "trusted-one");
    const moderator = await createUser(w.db, "mod@example.test");
    await w.db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [moderator]);

    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_block_submitter($1, 'מחירים שלא קיימים, שוב ושוב')", [trusted]),
    );
    await expect(
      asUser(w.db, trusted, () =>
        w.db.query(
          `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by)
           values ($1, $2, 'sixpack', 2490, 3990, 'pending', $3)`,
          [w.ids.goldstar, w.ids.rami, trusted],
        ),
      ),
    ).rejects.toThrow(/לא יכול לשלוח מבצעים חדשים/);
  });
});

describe("a person can see their own standing", () => {
  it("tells them where they are on the ladder", async () => {
    const w = await world();
    const person = await withScore(w, 60, "dana");
    const { rows } = await asUser(w.db, person, () =>
      w.db.query<{ trust: string; score: number; display_name: string }>("select * from public.my_standing()"),
    );
    expect(rows[0]).toMatchObject({ display_name: "dana", score: 60, trust: "known" });
  });

  it("says nothing about somebody who has not chosen a name", async () => {
    const w = await world();
    // No contributors row until a person asks to be credited (0030), so there is no
    // standing to show — and inventing a 'new' row for them would be a label they
    // never asked for.
    const { rows } = await asUser(w.db, w.visitor, () => w.db.query("select * from public.my_standing()"));
    expect(rows).toEqual([]);
  });

  it("shows nobody else's", async () => {
    const w = await world();
    await withScore(w, 100, "somebody-else");
    const person = await withScore(w, 10, "me");
    const { rows } = await asUser(w.db, person, () =>
      w.db.query<{ display_name: string }>("select display_name from public.my_standing()"),
    );
    expect(rows.map((r) => r.display_name)).toEqual(["me"]);
  });

  it("refuses a caller with no session", async () => {
    const w = await world();
    await expect(
      asUser(w.db, null, () => w.db.query("select public.my_standing()"), "anon"),
    ).rejects.toThrow(/permission denied|not signed in/);
  });
});

describe("what a moderator can read about a submitter", () => {
  it("gives the word beside the score, and only to an admin", async () => {
    const w = await world();
    const moderator = await createUser(w.db, "mod@example.test");
    await w.db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [moderator]);
    const person = await withScore(w, 120, "yoni");

    const { rows } = await asUser(w.db, moderator, () =>
      w.db.query<{ trust: string; display_name: string }>("select * from public.admin_submitter_trust($1::uuid[])", [
        [person],
      ]),
    );
    expect(rows[0]).toMatchObject({ display_name: "yoni", trust: "trusted" });

    await expect(
      asUser(w.db, w.visitor, () => w.db.query("select public.admin_submitter_trust($1::uuid[])", [[person]])),
    ).rejects.toThrow(/admin privileges required/);
  });
});

/**
 * The ladder exists in two languages — SQL for the tally, TypeScript for the
 * moderation row — so it is asserted to be ONE ladder here rather than hoped to be.
 */
describe("the TypeScript ladder and the SQL ladder are the same ladder", () => {
  it("agrees at every boundary and either side of it", async () => {
    const w = await world();
    const { weightOf: weightInTs } = await import("@/lib/trust");
    const { trustOf } = await import("@/lib/trust");
    for (const score of [0, 1, 49, 50, 51, 99, 100, 101, 5000]) {
      expect(trustOf(score), `trust at ${score}`).toBe(await trustOf_sql(w, score));
      expect(weightInTs(score), `weight at ${score}`).toBe(await weightOf(w, score));
    }
  });
});

const trustOf_sql = async (w: World, score: number) =>
  (await w.db.query<{ t: string }>("select public.contributor_trust($1) as t", [score])).rows[0].t;
