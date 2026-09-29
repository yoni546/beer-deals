import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createUser, freshDatabase } from "./helpers/db";

/**
 * Who may touch the notification tables (migration 0012), asserted from non-superuser
 * sessions — RLS and grants do not apply to a superuser, so anything else proves nothing.
 *
 *   notification_events / notification_deliveries   service role only; nobody else can even read
 *   admin_recent_deliveries()                       any admin
 *   update_notification_rules()                     super admin only, with sane bounds
 */
let db: PGlite;
let person: string;
let admin: string;
let superAdmin: string;
let beerId: string;

beforeAll(async () => {
  db = await freshDatabase();
  person = await createUser(db, "person@example.test");
  admin = await createUser(db, "admin@example.test");
  superAdmin = await createUser(db, "super@example.test");
  await db.query("insert into public.admins (user_id, level) values ($1, 'admin'), ($2, 'super_admin')", [admin, superAdmin]);
  beerId = (await db.query<{ id: string }>("select id from public.beers where slug = 'goldstar'")).rows[0].id;
  await db.query("insert into public.notification_events (dedupe_key, offer_key, beer_id, expires_at) values ('k', 'obs:1', $1, now() + interval '1 day')", [beerId]);
  await db.query("insert into public.notification_deliveries (event_id, user_id, beer_id, status) select id, $1, $2, 'sent' from public.notification_events", [person, beerId]);
});

afterAll(async () => {
  await db?.close();
});

describe("the outbox and the delivery log are closed to the API", () => {
  for (const role of ["anon", "authenticated"] as const) {
    it(`${role} cannot read, write or delete either table`, async () => {
      const as = (work: () => Promise<unknown>) => asUser(db, role === "anon" ? null : person, work, role);
      for (const table of ["notification_events", "notification_deliveries"]) {
        await expect(as(() => db.query(`select * from public.${table}`))).rejects.toThrow(/permission denied/);
        await expect(as(() => db.query(`delete from public.${table}`))).rejects.toThrow(/permission denied/);
      }
      await expect(as(() => db.query("insert into public.notification_deliveries (user_id, status) values ($1, 'sent')", [person]))).rejects.toThrow(/permission denied/);
      await expect(as(() => db.query("update public.notification_events set status = 'done'"))).rejects.toThrow(/permission denied/);
    });
  }

  it("the service role can do what the worker needs, and no more", async () => {
    const worker = (work: () => Promise<unknown>) => asUser(db, null, work, "service_role");
    await expect(worker(() => db.query("select * from public.notification_events"))).resolves.toBeDefined();
    await expect(worker(() => db.query("update public.notification_events set status = 'done' where dedupe_key = 'k'"))).resolves.toBeDefined();
    await expect(worker(() => db.query("insert into public.notification_deliveries (user_id, status, kind) values ($1, 'sent', 'test')", [person]))).resolves.toBeDefined();
    await expect(worker(() => db.query("delete from public.notification_deliveries"))).rejects.toThrow(/permission denied/);
    await expect(worker(() => db.query("insert into public.notification_events (dedupe_key, offer_key, beer_id, expires_at) values ('x', 'obs:2', $1, now())", [beerId]))).rejects.toThrow(/permission denied/);
  });
});

describe("the delivery log for admins", () => {
  it("is readable by an admin, shortened, and by nobody else", async () => {
    const rows = await asUser(db, admin, () => db.query<{ recipient: string; beer_name: string }>("select * from public.admin_recent_deliveries(10)"));
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) expect(row.recipient).toHaveLength(8); // never the whole user id
    expect(rows.rows.map((row) => row.beer_name)).toContain("גולדסטאר");

    await expect(asUser(db, person, () => db.query("select * from public.admin_recent_deliveries()"))).rejects.toThrow(/admin privileges required/);
    await expect(asUser(db, null, () => db.query("select * from public.admin_recent_deliveries()"), "anon")).rejects.toThrow(/permission denied/);
  });
});

describe("the rules", () => {
  const rules = (uid: string) =>
    asUser(db, uid, () => db.query("select * from public.update_notification_rules(30, 2500, 12, 3, 23, 7)"));

  it("only a super admin can change them", async () => {
    await expect(rules(admin)).rejects.toThrow(/super admin privileges required/);
    await expect(rules(person)).rejects.toThrow(/super admin privileges required/);
    const saved = await rules(superAdmin);
    expect(saved.rows[0]).toMatchObject({ notify_min_discount_percent: 30, notify_max_price_agorot: 2500, notify_cooldown_hours: 12, notify_daily_cap: 3, notify_quiet_start: 23, notify_quiet_end: 7 });
  });

  it("refuses nonsense: a zero cap, an hour that does not exist", async () => {
    const attempt = (cap: number, start: number) =>
      asUser(db, superAdmin, () => db.query("select * from public.update_notification_rules(25, 3000, 20, $1, $2, 8)", [cap, start]));
    await expect(attempt(0, 22)).rejects.toThrow(/notify_daily_cap/);
    await expect(attempt(11, 22)).rejects.toThrow(/notify_daily_cap/);
    await expect(attempt(2, 24)).rejects.toThrow(/notify_quiet_start/);
  });
});

describe("a delivery is unique per event and person", () => {
  it("refuses a second delivery row for the same news and person", async () => {
    await expect(
      db.query("insert into public.notification_deliveries (event_id, user_id, beer_id, status) select id, $1, $2, 'sent' from public.notification_events", [person, beerId]),
    ).rejects.toThrow(/unique/i);
  });
});
