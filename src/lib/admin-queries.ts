import "server-only";

import { report } from "@/lib/log";
import { supabaseServer } from "@/lib/supabase/server";
import type { AdminDeal, DealReport, DealStatus } from "@/lib/db/types";

/**
 * Admin reads. These use the caller session, so an ordinary user calling them
 * gets an empty list from RLS rather than a privilege error — the pages are
 * unreachable for them anyway.
 */

/**
 * `contributors(display_name)` is the thing the moderation queue could not do before
 * 0030: `created_by` has been recorded since 0001, but it was not in this list and
 * `profiles` is owner-only by RLS, so a moderator judging a deal could not see who
 * submitted it. `contributors` is the public half of a person and world-readable, so
 * this join needs no privilege the admin pages did not already have.
 *
 * A submitter who has not chosen a name joins to nothing and the row simply says
 * nothing about them.
 */
const DEAL_COLUMNS =
  "id, category, deal_price_agorot, regular_price_agorot, discount_percent, image_url, " +
  "notes, status, created_at, approved_at, beer_id, store_id, created_by, entered_by_admin, " +
  "beers(id, slug, name_he), stores(id, slug, name_he)";

/**
 * The submitters' chosen names, merged in afterwards.
 *
 * Not an embedded select: `deals.created_by` points at auth.users and
 * `contributors.profile_id` at profiles, so PostgREST has no foreign key between the
 * two tables to follow. `contributors` is small and world-readable, so one read covers
 * a page of the queue.
 */
async function withSubmitters(rows: AdminDeal[]): Promise<AdminDeal[]> {
  const ids = [...new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return rows.map((row) => ({ ...row, contributors: null }));

  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("contributors").select("profile_id, display_name").in("profile_id", ids);
  if (error) report("admin.submitters_failed", { code: error.code, reason: error.message });

  const names = new Map(
    ((data ?? []) as Array<{ profile_id: string; display_name: string }>).map((row) => [row.profile_id, row.display_name]),
  );
  return rows.map((row) => ({
    ...row,
    contributors: row.created_by && names.has(row.created_by) ? { display_name: names.get(row.created_by)! } : null,
  }));
}

export async function getDealsByStatus(status: DealStatus, limit = 50): Promise<AdminDeal[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("deals")
    .select(DEAL_COLUMNS)
    // Oldest first while they are waiting — a queue, not a feed. Newest first
    // everywhere else, where the question is what changed recently.
    .order("created_at", { ascending: status === "pending" })
    .eq("status", status)
    .limit(limit);
  // A failed read must not render as "nothing is pending": that tells a moderator the
  // queue is clear when the truth is that we could not look.
  if (error) report("admin.deals_failed", { status, code: error.code, reason: error.message });
  return withSubmitters((data ?? []) as unknown as AdminDeal[]);
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

export type OfferFeedbackRow = {
  offer_key: string;
  ended_weight: number;
  still_weight: number;
  voices: number;
  newest_at: string;
  standing: "ended" | "still_there" | "unclear";
  notes: string[];
};

/**
 * What people are saying about offers on the shelf (migration 0031).
 *
 * Disagreements first, because those are the ones a rule deliberately refused to
 * settle. Returns {rows, ok} so the screen can tell "nobody has said anything" from
 * "we could not look".
 */
export async function getOfferFeedback(limit = 50): Promise<{ rows: OfferFeedbackRow[]; ok: boolean }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_offer_feedback", { p_limit: limit });
  if (error) {
    report("admin.offer_feedback_failed", { code: error.code, reason: error.message });
    return { rows: [], ok: false };
  }
  return { rows: (data ?? []) as OfferFeedbackRow[], ok: true };
}
