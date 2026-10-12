"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { shekelsToAgorot } from "@/lib/money";
import { describeDbError, type ActionResult } from "@/lib/actions/result";

/**
 * Following a beer, and the price you would act on (migration 0037).
 *
 * No FEEDS_TAG here, deliberately: a watch changes nothing about the offers
 * themselves, only who hears about them. Clearing the whole site's feed cache
 * because one person followed a beer would be a real cost for no effect.
 */

export async function followBeer(beerId: string, price: string): Promise<ActionResult> {
  const trimmed = price.trim();
  // Empty is a real answer — "treat it like my number one" — and not a mistake.
  const agorot = trimmed === "" ? null : shekelsToAgorot(trimmed);
  if (trimmed !== "" && agorot === null) return { ok: false, error: "מחיר לא תקין — למשל 24.90" };

  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("watch_beer", { p_beer_id: beerId, p_max_price_agorot: agorot });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidatePath("/settings");
  return {
    ok: true,
    message: agorot
      ? "נעקוב. נודיע לכם כשהמחיר יגיע לשם."
      : "נעקוב. נודיע לכם על מבצע חזק, כמו על הבירה הראשית שלכם.",
  };
}

export async function unfollowBeer(beerId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("unwatch_beer", { p_beer_id: beerId });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidatePath("/settings");
  return { ok: true, message: "הפסקנו לעקוב." };
}
