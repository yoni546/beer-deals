import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";

/**
 * The people screen (migration 0041), and where the gaps are (Phase T).
 *
 * 0035 built this deliberately narrow and left out city, radius, favourites and
 * the registration date. The owner asked for those four by name, so they are here
 * — added narrowly, through one SECURITY DEFINER function, rather than by opening
 * `profiles`. These tests are as much about what the function still refuses to
 * return as about what it does.
 */

async function person(w: World, opts: { email: string; city?: string; radius?: number | null; beers?: string[]; name?: string }) {
  const id = await createUser(w.db, opts.email);
  await w.db.query(
    `insert into public.profiles (id, first_name, home_city, home_lat, home_lon, search_radius_km, onboarded_at)
     values ($1, 'פרטי', $2, 32.08, 34.78, $3, now())
     on conflict (id) do update set first_name = 'פרטי', home_city = excluded.home_city,
       home_lat = 32.08, home_lon = 34.78, search_radius_km = excluded.search_radius_km, onboarded_at = now()`,
    [id, opts.city ?? null, opts.radius ?? null],
  );
  for (const [i, beer] of (opts.beers ?? []).entries()) {
    await w.db.query(
      "insert into public.user_favorite_beers (profile_id, beer_id, rank) values ($1, $2, $3)",
      [id, beer, i + 1],
    );
  }
  if (opts.name) await asUser(w.db, id, () => w.db.query("select public.set_display_name($1)", [opts.name]));
  return id;
}

async function staff(w: World, level: "moderator" | "admin") {
  const id = await createUser(w.db, `staff-${level}@example.test`);
  await w.db.query("insert into public.admins (user_id, level) values ($1, $2::public.admin_level)", [id, level]);
  return id;
}

type Row = {
  user_id: string;
  display_name: string | null;
  home_city: string | null;
  search_radius_km: number | null;
  registered_at: string;
  favourites: string[];
  approved: number;
  rejected: number;
  pending: number;
  trust: string;
  admin_level: string | null;
};

const people = async (w: World, who: string) =>
  (await asUser(w.db, who, () => w.db.query<Row>("select * from public.admin_people()"))).rows;

describe("the four fields the owner asked for", () => {
  it("returns town, radius, favourites and when they registered", async () => {
    const w = await world();
    const mod = await staff(w, "moderator");
    await person(w, {
      email: "dana@example.test",
      city: "חיפה",
      radius: 15,
      beers: [w.ids.goldstar, w.ids.maccabee],
      name: "דנה",
    });

    const [row] = await people(w, mod);
    expect(row).toMatchObject({ display_name: "דנה", home_city: "חיפה", search_radius_km: 15 });
    // In their own order: #1 first, because #1 is the app.
    expect(row.favourites).toEqual(["גולדסטאר", "מכבי"]);
    expect(row.registered_at).toBeTruthy();
  });

  it("still returns nothing private", async () => {
    const w = await world();
    const mod = await staff(w, "moderator");
    await person(w, { email: "dana@example.test", city: "חיפה" });

    const [row] = await people(w, mod);
    // The private name, the coordinates and the email are not columns here, and
    // widening it later is an edit somebody has to make on purpose.
    for (const forbidden of ["first_name", "home_lat", "home_lon", "email"]) {
      expect(Object.keys(row), forbidden).not.toContain(forbidden);
    }
    // `profiles` itself is untouched: still owner-only. A moderator reading it
    // directly gets their OWN row and nobody else's, exactly as before 0041.
    const direct = await asUser(w.db, mod, () => w.db.query<{ id: string }>("select id from public.profiles"));
    expect(direct.rows.map((r) => r.id)).toEqual([mod]);
  });

  it("counts rejections for a moderator without storing them where the public can read", async () => {
    const w = await world();
    const mod = await staff(w, "moderator");
    const id = await person(w, { email: "dana@example.test", name: "דנה" });

    for (const [store, status] of [[w.ids.rami, "rejected"], [w.ids.shufersal, "rejected"], [w.ids.victory, "pending"]] as const) {
      await asUser(w.db, id, () =>
        w.db.query(
          `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by)
           values ($1, $2, 'sixpack', 2490, 3990, 'pending', $3)`,
          [w.ids.goldstar, store, id],
        ),
      );
      if (status === "rejected") {
        await w.db.query("update public.deals set status = 'rejected' where store_id = $1 and created_by = $2", [store, id]);
      }
    }

    const [row] = await people(w, mod);
    expect(row).toMatchObject({ rejected: 2, pending: 1 });
    // And `contributors`, which anybody can read, still does not carry it (0030).
    const { rows } = await w.db.query<{ c: number }>(
      "select count(*)::int as c from information_schema.columns where table_name = 'contributors' and column_name like '%reject%'",
    );
    expect(rows[0].c).toBe(0);
  });

  it("says which of them is staff, so a moderator knows who they are looking at", async () => {
    const w = await world();
    const mod = await staff(w, "moderator");
    await w.db.query("insert into public.profiles (id, onboarded_at) values ($1, now()) on conflict (id) do update set onboarded_at = now()", [mod]);

    const rows = await people(w, mod);
    expect(rows.find((r) => r.user_id === mod)?.admin_level).toBe("moderator");
  });

  it("leaves out somebody who never finished onboarding", async () => {
    const w = await world();
    const mod = await staff(w, "moderator");
    await createUser(w.db, "lurker@example.test"); // a profile row, never onboarded
    expect(await people(w, mod)).toEqual([]);
  });

  it("is refused to anybody who is not staff", async () => {
    const w = await world();
    await expect(asUser(w.db, w.visitor, () => w.db.query("select public.admin_people()"))).rejects.toThrow(
      /moderator privileges required/,
    );
  });
});

describe("where the people are and the deals are not", () => {
  const byCity = async (w: World, who: string) =>
    (await asUser(w.db, who, () =>
      w.db.query<{ city: string; people: number; with_radius: number; deals_nearby: number | null }>(
        "select * from public.admin_people_by_city()",
      ),
    )).rows;

  it("counts people by the town they told us, most first", async () => {
    const w = await world();
    const admin = await staff(w, "admin");
    await person(w, { email: "a@example.test", city: "חיפה", radius: 15 });
    await person(w, { email: "b@example.test", city: "חיפה" });
    await person(w, { email: "c@example.test", city: "אילת", radius: 50 });

    const rows = await byCity(w, admin);
    expect(rows.map((r) => [r.city, r.people])).toEqual([
      ["חיפה", 2],
      ["אילת", 1],
    ]);
    expect(rows[0].with_radius).toBe(1);
  });

  it("says 'we do not know' rather than zero while no branch has a position", async () => {
    const w = await world();
    const admin = await staff(w, "admin");
    await person(w, { email: "a@example.test", city: "חיפה", radius: 15 });

    // Branch coordinates are deliberately empty until a geocoder runs (0026).
    // Reporting 0 deals nearby would read as "this town is uncovered", which is a
    // claim we cannot make.
    expect((await byCity(w, admin))[0].deals_nearby).toBeNull();
  });

  it("is management, not moderation: a moderator does not see it", async () => {
    const w = await world();
    const mod = await staff(w, "moderator");
    await expect(asUser(w.db, mod, () => w.db.query("select public.admin_people_by_city()"))).rejects.toThrow(
      /admin privileges required/,
    );
  });
});
