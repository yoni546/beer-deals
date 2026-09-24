"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { describeDbError, type ActionResult } from "@/lib/actions/result";

const preferences = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "איך קוראים לכם?")
    .max(40, "השם ארוך מדי."),
  beerIds: z
    .array(z.uuid())
    .length(4, "בחרו בדיוק ארבע בירות, לפי הסדר.")
    .refine((ids) => new Set(ids).size === 4, "כל בירה יכולה להופיע פעם אחת."),
});

/**
 * Name + the ranked four, saved together through save_preferences(), which
 * writes them in one transaction. Beer #1 becomes the Primary Beer by a
 * database trigger, so the theme and the notification target can never drift
 * from what the user actually ranked first.
 */
export async function savePreferences(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = preferences.safeParse({
    firstName: formData.get("firstName"),
    beerIds: String(formData.get("beerIds") ?? "").split(",").filter(Boolean),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "בדקו את הפרטים." };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("save_preferences", {
    p_first_name: parsed.data.firstName,
    p_beer_ids: parsed.data.beerIds,
  });

  if (error) return { ok: false, error: describeDbError(error) };

  revalidatePath("/", "layout");
  return { ok: true, message: "נשמר." };
}

export async function setNotificationsEnabled(enabled: boolean): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "לא הצלחנו לזהות אתכם." };

  const { error } = await supabase
    .from("profiles")
    .update({ notifications_enabled: enabled })
    .eq("id", auth.user.id);

  if (error) return { ok: false, error: describeDbError(error) };

  revalidatePath("/settings");
  return { ok: true };
}
