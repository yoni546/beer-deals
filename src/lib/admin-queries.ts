import "server-only";

import { report } from "@/lib/log";
import { supabaseServer } from "@/lib/supabase/server";
import type { AdminDeal, DealReport, DealStatus } from "@/lib/db/types";

/**
 * Admin reads. These use the caller session, so an ordinary user calling them
 * gets an empty list from RLS rather than a privilege error — the pages are
 * unreachable for them anyway.
 */

const DEAL_COLUMNS =
  "id, category, deal_price_agorot, regular_price_agorot, discount_percent, image_url, " +
  "notes, status, created_at, approved_at, beer_id, store_id, " +
  "beers(id, slug, name_he), stores(id, slug, name_he)";

export async function getDealsByStatus(status: DealStatus, limit = 50): Promise<AdminDeal[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("deals")
    .select(DEAL_COLUMNS)
    // Oldest first while they are waiting — a queue, not a feed. Newest first
    // everywhere else, where the question is what changed recently.
    .order("created_at", { ascending: status === "pending" })
    .eq("status", status)
    .limit(limit);
  return (data ?? []) as unknown as AdminDeal[];
}

export async function getOpenReports(): Promise<DealReport[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("deal_reports")
    .select("id, deal_id, reason, status, created_at, deals(" + DEAL_COLUMNS + ")")
    .eq("status", "open")
    .order("created_at", { ascending: true });
  return (data ?? []) as unknown as DealReport[];
}

export async function getAdminRoster() {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("admins")
    .select("user_id, level, created_at")
    .order("created_at");
  return data ?? [];
}

export type AdminOverview = {
  people: { total: number; onboarded: number; this_week: number; notifiable: number };
  deals: {
    live: number;
    pending: number;
    added_this_week: number;
    taken_down_this_week: number;
    submitted_this_week: number;
  };
  reports: { open: number };
  /** `live` already includes the approved manual deals; `from_chains` is the catalogue half. Never add them. */
  offers: { live: number; from_chains: number; retailers: number; expiring: number };
  /** What "closest to me" has to work with (0026, 0028). Absent before 0028. */
  branches?: { total: number; located: number; geocodable: number; no_address: number };
  notifications: { pending: number; sent_ever: number };
  expiring_within_days: number;
  as_of: string;
};

/**
 * Everything the admin home shows, in one round trip.
 *
 * Counted by `admin_overview()` in the database rather than here, because most
 * of it is over rows an admin deliberately cannot read — `profiles` is readable
 * only by its owner. The function returns the numbers and never the rows.
 */
export async function getAdminOverview(expiringWithinDays = 7): Promise<AdminOverview | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_overview", {
    p_expiring_within_days: expiringWithinDays,
  });
  if (error) {
    // This used to return null with nothing recorded anywhere, so a timeout
    // (57014), a privilege refusal (42501) and a bad argument (22023) all reached
    // the admin as the same "לא הצלחנו לטעון את הנתונים" with no way to tell them apart.
    report("admin.overview_failed", { code: error.code, reason: error.message });
    return null;
  }
  return data as AdminOverview;
}

/** Today where the shops are. `toISOString()` is UTC, which rolls over at 02:00/03:00 in Israel. */
function israelDay(offsetDays = 0): string {
  const at = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(at);
}

/**
 * The offers that end soonest, so somebody can look before they vanish.
 *
 * Returns the rows AND whether the read worked: an empty list and a failed read
 * are different claims, and the screen must not make the first one on the
 * strength of the second.
 */
export async function getExpiringOffers(withinDays = 7, limit = 12) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("offers_feed")
    .select("offer_key, beer_name, store_name, pack_label, effective_agorot, valid_to, scope")
    .not("valid_to", "is", null)
    .gte("valid_to", israelDay())
    .lt("valid_to", israelDay(withinDays))
    .order("valid_to", { ascending: true })
    .limit(limit);
  if (error) report("admin.expiring_failed", { code: error.code, reason: error.message });
  return { rows: data ?? [], ok: !error };
}
