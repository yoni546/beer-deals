import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";

/**
 * The geographic foundation (migration 0026).
 *
 * The rule that shapes all of it: a branch we have not located is NOT at (0,0),
 * and it is not "probably nearby" either. It is a branch whose position we do not
 * know, and nothing may place it on a map or inside a radius. That is the same
 * discipline CLAUDE.md applies to a price with no trusted reference.
 */

async function branch(w: World, name: string, city: string, lat?: number, lon?: number) {
  const { rows } = await w.db.query<{ id: string }>(
    `insert into public.branches (store_id, external_ref, name_he, city, latitude, longitude, geocoded_at, geocode_source, geocode_precision)
     values ($1, $2, $3, $4, $5::double precision, $6::double precision,
             case when $5::double precision is null then null else now() end,
             case when $5::double precision is null then null else 'test-fixture' end,
             case when $5::double precision is null then null else 'rooftop' end)
     returning id`,
    [w.ids.rami, `ref-${name}`, name, city, lat ?? null, lon ?? null],
  );
  return rows[0].id;
}

// Tel Aviv and Haifa are ~85 km apart; Tel Aviv and Ramat Gan ~5 km.
const TEL_AVIV = { lat: 32.0853, lon: 34.7818 };
const RAMAT_GAN = { lat: 32.082, lon: 34.8141 };
const HAIFA = { lat: 32.794, lon: 34.9896 };
const BEERSHEVA = { lat: 31.2518, lon: 34.7913 };

describe("km_between", () => {
  it("measures a known distance", async () => {
    const w = await world();
    const { rows } = await w.db.query<{ km: number }>(
      "select public.km_between($1,$2,$3,$4) as km",
      [TEL_AVIV.lat, TEL_AVIV.lon, HAIFA.lat, HAIFA.lon],
    );
    // Tel Aviv to Haifa, great-circle: ~82 km.
    expect(rows[0].km).toBeGreaterThan(78);
    expect(rows[0].km).toBeLessThan(88);
  });

  it("is zero at the same point, and null when anything is missing", async () => {
    const w = await world();
    const same = await w.db.query<{ km: number }>("select public.km_between($1,$2,$1,$2) as km", [TEL_AVIV.lat, TEL_AVIV.lon]);
    expect(same.rows[0].km).toBeCloseTo(0, 6);

    const missing = await w.db.query<{ km: number | null }>("select public.km_between($1,$2,null,null) as km", [TEL_AVIV.lat, TEL_AVIV.lon]);
    expect(missing.rows[0].km).toBeNull();
  });
});

describe("branches_within_km", () => {
  it("returns the near ones, nearest first, and leaves the far ones out", async () => {
    const w = await world();
    await branch(w, "רמת גן", "רמת גן", RAMAT_GAN.lat, RAMAT_GAN.lon);
    await branch(w, "חיפה", "חיפה", HAIFA.lat, HAIFA.lon);
    await branch(w, "באר שבע", "באר שבע", BEERSHEVA.lat, BEERSHEVA.lon);

    const near = await w.db.query<{ name_he: string; km: number }>(
      "select name_he, km from public.branches_within_km($1, $2, 25)",
      [TEL_AVIV.lat, TEL_AVIV.lon],
    );
    expect(near.rows.map((r) => r.name_he)).toEqual(["רמת גן"]);
    expect(near.rows[0].km).toBeLessThan(5);

    const wide = await w.db.query<{ name_he: string }>(
      "select name_he from public.branches_within_km($1, $2, 0)", // 0 = nationwide
      [TEL_AVIV.lat, TEL_AVIV.lon],
    );
    expect(wide.rows.map((r) => r.name_he)).toEqual(["רמת גן", "חיפה", "באר שבע"]);
  });

  it("never returns a branch we have not located — not even nationwide", async () => {
    const w = await world();
    await branch(w, "יודע", "תל אביב", TEL_AVIV.lat, TEL_AVIV.lon);
    await branch(w, "לא יודע", "תל אביב"); // no coordinates

    const rows = await w.db.query<{ name_he: string }>(
      "select name_he from public.branches_within_km($1, $2, 0)",
      [TEL_AVIV.lat, TEL_AVIV.lon],
    );
    expect(rows.rows.map((r) => r.name_he)).toEqual(["יודע"]);
  });

  it("does not lose a branch that sits just inside the radius", async () => {
    const w = await world();
    // ~9.5 km due north of Tel Aviv: inside a 10 km radius, and the kind of case a
    // too-tight bounding box would drop before the exact distance was ever computed.
    await branch(w, "כמעט", "הרצליה", TEL_AVIV.lat + 0.0855, TEL_AVIV.lon);

    const rows = await w.db.query<{ name_he: string; km: number }>(
      "select name_he, km from public.branches_within_km($1, $2, 10)",
      [TEL_AVIV.lat, TEL_AVIV.lon],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].km).toBeLessThan(10);
  });

  it("leaves out a branch that is no longer active", async () => {
    const w = await world();
    const id = await branch(w, "סגור", "רמת גן", RAMAT_GAN.lat, RAMAT_GAN.lon);
    await w.db.query("update public.branches set is_active = false where id = $1", [id]);

    const rows = await w.db.query("select 1 from public.branches_within_km($1, $2, 0)", [TEL_AVIV.lat, TEL_AVIV.lon]);
    expect(rows.rows).toHaveLength(0);
  });
});

describe("a coordinate we cannot defend is refused at the table", () => {
  it("refuses half a coordinate", async () => {
    const w = await world();
    await expect(
      w.db.query(
        "insert into public.branches (store_id, external_ref, latitude) values ($1, 'half', 32.0)",
        [w.ids.rami],
      ),
    ).rejects.toThrow(/branches_geo_pair|geo_provenance/);
  });

  it("refuses a position outside Israel — a swapped pair, or a 0/0 fix", async () => {
    const w = await world();
    for (const [lat, lon] of [
      [34.7818, 32.0853], // latitude and longitude the wrong way round
      [0, 0],
      [51.5, -0.12], // London
    ]) {
      await expect(
        w.db.query(
          `insert into public.branches (store_id, external_ref, latitude, longitude, geocoded_at, geocode_source)
           values ($1, $2, $3, $4, now(), 'test')`,
          [w.ids.rami, `bad-${lat}-${lon}`, lat, lon],
        ),
      ).rejects.toThrow(/branches_geo_bounds/);
    }
  });

  it("refuses a coordinate with no recorded source", async () => {
    const w = await world();
    await expect(
      w.db.query(
        "insert into public.branches (store_id, external_ref, latitude, longitude) values ($1, 'nosource', 32.08, 34.78)",
        [w.ids.rami],
      ),
    ).rejects.toThrow(/branches_geo_provenance/);
  });
});

describe("save_location", () => {
  const call = (w: World, who: string, args: unknown[]) =>
    asUser(w.db, who, () => w.db.query("select public.save_location($1, $2, $3, $4)", args));

  it("saves a city, a point and a radius, and nothing else", async () => {
    const w = await world();
    await call(w, w.visitor, ["תל אביב-יפו", TEL_AVIV.lat, TEL_AVIV.lon, 15]);

    const { rows } = await w.db.query<{ home_city: string; home_lat: number; search_radius_km: number }>(
      "select home_city, home_lat, search_radius_km from public.profiles where id = $1",
      [w.visitor],
    );
    expect(rows[0]).toMatchObject({ home_city: "תל אביב-יפו", search_radius_km: 15 });
    expect(rows[0].home_lat).toBeCloseTo(TEL_AVIV.lat, 4);
  });

  it("takes a city with no point at all — the feature still has to work", async () => {
    const w = await world();
    // A village that is not in the town table (src/data/israel-cities.ts, migration
    // 0045): the name is kept, and no coordinate is invented for it. A town we DO
    // know gets its centre instead — tests/town-centres.test.ts holds that half.
    await call(w, w.visitor, ["כפר שאין כזה", null, null, 25]);
    const { rows } = await w.db.query<{ home_city: string; home_lat: number | null }>(
      "select home_city, home_lat from public.profiles where id = $1",
      [w.visitor],
    );
    expect(rows[0]).toEqual({ home_city: "כפר שאין כזה", home_lat: null });
  });

  it("refuses a radius that is not on offer, and half a coordinate", async () => {
    const w = await world();
    await expect(call(w, w.visitor, ["תל אביב", null, null, 7])).rejects.toThrow(/distances on offer/);
    await expect(call(w, w.visitor, ["תל אביב", TEL_AVIV.lat, null, 10])).rejects.toThrow(/not a place/);
  });

  it("refuses a caller who is not signed in", async () => {
    const w = await world();
    await expect(
      asUser(w.db, null, () => w.db.query("select public.save_location('תל אביב', null, null, 10)"), "anon"),
    ).rejects.toThrow(/permission denied/);
  });

  it("can only ever write the caller's own row", async () => {
    const w = await world();
    const other = await createUser(w.db);
    await call(w, w.visitor, ["חיפה", HAIFA.lat, HAIFA.lon, 20]);

    const theirs = await w.db.query<{ home_city: string | null }>(
      "select home_city from public.profiles where id = $1",
      [other],
    );
    expect(theirs.rows[0].home_city).toBeNull();
  });

  it("cannot be bypassed by writing the columns directly", async () => {
    const w = await world();
    // 0010 revoked table-wide UPDATE on profiles and re-granted it column by column;
    // the location columns are deliberately not in that grant.
    await expect(
      asUser(w.db, w.visitor, () =>
        w.db.query("update public.profiles set home_lat = 32.0, home_lon = 34.8 where id = $1", [w.visitor]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
