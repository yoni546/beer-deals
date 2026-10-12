"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { FEEDS_TAG } from "@/lib/feeds";
import { supabaseServer } from "@/lib/supabase/server";
import { describeDbError, type ActionResult } from "@/lib/actions/result";

/**
 * Managing the beers (migration 0034).
 *
 * Every one of these calls an RPC that checks the caller's role in Postgres and
 * records what was done. None of them trusts the fact that an admin screen
 * rendered the button.
 *
 * The catalogue is one of the cached whole-site reads (src/lib/feeds.ts), and a
 * beer switched off has to leave the lists people choose from at once rather than
 * in five minutes — so each of these clears FEEDS_TAG.
 */

function revalidateCatalogue() {
  revalidatePath("/admin", "layout");
  revalidatePath("/", "layout");
  revalidateTag(FEEDS_TAG);
}

export async function setBeerActive(beerId: string, active: boolean): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("admin_set_beer_active", { p_beer_id: beerId, p_active: active });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidateCatalogue();
  return {
    ok: true,
    // Said in full, because it is the part people get wrong: switching a beer off
    // does not take it away from anybody who already chose it.
    message: active
      ? "הבירה חזרה לרשימת הבחירה."
      : "הבירה הוסרה מרשימת הבחירה. מי שכבר בחר אותה שומר אותה.",
  };
}

export async function updateBeer(beerId: string, formData: FormData): Promise<ActionResult> {
  const sortOrder = Number(formData.get("sortOrder"));
  if (!Number.isInteger(sortOrder)) return { ok: false, error: "מספר הסדר צריך להיות מספר שלם." };

  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("admin_update_beer", {
    p_beer_id: beerId,
    p_name_he: String(formData.get("nameHe") ?? ""),
    p_name_en: String(formData.get("nameEn") ?? ""),
    p_category: String(formData.get("category") ?? "beer"),
    p_sort_order: sortOrder,
  });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidateCatalogue();
  return { ok: true, message: "הבירה עודכנה." };
}

export async function addBeer(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("admin_add_beer", {
    p_slug: String(formData.get("slug") ?? "").trim(),
    p_name_he: String(formData.get("nameHe") ?? ""),
    p_name_en: String(formData.get("nameEn") ?? ""),
    p_brand_slug: String(formData.get("brand") ?? ""),
    p_category: String(formData.get("category") ?? "beer"),
    p_variant: (formData.get("variant") as string) || null,
  });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidateCatalogue();
  return {
    ok: true,
    // Honest about the half that is not done: the look is code and a reviewed photo.
    message: "הבירה נוספה. היא מקבלת את המראה הניטרלי עד שמוסיפים לה זהות ותמונה בקוד.",
  };
}
