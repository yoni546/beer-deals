import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";
import { cityByName, ISRAEL_CITIES, namesOf } from "@/data/israel-cities";
import { allRows, normPlace, rowsFor } from "../scripts/build-town-centres-sql.mjs";

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

/**
 * Where the app says a settlement is. Tests compare against this rather than a number
 * typed into the test, so a re-import that moves a town centre by a kilometre does not
 * fail a test that was only ever checking that the right town was found.
 */
const centre = (name: string) => {
  const place = cityByName(name);
  if (!place) throw new Error(`${name} is not in ISRAEL_CITIES`);
  return place;
};

const geoOf = (w: World, id: string) =>
  w.one<{ latitude: number | null; longitude: number | null; geocode_precision: string | null; geocode_source: string | null }>(
    "select latitude, longitude, geocode_precision, geocode_source from public.branches where id = $1",
    [id],
  );

describe("the town table matches the one the app ships", () => {
  it("has a row for every spelling of every settlement, with the same point", async () => {
    const w = await world();
    const expected = allRows();

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

  it("covers every settlement the app ships, and invents none", async () => {
    // The SQL and the TypeScript are generated from one validated list
    // (scripts/build-settlements.mjs); this is the assertion that they really are.
    const rows = allRows();
    const spellings = new Set(rows.map((r) => r.norm));
    expect(ISRAEL_CITIES.length).toBeGreaterThan(1000);
    for (const place of ISRAEL_CITIES) {
      for (const name of namesOf(place)) {
        expect(spellings.has(normPlace(name)), name).toBe(true);
      }
    }
    const names = new Set(ISRAEL_CITIES.map((p) => p.name));
    for (const row of rows) expect(names.has(row.name), row.name).toBe(true);
  });

  it("holds no settlement outside Israel, and no point shared by three of them", async () => {
    // The dataset this is built from had both: 85 settlements on one fallback point
    // in the Negev, and עטרת in Los Angeles. The import refuses them; this is the
    // assertion that it still does.
    const byPoint = new Map<string, string[]>();
    for (const place of ISRAEL_CITIES) {
      expect(place.lat, place.name).toBeGreaterThanOrEqual(29.3);
      expect(place.lat, place.name).toBeLessThanOrEqual(33.5);
      expect(place.lon, place.name).toBeGreaterThanOrEqual(34.0);
      expect(place.lon, place.name).toBeLessThanOrEqual(36.0);
      const key = `${place.lat.toFixed(4)},${place.lon.toFixed(4)}`;
      byPoint.set(key, [...(byPoint.get(key) ?? []), place.name]);
    }
    const crowded = [...byPoint.entries()].filter(([, names]) => names.length >= 3);
    expect(crowded.map(([point, names]) => `${point}: ${names.join(", ")}`)).toEqual([]);
  });

  it("normalises a place name in Postgres the way the generator does", async () => {
    const w = await world();
    const samples = ["תל אביב-יפו", "תל אביב יפו", " קרית אונו ", "מודיעין־מכבים־רעות", "ת״א", "פרדס חנה־כרכור", "טמרה (יזרעאל)", "בן שמן (מושב)"];
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
    expect(geo.latitude).toBeCloseTo(centre("חולון").lat, 4);
    expect(geo.longitude).toBeCloseTo(centre("חולון").lon, 4);
    expect(geo.geocode_precision).toBe("locality");
    expect(geo.geocode_source).toContain("town centre");
  });

  it("recognises another spelling, and a neighbourhood inside a town", async () => {
    const w = await world();
    const typo = await branch(w, "קרית אונו");
    const quarter = await branch(w, "ירושלים תלפיות");
    const aka = await branch(w, "נצרת עילית");
    await place(w);

    expect((await geoOf(w, typo.id)).latitude).toBeCloseTo(centre("קריית אונו").lat, 4);
    expect((await geoOf(w, quarter.id)).latitude).toBeCloseTo(centre("ירושלים").lat, 4);
    expect((await geoOf(w, aka.id)).latitude).toBeCloseTo(centre("נוף הגליל").lat, 4);
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

  it("recognises a settlement written as its official number, which some chains do", async () => {
    // Found on staging: the towns we had failed to match were not towns. 4000 (50
    // branches), 7600, 2660, 9400, 9500, 7800 — CBS settlement symbols, written where
    // the name goes. Perfectly valid data that name matching could never see.
    const w = await world();
    const haifa = await branch(w, "4000");
    const withZeros = await branch(w, "0007600");
    await place(w);

    expect((await geoOf(w, haifa.id)).latitude).toBeCloseTo(centre("חיפה").lat, 4);
    expect((await geoOf(w, withZeros.id)).latitude).toBeCloseTo(centre("עכו").lat, 4);
  });

  it("still answers to its number when we placed the settlement by hand", async () => {
    // 2720 טירה, 2730 טייבה, 3616 מעלה אדומים and 3780 ביתר עילית were refused by the
    // import's gate (the dataset had put them on a geocoder's fallback point) and
    // re-added from the curated list — which arrived with no symbol, so every branch
    // naming them by number stayed unplaced. A refused COORDINATE is not a refused
    // identity: the government's key for a settlement is right whatever the geocoder
    // did with it.
    const w = await world();
    const tira = await branch(w, "2720");
    const maale = await branch(w, "3616");
    await place(w);

    expect((await geoOf(w, tira.id)).latitude).toBeCloseTo(centre("טירה").lat, 4);
    expect((await geoOf(w, maale.id)).latitude).toBeCloseTo(centre("מעלה אדומים").lat, 4);
  });

  it("still refuses a number that is not a settlement symbol", async () => {
    const w = await world();
    // "0" is the placeholder several chains use where a town should be, and 10018 is
    // a chain's own internal numbering. Neither is a place.
    const nonsense = await branch(w, "999999");
    const zero = await branch(w, "0");
    const internal = await branch(w, "10018");
    expect((await place(w)).rows[0].place_branches_by_town).toBe(0);
    expect((await geoOf(w, nonsense.id)).latitude).toBeNull();
    expect((await geoOf(w, zero.id)).latitude).toBeNull();
    expect((await geoOf(w, internal.id)).latitude).toBeNull();
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
    expect(profile.home_lat).toBeCloseTo(centre("רמת גן").lat, 4);
    expect(profile.home_lon).toBeCloseTo(centre("רמת גן").lon, 4);
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
