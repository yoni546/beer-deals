"use server";

import { createWebPushSender } from "@/lib/push/sender";
import { buildTestNotification } from "@/lib/push/message";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseServiceRole } from "@/lib/supabase/admin";
import { describeDbError, type ActionResult } from "@/lib/actions/result";

export async function savePushSubscription(subscription: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
}): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: subscription.endpoint,
    p_p256dh: subscription.p256dh,
    p_auth: subscription.auth,
    p_user_agent: subscription.userAgent,
  });

  if (error) return { ok: false, error: describeDbError(error) };
  return { ok: true };
}

export async function deletePushSubscription(endpoint: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  // RLS restricts this to the caller's own rows, so no user_id filter is
  // needed — and adding one would not make it safer.
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return { ok: false, error: describeDbError(error) };
  return { ok: true };
}

const TEST_LIMIT_PER_HOUR = 5;

/**
 * "Send me a test notification" (Settings). The same transport the real notifications use, to
 * the caller's own devices only, so it is the end-to-end smoke test of a phone: permission,
 * subscription, server keys, push service, service worker, display.
 *
 * Rate-limited per person, and recorded like any other delivery so it shows up next to the
 * real ones in the admin list.
 */
export async function sendTestPush(): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "לא הצלחנו לזהות אתכם." };

  const send = createWebPushSender();
  if (!send) return { ok: false, error: "שליחת התראות עוד לא הוגדרה בשרת. זה לא קשור למכשיר שלכם." };

  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", auth.user.id);
  if (error) return { ok: false, error: describeDbError(error) };
  if (!subscriptions?.length) return { ok: false, error: "אין מכשיר רשום להתראות. הפעילו התראות ונסו שוב." };

  const log = supabaseServiceRole();
  if (log) {
    const { count } = await log
      .from("notification_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", auth.user.id)
      .eq("kind", "test")
      .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
    if ((count ?? 0) >= TEST_LIMIT_PER_HOUR) return { ok: false, error: "שלחתם כמה בדיקות. נסו שוב בעוד שעה." };
  }

  const message = buildTestNotification();
  const payload = JSON.stringify(message);
  let ok = 0;
  let lastStatus: number | null = null;
  let lastError: string | null = null;

  for (const subscription of subscriptions) {
    try {
      await send({ endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth }, payload, { ttlSeconds: 300 });
      ok += 1;
    } catch (failure) {
      lastStatus = (failure as { statusCode?: number }).statusCode ?? null;
      lastError = String((failure as Error).message ?? failure).slice(0, 300);
      // The browser has dropped this device: forget it (RLS lets a person delete their own).
      if (lastStatus === 404 || lastStatus === 410) await supabase.from("push_subscriptions").delete().eq("id", subscription.id);
    }
  }

  if (log) {
    await log.from("notification_deliveries").insert({
      user_id: auth.user.id,
      kind: "test",
      status: ok > 0 ? "sent" : "failed",
      reason: ok > 0 ? null : "push_error",
      attempts: 1,
      subscriptions_total: subscriptions.length,
      subscriptions_ok: ok,
      http_status: lastStatus,
      error: lastError,
      sent_at: ok > 0 ? new Date().toISOString() : null,
    });
  }

  if (ok > 0) return { ok: true, message: ok === 1 ? "נשלחה התראת בדיקה. היא אמורה להגיע תוך שניות." : `נשלחה התראת בדיקה ל־${ok} מכשירים.` };
  return {
    ok: false,
    error:
      lastStatus === 404 || lastStatus === 410
        ? "המכשיר כבר לא רשום להתראות. כבו והפעילו אותן מחדש."
        : "לא הצלחנו לשלוח. נסו שוב בעוד רגע; אם זה חוזר, ההתראות לא יגיעו למכשיר הזה.",
  };
}
