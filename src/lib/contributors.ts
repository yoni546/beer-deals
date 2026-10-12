import "server-only";

import { cache } from "react";
import { publicReader } from "@/lib/feeds";
import { note } from "@/lib/log";
import { supabaseServer } from "@/lib/supabase/server";
import type { Trust } from "@/lib/trust";

/**
 * The public half of a person (migration 0030).
 *
 * `contributors` holds one thing: a name somebody chose to be credited by on a deal
 * they found. It is world-readable, which is the point — and separate from
 * `profiles`, whose first_name is private and stays that way.
 *
 * Not cached under FEEDS_TAG: a person changing their own name should see it at
 * once, and this is one row by primary key.
 */
export const currentCreditName = cache(async (userId: string | null): Promise<string> => {
  if (!userId) return "";
  const { data } = await publicReader()
    .from("contributors")
    .select("display_name")
    .eq("profile_id", userId)
    .maybeSingle();
  return (data as { display_name: string } | null)?.display_name ?? "";
});

export type Standing = { display_name: string; approved: number; weekly: number; score: number };

/**
 * The leaderboard. Ordered by what the score is worth, not by how much somebody
 * submitted: the score already penalises rejections, so volume without quality sinks.
 */
export const topContributors = cache(async (limit = 5): Promise<Standing[]> => {
  const { data, error } = await publicReader()
    .from("contributors")
    .select("display_name, approved, weekly, score")
    .gt("score", 0)
    .order("score", { ascending: false })
    .order("approved", { ascending: false })
    .limit(limit);
  // Before 0030 the table is not there. A missing leaderboard is not worth a screen.
  if (error) return [];
  return (data ?? []) as Standing[];
});

export type MyStanding = Standing & { trust: Trust };

/**
 * This person's own standing (migration 0038).
 *
 * Null when they have not chosen a name: there is no contributors row until
 * somebody asks to be credited (0030), and inventing a "new contributor" row for
 * everybody else would be a label they never asked for.
 *
 * Read through `my_standing()` rather than from the table, so the ladder's word
 * comes from the same place the shelf tally's weight does.
 */
export const myStanding = cache(async (userId: string | null): Promise<MyStanding | null> => {
  if (!userId) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("my_standing");
  if (error) {
    note("my_standing.read_failed", { reason: error.message });
    return null;
  }
  const rows = (data ?? []) as MyStanding[];
  return rows[0] ?? null;
});
