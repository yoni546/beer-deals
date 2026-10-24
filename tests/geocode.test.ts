import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { insideIsrael, isBetterFix, providerFrom, PRECISIONS } from "../scripts/ingest/lib/geocode/index.mjs";
import { asUser } from "./helpers/db";
import { world } from "./helpers/catalog";

/**
 * Geocoding, and the one thing it must never do.
 *
 * An invented coordinate is the single failure this product cannot absorb. A missing
 * position is visible everywhere — the admin count, the "closest to me" screen, the
 * branch list. A WRONG one is visible nowhere, and the person it misleads is standing
 * outside the wrong supermarket. So the default configuration refuses, and every
 * answer is checked before it is believed.
 */

describe("the provider that is used when nothing is configured", () => {
  it("refuses every address, and says it is not configured", async () => {
    const provider = providerFrom({});
    expect(provider.name).toBe("null");
    expect(provider.configured).toBe(false);
    expect(await provider.geocode("רחוב הרצל 1", "תל אביב")).toBeNull();
    expect(await provider.geocode("", "")).toBeNull();
  });

  it("is what an unknown setting gets — a typo must not silently fall through to a real one", () => {
    expect(() => providerFrom({ GEOCODER: "gogle" })).toThrow(/not a provider I know/);
  });

  it("will not let nominatim run without an identifiable contact", async () => {
    const provider = providerFrom({ GEOCODER: "nominatim" });
    expect(provider.configured).toBe(false);
    await expect(provider.geocode("רחוב הרצל 1", "תל אביב")).rejects.toThrow(/GEOCODER_CONTACT/);
  });
});

describe("what counts as a plausible answer", () => {
  it("accepts a point in Israel and refuses everything else", () => {
    expect(insideIsrael(32.0853, 34.7818)).toBe(true); // Tel Aviv
    expect(insideIsrael(29.5577, 34.9519)).toBe(true); // Eilat
    expect(insideIsrael(34.7818, 32.0853)).toBe(false); // the pair the wrong way round
    expect(insideIsrael(0, 0)).toBe(false);
    expect(insideIsrael(51.5, -0.12)).toBe(false); // London
    expect(insideIsrael(Number.NaN, 34.8)).toBe(false);
  });

  it("knows only the three precisions the database accepts", () => {
    expect(PRECISIONS).toEqual(["rooftop", "street", "locality"]);
  });
});

describe("the runner", () => {
  const source = readFileSync("scripts/ingest/geocode.mjs", "utf8");

  it("writes nothing unless asked", () => {
    expect(source).toContain('const APPLY = args.includes("--apply")');
    expect(source).toMatch(/if \(!APPLY\) continue;/);
  });

  it("reads its configuration only from the target's env file, never from the shell", () => {
    // The same rule the writer follows, and the same test that caught it being broken.
    expect(source).toContain("loadTarget(ROOT, args)");
    expect(source.includes("process.env")).toBe(false);
  });

  it("only looks at branches that have no position yet", () => {
    expect(source).toMatch(/\.is\("latitude", null\)/);
  });

  it("never writes a point without its provenance", () => {
    // 0026's CHECK refuses it anyway; this is so the refusal never has to happen.
    for (const field of ["geocoded_at", "geocode_source", "geocode_precision"]) {
      expect(source, field).toContain(field);
    }
  });
});

describe("the database will not hold a coordinate it cannot defend", () => {
  it("refuses a point outside Israel even when the provenance is perfect", async () => {
    const w = await world();
    await expect(
      w.db.query(
        `insert into public.branches (store_id, external_ref, latitude, longitude, geocoded_at, geocode_source, geocode_precision)
         values ($1, 'london', 51.5, -0.12, now(), 'nominatim', 'rooftop')`,
        [w.ids.rami],
      ),
    ).rejects.toThrow(/branches_geo_bounds/);
  });

  it("refuses a point with no source, however plausible it is", async () => {
    const w = await world();
    await expect(
      w.db.query(
        `insert into public.branches (store_id, external_ref, latitude, longitude)
         values ($1, 'nosource', 32.0853, 34.7818)`,
        [w.ids.rami],
      ),
    ).rejects.toThrow(/branches_geo_provenance/);
  });

  it("refuses a precision it does not recognise", async () => {
    const w = await world();
    await expect(
      w.db.query(
        `insert into public.branches (store_id, external_ref, latitude, longitude, geocoded_at, geocode_source, geocode_precision)
         values ($1, 'vague', 32.0853, 34.7818, now(), 'nominatim', 'about right')`,
        [w.ids.rami],
      ),
    ).rejects.toThrow(/branches_geocode_precision/);
  });

  it("takes a properly provenanced point", async () => {
    const w = await world();
    await w.db.query(
      `insert into public.branches (store_id, external_ref, name_he, city, latitude, longitude, geocoded_at, geocode_source, geocode_precision)
       values ($1, 'ok', 'רמי לוי דיזנגוף', 'תל אביב-יפו', 32.0775, 34.7738, now(), 'nominatim', 'rooftop')`,
      [w.ids.rami],
    );
    const { rows } = await w.db.query<{ n: number }>("select count(*)::int n from public.branches where latitude is not null");
    expect(rows[0].n).toBe(1);
  });
});

describe("the admin can see how big the gap is", () => {
  it("counts the branches we can place, the ones worth trying, and the hopeless ones", async () => {
    const w = await world();
    const moderator = await (async () => {
      const { createUser } = await import("./helpers/db");
      const id = await createUser(w.db, "mod@example.test");
      await w.db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [id]);
      return id;
    })();

    await w.db.query(
      `insert into public.branches (store_id, external_ref, city, latitude, longitude, geocoded_at, geocode_source, geocode_precision)
       values ($1, 'located', 'תל אביב-יפו', 32.0775, 34.7738, now(), 'nominatim', 'rooftop')`,
      [w.ids.rami],
    );
    await w.db.query(`insert into public.branches (store_id, external_ref, city) values ($1, 'has-city', 'חיפה')`, [w.ids.rami]);
    await w.db.query(`insert into public.branches (store_id, external_ref) values ($1, 'nothing')`, [w.ids.rami]);

    const { rows } = await asUser(w.db, moderator, () =>
      w.db.query<{ o: { branches: { total: number; located: number; geocodable: number; no_address: number } } }>(
        "select public.admin_overview() as o",
      ),
    );
    expect(rows[0].o.branches).toEqual({ total: 3, located: 1, geocodable: 1, no_address: 1 });
  });
});

/**
 * Upgrading the thousand branches that already sit on their town's centre.
 *
 * Migration 0045 gave every branch whose town we recognise the centre of that town.
 * That answers "is there a Rami Levy in my town" and openly does not point at the
 * shop's door — and on a map it is a thousand shops stacked on twenty town squares.
 *
 * The obvious way to re-do them is to blank the column and let the ordinary pass
 * pick them up. That trades a coarse position for NO position the moment a lookup
 * fails, and a failed lookup is the common case here, not the rare one. So nothing
 * is ever cleared: the row is read with its precision and written only when the new
 * answer is strictly better. A branch can move from the town square to its door. It
 * can never move back to nothing.
 */
describe("a position is only ever replaced by a better one", () => {
  it("accepts a sharper fix", () => {
    expect(isBetterFix("rooftop", "locality")).toBe(true);
    expect(isBetterFix("street", "locality")).toBe(true);
    expect(isBetterFix("rooftop", "street")).toBe(true);
  });

  it("refuses an equal or coarser one — a town centre is not replaced by another town centre", () => {
    expect(isBetterFix("locality", "locality")).toBe(false);
    expect(isBetterFix("street", "street")).toBe(false);
    expect(isBetterFix("locality", "street")).toBe(false);
    expect(isBetterFix("locality", "rooftop")).toBe(false);
  });

  it("takes anything it understands for a branch that has no position", () => {
    expect(isBetterFix("locality", null)).toBe(true);
    expect(isBetterFix("rooftop", undefined)).toBe(true);
  });

  it("never trusts a precision it does not know, whatever is already there", () => {
    expect(isBetterFix("approximate", "locality")).toBe(false);
    expect(isBetterFix("", null)).toBe(false);
    expect(isBetterFix(undefined, null)).toBe(false);
    // …and a row holding an unknown precision has nothing worth keeping.
    expect(isBetterFix("street", "guessed")).toBe(true);
  });
});
