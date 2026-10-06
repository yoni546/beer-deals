import type { SupabaseClient } from "@supabase/supabase-js";
import type { Offer } from "@/lib/db/types";
import { buildOfferNotification } from "@/lib/push/message";
import {
  decide,
  eventVerdict,
  israelDayStart,
  type NotifySettings,
  type PushRecipient,
} from "@/lib/push/rules";

/**
 * The notification worker: turns pending `notification_events` (the outbox, filled by database
 * triggers when a promotion goes live or a legacy deal is approved) into pushes, and writes a
 * `notification_deliveries` row for every person it decides about.
 *
 * It is written against two injected things, so the whole flow can be tested with no network:
 *   db    a Supabase client with the service role (the tables have no API access for anyone else)
 *   send  the function that delivers one Web Push message to one device
 *
 * Guarantees:
 *   - One delivery row per (event, person): a person is never told the same news twice, however
 *     often the worker runs, and a crash between "sent" and "recorded" can at worst mean a
 *     retry of a device that may already have it — it cannot mean a duplicate row.
 *   - A transient failure (5xx, network) is retried on the next run, up to 3 attempts.
 *   - 404/410 from the push service means the device is gone: its subscription is deleted.
 *   - Quiet hours defer instead of dropping; an event stays pending until it expires.
 */

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type PushSender = (target: PushTarget, payload: string, options: { ttlSeconds: number }) => Promise<void>;

export type RunSummary = {
  events: number;
  sent: number;
  skipped: number;
  deferred: number;
  retried: number;
  failed: number;
  devicesRemoved: number;
};

const MAX_ATTEMPTS = 3;
const TTL_SECONDS = 12 * 60 * 60;

type EventRow = { id: number; offer_key: string; beer_id: string; expires_at: string };
type SubscriptionRow = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type DeliveryRow = { id: number; user_id: string; status: "sent" | "skipped" | "retry" | "failed"; attempts: number };
type HistoryRow = { user_id: string; beer_id: string | null; sent_at: string };
type ProfileRow = { id: string; primary_beer_id: string | null; notifications_enabled: boolean };

type SettingsRow = {
  notify_min_discount_percent: number;
  notify_max_price_agorot: number;
  notify_cooldown_hours: number;
  notify_daily_cap: number;
  notify_quiet_start: number;
  notify_quiet_end: number;
};

/**
 * The offer an event announces, from the read model (so it is still live, in force, redeemable by
 * everyone and in scope). A catalogue event names ONE branch's observation; the public feed shows one
 * row per chain promotion (migration 0014), possibly another branch's — so catalogue events are looked
 * up in offers_ranked, which has every branch. Legacy deals are only in offers_feed.
 */
async function loadOffer(db: SupabaseClient, offerKey: string): Promise<Offer | null> {
  if (!offerKey.startsWith("obs:")) {
    const result = await db.from("offers_feed").select("*").eq("offer_key", offerKey).maybeSingle();
    if (result.error) throw new Error(`offers unavailable: ${result.error.message}`);
    return (result.data as Offer | null) ?? null;
  }
  const result = await db.from("offers_ranked").select("*").eq("observation_id", Number(offerKey.slice(4))).maybeSingle();
  if (result.error) throw new Error(`offers unavailable: ${result.error.message}`);
  const row = result.data as (Omit<Offer, "offer_key" | "origin" | "pack_label" | "notes"> & { observation_id: number; sku_name: string; identity_key: string }) | null;
  if (!row) return null;
  // Where the promotion runs (0017), so the text never claims more than was checked.
  const scope = await db
    .from("promotions")
    .select("id, scope, scope_evidence, branches_known, branches_checked, branches_matching, coverage_as_of, only_branch_id")
    .eq("store_id", row.store_id)
    .eq("canonical_key", row.identity_key)
    .maybeSingle();
  const promotion = scope.error ? null : (scope.data as ({ id: number; only_branch_id: string | null } & Record<string, unknown>) | null);
  type BranchName = { name_he: string | null; city: string | null };
  let onlyBranch: BranchName | null = null;
  if (promotion?.only_branch_id) {
    const branch = await db.from("branches").select("name_he, city").eq("id", promotion.only_branch_id).maybeSingle();
    onlyBranch = (branch.data as BranchName | null) ?? null;
  }
  // The pack's form (0021), so a notification names a crate a ארגז and a 24-can tray a מארז 24.
  const sku = await db.from("skus").select("packaging").eq("id", row.sku_id).maybeSingle();
  return {
    ...row,
    offer_key: offerKey,
    origin: "catalog",
    pack_label: row.sku_name,
    packaging: sku.error ? null : ((sku.data as { packaging: Offer["packaging"] } | null)?.packaging ?? null),
    notes: null,
    ...(promotion ? { ...promotion, promotion_id: promotion.id, only_branch_name: onlyBranch?.name_he ?? null, only_branch_city: onlyBranch?.city ?? null } : {}),
  } as Offer;
}

const toSettings = (row: SettingsRow): NotifySettings => ({
  minValuePct: row.notify_min_discount_percent,
  maxPriceAgorot: row.notify_max_price_agorot,
  cooldownHours: row.notify_cooldown_hours,
  dailyCap: row.notify_daily_cap,
  quietStart: row.notify_quiet_start,
  quietEnd: row.notify_quiet_end,
});

export async function processNotificationEvents(input: {
  db: SupabaseClient;
  send: PushSender;
  now?: Date;
  maxEvents?: number;
}): Promise<RunSummary> {
  const { db, send } = input;
  const now = input.now ?? new Date();
  const summary: RunSummary = { events: 0, sent: 0, skipped: 0, deferred: 0, retried: 0, failed: 0, devicesRemoved: 0 };

  const settingsResult = await db
    .from("app_settings")
    .select("notify_min_discount_percent, notify_max_price_agorot, notify_cooldown_hours, notify_daily_cap, notify_quiet_start, notify_quiet_end")
    .eq("id", true)
    .maybeSingle();
  if (settingsResult.error || !settingsResult.data) throw new Error(`notification settings unavailable: ${settingsResult.error?.message ?? "no row"}`);
  const settings = toSettings(settingsResult.data as SettingsRow);

  const eventsResult = await db
    .from("notification_events")
    .select("id, offer_key, beer_id, expires_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(input.maxEvents ?? 25);
  if (eventsResult.error) throw new Error(`notification events unavailable: ${eventsResult.error.message}`);

  const finish = (eventId: number, outcome: string) =>
    db.from("notification_events").update({ status: "done", outcome, processed_at: now.toISOString() }).eq("id", eventId);

  for (const event of (eventsResult.data ?? []) as EventRow[]) {
    summary.events += 1;
    const expiresAt = new Date(event.expires_at);

    // 1. The offer must still be live; render everything from the read model.
    const offer = await loadOffer(db, event.offer_key);
    if (!offer) {
      await finish(event.id, now >= expiresAt ? "expired" : "stale");
      continue;
    }

    // 2. Event-level rules: the same answer for everyone.
    const verdict = eventVerdict(
      { beerId: event.beer_id, priceAgorot: offer.effective_agorot, valuePct: offer.value_pct },
      settings,
      now,
      expiresAt,
    );
    if (!verdict.ok) {
      await finish(event.id, verdict.reason);
      continue;
    }

    // 3. Who could be told: people for whom this is beer #1, with notifications on.
    const profilesResult = await db
      .from("profiles")
      .select("id, primary_beer_id, notifications_enabled")
      .eq("primary_beer_id", event.beer_id)
      .eq("notifications_enabled", true);
    if (profilesResult.error) throw new Error(`profiles unavailable: ${profilesResult.error.message}`);
    const profiles = (profilesResult.data ?? []) as ProfileRow[];
    if (profiles.length === 0) {
      await finish(event.id, "no_recipients");
      continue;
    }
    const userIds = profiles.map((profile) => profile.id);

    const [subscriptionsResult, deliveredResult, historyResult] = await Promise.all([
      db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", userIds),
      db.from("notification_deliveries").select("id, user_id, status, attempts").eq("event_id", event.id),
      db
        .from("notification_deliveries")
        .select("user_id, beer_id, sent_at")
        .in("user_id", userIds)
        .eq("status", "sent")
        .gte("sent_at", new Date(Math.min(israelDayStart(now).getTime(), now.getTime() - settings.cooldownHours * 3_600_000)).toISOString()),
    ]);
    if (subscriptionsResult.error) throw new Error(`subscriptions unavailable: ${subscriptionsResult.error.message}`);
    if (deliveredResult.error) throw new Error(`deliveries unavailable: ${deliveredResult.error.message}`);
    if (historyResult.error) throw new Error(`delivery history unavailable: ${historyResult.error.message}`);

    const subscriptionsByUser = new Map<string, SubscriptionRow[]>();
    for (const row of (subscriptionsResult.data ?? []) as SubscriptionRow[]) {
      subscriptionsByUser.set(row.user_id, [...(subscriptionsByUser.get(row.user_id) ?? []), row]);
    }
    const deliveryByUser = new Map<string, DeliveryRow>(((deliveredResult.data ?? []) as DeliveryRow[]).map((row) => [row.user_id, row] as const));
    const history = (historyResult.data ?? []) as HistoryRow[];
    const dayStart = israelDayStart(now).getTime();

    const message = buildOfferNotification(offer);
    const payload = JSON.stringify({ title: message.title, body: message.body, url: message.url, tag: message.tag, offerKey: offer.offer_key });

    let candidates = 0;
    let waiting = 0; // deferred or awaiting a retry: keep the event open
    let sentHere = 0;

    for (const profile of profiles) {
      const subscriptions = subscriptionsByUser.get(profile.id) ?? [];
      if (subscriptions.length === 0) continue; // nothing to send to, and nothing worth recording
      candidates += 1;

      const previous = deliveryByUser.get(profile.id);
      if (previous && (previous.status === "sent" || previous.status === "skipped" || previous.status === "failed")) continue;

      const mine = history.filter((row) => row.user_id === profile.id);
      const lastForBeer = mine
        .filter((row) => row.beer_id === event.beer_id)
        .map((row) => new Date(row.sent_at))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const recipient: PushRecipient = {
        userId: profile.id,
        primaryBeerId: profile.primary_beer_id,
        notificationsEnabled: profile.notifications_enabled,
        subscriptions: subscriptions.length,
        lastSentForBeerAt: lastForBeer ?? null,
        sentToday: mine.filter((row) => new Date(row.sent_at).getTime() >= dayStart).length,
      };

      const decision = decide({ beerId: event.beer_id, priceAgorot: offer.effective_agorot, valuePct: offer.value_pct }, recipient, settings, now);

      if (decision.action === "defer") {
        summary.deferred += 1;
        waiting += 1;
        continue;
      }
      if (decision.action === "skip") {
        summary.skipped += 1;
        await recordDelivery(db, previous, { event_id: event.id, user_id: profile.id, beer_id: event.beer_id, status: "skipped", reason: decision.reason, attempts: previous?.attempts ?? 0 });
        continue;
      }

      // 4. Send to each of the person's devices.
      let ok = 0;
      let gone = 0;
      let transient = 0;
      let lastStatus: number | null = null;
      let lastError: string | null = null;
      for (const subscription of subscriptions) {
        try {
          await send({ endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth }, payload, { ttlSeconds: TTL_SECONDS });
          ok += 1;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode ?? null;
          lastStatus = status;
          lastError = String((error as Error).message ?? error).slice(0, 300);
          if (status === 404 || status === 410) {
            // The browser threw the subscription away (uninstalled, site data cleared): stop trying.
            gone += 1;
            await db.from("push_subscriptions").delete().eq("id", subscription.id);
            summary.devicesRemoved += 1;
          } else if (status !== null && status >= 400 && status < 500) {
            // Rejected for a reason a retry will not fix (bad keys, payload too large).
            lastError = `${status}: ${lastError}`;
          } else {
            transient += 1;
          }
        }
      }

      const attempts = (previous?.attempts ?? 0) + 1;
      const base = { event_id: event.id, user_id: profile.id, beer_id: event.beer_id, attempts, subscriptions_total: subscriptions.length, subscriptions_ok: ok, http_status: lastStatus, error: lastError };
      if (ok > 0) {
        summary.sent += 1;
        sentHere += 1;
        await recordDelivery(db, previous, { ...base, status: "sent", reason: null, sent_at: now.toISOString() });
      } else if (gone === subscriptions.length) {
        summary.failed += 1;
        await recordDelivery(db, previous, { ...base, status: "failed", reason: "subscription_gone" });
      } else if (transient > 0 && attempts < MAX_ATTEMPTS) {
        summary.retried += 1;
        waiting += 1;
        await recordDelivery(db, previous, { ...base, status: "retry", reason: "push_error" });
      } else {
        summary.failed += 1;
        await recordDelivery(db, previous, { ...base, status: "failed", reason: "push_error" });
      }
    }

    // 5. Close the event unless someone is still waiting (quiet hours, a retry) and it has not expired.
    if (waiting > 0 && now < expiresAt) continue;
    const anySent = sentHere > 0 || [...deliveryByUser.values()].some((row) => row.status === "sent");
    await finish(event.id, anySent ? "sent" : candidates === 0 ? "no_recipients" : waiting > 0 ? "expired" : "all_skipped");
  }

  return summary;
}

async function recordDelivery(
  db: SupabaseClient,
  previous: DeliveryRow | undefined,
  row: Record<string, unknown> & { user_id: string; event_id: number },
) {
  const result = previous
    ? await db.from("notification_deliveries").update(row).eq("id", previous.id)
    : await db.from("notification_deliveries").insert(row);
  if (result.error) throw new Error(`could not record delivery: ${result.error.message}`);
}
