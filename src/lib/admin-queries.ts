import "server-only";

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
  offers: { live: number; retailers: number; expiring: number };
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
  if (error) return null;
  return data as AdminOverview;
}

/** The offers that end soonest, so somebody can look before they vanish. */
export async function getExpiringOffers(withinDays = 7, limit = 12) {
  const supabase = await supabaseServer();
  const until = new Date(Date.now() + withinDays * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("offers_feed")
    .select("offer_key, beer_name, store_name, pack_label, effective_agorot, valid_to, scope")
    .not("valid_to", "is", null)
    .gte("valid_to", new Date().toISOString().slice(0, 10))
    .lt("valid_to", until)
    .order("valid_to", { ascending: true })
    .limit(limit);
  return data ?? [];
}
