import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { israelHour } from "@/lib/push/rules";
import { processNotificationEvents, type PushSender } from "@/lib/push/worker";
import { SERVICE_KEY, startFakeSupabase } from "./e2e/fake-supabase/server.mjs";

/**
 * The notification pipeline end to end, against the repo's real migrations (PGlite) and the
 * real supabase-js client, with only the push transport faked:
 *
 *   promotion goes live ─(trigger)→ notification_events ─(worker + rules)→ push → notification_deliveries
 *
 * Every scenario the audit asked for (§13.2, acceptance 22–25): thresholds on VERIFIED savings,
 * primary-beer-only targeting, dedupe, cooldown, daily cap, quiet hours (defer, not drop),
 * retries with a ceiling, dead devices removed, invented data never notifying.
 */

type Fake = Awaited<ReturnType<typeof startFakeSupabase>>;
let fake: Fake;
let db: SupabaseClient;

const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await fake.query(sql, params)).rows as T[];
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];

const HOUR = 3_600_000;
let beerId: string;
let otherBeerId: string;
let ramiId: string;
let shufersalId: string;
let packSeed = 0;

beforeAll(async () => {
  fake = await startFakeSupabase({ port: 0 });
  db = createClient(fake.url, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  beerId = (await one<{ id: string }>("select id from public.beers where slug = 'goldstar'")).id;
  otherBeerId = (await one<{ id: string }>("select id from public.beers where slug = 'maccabee'")).id;
  ramiId = (await one<{ id: string }>("select id from public.stores where slug = 'rami-levy'")).id;
  shufersalId = (await one<{ id: string }>("select id from public.stores where slug = 'shufersal'")).id;
}, 120_000);

afterAll(async () => {
  await fake.close();
});

beforeEach(async () => {
  // Every test starts with an empty outbox, nobody subscribed from earlier tests, and the default rules.
  await rows("update public.profiles set notifications_enabled = false");
  await rows("update public.notification_events set status = 'done', outcome = 'test-reset' where status = 'pending'");
  await rows(
    `update public.app_settings set notify_min_discount_percent = 25, notify_max_price_agorot = 3000,
       notify_cooldown_hours = 20, notify_daily_cap = 2, notify_quiet_start = 22, notify_quiet_end = 8`,
  );
});

/** A person whose number-one beer is `beer`, with `devices` push subscriptions. */
async function person(opts: { beer?: string; enabled?: boolean; devices?: number } = {}) {
  const { id } = await one<{ id: string }>("insert into auth.users (email) values (null) returning id");
  await rows("update public.profiles set primary_beer_id = $2, notifications_enabled = $3 where id = $1", [id, opts.beer ?? beerId, opts.enabled ?? true]);
  for (let i = 0; i < (opts.devices ?? 1); i += 1) {
    await rows("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'p', 'a')", [id, `https://push.example/${id}/${i}`]);
  }
  return id;
}

/** A pack with a regular price and a promotion on it; returns the event the trigger queued. */
async function promotion(opts: { price?: number; regular?: number | null; source?: string; store?: string; beer?: string; validToHours?: number; multi?: boolean } = {}) {
  packSeed += 1;
  const sku = (await one<{ id: string }>(
    "insert into public.skus (beer_id, container, volume_ml, pack_quantity, display_he) values ($1, 'can', $2, 6, 'test') returning id",
    [opts.beer ?? beerId, 100 + packSeed],
  )).id;
  const source = (await one<{ id: string }>("select id from public.sources where slug = $1", [opts.source ?? "admin"])).id;
  const store = opts.store ?? ramiId;
  if (opts.regular !== null) {
    await rows(
      `insert into public.price_observations (sku_id, store_id, kind, price_agorot, observed_at, identity_key, source_id)
       values ($1, $2, 'regular', $3, now() - interval '1 hour', 'regular', $4)`,
      [sku, store, opts.regular ?? 3790, source],
    );
  }
  const price = opts.price ?? 2500;
  const conditions = opts.multi ? { multi_buy: { qty: 2, total_agorot: price * 2 } } : {};
  const { id } = await one<{ id: string }>(
    `insert into public.price_observations (sku_id, store_id, kind, price_agorot, observed_at, valid_to, promo_type, conditions, identity_key, source_id)
     values ($1, $2, 'promotion', $3, now(), now() + ($4 || ' hours')::interval, $5, $6::jsonb, 'promo', $7) returning id`,
    [sku, store, price, String(opts.validToHours ?? 120), opts.multi ? "multi_buy" : "price_cut", JSON.stringify(conditions), source],
  );
  return { sku, observationId: id, offerKey: `obs:${id}` };
}

const eventFor = (offerKey: string) => one<{ id: number; status: string; outcome: string | null }>("select id, status, outcome from public.notification_events where offer_key = $1", [offerKey]);
const deliveriesOf = (userId: string) => rows<{ status: string; reason: string | null; attempts: number; subscriptions_ok: number; subscriptions_total: number }>(
  "select status, reason, attempts, subscriptions_ok, subscriptions_total from public.notification_deliveries where user_id = $1 order by id",
  [userId],
);

/** An Israeli clock time `hour`:30 within the next 24 hours. */
function nextIsraelTime(hour: number, after = new Date()): Date {
  let t = new Date(Math.ceil(after.getTime() / HOUR) * HOUR + 30 * 60_000);
  while (israelHour(t) !== hour) t = new Date(t.getTime() + HOUR);
  return t;
}

const okSender = () => vi.fn<PushSender>(async () => undefined);
/** A moment that is not in the quiet window whatever day the suite runs. */
const daytime = () => nextIsraelTime(13);

describe("a promotion going live queues an event (the outbox)", () => {
  it("creates exactly one event per promotion, and replaying the same news adds nothing", async () => {
    const promo = await promotion();
    expect(await eventFor(promo.offerKey)).toMatchObject({ status: "pending" });

    // The same promotion (same pack, chain, kind, price, start) observed again is the same news.
    const first = await one<{ dedupe_key: string }>("select dedupe_key from public.notification_events where offer_key = $1", [promo.offerKey]);
    await rows(
      `insert into public.price_observations (sku_id, store_id, kind, price_agorot, observed_at, valid_to, promo_type, identity_key, source_id)
       select sku_id, store_id, kind, price_agorot, now() + interval '1 minute', valid_to, promo_type, identity_key, source_id
         from public.price_observations where id = $1`,
      [promo.observationId],
    );
    const same = await rows("select id from public.notification_events where dedupe_key = $1", [first.dedupe_key]);
    expect(same).toHaveLength(1);
  });

  it("never queues regular prices or invented (sample) data", async () => {
    const before = (await one<{ n: string }>("select count(*) n from public.notification_events")).n;
    const sample = await promotion({ source: "sample-data" });
    expect(await eventFor(sample.offerKey)).toBeUndefined();
    await rows(
      `insert into public.price_observations (sku_id, store_id, kind, price_agorot, observed_at, identity_key, source_id)
       values ($1, $2, 'regular', 3000, now(), 'regular2', (select id from public.sources where slug = 'admin'))`,
      [sample.sku, shufersalId],
    );
    expect((await one<{ n: string }>("select count(*) n from public.notification_events")).n).toBe(before);
  });

  it("queues an approved legacy deal, but not a sample one", async () => {
    const admin = (await one<{ id: string }>("insert into auth.users (email) values ('n-admin@example.test') returning id")).id;
    await rows("insert into public.admins (user_id, level) values ($1, 'super_admin')", [admin]);
    const insertDeal = async (store: string, notes: string | null) =>
      (await one<{ id: string }>(
        `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, notes)
         values ($1, $2, 'sixpack', 2490, 3990, 'pending', $3) returning id`,
        [beerId, store, notes],
      )).id;
    const real = await insertDeal(ramiId, null);
    const demo = await insertDeal(shufersalId, "מבצע לדוגמה");
    for (const id of [real, demo]) await rows("update public.deals set status = 'approved', approved_by = $2, approved_at = now() where id = $1", [id, admin]);

    expect(await eventFor(`deal:${real}`)).toMatchObject({ status: "pending" });
    expect(await eventFor(`deal:${demo}`)).toBeUndefined();
  });
});

describe("the worker", () => {
  it("sends a verified, strong promotion to the person whose number one it is — once", async () => {
    const user = await person();
    const promo = await promotion(); // 25.00 instead of 37.90 → 34 %
    const send = okSender();

    const first = await processNotificationEvents({ db, send, now: daytime() });
    expect(first).toMatchObject({ sent: 1, skipped: 0 });
    expect(send).toHaveBeenCalledTimes(1);

    const payload = JSON.parse(send.mock.calls[0][1]);
    expect(payload).toMatchObject({ title: "גולדסטאר ₪25.00 ברמי לוי", url: "/beer/goldstar", offerKey: promo.offerKey });
    // The price moved to the title with the beer and the shop (2026-10-25); the
    // body keeps the evidence behind it.
    expect(payload.body).toContain("במקום ₪37.90 · −34%");
    expect(send.mock.calls[0][2]).toEqual({ ttlSeconds: 43200 });

    expect(await deliveriesOf(user)).toEqual([expect.objectContaining({ status: "sent", attempts: 1, subscriptions_ok: 1, subscriptions_total: 1 })]);
    expect(await eventFor(promo.offerKey)).toMatchObject({ status: "done", outcome: "sent" });

    // Running again — a second cron tick, a retry of the request — sends nothing.
    const again = await processNotificationEvents({ db, send, now: daytime() });
    expect(again.events).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not interrupt people for whom this is only favourite #2–#4, or who switched it off", async () => {
    const primary = await person();
    const other = await person({ beer: otherBeerId });
    const off = await person({ enabled: false });
    await promotion();
    const send = okSender();
    await processNotificationEvents({ db, send, now: daytime() });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await deliveriesOf(primary)).toHaveLength(1);
    expect(await deliveriesOf(other)).toHaveLength(0);
    expect(await deliveriesOf(off)).toHaveLength(0);
  });

  it("says nothing about a promotion without a verified saving, however cheap", async () => {
    await person();
    const promo = await promotion({ regular: null, price: 500 });
    const send = okSender();
    await processNotificationEvents({ db, send, now: daytime() });
    expect(send).not.toHaveBeenCalled();
    expect(await eventFor(promo.offerKey)).toMatchObject({ status: "done", outcome: "no_verified_saving" });
  });

  it("applies the admin's thresholds: a weak saving and a dear price are not worth a buzz", async () => {
    await person();
    const weak = await promotion({ price: 3400, regular: 3790 }); // 10 %
    const dear = await promotion({ price: 3100, regular: 6200 }); // 50 % but over the ₪30 cap
    const send = okSender();
    await processNotificationEvents({ db, send, now: daytime() });
    expect(send).not.toHaveBeenCalled();
    expect((await eventFor(weak.offerKey))?.outcome).toBe("below_threshold");
    expect((await eventFor(dear.offerKey))?.outcome).toBe("over_price_cap");
  });

  it("holds the cooldown per beer: a second promotion within the window is recorded as skipped", async () => {
    const user = await person();
    await promotion();
    const at = daytime();
    const send = okSender();
    await processNotificationEvents({ db, send, now: at });
    const second = await promotion({ store: shufersalId });
    await processNotificationEvents({ db, send, now: new Date(at.getTime() + 2 * HOUR) });
    expect(send).toHaveBeenCalledTimes(1);
    // Since 0037 an event whose every recipient was skipped for the SAME reason says
    // that reason, as the threshold cases above already did — "all_skipped" is kept
    // for a genuine mixture.
    expect((await eventFor(second.offerKey))?.outcome).toBe("cooldown");
    expect((await deliveriesOf(user)).map((d) => [d.status, d.reason])).toEqual([["sent", null], ["skipped", "cooldown"]]);
  });

  it("holds the daily cap across beers' cooldowns", async () => {
    await rows("update public.app_settings set notify_cooldown_hours = 0");
    const user = await person();
    const at = daytime();
    const send = okSender();
    for (let i = 0; i < 3; i += 1) {
      await promotion();
      await processNotificationEvents({ db, send, now: new Date(at.getTime() + i * 60_000) });
    }
    expect(send).toHaveBeenCalledTimes(2);
    expect((await deliveriesOf(user)).map((d) => d.reason)).toEqual([null, null, "daily_cap"]);
  });

  it("defers during quiet hours and sends when they end — the promotion is still running", async () => {
    const user = await person();
    const promo = await promotion({ validToHours: 100 });
    const night = nextIsraelTime(23);
    const morning = nextIsraelTime(8, night);
    const send = okSender();

    const quiet = await processNotificationEvents({ db, send, now: night });
    expect(quiet).toMatchObject({ sent: 0, deferred: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(await eventFor(promo.offerKey)).toMatchObject({ status: "pending" });
    expect(await deliveriesOf(user)).toHaveLength(0);

    const loud = await processNotificationEvents({ db, send, now: morning });
    expect(loud.sent).toBe(1);
    expect(await eventFor(promo.offerKey)).toMatchObject({ status: "done", outcome: "sent" });
  });

  it("gives up on a deferred event once the deal has ended", async () => {
    const user = await person();
    const promo = await promotion({ validToHours: 6 });
    const send = okSender();
    const night = nextIsraelTime(23);
    await processNotificationEvents({ db, send, now: night });
    // Long after the promotion's end: the event expires with nobody told.
    await processNotificationEvents({ db, send, now: new Date(Date.now() + 200 * HOUR) });
    expect(send).not.toHaveBeenCalled();
    expect((await eventFor(promo.offerKey))?.status).toBe("done");
    expect(await deliveriesOf(user)).toHaveLength(0);
  });

  it("retries a transient failure, at most three times", async () => {
    const user = await person();
    await promotion();
    const flaky = vi.fn<PushSender>(async () => {
      throw Object.assign(new Error("push service unavailable"), { statusCode: 503 });
    });
    const at = daytime();

    expect(await processNotificationEvents({ db, send: flaky, now: at })).toMatchObject({ retried: 1, sent: 0 });
    expect((await deliveriesOf(user))[0]).toMatchObject({ status: "retry", attempts: 1 });

    expect(await processNotificationEvents({ db, send: flaky, now: new Date(at.getTime() + 60_000) })).toMatchObject({ retried: 1 });
    expect(await processNotificationEvents({ db, send: flaky, now: new Date(at.getTime() + 120_000) })).toMatchObject({ failed: 1, retried: 0 });
    expect(await deliveriesOf(user)).toEqual([expect.objectContaining({ status: "failed", reason: "push_error", attempts: 3 })]);
    expect(flaky).toHaveBeenCalledTimes(3);

    // A failed delivery is final: no fourth attempt, ever.
    await processNotificationEvents({ db, send: flaky, now: new Date(at.getTime() + 180_000) });
    expect(flaky).toHaveBeenCalledTimes(3);
  });

  it("a retry that succeeds updates the same delivery row", async () => {
    const user = await person();
    await promotion();
    let calls = 0;
    const send = vi.fn<PushSender>(async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("timeout"), { statusCode: 500 });
    });
    const at = daytime();
    await processNotificationEvents({ db, send, now: at });
    await processNotificationEvents({ db, send, now: new Date(at.getTime() + 60_000) });
    expect(await deliveriesOf(user)).toEqual([expect.objectContaining({ status: "sent", attempts: 2, subscriptions_ok: 1 })]);
  });

  it("removes a device the push service says is gone (404/410) and does not retry it", async () => {
    const user = await person({ devices: 2 });
    await promotion();
    const send = vi.fn<PushSender>(async (target) => {
      if (target.endpoint.endsWith("/0")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    const result = await processNotificationEvents({ db, send, now: daytime() });
    expect(result).toMatchObject({ sent: 1, devicesRemoved: 1 });
    expect(await deliveriesOf(user)).toEqual([expect.objectContaining({ status: "sent", subscriptions_ok: 1, subscriptions_total: 2 })]);
    expect((await rows("select id from public.push_subscriptions where user_id = $1", [user]))).toHaveLength(1);
  });

  it("marks a person whose every device is gone as failed, once", async () => {
    const user = await person();
    await promotion();
    const send = vi.fn<PushSender>(async () => {
      throw Object.assign(new Error("gone"), { statusCode: 404 });
    });
    await processNotificationEvents({ db, send, now: daytime() });
    expect(await deliveriesOf(user)).toEqual([expect.objectContaining({ status: "failed", reason: "subscription_gone" })]);
    expect(await rows("select id from public.push_subscriptions where user_id = $1", [user])).toHaveLength(0);
  });

  it("a rejected payload (4xx other than gone) is final, not retried", async () => {
    const user = await person();
    await promotion();
    const send = vi.fn<PushSender>(async () => {
      throw Object.assign(new Error("unauthorized vapid"), { statusCode: 401 });
    });
    await processNotificationEvents({ db, send, now: daytime() });
    expect(await deliveriesOf(user)).toEqual([expect.objectContaining({ status: "failed", attempts: 1 })]);
  });

  it("announces a multi-buy by its terms", async () => {
    await person();
    await promotion({ multi: true, price: 2000, regular: 3000 }); // 2 for ₪40.00
    const send = okSender();
    await processNotificationEvents({ db, send, now: daytime() });
    // The terms ARE the price, so they are in the title with it now (2026-10-25).
    expect(JSON.parse(send.mock.calls[0][1]).title).toContain("2 ב־₪40.00");
  });

  it("closes an event whose offer is no longer live instead of announcing it", async () => {
    await person();
    const promo = await promotion();
    await rows("alter table public.price_observations disable trigger user");
    await rows("update public.price_observations set valid_to = now() - interval '1 hour' where id = $1", [promo.observationId]);
    await rows("alter table public.price_observations enable trigger user");
    const send = okSender();
    await processNotificationEvents({ db, send, now: daytime() });
    expect(send).not.toHaveBeenCalled();
    expect((await eventFor(promo.offerKey))?.outcome).toMatch(/stale|expired/);
  });
});

describe("a chain promotion seen at several branches (0014)", () => {
  it("is announced once — even when the public feed shows another branch's row", async () => {
    const user = await person();
    const promo = await promotion({ price: 2500, regular: 3790 });
    // The same chain promotion at a second, cheaper-listed branch of the same chain.
    const branch = (await one<{ id: string }>("insert into public.branches (store_id, external_ref) values ($1, 'second') returning id", [ramiId])).id;
    await rows(
      `insert into public.price_observations (sku_id, store_id, branch_id, kind, price_agorot, observed_at, valid_to, promo_type, conditions, identity_key, source_id)
       select sku_id, store_id, $2, kind, price_agorot, observed_at + interval '1 minute', valid_to, promo_type, conditions, identity_key, source_id
         from public.price_observations where id = $1`,
      [promo.observationId, branch],
    );
    // The feed now shows the newer branch's row, not the one the event names…
    // (Rebuilt first: since 0044 the chain half is a table the import fills, and
    // this test just wrote a price straight into the ledger behind it.)
    await db.rpc("refresh_offers_catalog");
    const shown = await one<{ offer_key: string }>("select offer_key from public.offers_feed where sku_id = $1", [promo.sku]);
    expect(shown.offer_key).not.toBe(promo.offerKey);
    const sent = okSender();
    await processNotificationEvents({ db, send: sent, now: daytime() });
    expect(await eventFor(promo.offerKey)).toMatchObject({ status: "done", outcome: "sent" });
    expect(sent).toHaveBeenCalledTimes(1);
    expect((await deliveriesOf(user)).map((d) => d.status)).toEqual(["sent"]);
  });

  it("an offer only club members can use is never queued, even as the person's #1 beer", async () => {
    await person();
    const promo = await promotion({ price: 2000, regular: 3790 });
    const club = await one<{ id: string }>(
      `insert into public.price_observations (sku_id, store_id, kind, price_agorot, observed_at, valid_to, promo_type, conditions, identity_key, source_id)
       select sku_id, store_id, 'promotion', 1500, now(), now() + interval '2 days', 'price_cut', '{"audience": "club"}'::jsonb, 'club-1', source_id
         from public.price_observations where id = $1 returning id`,
      [promo.observationId],
    );
    expect(await eventFor(`obs:${club.id}`)).toBeUndefined();
  });
});

/**
 * The watchlist (migration 0037), through the real pipeline.
 *
 * What this has to prove is as much about what did NOT change: the outbox, the
 * worker and every per-person protection are the ones that were already here. A
 * watch adds a second reason somebody may be told, and lets them name their own
 * price — it does not buy them a way past the cooldown, the daily cap or the night.
 */
describe("a watched beer can reach a phone too (0037)", () => {
  /** Somebody whose number one is a DIFFERENT beer, watching `beer` at `price`. */
  async function watcher(opts: { price?: number | null; beer?: string } = {}) {
    const id = await person({ beer: otherBeerId });
    await rows("insert into public.watchlist (profile_id, beer_id, max_price_agorot) values ($1, $2, $3)", [
      id,
      opts.beer ?? beerId,
      opts.price ?? null,
    ]);
    return id;
  }

  it("tells somebody about a beer that is not their number one", async () => {
    const user = await watcher({ price: 2600 });
    await promotion({ price: 2500 });
    const send = okSender();
    await processNotificationEvents({ db, send, now: daytime() });

    expect(send).toHaveBeenCalledTimes(1);
    expect((await deliveriesOf(user)).map((d) => d.status)).toEqual(["sent"]);
  });

  it("honours their price and not the admin's percentage", async () => {
    // 10 % off: well below the admin's 25 % minimum, and exactly what this person
    // asked to be told about. Their ceiling is the more specific statement of intent.
    const user = await watcher({ price: 3500 });
    await promotion({ price: 3400, regular: 3790 });
    const send = okSender();
    await processNotificationEvents({ db, send, now: daytime() });

    expect(send).toHaveBeenCalledTimes(1);
    expect((await deliveriesOf(user)).map((d) => d.status)).toEqual(["sent"]);
  });

  it("says nothing when the price is above their ceiling", async () => {
    const user = await watcher({ price: 2000 });
    const promo = await promotion({ price: 2500 });
    const send = okSender();
    await processNotificationEvents({ db, send, now: daytime() });

    expect(send).not.toHaveBeenCalled();
    expect((await deliveriesOf(user)).map((d) => [d.status, d.reason])).toEqual([["skipped", "over_my_price"]]);
    expect((await eventFor(promo.offerKey))?.outcome).toBe("over_my_price");
  });

  it("reaches a watcher even on an offer the admin's rules would have dropped for everyone", async () => {
    // No regular price, so no verified saving: the old pipeline closed the EVENT on
    // this and nobody was ever asked. A watch hit states the price and claims no
    // percentage, so a trusted saving is not what it needs.
    const user = await watcher({ price: 1000 });
    await promotion({ regular: null, price: 500 });
    const send = okSender();
    await processNotificationEvents({ db, send, now: daytime() });

    expect(send).toHaveBeenCalledTimes(1);
    expect((await deliveriesOf(user)).map((d) => d.status)).toEqual(["sent"]);
  });

  it("still applies the admin's rules to a watch with no price of its own", async () => {
    const user = await watcher({ price: null });
    await promotion({ price: 3400, regular: 3790 }); // 10 %, under the minimum
    const send = okSender();
    await processNotificationEvents({ db, send, now: daytime() });

    expect(send).not.toHaveBeenCalled();
    expect((await deliveriesOf(user)).map((d) => d.reason)).toEqual(["below_threshold"]);
  });

  it("buys no way past the daily cap", async () => {
    await rows("update public.app_settings set notify_cooldown_hours = 0");
    const user = await watcher({ price: 9900 });
    const at = daytime();
    const send = okSender();
    for (let i = 0; i < 3; i += 1) {
      await promotion({ price: 2500 });
      await processNotificationEvents({ db, send, now: new Date(at.getTime() + i * 60_000) });
    }
    // Two, like everybody else. A watchlist is a statement about what matters, not a
    // subscription to noise.
    expect(send).toHaveBeenCalledTimes(2);
    expect((await deliveriesOf(user)).map((d) => d.reason)).toEqual([null, null, "daily_cap"]);
  });

  it("buys no way past the night either", async () => {
    const user = await watcher({ price: 9900 });
    await promotion({ price: 2500, validToHours: 100 });
    const send = okSender();
    await processNotificationEvents({ db, send, now: nextIsraelTime(23) });

    expect(send).not.toHaveBeenCalled();
    expect(await deliveriesOf(user)).toEqual([]); // deferred, not decided
  });

  it("says nothing to somebody with notifications off, watch or no watch", async () => {
    const id = await person({ beer: otherBeerId, enabled: false });
    await rows("insert into public.watchlist (profile_id, beer_id, max_price_agorot) values ($1, $2, 9900)", [
      id,
      beerId,
    ]);
    await promotion({ price: 2500 });
    const send = okSender();
    await processNotificationEvents({ db, send, now: daytime() });

    expect(send).not.toHaveBeenCalled();
  });

  it("does not notify twice when the beer is BOTH their number one and watched", async () => {
    const user = await person({ beer: beerId });
    await rows("insert into public.watchlist (profile_id, beer_id, max_price_agorot) values ($1, $2, 9900)", [
      user,
      beerId,
    ]);
    await promotion({ price: 2500 });
    const send = okSender();
    await processNotificationEvents({ db, send, now: daytime() });

    expect(send).toHaveBeenCalledTimes(1);
    expect(await deliveriesOf(user)).toHaveLength(1);
  });
});
