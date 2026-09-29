import "server-only";

import { supabaseServiceRole } from "@/lib/supabase/admin";
import { createWebPushSender } from "@/lib/push/sender";
import { processNotificationEvents, type RunSummary } from "@/lib/push/worker";

export type RunResult = { ok: true; summary: RunSummary } | { ok: false; reason: "no service role key configured" | "no VAPID keys configured" | "failed"; detail?: string };

/**
 * Runs the notification worker with the real database and the real push transport.
 * Called from the cron endpoint (every few minutes) and right after an admin approves a deal.
 * Never throws: a broken notification path must not break the thing that called it.
 */
export async function runNotifications(): Promise<RunResult> {
  const db = supabaseServiceRole();
  if (!db) return { ok: false, reason: "no service role key configured" };
  const send = createWebPushSender();
  if (!send) return { ok: false, reason: "no VAPID keys configured" };

  try {
    return { ok: true, summary: await processNotificationEvents({ db, send }) };
  } catch (error) {
    console.error("[notifications] run failed:", error);
    return { ok: false, reason: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}
