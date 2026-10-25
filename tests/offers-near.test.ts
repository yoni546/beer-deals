import { describe, expect, it } from "vitest";
import { asUser } from "./helpers/db";
import { inDays, world, type World } from "./helpers/catalog";

/**
 * The deals around a point (0057) — what a map is drawn from.
 *
 * Migration 0039 refused to build a map and said why: every branch position was
 * null, and a pin in the wrong place is the one failure this product cannot
 * absorb. The positions exist now, so this is the query that answers "what is on
 * offer near here" — and the rules it must keep are the ones 0039 and 0026 set.
 *
 * The unit is a BRANCH, not a chain. offers_catalog holds one row per deal per
 * chain, naming the single branch the price was seen at; promotion_branches
 * holds every branch the promotion was actually observed at. A map built from
 * the first would show one pin for a deal running in forty shops.
 */

/** Tel Aviv, roughly. Distances below are from here. */
const TLV = { lat: 32.0853, lon: 34.7818 };

type Row = {
  branch_name: string;
  branch_city: string;
  km: number | null;
  beer_slug: string;
  store_slug: string;
  effective_agorot: number;
  latitude: number;
  longitude: number;
};

/**
 * One chain promotion, observed at the branches given. Each branch is placed (or
 * deliberately not) exactly as the geocoder would leave it.
 */
async function promotionAt(
  w: World,
  branches: Array<{ name: string; city: string; lat?: number; lon?: number; precision?: string }>,
  { beer = "goldstar", price = 2490 }: { beer?: "goldstar" | "maccabee"; price?: number } = {},
) {
  const store = w.ids.rami;
  const sku = await w.sku(w.ids[beer], "bottle", 330, 6);
  const key = `rami-levy:c:${beer}6-${price}`;
  const ids: string[] = [];

  for (const [i, b] of branches.entries()) {
    const row = await w.one<{ id: string }>(
      `insert into public.branches
         (store_id, external_ref, name_he, city, listed_in_stores_file, latitude, longitude, geocoded_at, geocode_source, geocode_precision)
       values ($1, $2, $3, $4, true, $5::double precision, $6::double precision,
               case when $5::double precision is null then null else now() end,
               case when $5::double precision is null then null else 'test' end,
               $7::text)
       returning id`,
      [store, `b${i}`, b.name, b.city, b.lat ?? null, b.lon ?? null, b.precision ?? (b.lat ? "rooftop" : null)],
    );
    ids.push(row.id);
  }

  // A scan, so promotion_branches has a current file per branch to believe (0017).
  await asUser(w.db, w.admin, () =>
    w.db.query("select public.record_branch_scan($1, $2, now(), $3::jsonb)", [
      `scan-${beer}`,
      store,
      JSON.stringify(ids.map((id) => ({ branch_id: id, status: "ok", promo_file: `promo-${id}` }))),
    ]),
  );

  for (const branch of ids) {
    await w.record({ sku, store, branch, kind: "promotion", promoType: "price_cut", price, naturalKey: key, validTo: inDays(5) });
  }

  await asUser(w.db, w.admin, () =>
    w.db.query("select public.record_promotion_occurrences($1, $2::jsonb)", [
      store,
      JSON.stringify(ids.map((branch) => ({
        branch_id: branch, canonical_key: key, source_promotion_id: "P1",
        source_file: `promo-${branch}`, observed_at: new Date().toISOString(),
        kind: "price", price_agorot: price, published: true,
      }))),
    ]),
  );

  // The chain's promotions and their scope (0017). Without this there are no rows in
  // `promotions`, so the catalogue carries no promotion_id and nothing joins to a branch.
  await asUser(w.db, w.admin, () => w.db.query("select public.refresh_promotion_scope($1)", [store]));

  await w.rebuildFeed();
  return ids;
}

const near = (w: World, lat = TLV.lat, lon = TLV.lon, radius = 15) =>
  w.asPublic(() =>
    w.db.query<Row>("select * from public.offers_near($1, $2, $3, $4)", [lat, lon, radius, 400]),
  ).then((r) => r.rows);

describe("the deals around a point", () => {
  it("returns one row per branch the promotion runs at, not one per chain", async () => {
    const w = await world();
    await promotionAt(w, [
      { name: "דיזנגוף", city: "תל אביב", lat: 32.0809, lon: 34.7739 },
      { name: "אבן גבירול", city: "תל אביב", lat: 32.0864, lon: 34.7795 },
      { name: "יפו", city: "תל אביב", lat: 32.0553, lon: 34.7520 },
    ]);

    const rows = await near(w);
    expect(rows.map((r) => r.branch_name).sort()).toEqual(["אבן גבירול", "דיזנגוף", "יפו"]);
    // Every row carries the same deal — it is one promotion in three shops.
    expect(new Set(rows.map((r) => r.effective_agorot))).toEqual(new Set([2490]));
  });

  it("omits a branch it cannot place, rather than guessing one", async () => {
    const w = await world();
    await promotionAt(w, [
      { name: "יש לו מיקום", city: "תל אביב", lat: 32.0809, lon: 34.7739 },
      { name: "אין לו מיקום", city: "תל אביב" },
    ]);

    const rows = await near(w);
    expect(rows.map((r) => r.branch_name)).toEqual(["יש לו מיקום"]);
    // Not 0 km, not the city centre standing in for a shop: simply not on the map.
    expect(rows.every((r) => r.km !== null)).toBe(true);
  });

  it("keeps out what is beyond the radius, and nothing beyond it leaks in", async () => {
    const w = await world();
    await promotionAt(w, [
      { name: "קרוב", city: "תל אביב", lat: 32.0809, lon: 34.7739 },
      { name: "רחוק", city: "אילת", lat: 29.5577, lon: 34.9519 },
    ]);

    expect((await near(w, TLV.lat, TLV.lon, 15)).map((r) => r.branch_name)).toEqual(["קרוב"]);
    // 0 is "no limit", the same reading search_radius_km has everywhere else.
    expect((await near(w, TLV.lat, TLV.lon, 0)).map((r) => r.branch_name).sort()).toEqual(["קרוב", "רחוק"]);
  });

  it("puts the nearest first, and says how far each one is", async () => {
    const w = await world();
    await promotionAt(w, [
      { name: "הרחוק יותר", city: "תל אביב", lat: 32.1200, lon: 34.8200 },
      { name: "הקרוב", city: "תל אביב", lat: 32.0860, lon: 34.7820 },
    ]);

    const rows = await near(w);
    expect(rows.map((r) => r.branch_name)).toEqual(["הקרוב", "הרחוק יותר"]);
    expect(rows[0].km!).toBeLessThan(1);
    expect(rows[1].km!).toBeGreaterThan(3);
  });

  it("answers nothing at all without a point, instead of the whole country", async () => {
    const w = await world();
    await promotionAt(w, [{ name: "דיזנגוף", city: "תל אביב", lat: 32.0809, lon: 34.7739 }]);

    const rows = await w.asPublic(() =>
      w.db.query<Row>("select * from public.offers_near(null, null, 15, 400)"),
    ).then((r) => r.rows);
    expect(rows).toEqual([]);
  });

  it("is readable by a visitor who is not signed in — a map is public", async () => {
    const w = await world();
    await promotionAt(w, [{ name: "דיזנגוף", city: "תל אביב", lat: 32.0809, lon: 34.7739 }]);
    const rows = await near(w);
    expect(rows).toHaveLength(1);
    expect(rows[0].store_slug).toBe("rami-levy");
    expect(rows[0].beer_slug).toBe("goldstar");
  });
});

/**
 * The whole country, by town (0064).
 *
 * MEASURED against production, after the owner chose "בכל הארץ" and saw only
 * what was within about forty kilometres of him: offers_near orders by distance
 * and PostgREST caps any response at 1,000 rows, so "no radius" came back as the
 * nearest hundred branches around one city. The radius was honoured and the
 * answer was still wrong.
 *
 * One row per POINT rather than per branch, because branches sit at their town's
 * centre until a geocoder puts them on a street — and a thousand markers on a
 * phone is not a map.
 */
describe("the whole country", () => {
  const byTown = (w: World) =>
    w.asPublic(() => w.db.query<{ town: string; branches: number; deals: number; best_value_pct: number | null; latitude: number }>(
      "select * from public.deals_by_town()",
    )).then((r) => r.rows);

  it("gives one row per point, with what is there counted", async () => {
    const w = await world();
    // Three branches sharing a town centre, and one placed on its own street.
    await promotionAt(w, [
      { name: "סניף א", city: "תל אביב", lat: 32.0853, lon: 34.7818, precision: "locality" },
      { name: "סניף ב", city: "תל אביב", lat: 32.0853, lon: 34.7818, precision: "locality" },
      { name: "סניף ג", city: "חיפה", lat: 32.7940, lon: 34.9896, precision: "locality" },
    ]);

    const rows = await byTown(w);
    expect(rows).toHaveLength(2);
    const tlv = rows.find((r) => Math.abs(r.latitude - 32.0853) < 0.001)!;
    expect(tlv.branches).toBe(2);
    expect(tlv.deals).toBe(2);
  });

  it("leaves out what it cannot place, exactly as the near view does", async () => {
    const w = await world();
    await promotionAt(w, [
      { name: "יש מיקום", city: "תל אביב", lat: 32.0853, lon: 34.7818 },
      { name: "אין מיקום", city: "תל אביב" },
    ]);
    const rows = await byTown(w);
    expect(rows).toHaveLength(1);
    expect(rows[0].branches).toBe(1);
  });

  it("is readable by a visitor who is not signed in", async () => {
    const w = await world();
    await promotionAt(w, [{ name: "סניף", city: "תל אביב", lat: 32.0853, lon: 34.7818 }]);
    expect((await byTown(w))[0].deals).toBe(1);
  });
});
