import "server-only";

import { report } from "@/lib/log";
import { trustOf } from "@/lib/trust";
import { getBeerBySlug, getStoreBySlug } from "@/lib/queries";
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
  // The score comes with the name (0038): a moderator judging a price is better off
  // knowing whether the person has a record than not. It is CONTEXT — the queue
  // order is untouched, because a queue that serves trusted people first makes a
  // newcomer's first submission wait behind everybody else's.
  const { data, error } = await supabase
    .from("contributors")
    .select("profile_id, display_name, score")
    .in("profile_id", ids);
  if (error) report("admin.submitters_failed", { code: error.code, reason: error.message });

  const found = new Map(
    ((data ?? []) as Array<{ profile_id: string; display_name: string; score: number }>).map((row) => [
      row.profile_id,
      row,
    ]),
  );
  return rows.map((row) => {
    const person = row.created_by ? found.get(row.created_by) : undefined;
    return {
      ...row,
      contributors: person
        ? { display_name: person.display_name, score: person.score, trust: trustOf(person.score) }
        : null,
    };
  });
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

export type AuditEntry = {
  id: number;
  actor: string;
  actor_email: string | null;
  action: string;
  subject_kind: string;
  subject_id: string | null;
  details: Record<string, unknown>;
  at: string;
  is_me: boolean;
};

/**
 * The admin audit log (migration 0032).
 *
 * Returns {rows, ok} like the rest of this file: "nobody has done anything yet" and
 * "we could not read the log" are different sentences, and on this screen in
 * particular they must not be shown as the same one.
 */
export async function getAuditLog(limit = 100, beforeId?: number): Promise<{ rows: AuditEntry[]; ok: boolean }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_audit", {
    p_limit: limit,
    p_before_id: beforeId ?? null,
  });
  if (error) {
    report("admin.audit_failed", { code: error.code, reason: error.message });
    return { rows: [], ok: false };
  }
  return { rows: (data ?? []) as AuditEntry[], ok: true };
}

export type AdminBeer = {
  id: string;
  slug: string;
  name_he: string;
  name_en: string;
  category: string;
  sort_order: number;
  is_active: boolean;
  brand_name_he: string;
  variant: string | null;
  chosen_by: number;
  first_for: number;
  live_offers: number;
  packs: number;
};

/**
 * Every beer as the panel sees it (migration 0034), with the counts that make
 * "switch this one off" a decision somebody can actually take.
 */
export async function getAdminBeers(): Promise<{ rows: AdminBeer[]; ok: boolean }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_beers");
  if (error) {
    report("admin.beers_failed", { code: error.code, reason: error.message });
    return { rows: [], ok: false };
  }
  return { rows: (data ?? []) as AdminBeer[], ok: true };
}

/** The brands a new beer can be attached to (migration 0034). */
export async function getAdminBrands(): Promise<Array<{ slug: string; name_he: string }>> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_brands");
  if (error) report("admin.brands_failed", { code: error.code, reason: error.message });
  return (data ?? []) as Array<{ slug: string; name_he: string }>;
}

/** The categories a beer can be in (migration 0034), by name. */
export async function getAdminProductCategories(): Promise<Array<{ slug: string; name_he: string; in_scope: boolean }>> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_product_categories");
  if (error) report("admin.categories_failed", { code: error.code, reason: error.message });
  return (data ?? []) as Array<{ slug: string; name_he: string; in_scope: boolean }>;
}

export type AdminSubmitter = {
  user_id: string;
  display_name: string | null;
  approved: number;
  rejected: number;
  pending: number;
  last_at: string;
  is_blocked: boolean;
  block_reason: string | null;
};

/**
 * Who has been submitting, and how it has gone (migration 0035).
 *
 * Deliberately NOT a list of users: it carries only what a person chose to publish
 * (their display name, if any) and what they sent us. No email, no first name, no
 * favourites, no location — admins have never had read access to profiles (0003)
 * and this screen does not change that.
 */
export async function getAdminSubmitters(limit = 50): Promise<{ rows: AdminSubmitter[]; ok: boolean }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_submitters", { p_limit: limit });
  if (error) {
    report("admin.submitters_failed", { code: error.code, reason: error.message });
    return { rows: [], ok: false };
  }
  return { rows: (data ?? []) as AdminSubmitter[], ok: true };
}

export type AdminDealFilter = {
  /** A single status, or "all". The queue's own default is "pending". */
  status: DealStatus | "all";
  /** Chain and beer by slug, so a filter survives in the URL and can be shared. */
  store?: string;
  beer?: string;
  /** Where it came from: everything, what people sent, or what an admin typed in. */
  source: "all" | "users" | "admins";
  /** Free text over the note a submitter wrote. */
  q?: string;
};

export const DEAL_FILTER_DEFAULTS: AdminDealFilter = { status: "pending", source: "all" };

/**
 * The moderation list, filtered (Phase U).
 *
 * Before this the panel had exactly two lists — every pending deal, oldest first,
 * and the last thirty approved — which is workable at a hundred deals and useless
 * at four thousand. "What did this chain send us?" and "what have we rejected from
 * this beer?" had no answer at all.
 *
 * It deliberately does NOT report a total. A count would mean a second query whose
 * only job is a number, and the local fake the e2e runs against does not implement
 * PostgREST's count header — so the number would be real in production and a
 * fiction in the tests. Instead it asks for one row more than it shows, and says
 * "there are more" when it gets it. That is the honest version of the same
 * information: whether this list is everything.
 */
export async function getAdminDeals(
  filter: AdminDealFilter,
  limit = 50,
): Promise<{ rows: AdminDeal[]; more: boolean; ok: boolean }> {
  const supabase = await supabaseServer();
  let query = supabase.from("deals").select(DEAL_COLUMNS);

  if (filter.status !== "all") query = query.eq("status", filter.status);
  if (filter.source === "users") query = query.eq("entered_by_admin", false);
  if (filter.source === "admins") query = query.eq("entered_by_admin", true);
  // Slug, not id: the filter lives in the URL and an id there is unreadable and
  // unshareable. One extra lookup, on tables that are cached site-wide anyway.
  if (filter.store) {
    const store = await getStoreBySlug(filter.store);
    if (!store) return { rows: [], more: false, ok: true };
    query = query.eq("store_id", store.id);
  }
  if (filter.beer) {
    const beer = await getBeerBySlug(filter.beer);
    if (!beer) return { rows: [], more: false, ok: true };
    query = query.eq("beer_id", beer.id);
  }
  if (filter.q?.trim()) {
    // Plain `ilike`, escaped: a % or _ typed into a search box is a character, not
    // a wildcard, and `,` would otherwise end the filter early in PostgREST.
    const needle = filter.q.trim().replace(/[%_\\,]/g, (ch) => `\\${ch}`);
    query = query.ilike("notes", `%${needle}%`);
  }

  const { data, error } = await query
    // Oldest first while they are waiting — a queue, not a feed. Newest first
    // everywhere else, where the question is what changed recently.
    .order("created_at", { ascending: filter.status === "pending" })
    .limit(limit + 1);

  if (error) {
    report("admin.deals_filtered_failed", { code: error.code, reason: error.message });
    return { rows: [], more: false, ok: false };
  }

  const all = (data ?? []) as unknown as AdminDeal[];
  return { rows: await withSubmitters(all.slice(0, limit)), more: all.length > limit, ok: true };
}

export type AdminCoverage = {
  store_id: string;
  store_slug: string;
  store_name: string;
  branches: number;
  located: number;
  last_scan_id: string | null;
  last_scan_at: string | null;
  checked: number;
  promo_checked: number;
  no_promo_file: number;
  not_published: number;
  stale: number;
  failed: number;
  live_offers: number;
};

/**
 * What the database knows about each retailer's coverage (migration 0036).
 *
 * Deliberately narrower than docs/RETAILER-COVERAGE.md: that document is produced
 * by the scan and knows things no table holds (why a source is blocked, a
 * publisher's own note). This is the evidence in `branch_scans`, as it stands now.
 */
export async function getAdminCoverage(): Promise<{ rows: AdminCoverage[]; ok: boolean }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_coverage");
  if (error) {
    report("admin.coverage_failed", { code: error.code, reason: error.message });
    return { rows: [], ok: false };
  }
  return { rows: (data ?? []) as AdminCoverage[], ok: true };
}

export type AdminPerson = {
  user_id: string;
  display_name: string | null;
  home_city: string | null;
  search_radius_km: number | null;
  registered_at: string;
  favourites: string[];
  approved: number;
  rejected: number;
  pending: number;
  score: number;
  trust: "new" | "known" | "trusted";
  is_blocked: boolean;
  block_reason: string | null;
  admin_level: string | null;
};

/**
 * The people screen (migration 0041).
 *
 * Four fields the owner asked for by name — town, radius, favourites, registration
 * date — beside what each person sent us. `profiles` keeps its owner-only policy:
 * this reads through one definer function that returns those columns and no others.
 */
export async function getAdminPeople(limit = 100): Promise<{ rows: AdminPerson[]; ok: boolean }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_people", { p_limit: limit });
  if (error) {
    report("admin.people_failed", { code: error.code, reason: error.message });
    return { rows: [], ok: false };
  }
  return { rows: (data ?? []) as AdminPerson[], ok: true };
}

export type CityGap = { city: string; people: number; with_radius: number; deals_nearby: number | null };

/** Where the people are, and whether there is anything near them (Phase T, 0041). */
export async function getPeopleByCity(limit = 50): Promise<{ rows: CityGap[]; ok: boolean }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_people_by_city", { p_limit: limit });
  if (error) {
    report("admin.people_by_city_failed", { code: error.code, reason: error.message });
    return { rows: [], ok: false };
  }
  return { rows: (data ?? []) as CityGap[], ok: true };
}

export type Highlights = {
  top_beer: { name: string; slug: string; people: number } | null;
  top_store: { name: string; slug: string; offers: number } | null;
  top_city: { city: string; people: number } | null;
  best_score: { score: number; band: string; beer: string; store: string; offer_key: string } | null;
  top_contributors: Array<{ name: string; score: number; approved: number }>;
  /** False, and said rather than assumed: nothing in this system records a visit. */
  activity_measurable: boolean;
  as_of: string;
};

/** The dashboard's answers to "what is big right now" (migration 0042). */
export async function getHighlights(): Promise<{ data: Highlights | null; ok: boolean }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_highlights");
  if (error) {
    report("admin.highlights_failed", { code: error.code, reason: error.message });
    return { data: null, ok: false };
  }
  return { data: data as Highlights, ok: true };
}
