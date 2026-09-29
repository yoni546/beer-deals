import { describe, expect, it } from "vitest";
import { asUser, createUser, freshDatabase } from "./helpers/db";

/**
 * Migration 0010 — two holes from the 2026-09-29 audit:
 *   S-9   a user could rewrite any column of their own profile
 *   S-10  a browser already registered under another identity could not re-register
 */

async function setup() {
  const db = await freshDatabase();
  const alice = await createUser(db);
  const bob = await createUser(db);
  const beers = (await db.query<{ id: string }>("select id from public.beers order by sort_order limit 5")).rows.map((r) => r.id);
  return { db, alice, bob, beers };
}

describe("S-9 · a profile owner cannot rewrite the columns the database owns", () => {
  it("refuses a hand-written primary_beer_id (it decides the theme and who gets notified)", async () => {
    const { db, alice, beers } = await setup();
    await expect(
      asUser(db, alice, () => db.query("update public.profiles set primary_beer_id = $2 where id = $1", [alice, beers[0]])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("refuses a hand-written onboarded_at", async () => {
    const { db, alice } = await setup();
    await expect(
      asUser(db, alice, () => db.query("update public.profiles set onboarded_at = now() where id = $1", [alice])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("still lets them change their name and their notification preference", async () => {
    const { db, alice } = await setup();
    await asUser(db, alice, () =>
      db.query("update public.profiles set first_name = 'Dana', notifications_enabled = true where id = $1", [alice]),
    );
    const { rows } = await db.query<{ first_name: string; notifications_enabled: boolean }>(
      "select first_name, notifications_enabled from public.profiles where id = $1",
      [alice],
    );
    expect(rows[0]).toEqual({ first_name: "Dana", notifications_enabled: true });
  });

  it("still onboards through save_preferences(), which sets the derived columns itself", async () => {
    const { db, alice, beers } = await setup();
    await asUser(db, alice, () => db.query("select public.save_preferences('Dana', $1::uuid[])", [beers.slice(0, 4)]));

    const { rows } = await db.query<{ primary_beer_id: string; onboarded: boolean }>(
      "select primary_beer_id, onboarded_at is not null as onboarded from public.profiles where id = $1",
      [alice],
    );
    expect(rows[0]).toEqual({ primary_beer_id: beers[0], onboarded: true });
  });

  it("does not let save_preferences() be used on someone else's profile", async () => {
    const { db, alice, bob, beers } = await setup();
    await asUser(db, alice, () => db.query("select public.save_preferences('Alice', $1::uuid[])", [beers.slice(0, 4)]));
    await asUser(db, bob, () => db.query("select public.save_preferences('Bob', $1::uuid[])", [beers.slice(1, 5)]));

    const { rows } = await db.query<{ first_name: string; primary: string }>(
      "select first_name, primary_beer_id as primary from public.profiles where id = any($1::uuid[]) order by first_name",
      [[alice, bob]],
    );
    expect(rows).toEqual([
      { first_name: "Alice", primary: beers[0] },
      { first_name: "Bob", primary: beers[1] },
    ]);
  });

  it("rejects a signed-out caller and a wrong-sized list, as before", async () => {
    const { db, alice, beers } = await setup();
    await expect(asUser(db, null, () => db.query("select public.save_preferences('x', $1::uuid[])", [beers.slice(0, 4)]), "anon")).rejects.toThrow();
    await expect(asUser(db, alice, () => db.query("select public.save_preferences('x', $1::uuid[])", [beers.slice(0, 3)]))).rejects.toMatchObject({ code: "22023" });
  });
});

describe("S-10 · a device can move to a new identity", () => {
  const endpoint = "https://push.example/device-1";
  const save = (db: Awaited<ReturnType<typeof setup>>["db"], keys = "k1") =>
    db.query("select public.save_push_subscription($1, $2, $3, 'test-agent')", [endpoint, `p256dh-${keys}`, `auth-${keys}`]);

  it("re-registers an endpoint that another identity held, moving it to the caller", async () => {
    const { db, alice, bob } = await setup();
    await asUser(db, alice, () => save(db, "old"));
    await asUser(db, bob, () => save(db, "new")); // used to fail with an RLS error

    const { rows } = await db.query<{ user_id: string; p256dh: string }>("select user_id, p256dh from public.push_subscriptions");
    expect(rows).toEqual([{ user_id: bob, p256dh: "p256dh-new" }]);
  });

  it("means the previous identity no longer sees (or receives) it", async () => {
    const { db, alice, bob } = await setup();
    await asUser(db, alice, () => save(db));
    await asUser(db, bob, () => save(db));
    const aliceSees = await asUser(db, alice, () => db.query("select count(*)::int as n from public.push_subscriptions"));
    expect(aliceSees.rows[0]).toEqual({ n: 0 });
  });

  it("is still an upsert for the same identity, and still needs a signed-in caller", async () => {
    const { db, alice } = await setup();
    await asUser(db, alice, () => save(db, "a"));
    await asUser(db, alice, () => save(db, "b"));
    const { rows } = await db.query<{ n: number; p256dh: string }>("select count(*)::int as n, max(p256dh) as p256dh from public.push_subscriptions");
    expect(rows[0]).toEqual({ n: 1, p256dh: "p256dh-b" });

    await expect(asUser(db, null, () => save(db), "anon")).rejects.toThrow();
  });
});
