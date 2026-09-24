"use server";

import { supabaseServer } from "@/lib/supabase/server";
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
