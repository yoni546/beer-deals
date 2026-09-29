import "server-only";

import webpush from "web-push";
import { supabaseServiceRole } from "@/lib/supabase/admin";
import { publicEnv, serverEnv } from "@/lib/env";
import { buildDealNotification, buildDealPath } from "@/lib/push/message";
import type { DealCategory } from "@/lib/categories";

/**
 * Who gets woken up, and when.
 *
 * Three rules, all of them about not being a nuisance:
 *   1. ONLY the Primary Beer. Favourites #2–#4 shape what the app shows, never
 *      what it interrupts you for.
 *   2. The deal must clear both admin thresholds — a big enough discount AND a
 *      low enough price. An ordinary deal is not worth a phone buzzing.
 *   3. A cooldown per person per beer, so a run of approvals on a Thursday
 *      evening cannot turn into five notifications.
 */

type NotifyOutcome = { sent: number; skipped: string | null };

let configured = false;

function configureWebPush(): boolean {
  const { vapidPrivateKey, vapidSubject } = serverEnv();
  if (!publicEnv.vapidPublicKey || !vapidPrivateKey) return false;
  if (!configured) {
    webpush.setVapidDetails(vapidSubject, publicEnv.vapidPublicKey, vapidPrivateKey);
    configured = true;
  }
  return true;
}

export async function notifyAboutDeal(dealId: string): Promise<NotifyOutcome> {
  const supabase = supabaseServiceRole();
  if (!supabase) return { sent: 0, skipped: "no service role key configured" };
  if (!configureWebPush()) return { sent: 0, skipped: "no VAPID keys configured" };

  // Typed by hand: the generated relational types turn an embedded one-to-one
  // join into a union that every field access then has to narrow, which buys
  // nothing here.
  type DealRow = {
    id: string;
    status: string;
    notified_at: string | null;
    category: DealCategory;
    deal_price_agorot: number;
    discount_percent: number;
    beer_id: string;
    beers: { name_he: string; slug: string } | null;
    stores: { name_he: string } | null;
  };

  const { data: dealRow } = await supabase
    .from("deals")
    .select(
      "id, status, notified_at, category, deal_price_agorot, discount_percent, beer_id, " +
        "beers(name_he, slug), stores(name_he)",
    )
    .eq("id", dealId)
    .maybeSingle();

  const deal = dealRow as DealRow | null;

  if (!deal || deal.status !== "approved") return { sent: 0, skipped: "deal is not approved" };

  // Already announced. Editing and re-approving a deal must not notify the same
  // people a second time.
  if (deal.notified_at) return { sent: 0, skipped: "already notified" };

  const { data: settings } = await supabase
    .from("app_settings")
    .select("notify_min_discount_percent, notify_max_price_agorot, notify_cooldown_hours")
    .eq("id", true)
    .maybeSingle();

  if (!settings) return { sent: 0, skipped: "no settings row" };

  const strongEnough =
    deal.discount_percent >= settings.notify_min_discount_percent &&
    deal.deal_price_agorot <= settings.notify_max_price_agorot;

  if (!strongEnough) {
    // Mark it anyway: this deal has had its chance. Otherwise lowering the
    // threshold later would fire a burst of notifications about old deals.
    await supabase.from("deals").update({ notified_at: new Date().toISOString() }).eq("id", dealId);
    return { sent: 0, skipped: "below notification thresholds" };
  }

  const { data: recipients } = await supabase
    .from("profiles")
    .select("id, first_name")
    .eq("primary_beer_id", deal.beer_id)
    .eq("notifications_enabled", true);

  if (!recipients?.length) {
    await supabase.from("deals").update({ notified_at: new Date().toISOString() }).eq("id", dealId);
    return { sent: 0, skipped: "nobody has this as their primary beer" };
  }

  const cooldownSince = new Date(
    Date.now() - settings.notify_cooldown_hours * 3_600_000,
  ).toISOString();

  const { data: recentlyNotified } = await supabase
    .from("push_log")
    .select("user_id")
    .eq("beer_id", deal.beer_id)
    .gte("sent_at", cooldownSince);

  const onCooldown = new Set((recentlyNotified ?? []).map((row) => row.user_id));
  const targets = recipients.filter((profile) => !onCooldown.has(profile.id));
  if (!targets.length) {
    await supabase.from("deals").update({ notified_at: new Date().toISOString() }).eq("id", dealId);
    return { sent: 0, skipped: "all recipients are within the cooldown window" };
  }

  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in(
      "user_id",
      targets.map((t) => t.id),
    );

  if (!subscriptions?.length) {
    await supabase.from("deals").update({ notified_at: new Date().toISOString() }).eq("id", dealId);
    return { sent: 0, skipped: "no push subscriptions" };
  }

  const nameById = new Map(targets.map((t) => [t.id, t.first_name]));
  const beerName = deal.beers?.name_he ?? "בירה";
  const storeName = deal.stores?.name_he ?? "";
  // The page a tap opens. Falls back to home rather than to a link that 404s.
  const url = deal.beers ? buildDealPath({ beerSlug: deal.beers.slug, category: deal.category }) : "/";

  const notified = new Set<string>();
  const deadEndpoints: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      const { title, body } = buildDealNotification({
        firstName: nameById.get(sub.user_id) ?? null,
        beerName,
        category: deal.category,
        dealPriceAgorot: deal.deal_price_agorot,
        storeName,
        discountPercent: deal.discount_percent,
      });

      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body, url, dealId: deal.id }),
          { TTL: 60 * 60 * 12 },
        );
        notified.add(sub.user_id);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404/410 mean the browser threw the subscription away — the user
        // uninstalled or cleared site data. Keeping it would retry forever.
        if (status === 404 || status === 410) deadEndpoints.push(sub.endpoint);
        else console.error("[push] send failed:", error);
      }
    }),
  );

  if (deadEndpoints.length) {
    await supabase.from("push_subscriptions").delete().in("endpoint", deadEndpoints);
  }

  if (notified.size) {
    await supabase.from("push_log").insert(
      [...notified].map((userId) => ({
        user_id: userId,
        deal_id: deal.id,
        beer_id: deal.beer_id,
      })),
    );
  }

  await supabase.from("deals").update({ notified_at: new Date().toISOString() }).eq("id", dealId);

  return { sent: notified.size, skipped: null };
}
