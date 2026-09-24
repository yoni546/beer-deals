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
