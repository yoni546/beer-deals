"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { describeDbError, type ActionResult } from "@/lib/actions/result";
import { runNotifications } from "@/lib/push/run";
import { shekelsToAgorot } from "@/lib/money";
import type { DealCategory } from "@/lib/categories";
import type { AdminLevel, DealStatus, ReportStatus } from "@/lib/db/types";

/**
 * Every action here calls an RPC that checks the caller's role in the database.
 * None of them trusts the fact that the page rendered an admin button — a
 * regular user who posts the same request by hand gets a 42501 from Postgres.
 */

function revalidateAdmin() {
  revalidatePath("/admin", "layout");
  revalidatePath("/", "layout");
}

export async function approveDeal(dealId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("approve_deal", { p_deal_id: dealId });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidateAdmin();

  // Approving queued a notification event in the same transaction (a database trigger).
  // Running the worker now delivers it within seconds instead of at the next scheduled run;
  // it happens after the approval committed, so a failure here can never roll it back.
  const push = await runNotifications();
  const sent = push.ok ? push.summary.sent : 0;

  return {
    ok: true,
    message: sent > 0 ? `אושר. נשלחה התראה ל-${sent} משתמשים.` : "המבצע אושר.",
  };
}

export async function setDealStatus(dealId: string, status: DealStatus): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("set_deal_status", {
    p_deal_id: dealId,
    p_status: status,
  });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidateAdmin();
  return { ok: true, message: "עודכן." };
}

export async function updateDeal(dealId: string, formData: FormData): Promise<ActionResult> {
  const dealAgorot = shekelsToAgorot(String(formData.get("dealPrice") ?? ""));
  const regularAgorot = shekelsToAgorot(String(formData.get("regularPrice") ?? ""));

  if (dealAgorot === null || regularAgorot === null) {
    return { ok: false, error: "מחיר לא תקין." };
  }
  if (dealAgorot >= regularAgorot) {
    return { ok: false, error: "מחיר המבצע צריך להיות נמוך מהמחיר הרגיל." };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("admin_update_deal", {
    p_deal_id: dealId,
    p_beer_id: String(formData.get("beerId")),
    p_store_id: String(formData.get("storeId")),
    p_category: String(formData.get("category")) as DealCategory,
    p_deal_price_agorot: dealAgorot,
    p_regular_price_agorot: regularAgorot,
    p_notes: (formData.get("notes") as string) || null,
  });

  if (error) return { ok: false, error: describeDbError(error) };

  revalidateAdmin();
  return { ok: true, message: "המבצע עודכן." };
}

/**
 * Closing a report says nothing about the deal. Taking the deal down is a
 * separate, deliberate call to setDealStatus — which is exactly the separation
 * the spec asks for.
 */
export async function resolveReport(
  reportId: string,
  status: ReportStatus,
): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("resolve_report", {
    p_report_id: reportId,
    p_status: status,
  });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidateAdmin();
  return { ok: true, message: "הדיווח טופל." };
}

export async function setWeeklyDeal(dealId: string | null): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("set_weekly_deal", { p_deal_id: dealId });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidateAdmin();
  return { ok: true, message: dealId ? "מבצע השבוע עודכן." : "מבצע השבוע הוסר." };
}

export async function updateNotificationSettings(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const maxPrice = shekelsToAgorot(String(formData.get("maxPrice") ?? ""));
  if (maxPrice === null) return { ok: false, error: "מחיר מקסימלי לא תקין." };

  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("update_notification_rules", {
    p_min_discount_percent: Number(formData.get("minDiscount")),
    p_max_price_agorot: maxPrice,
    p_cooldown_hours: Number(formData.get("cooldownHours")),
    p_daily_cap: Number(formData.get("dailyCap")),
    p_quiet_start: Number(formData.get("quietStart")),
    p_quiet_end: Number(formData.get("quietEnd")),
  });

  if (error) return { ok: false, error: describeDbError(error) };

  revalidateAdmin();
  return { ok: true, message: "ההגדרות נשמרו." };
}

export async function grantAdmin(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("grant_admin", {
    p_email: String(formData.get("email") ?? ""),
    p_level: String(formData.get("level") ?? "admin") as AdminLevel,
  });

  if (error) return { ok: false, error: describeDbError(error) };

  revalidateAdmin();
  return { ok: true, message: "המנהל נוסף." };
}

export async function revokeAdmin(userId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("revoke_admin", { p_user_id: userId });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidateAdmin();
  return { ok: true, message: "ההרשאה הוסרה." };
}

/**
 * An admin typing a deal in is vouching for it, so it goes up approved and
 * attributed to them. `notify` is off by default: a hand-entered deal should not
 * ring anyone's phone unless the admin deliberately asks for it.
 */
export async function addDeal(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const dealAgorot = shekelsToAgorot(String(formData.get("dealPrice") ?? ""));
  const regularAgorot = shekelsToAgorot(String(formData.get("regularPrice") ?? ""));

  if (dealAgorot === null) return { ok: false, error: "מחיר המבצע לא תקין — למשל 24.90" };
  if (regularAgorot === null) return { ok: false, error: "המחיר הרגיל לא תקין — למשל 39.90" };
  if (dealAgorot >= regularAgorot) {
    return { ok: false, error: "מחיר המבצע צריך להיות נמוך מהמחיר הרגיל." };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("admin_add_deal", {
    p_beer_id: String(formData.get("beerId") ?? ""),
    p_store_id: String(formData.get("storeId") ?? ""),
    p_category: String(formData.get("category") ?? "sixpack") as DealCategory,
    p_deal_price_agorot: dealAgorot,
    p_regular_price_agorot: regularAgorot,
    p_notes: (formData.get("notes") as string) || null,
    p_notify: formData.get("notify") === "on",
  });

  if (error) return { ok: false, error: describeDbError(error) };

  revalidateAdmin();
  return { ok: true, message: "המבצע נוסף ופורסם." };
}

/**
 * Deletion, not deactivation.
 *
 * Taking a deal off the site keeps the record of who approved it; deleting
 * destroys it. Super admin only, and the database refuses while a report still
 * points at the deal.
 */
export async function deleteDeal(dealId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("admin_delete_deal", { p_deal_id: dealId });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidateAdmin();
  return { ok: true, message: "המבצע נמחק." };
}
