"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { describeDbError, type ActionResult } from "@/lib/actions/result";
import { notifyAboutDeal } from "@/lib/push/notify";
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

  // Deciding whether this is worth a push — and sending it — happens after the
  // approval has committed, so a failure in the notification path can never
  // roll back the approval itself.
  const push = await notifyAboutDeal(dealId);

  return {
    ok: true,
    message: push.sent > 0 ? `אושר. נשלחה התראה ל-${push.sent} משתמשים.` : "המבצע אושר.",
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
  const { error } = await supabase.rpc("update_notification_settings", {
    p_min_discount_percent: Number(formData.get("minDiscount")),
    p_max_price_agorot: maxPrice,
    p_cooldown_hours: Number(formData.get("cooldownHours")),
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
