import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";

/**
 * Who found the deal (migration 0030).
 *
 * Two rules shape all of it. Consent is the default: nobody is named until they
 * choose a name, and a deal from somebody who has not says nothing about who found
 * it — not "anonymous", which is itself a label. And quality beats volume: the
 * standings must make submitting a hundred deals to get two accepted worth LESS
 * than submitting two and having both accepted.
 */

const name = (w: World, who: string | null, value: string, role: "authenticated" | "anon" = "authenticated") =>
  asUser(w.db, who, () => w.db.query("select public.set_display_name($1)", [value]), role);

/** A deal submitted by a person, through the same insert path the app uses. */
async function submit(w: World, who: string, status: "pending" | "approved" | "rejected", category = "sixpack") {
  const { rows } = await w.db.query<{ id: string }>(
    `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by, approved_by, approved_at)
     values ($1, $2, $3::public.deal_category, 2490, 3990, $4::public.deal_status, $5::uuid,
             case when $4::public.deal_status = 'approved' then $5::uuid else null end,
             case when $4::public.deal_status = 'approved' then now() else null end)
     returning id`,
    [w.ids.goldstar, w.ids.rami, category, status, who],
  );
  return rows[0].id;
}

/**
 * The leaderboard as the public reads it: an ordinary table under an ordinary
 * policy. It is deliberately NOT a SECURITY DEFINER function granted to anon --
 * that is the shape tests/function-grants.test.ts forbids, and storing the answer
 * avoids needing one at all.
 */
const standings = async (w: World) =>
  (await w.db.query<{ profile_id: string; display_name: string; approved: number; weekly: number; score: number }>(
    "select profile_id, display_name, approved, weekly, score from public.contributors where score > 0 or approved > 0 order by score desc, display_name",
  )).rows;

describe("choosing to be named", () => {
  it("nobody is named until they say so", async () => {
    const w = await world();
    await submit(w, w.visitor, "approved");
    expect(await standings(w)).toEqual([]);

    const { rows } = await w.db.query("select * from public.contributors");
    expect(rows).toEqual([]);
  });

  it("takes a name, and lets it be changed", async () => {
    const w = await world();
    await name(w, w.visitor, "יוני");
    await name(w, w.visitor, "יוני ה.");

    const { rows } = await w.db.query<{ display_name: string }>("select display_name from public.contributors");
    expect(rows).toEqual([{ display_name: "יוני ה." }]);
  });

  it("clearing it removes the row, not just the words", async () => {
    const w = await world();
    await name(w, w.visitor, "יוני");
    await name(w, w.visitor, "   ");
    expect((await w.db.query("select * from public.contributors")).rows).toEqual([]);
  });

  it("refuses a name too short to be one, or too long to fit on a card", async () => {
    const w = await world();
    await expect(name(w, w.visitor, "י")).rejects.toThrow(/two and twenty-four/);
    await expect(name(w, w.visitor, "א".repeat(25))).rejects.toThrow(/two and twenty-four/);
  });

  it("refuses a caller who is not signed in", async () => {
    const w = await world();
    await expect(name(w, null, "יוני", "anon")).rejects.toThrow(/permission denied/);
  });

  it("can only ever name the caller", async () => {
    const w = await world();
    const other = await createUser(w.db);
    await name(w, w.visitor, "יוני");
    const { rows } = await w.db.query<{ profile_id: string }>("select profile_id from public.contributors");
    expect(rows).toEqual([{ profile_id: w.visitor }]);
    expect(rows[0].profile_id).not.toBe(other);
  });

  it("cannot be written directly: the function is the only way in", async () => {
    const w = await world();
    await expect(
      asUser(w.db, w.visitor, () =>
        w.db.query("insert into public.contributors (profile_id, display_name) values ($1, 'שם')", [w.visitor]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("is readable by everyone — that is what it is for", async () => {
    const w = await world();
    await name(w, w.visitor, "יוני");
    const seen = await asUser(w.db, null, () => w.db.query("select display_name from public.contributors"), "anon");
    expect(seen.rows).toEqual([{ display_name: "יוני" }]);
  });
});

describe("the standings reward quality, not volume", () => {
  it("counts an approved deal and ignores one still waiting", async () => {
    const w = await world();
    await name(w, w.visitor, "יוני");
    await submit(w, w.visitor, "approved");
    await submit(w, w.visitor, "pending", "case");

    const [row] = await standings(w);
    expect(row).toMatchObject({ display_name: "יוני", approved: 1, score: 10 });
  });

  // The penalty is inside the score and is deliberately NOT published as a count:
  // somebody's failures do not belong beside their name on a public leaderboard.
  it("makes a rejected submission cost something", async () => {
    const w = await world();
    await name(w, w.visitor, "יוני");
    await submit(w, w.visitor, "approved");
    await submit(w, w.visitor, "rejected", "case");

    const [row] = await standings(w);
    expect(row.score).toBe(5); // 10 − 5
  });

  it("never leaves anyone in debt", async () => {
    const w = await world();
    await name(w, w.visitor, "יוני");
    await submit(w, w.visitor, "approved");
    for (const c of ["case", "single"] as const) await submit(w, w.visitor, "rejected", c);

    const [row] = await standings(w);
    expect(row.score).toBe(0); // 10 − 10, floored
  });

  it("values a deal that became the pick above an ordinary one", async () => {
    const w = await world();
    const careful = await createUser(w.db);
    await name(w, careful, "דנה");
    const id = await submit(w, careful, "approved");
    await w.db.query("update public.deals set was_weekly = true where id = $1", [id]);

    const [row] = await standings(w);
    expect(row).toMatchObject({ display_name: "דנה", weekly: 1, score: 35 }); // 10 + 25
  });

  it("puts two careful submissions above a hundred careless ones", async () => {
    const w = await world();
    const spammer = await createUser(w.db, "spam@example.test");
    const careful = await createUser(w.db, "careful@example.test");
    await name(w, spammer, "ספאמר");
    await name(w, careful, "זהירה");

    // One accepted out of twenty-three: volume without quality. (Approved deals are
    // one per shelf — beer, chain, pack — so each person's approved ones differ.)
    await submit(w, spammer, "approved"); // goldstar · rami · sixpack
    for (const c of ["case", "single"] as const) await submit(w, spammer, "rejected", c);
    await w.db.query(
      `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by)
       select $1, $2, 'sixpack', 2490, 3990, 'rejected', $3::uuid from generate_series(1, 20)`,
      [w.ids.maccabee, w.ids.shufersal, spammer],
    );

    // Two submissions, both accepted.
    for (const [beer, store] of [
      [w.ids.maccabee, w.ids.victory],
      [w.ids.maccabee, w.ids.yochananof],
    ]) {
      await w.db.query(
        `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by, approved_by, approved_at)
         values ($1, $2, 'sixpack', 2490, 3990, 'approved', $3::uuid, $3::uuid, now())`,
        [beer, store, careful],
      );
    }

    const rows = await standings(w);
    expect(rows[0].display_name).toBe("זהירה");
    expect(rows[0].score).toBeGreaterThan(rows[1]?.score ?? -1);
  });

  it("does not credit a person for a deal an admin typed in", async () => {
    const w = await world();
    await name(w, w.admin, "המנהל");
    await asUser(w.db, w.admin, () =>
      w.db.query("select public.admin_add_deal($1, $2, 'sixpack', 2490, 3990)", [w.ids.goldstar, w.ids.rami]),
    );
    expect(await standings(w)).toEqual([]);
  });

  it("leaves out anybody who has not had a deal accepted yet", async () => {
    const w = await world();
    await name(w, w.visitor, "חדש");
    await submit(w, w.visitor, "pending");
    expect(await standings(w)).toEqual([]);
  });
});

describe("the standings give away nothing they should not", () => {
  it("never stores how many of somebody's submissions were rejected", async () => {
    const w = await world();
    const { rows } = await w.db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'contributors'",
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).not.toContain("rejected");
    // The penalty is inside the score; the count of a person's failures is not
    // something a public leaderboard should carry beside their name.
    expect(columns).toContain("score");
  });

  it("carries no email and no name the person did not choose", async () => {
    const w = await world();
    await name(w, w.visitor, "יוני");
    await submit(w, w.visitor, "approved");
    const seen = await asUser(w.db, null, () => w.db.query("select * from public.contributors"), "anon");
    expect(JSON.stringify(seen.rows)).not.toContain("@");
  });

  it("is readable by the public, because the leaderboard is public", async () => {
    const w = await world();
    await name(w, w.visitor, "יוני");
    await submit(w, w.visitor, "approved");
    const seen = await asUser(w.db, null, () => w.db.query("select display_name, score from public.contributors"), "anon");
    expect(seen.rows).toEqual([{ display_name: "יוני", score: 10 }]);
  });

  it("needs no SECURITY DEFINER function granted to anon to be read", async () => {
    const w = await world();
    const { rows } = await w.db.query<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.prosecdef and p.proname like '%contributor%'
          -- A trigger function is unreachable from SQL whatever its ACL says; the
          -- project's own guard (tests/function-grants.test.ts) excludes them too.
          and p.prorettype <> 'trigger'::regtype
          and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(rows.map((r) => r.name)).toEqual([]);
  });
});

describe("the weekly pick is remembered", () => {
  it("records that a deal was chosen, so the credit survives the pointer moving on", async () => {
    const w = await world();
    const first = await submit(w, w.visitor, "approved");
    const second = await submit(w, w.visitor, "approved", "case");

    await asUser(w.db, w.admin, () => w.db.query("select public.set_weekly_deal($1)", [first]));
    await asUser(w.db, w.admin, () => w.db.query("select public.set_weekly_deal($1)", [second]));

    const { rows } = await w.db.query<{ id: string; was_weekly: boolean }>(
      "select id, was_weekly from public.deals order by was_weekly desc",
    );
    // Both were the pick at some point; app_settings only remembers the last.
    expect(rows.filter((r) => r.was_weekly).map((r) => r.id).sort()).toEqual([first, second].sort());
  });
});
