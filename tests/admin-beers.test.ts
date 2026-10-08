import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";

/**
 * Managing the beers from the panel (migration 0034).
 *
 * What was already true: `beers_admin_write` (0003) was `for all`, so an admin
 * could insert, update and DELETE a beer by hand through PostgREST — with no
 * screen, no audit entry and no guard against the two edits that quietly break
 * things. These tests are mostly about those two.
 */

type BeerRow = {
  slug: string;
  name_he: string;
  is_active: boolean;
  chosen_by: number;
  first_for: number;
  live_offers: number;
  packs: number;
};

async function setup() {
  const w = await world();
  const moderator = await createUser(w.db, "moderator@example.test");
  await w.db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [moderator]);
  return { w, moderator };
}

const beers = async (w: World, who: string): Promise<BeerRow[]> =>
  (await asUser(w.db, who, () => w.db.query<BeerRow>("select * from public.admin_beers()"))).rows;

const find = (rows: BeerRow[], slug: string) => rows.find((r) => r.slug === slug)!;

describe("a beer is switched off, never deleted", () => {
  it("has no delete path at all, for anybody", async () => {
    const { w, moderator } = await setup();
    // Not the policy and not the grant: both were there before 0034.
    await expect(
      asUser(w.db, moderator, () => w.db.query("delete from public.beers where slug = 'goldstar'")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(w.db, w.admin, () => w.db.query("delete from public.beers where slug = 'goldstar'")),
    ).rejects.toThrow(/permission denied/);
  });

  it("switches off and on again, and says so in the audit log", async () => {
    const { w, moderator } = await setup();
    const id = w.ids.goldstar;

    await asUser(w.db, moderator, () => w.db.query("select public.admin_set_beer_active($1, false)", [id]));
    expect(find(await beers(w, moderator), "goldstar").is_active).toBe(false);

    await asUser(w.db, moderator, () => w.db.query("select public.admin_set_beer_active($1, true)", [id]));
    expect(find(await beers(w, moderator), "goldstar").is_active).toBe(true);

    const { rows } = await asUser(w.db, moderator, () =>
      w.db.query<{ action: string }>("select action from public.admin_audit()"),
    );
    expect(rows.map((r) => r.action)).toEqual(["beer.activate", "beer.deactivate"]);
  });

  it("records how many people it was the app FOR, at the moment it was switched off", async () => {
    const { w, moderator } = await setup();
    // Two people have Goldstar first; one has it second.
    for (const email of ["a@example.test", "b@example.test"]) {
      const person = await createUser(w.db, email);
      await w.db.query("insert into public.profiles (id) values ($1) on conflict do nothing", [person]);
      await w.db.query("insert into public.user_favorite_beers (profile_id, beer_id, rank) values ($1, $2, 1)", [
        person,
        w.ids.goldstar,
      ]);
    }
    const third = await createUser(w.db, "c@example.test");
    await w.db.query("insert into public.profiles (id) values ($1) on conflict do nothing", [third]);
    await w.db.query("insert into public.user_favorite_beers (profile_id, beer_id, rank) values ($1, $2, 2)", [
      third,
      w.ids.goldstar,
    ]);

    const row = find(await beers(w, moderator), "goldstar");
    expect(row).toMatchObject({ chosen_by: 3, first_for: 2 });

    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_set_beer_active($1, false)", [w.ids.goldstar]),
    );
    const [entry] = (await asUser(w.db, moderator, () =>
      w.db.query<{ details: Record<string, unknown> }>("select details from public.admin_audit()"),
    )).rows;
    // The number changes afterwards; this is the only place the question "how many
    // did this affect?" can still be answered.
    expect(entry.details).toMatchObject({ slug: "goldstar", first_for: 2 });
  });

  it("leaves the favourites of the people who already chose it alone", async () => {
    const { w, moderator } = await setup();
    const person = await createUser(w.db, "keeps@example.test");
    await w.db.query("insert into public.profiles (id) values ($1) on conflict do nothing", [person]);
    await w.db.query("insert into public.user_favorite_beers (profile_id, beer_id, rank) values ($1, $2, 1)", [
      person,
      w.ids.goldstar,
    ]);

    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_set_beer_active($1, false)", [w.ids.goldstar]),
    );

    // Still theirs, still first — which is what decides how the app looks for them.
    const { rows } = await w.db.query<{ rank: number }>(
      "select rank from public.user_favorite_beers where profile_id = $1",
      [person],
    );
    expect(rows).toEqual([{ rank: 1 }]);
  });
});

describe("the slug is forever", () => {
  it("refuses a change, through the function and through a direct update", async () => {
    const { w, moderator } = await setup();
    await expect(
      asUser(w.db, moderator, () =>
        w.db.query("update public.beers set slug = 'gold-star' where id = $1", [w.ids.goldstar]),
      ),
    ).rejects.toThrow(/אי אפשר לשנות מזהה/);

    // It is the URL of the page, the key of the beer's identity in themes.ts and the
    // filename of its photo. Still 'goldstar'.
    const { rows } = await w.db.query<{ slug: string }>("select slug from public.beers where id = $1", [
      w.ids.goldstar,
    ]);
    expect(rows).toEqual([{ slug: "goldstar" }]);
  });

  it("does not stand in the way of an ordinary edit", async () => {
    const { w, moderator } = await setup();
    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_update_beer($1, 'גולדסטאר', 'Goldstar', 'beer', 5)", [w.ids.goldstar]),
    );
    const { rows } = await w.db.query<{ sort_order: number }>(
      "select sort_order from public.beers where id = $1",
      [w.ids.goldstar],
    );
    expect(rows).toEqual([{ sort_order: 5 }]);
  });
});

describe("editing what is safe to edit", () => {
  it("records only what moved", async () => {
    const { w, moderator } = await setup();
    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_update_beer($1, 'גולדסטאר קלאסי', 'Goldstar', 'beer', 1)", [
        w.ids.goldstar,
      ]),
    );
    const [entry] = (await asUser(w.db, moderator, () =>
      w.db.query<{ details: Record<string, unknown> }>("select details from public.admin_audit()"),
    )).rows;
    // The Hebrew name moved; the English name did not, so it is absent rather than
    // echoed back as a pair of identical values.
    expect(entry.details.slug).toBe("goldstar");
    expect(entry.details.name_he).toEqual(["גולדסטאר", "גולדסטאר קלאסי"]);
    expect(entry.details.name_en).toBeUndefined();
  });

  it("refuses an empty name and an unknown category", async () => {
    const { w, moderator } = await setup();
    await expect(
      asUser(w.db, moderator, () =>
        w.db.query("select public.admin_update_beer($1, '  ', 'Goldstar', 'beer', 1)", [w.ids.goldstar]),
      ),
    ).rejects.toThrow(/לא יכול להיות ריק/);
    await expect(
      asUser(w.db, moderator, () =>
        w.db.query("select public.admin_update_beer($1, 'גולדסטאר', 'Goldstar', 'wine', 1)", [w.ids.goldstar]),
      ),
    ).rejects.toThrow(/קטגוריה לא מוכרת/);
  });
});

describe("adding a beer", () => {
  it("adds it at the end of the list, so nobody else's order moves", async () => {
    const { w, moderator } = await setup();
    const before = (await beers(w, moderator)).length;
    const [brand] = (await asUser(w.db, moderator, () =>
      w.db.query<{ slug: string }>("select slug from public.admin_brands() limit 1"),
    )).rows;

    // A variant, because every seeded brand already has its plain beer.
    await asUser(w.db, moderator, () =>
      w.db.query("select public.admin_add_beer('test-lager', 'בירת בדיקה', 'Test Lager', $1, 'beer', 'בדיקה')", [
        brand.slug,
      ]),
    );

    const rows = await beers(w, moderator);
    expect(rows).toHaveLength(before + 1);
    expect(find(rows, "test-lager")).toMatchObject({
      name_he: "בירת בדיקה",
      is_active: true,
      chosen_by: 0,
      live_offers: 0,
      packs: 0,
    });

    // Last, so nobody else's order moved.
    const { rows: order } = await w.db.query<{ slug: string }>(
      "select slug from public.beers order by sort_order desc, name_he limit 1",
    );
    expect(order[0].slug).toBe("test-lager");
  });

  it("explains the one-beer-per-variant rule instead of quoting an index name", async () => {
    const { w, moderator } = await setup();
    // 'goldstar' the brand already has its plain beer.
    await expect(
      asUser(w.db, moderator, () =>
        w.db.query("select public.admin_add_beer('goldstar-2', 'גולדסטאר', 'Goldstar', 'goldstar')"),
      ),
    ).rejects.toThrow(/הוסיפו שם לגרסה/);
  });

  it("refuses a slug that is not a slug, and an unknown brand", async () => {
    const { w, moderator } = await setup();
    await expect(
      asUser(w.db, moderator, () =>
        w.db.query("select public.admin_add_beer('Test Lager!', 'בירה', 'Beer', 'goldstar')"),
      ),
    ).rejects.toThrow(/slug/);
    await expect(
      asUser(w.db, moderator, () =>
        w.db.query("select public.admin_add_beer('test-lager', 'בירה', 'Beer', 'no-such-brand')"),
      ),
    ).rejects.toThrow(/מותג לא מוכר/);
  });
});

describe("none of it is reachable without being an admin", () => {
  it("refuses every entry point", async () => {
    const { w } = await setup();
    for (const call of [
      "select public.admin_beers()",
      "select public.admin_brands()",
      `select public.admin_set_beer_active('${w.ids.goldstar}', false)`,
      `select public.admin_update_beer('${w.ids.goldstar}', 'x', 'x', 'beer', 1)`,
      "select public.admin_add_beer('x-beer', 'x', 'x', 'goldstar')",
    ]) {
      await expect(
        asUser(w.db, w.visitor, () => w.db.query(call)),
        call,
      ).rejects.toThrow(/admin privileges required/);
    }
  });
});
