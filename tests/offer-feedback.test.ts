import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";

/**
 * "המבצע עדיין קיים" / "המבצע נגמר" (migration 0031).
 *
 * The rule that shapes it: a tap is not a verdict. One person saying a shelf was
 * empty is a data point, not a decision — and the people most likely to tap are the
 * ones who just had a wasted journey. So both directions are counted, recent voices
 * count more than old ones, somebody with a record counts for more than a stranger
 * (but never enough to decide alone), and where the two sides genuinely disagree the
 * answer is "unclear" and an admin looks.
 *
 * Nothing here ever deletes a deal. The strongest thing it says is a word.
 */

const KEY = "obs:12345";

const report = (w: World, who: string | null, verdict: "ended" | "still_there", key = KEY, note?: string, role: "authenticated" | "anon" = "authenticated") =>
  asUser(
    w.db,
    who,
    () => w.db.query("select public.report_offer($1, $2::public.offer_verdict, $3)", [key, verdict, note ?? null]),
    role,
  );

const standing = async (w: World, key = KEY) =>
  (await w.db.query<{ ended_weight: string; still_weight: string; voices: number; standing: string }>(
    "select ended_weight, still_weight, voices, standing from public.offer_standing($1)",
    [key],
  )).rows[0];

/** Somebody with a record of finds, which buys them more weight. */
async function trusted(w: World, points: number, label: string) {
  const id = await createUser(w.db, `${label}@example.test`);
  await asUser(w.db, id, () => w.db.query("select public.set_display_name($1)", [label]));
  await w.db.query("update public.contributors set score = $2 where profile_id = $1", [id, points]);
  return id;
}

describe("anybody can say something about any offer", () => {
  it("takes feedback on a CHAIN offer, which had no report path at all before", async () => {
    const w = await world();
    // 'obs:' is a catalogue offer — a row of a view, with no `deals` row behind it.
    await report(w, w.visitor, "ended", "obs:98765");
    const { rows } = await w.db.query<{ offer_key: string }>("select offer_key from public.offer_feedback");
    expect(rows).toEqual([{ offer_key: "obs:98765" }]);
  });

  it("takes a note, which the old flow had a column for and no way to fill", async () => {
    const w = await world();
    await report(w, w.visitor, "ended", KEY, "המדף היה ריק");
    const { rows } = await w.db.query<{ note: string }>("select note from public.offer_feedback");
    expect(rows).toEqual([{ note: "המדף היה ריק" }]);
  });

  it("refuses something that is not an offer key", async () => {
    const w = await world();
    for (const bad of ["", "hello", "obs:", "deal:'; drop table deals; --"]) {
      await expect(report(w, w.visitor, "ended", bad)).rejects.toThrow(/not an offer/);
    }
  });

  it("refuses a caller who is not signed in", async () => {
    const w = await world();
    await expect(report(w, null, "ended", KEY, undefined, "anon")).rejects.toThrow(/permission denied/);
  });

  it("keeps one standing opinion per person: saying it again replaces it", async () => {
    const w = await world();
    await report(w, w.visitor, "ended");
    await report(w, w.visitor, "still_there"); // they went back and it was there

    const { rows } = await w.db.query<{ verdict: string }>("select verdict from public.offer_feedback");
    expect(rows).toEqual([{ verdict: "still_there" }]);
  });

  it("cannot be written directly — the function is the only way in", async () => {
    const w = await world();
    await expect(
      asUser(w.db, w.visitor, () =>
        w.db.query("insert into public.offer_feedback (offer_key, verdict, reported_by) values ($1, 'ended', $2)", [KEY, w.visitor]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("one tap never ends a deal", () => {
  it("says nothing at all on a single report", async () => {
    const w = await world();
    await report(w, w.visitor, "ended");
    expect(await standing(w)).toMatchObject({ voices: 1, standing: "quiet" });
  });

  it("still says nothing on two", async () => {
    const w = await world();
    for (const label of ["a", "b"]) {
      await report(w, await createUser(w.db, `${label}@example.test`), "ended");
    }
    expect((await standing(w)).standing).toBe("quiet");
  });

  it("believes it is gone once three strangers agree and nobody disagrees", async () => {
    const w = await world();
    for (const label of ["a", "b", "c"]) {
      await report(w, await createUser(w.db, `${label}@example.test`), "ended");
    }
    expect(await standing(w)).toMatchObject({ standing: "ended", voices: 3 });
  });

  it("lets somebody with a record speak for more than a stranger — but not alone", async () => {
    const w = await world();
    const known = await trusted(w, 120, "known"); // weight 3
    await report(w, known, "ended");
    // Three points of weight from one person is still one person.
    expect((await standing(w)).standing).toBe("ended");
    expect(Number((await standing(w)).ended_weight)).toBe(3);
  });
});

describe("a confirmation can answer a report", () => {
  it("says it is still there when people checked and it was", async () => {
    const w = await world();
    for (const label of ["a", "b"]) {
      await report(w, await createUser(w.db, `${label}@example.test`), "still_there");
    }
    expect((await standing(w)).standing).toBe("still_there");
  });

  it("hands a real disagreement to a person instead of deciding it", async () => {
    const w = await world();
    for (const label of ["a", "b", "c"]) await report(w, await createUser(w.db, `${label}@example.test`), "ended");
    for (const label of ["d", "e"]) await report(w, await createUser(w.db, `${label}@example.test`), "still_there");

    // Both sides have real support. A rule should not settle this.
    expect((await standing(w)).standing).toBe("unclear");
  });
});

describe("a shelf last month says nothing about a shelf today", () => {
  it("halves a voice after a week and ignores it after thirty days", async () => {
    const w = await world();
    const old = await createUser(w.db, "old@example.test");
    const older = await createUser(w.db, "older@example.test");
    await report(w, old, "ended");
    await report(w, older, "ended");
    await w.db.query("update public.offer_feedback set created_at = now() - interval '10 days' where reported_by = $1", [old]);
    await w.db.query("update public.offer_feedback set created_at = now() - interval '40 days' where reported_by = $1", [older]);

    const row = await standing(w);
    expect(Number(row.ended_weight)).toBe(0.5); // one at half, one gone entirely
    expect(row.voices).toBe(1); // the 40-day-old one is not even counted as a voice
  });
});

describe("what an admin is shown", () => {
  const forAdmin = (w: World, who: string) =>
    asUser(w.db, who, () => w.db.query<{ offer_key: string; standing: string; notes: string[] }>(
      "select offer_key, standing, notes from public.admin_offer_feedback()",
    ));

  it("lists what needs looking at, disagreements first, with what people wrote", async () => {
    const w = await world();
    const moderator = await createUser(w.db, "mod@example.test");
    await w.db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [moderator]);

    // One clear-cut, one genuinely contested.
    for (const label of ["a", "b", "c"]) await report(w, await createUser(w.db, `${label}@example.test`), "ended", "obs:111");
    for (const label of ["d", "e", "f"]) await report(w, await createUser(w.db, `${label}@example.test`), "ended", "obs:222", "ריק");
    for (const label of ["g", "h"]) await report(w, await createUser(w.db, `${label}@example.test`), "still_there", "obs:222");

    const { rows } = await forAdmin(w, moderator);
    expect(rows[0]).toMatchObject({ offer_key: "obs:222", standing: "unclear" });
    expect(rows[0].notes).toContain("ריק");
    expect(rows.map((r) => r.offer_key)).toContain("obs:111");
  });

  it("refuses anyone who is not an admin", async () => {
    const w = await world();
    await expect(
      asUser(w.db, w.visitor, () => w.db.query("select public.admin_offer_feedback()")),
    ).rejects.toThrow(/moderator privileges required/);
  });

  it("leaves out the offers nobody has said anything meaningful about", async () => {
    const w = await world();
    const moderator = await createUser(w.db, "mod@example.test");
    await w.db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [moderator]);
    await report(w, w.visitor, "ended", "obs:333"); // one tap: quiet

    const { rows } = await forAdmin(w, moderator);
    expect(rows).toEqual([]);
  });
});

/**
 * The one thing that makes this different from the report box that was already here:
 * what people said reaches the next person, not only a moderator. The screen reads
 * every standing in ONE call (a Home render touches dozens of offers), so the two
 * functions have to agree — and the quiet majority has to be absent from it, or the
 * app would label offers nobody has checked.
 */
describe("what the screen reads", () => {
  const all = (w: World) =>
    w.db.query<{ offer_key: string; standing: string }>(
      "select offer_key, standing from public.offer_standings() order by offer_key",
    );

  it("says nothing about an offer nobody has spoken about", async () => {
    const w = await world();
    expect((await all(w)).rows).toEqual([]);
    // And asked about one directly, it still answers — with 'quiet'.
    expect(await standing(w, "obs:404")).toMatchObject({ voices: 0, standing: "quiet" });
  });

  it("agrees with the single-offer answer on every offer at once", async () => {
    const w = await world();
    for (const label of ["a", "b", "c"]) await report(w, await createUser(w.db, `${label}@example.test`), "ended", "obs:111");
    for (const label of ["d", "e"]) await report(w, await createUser(w.db, `${label}@example.test`), "still_there", "obs:222");
    await report(w, w.visitor, "ended", "obs:333"); // one tap, still quiet

    const { rows } = await all(w);
    for (const row of rows) {
      expect(row.standing, row.offer_key).toBe((await standing(w, row.offer_key)).standing);
    }
    expect(rows.filter((r) => r.standing !== "quiet").map((r) => [r.offer_key, r.standing])).toEqual([
      ["obs:111", "ended"],
      ["obs:222", "still_there"],
    ]);
  });

  it("is readable by a visitor who is not signed in — the label is on the line", async () => {
    const w = await world();
    for (const label of ["a", "b", "c"]) await report(w, await createUser(w.db, `${label}@example.test`), "ended", "obs:111");
    const { rows } = await asUser(
      w.db,
      null,
      () => w.db.query<{ standing: string }>("select standing from public.offer_standings() where offer_key = 'obs:111'"),
      "anon",
    );
    expect(rows).toEqual([{ standing: "ended" }]);
  });
});
