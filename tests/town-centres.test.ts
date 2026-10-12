import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";
import { ISRAEL_CITIES, namesOf } from "@/data/israel-cities";
import { normPlace, rowsFor, townsFromSource } from "../scripts/build-town-centres-sql.mjs";

/**
 * Migration 0045: "הכי קרוב אליי" measures from somewhere.
 *
 * The feature shipped in 0026 with the coordinate columns deliberately empty, so it
 * has never had anything to order. This places every branch at the centre of its
 * town — said out loud as a town centre, never as the shop's door — and fills the
 * person's own point from the town they typed.
 *
 * What these tests are really guarding is the honesty of it: the precision recorded,
 * the refusal to overwrite a better fix, and the refusal to place a town we do not
 * recognise.
 */

const branch = (w: World, city: string | null, store = w.ids.rami) =>
  w.one<{ id: string }>(
    "insert into public.branches (store_id, external_ref, name_he, city, listed_in_stores_file) values ($1, $2, 'סניף', $3, true) returning id",
    [store, `b-${Math.random().toString(36).slice(2)}`, city],
  );

const place = (w: World) => asUser(w.db, w.admin, () => w.db.query<{ place_branches_by_town: number }>("select public.place_branches_by_town()"));

const geoOf = (w: World, id: string) =>
  w.one<{ latitude: number | null; longitude: number | null; geocode_precision: string | null; geocode_source: string | null }>(
    "select latitude, longitude, geocode_precision, geocode_source from public.branches where id = $1",
    [id],
  );

describe("the town table matches the one the app ships", () => {
  it("has a row for every spelling of every town, with the same point", async () => {
    const w = await world();
    const expected = rowsFor(townsFromSource());

    const { rows } = await w.db.query<{ norm_name: string; name: string; lat: number; lon: number }>(
      "select norm_name, name, lat, lon from public.town_centres",
    );
    expect(rows).toHaveLength(expected.length);

    const byKey = new Map(rows.map((r) => [r.norm_name, r]));
    for (const row of expected) {
      const held = byKey.get(row.norm);
      expect(held, `missing ${row.norm} — add a migration with its row (scripts/build-town-centres-sql.mjs)`).toBeTruthy();
      expect(held!.name).toBe(row.name);
      expect(held!.lat).toBeCloseTo(row.lat, 6);
      expect(held!.lon).toBeCloseTo(row.lon, 6);
    }
  });

  it("parses the TypeScript file the way the TypeScript file reads", async () => {
    const parsed = townsFromSource();
    expect(parsed).toHaveLength(ISRAEL_CITIES.length);
    for (const [i, town] of parsed.entries()) {
      expect(town.name).toBe(ISRAEL_CITIES[i].name);
      expect(town.lat).toBeCloseTo(ISRAEL_CITIES[i].lat, 6);
      expect([town.name, ...town.aka]).toEqual(namesOf(ISRAEL_CITIES[i]));
    }
  });

  it("normalises a place name in Postgres the way the generator does", async () => {
    const w = await world();
    const samples = ["תל אביב-יפו", "תל אביב יפו", " קרית אונו ", "מודיעין־מכבים־רעות", "ת״א", "פרדס חנה־כרכור"];
    for (const sample of samples) {
      const { norm_place: fromSql } = await w.one<{ norm_place: string }>("select public.norm_place($1)", [sample]);
      expect(fromSql, sample).toBe(normPlace(sample));
    }
  });

  it("is readable by a visitor and writable by nobody", async () => {
    const w = await world();
    const visitor = await createUser(w.db);
    await asUser(w.db, visitor, async () => {
      const { rows } = await w.db.query("select * from public.town_centres where norm_name = 'חולון'");
      expect(rows).toHaveLength(1);
      await expect(w.db.query("update public.town_centres set lat = 0 where norm_name = 'חולון'")).rejects.toThrow();
      await expect(w.db.query("insert into public.town_centres (norm_name, name, lat, lon) values ('x', 'x', 32, 35)")).rejects.toThrow();
    });
  });
});

describe("placing the branches", () => {
  it("gives a branch its town's centre, recorded as a town centre", async () => {
    const w = await world();
    const holon = await branch(w, "חולון");
    expect((await place(w)).rows[0].place_branches_by_town).toBe(1);

    const geo = await geoOf(w, holon.id);
    expect(geo.latitude).toBeCloseTo(32.015, 3);
    expect(geo.longitude).toBeCloseTo(34.774, 3);
    expect(geo.geocode_precision).toBe("locality");
    expect(geo.geocode_source).toContain("town centre");
  });

  it("recognises another spelling, and a neighbourhood inside a town", async () => {
    const w = await world();
    const typo = await branch(w, "קרית אונו");
    const quarter = await branch(w, "ירושלים תלפיות");
    const aka = await branch(w, "נצרת עילית");
    await place(w);

    expect((await geoOf(w, typo.id)).latitude).toBeCloseTo(32.056, 3);
    expect((await geoOf(w, quarter.id)).latitude).toBeCloseTo(31.769, 3);
    expect((await geoOf(w, aka.id)).latitude).toBeCloseTo(32.713, 3);
  });

  it("leaves a town it does not know, and a branch with no town, unplaced", async () => {
    const w = await world();
    const unknown = await branch(w, "כפר שאין כזה");
    const nowhere = await branch(w, null);
    expect((await place(w)).rows[0].place_branches_by_town).toBe(0);

    expect((await geoOf(w, unknown.id)).latitude).toBeNull();
    expect((await geoOf(w, nowhere.id)).latitude).toBeNull();
  });

  it("never overwrites a position that is already there", async () => {
    const w = await world();
    const exact = await branch(w, "חולון");
    await w.db.query(
      "update public.branches set latitude = 32.0, longitude = 34.8, geocoded_at = now(), geocode_source = 'nominatim', geocode_precision = 'rooftop' where id = $1",
      [exact.id],
    );
    expect((await place(w)).rows[0].place_branches_by_town).toBe(0);

    const geo = await geoOf(w, exact.id);
    expect(geo.geocode_precision).toBe("rooftop");
    expect(geo.latitude).toBeCloseTo(32.0, 6);
  });

  it("is not something a visitor may run", async () => {
    const w = await world();
    const visitor = await createUser(w.db);
    await asUser(w.db, visitor, async () => {
      await expect(w.db.query("select public.place_branches_by_town()")).rejects.toThrow();
    });
  });

  it("makes the branches measurable, which is the whole point", async () => {
    const w = await world();
    await branch(w, "חולון");
    await branch(w, "באר שבע");
    await place(w);

    // From Tel Aviv, 15 km: Holon is in, Be'er Sheva is not.
    const { rows } = await w.db.query<{ city: string; km: number }>("select city, km from public.branches_within_km(32.085, 34.782, 15, 50)");
    expect(rows.map((r) => r.city)).toEqual(["חולון"]);
    expect(rows[0].km).toBeLessThan(10);
  });
});

describe("the person's own town", () => {
  it("fills the point from the town they typed", async () => {
    const w = await world();
    const visitor = await createUser(w.db);
    await asUser(w.db, visitor, () => w.db.query("select public.save_location($1, null, null, $2)", ["רמת גן", 10]));

    const profile = await w.one<{ home_lat: number | null; home_lon: number | null; home_city: string }>(
      "select home_city, home_lat, home_lon from public.profiles where id = $1",
      [visitor],
    );
    expect(profile.home_city).toBe("רמת גן");
    expect(profile.home_lat).toBeCloseTo(32.082, 3);
    expect(profile.home_lon).toBeCloseTo(34.814, 3);
  });

  it("prefers a point the person actually shared over their town's centre", async () => {
    const w = await world();
    const visitor = await createUser(w.db);
    await asUser(w.db, visitor, () => w.db.query("select public.save_location($1, 32.5, 35.0, $2)", ["רמת גן", 10]));

    const profile = await w.one<{ home_lat: number }>("select home_lat from public.profiles where id = $1", [visitor]);
    expect(profile.home_lat).toBeCloseTo(32.5, 6);
  });

  it("keeps a town it does not know, with no point, rather than guessing one", async () => {
    const w = await world();
    const visitor = await createUser(w.db);
    await asUser(w.db, visitor, () => w.db.query("select public.save_location($1, null, null, $2)", ["כפר שאין כזה", 10]));

    const profile = await w.one<{ home_city: string; home_lat: number | null }>(
      "select home_city, home_lat from public.profiles where id = $1",
      [visitor],
    );
    expect(profile.home_city).toBe("כפר שאין כזה");
    expect(profile.home_lat).toBeNull();
  });
});
