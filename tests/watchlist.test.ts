import { describe, expect, it } from "vitest";
import { asUser, createUser } from "./helpers/db";
import { world, type World } from "./helpers/catalog";

/**
 * The watchlist (migration 0037).
 *
 * Before it, exactly one beer could reach a phone — favourite #1 — and only on a
 * deal that cleared the administrator's global thresholds. Somebody who wanted to
 * hear about a sixth beer, or about their own price rather than an admin's
 * percentage, had nowhere to say so.
 *
 * What the pipeline does with a watch is tested end to end in
 * tests/notifications-worker.test.ts. This file is about the data: whose it is,
 * who can read it, and the two limits that keep it from becoming a firehose.
 */

const watch = (w: World, who: string, beerId: string, price?: number) =>
  asUser(w.db, who, () => w.db.query("select public.watch_beer($1, $2)", [beerId, price ?? null]));

const mine = async (w: World, who: string) =>
  (await asUser(w.db, who, () =>
    w.db.query<{ beer_id: string; max_price_agorot: number | null }>(
      "select beer_id, max_price_agorot from public.watchlist order by created_at",
    ),
  )).rows;

describe("a watch is yours", () => {
  it("records the beer and the price you named", async () => {
    const w = await world();
    await watch(w, w.visitor, w.ids.goldstar, 2500);
    expect(await mine(w, w.visitor)).toEqual([{ beer_id: w.ids.goldstar, max_price_agorot: 2500 }]);
  });

  it("takes no price, which means 'treat it like my number one'", async () => {
    const w = await world();
    await watch(w, w.visitor, w.ids.goldstar);
    expect(await mine(w, w.visitor)).toEqual([{ beer_id: w.ids.goldstar, max_price_agorot: null }]);
  });

  it("changes the price rather than adding a second row", async () => {
    const w = await world();
    await watch(w, w.visitor, w.ids.goldstar, 2500);
    await watch(w, w.visitor, w.ids.goldstar, 2200);
    expect(await mine(w, w.visitor)).toEqual([{ beer_id: w.ids.goldstar, max_price_agorot: 2200 }]);
  });

  it("can be taken off", async () => {
    const w = await world();
    await watch(w, w.visitor, w.ids.goldstar, 2500);
    await asUser(w.db, w.visitor, () => w.db.query("select public.unwatch_beer($1)", [w.ids.goldstar]));
    expect(await mine(w, w.visitor)).toEqual([]);
  });

  it("is invisible to everybody else", async () => {
    const w = await world();
    const other = await createUser(w.db, "other@example.test");
    await watch(w, w.visitor, w.ids.goldstar, 2500);

    // Not hidden by a query, hidden by RLS: the other person's own read returns nothing.
    expect(await mine(w, other)).toEqual([]);
    // Nor can they write one for somebody else.
    await expect(
      asUser(w.db, other, () =>
        w.db.query("insert into public.watchlist (profile_id, beer_id) values ($1, $2)", [w.visitor, w.ids.goldstar]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses a caller who is not signed in", async () => {
    const w = await world();
    await expect(
      asUser(w.db, null, () => w.db.query("select public.watch_beer($1)", [w.ids.goldstar]), "anon"),
    ).rejects.toThrow(/permission denied|not signed in/);
  });

  it("refuses a beer that does not exist, and a price that is not a price", async () => {
    const w = await world();
    await expect(
      asUser(w.db, w.visitor, () =>
        w.db.query("select public.watch_beer('00000000-0000-0000-0000-000000000000'::uuid)"),
      ),
    ).rejects.toThrow(/beer not found/);
    await expect(watch(w, w.visitor, w.ids.goldstar, 5)).rejects.toThrow(/בין ₪1 ל-₪1000/);
    await expect(watch(w, w.visitor, w.ids.goldstar, 200000)).rejects.toThrow(/בין ₪1 ל-₪1000/);
  });
});

describe("ten at a time", () => {
  it("stops at ten, in the database and not only in the form", async () => {
    const w = await world();
    const { rows: beers } = await w.db.query<{ id: string }>("select id from public.beers limit 11");
    expect(beers.length).toBeGreaterThan(10);

    for (const beer of beers.slice(0, 10)) await watch(w, w.visitor, beer.id);
    // A watchlist of two hundred beers is a firehose wearing a feature's clothes:
    // the daily cap would then pick which of them a person hears about, arbitrarily.
    await expect(watch(w, w.visitor, beers[10].id)).rejects.toThrow(/עשר בירות/);
    expect(await mine(w, w.visitor)).toHaveLength(10);
  });

  it("lets somebody at the limit change a price they already set", async () => {
    const w = await world();
    const { rows: beers } = await w.db.query<{ id: string }>("select id from public.beers limit 10");
    for (const beer of beers) await watch(w, w.visitor, beer.id);

    // The cap is on INSERT: swapping a price is not adding an eleventh beer.
    await expect(watch(w, w.visitor, beers[0].id, 1900)).resolves.toBeTruthy();
    expect((await mine(w, w.visitor)).find((r) => r.beer_id === beers[0].id)?.max_price_agorot).toBe(1900);
  });

  it("is a limit per person, not a limit on everybody", async () => {
    const w = await world();
    const other = await createUser(w.db, "other@example.test");
    const { rows: beers } = await w.db.query<{ id: string }>("select id from public.beers limit 10");
    for (const beer of beers) await watch(w, w.visitor, beer.id);

    await expect(watch(w, other, beers[0].id, 2500)).resolves.toBeTruthy();
  });
});
