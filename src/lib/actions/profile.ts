"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { report } from "@/lib/log";
import { supabaseServer } from "@/lib/supabase/server";
import { describeDbError, type ActionResult } from "@/lib/actions/result";

/**
 * Where the person lives, and how far they will go for a deal. Every field is
 * optional: somebody who declines the question still gets an app, they just do not
 * get distances. A city with no point is a real answer too — the list in
 * src/data/israel-cities.ts may not hold their village, and "I live in צפת" is
 * still worth knowing.
 */
const location = z.object({
  city: z.string().trim().max(60).optional(),
  lat: z.number().min(29.3).max(33.5).nullable().optional(),
  lon: z.number().min(34.0).max(36.0).nullable().optional(),
  // The same set as the CHECK on profiles.search_radius_km (0026). 0 is nationwide.
  radiusKm: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(25), z.literal(50)]).nullable().optional(),
});

const preferences = z.object({
  // Optional: an empty name is stored as "no name yet" (save_preferences does the nullif).
  firstName: z.string().trim().max(40, "השם ארוך מדי."),
  // One to four (0024). The database enforces the same range; this is only so the
  // person gets Hebrew rather than a Postgres error code.
  beerIds: z
    .array(z.uuid())
    .min(1, "בחרו לפחות בירה אחת.")
    .max(4, "אפשר לבחור עד ארבע בירות.")
    .refine((ids) => new Set(ids).size === ids.length, "כל בירה יכולה להופיע פעם אחת."),
});

/**
 * Name + the ranked beers (between one and four), saved together through
 * save_preferences(), which writes them in one transaction. Beer #1 becomes the
 * Primary Beer by a database trigger, so the theme and the notification target
 * can never drift from what the user actually ranked first.
 *
 * Shared by onboarding and Settings; only what happens AFTER the save differs
 * (see the two exported actions below).
 */
async function persistPreferences(formData: FormData): Promise<ActionResult> {
  const parsed = preferences.safeParse({
    firstName: String(formData.get("firstName") ?? ""),
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

  await persistLocation(formData, supabase);

  return { ok: true, message: "נשמר." };
}

/**
 * The location half, saved after the beers and deliberately not allowed to fail
 * the whole save.
 *
 * The beers are the thing the app cannot work without — they decide the theme, the
 * ordering and the notifications. A location is an enhancement. If it is absent,
 * malformed, or the write fails, the person is still onboarded with their beers
 * rather than being sent back to the start of a form they filled in correctly.
 */
async function persistLocation(
  formData: FormData,
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
): Promise<void> {
  const raw = {
    city: String(formData.get("homeCity") ?? "") || undefined,
    lat: formData.get("homeLat") ? Number(formData.get("homeLat")) : null,
    lon: formData.get("homeLon") ? Number(formData.get("homeLon")) : null,
    radiusKm: formData.get("radiusKm") ? Number(formData.get("radiusKm")) : null,
  };
  if (!raw.city && raw.lat === null && raw.radiusKm === null) return; // nothing was offered

  const parsed = location.safeParse(raw);
  if (!parsed.success) {
    report("location.rejected", { reason: parsed.error.issues[0]?.message });
    return;
  }

  const { error } = await supabase.rpc("save_location", {
    p_city: parsed.data.city ?? null,
    p_lat: parsed.data.lat ?? null,
    p_lon: parsed.data.lon ?? null,
    p_radius_km: parsed.data.radiusKm ?? null,
  });
  if (error) report("location.save_failed", { code: error.code, reason: error.message });
}

/** Settings, and anywhere else the radius or the city changes on its own. */
export async function saveLocation(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "לא הצלחנו לזהות אתכם. רעננו את הדף." };

  await persistLocation(formData, supabase);
  revalidatePath("/", "layout");
  return { ok: true, message: "נשמר." };
}

/**
 * Settings: save, then refresh every screen so the new Primary Beer's theme and
 * ordering show up immediately.
 */
export async function savePreferences(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const result = await persistPreferences(formData);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/**
 * Onboarding: save, and deliberately do NOT revalidate.
 *
 * Revalidating re-renders /welcome, and /welcome redirects anyone who is
 * already onboarded to `/` — which threw people out of the last onboarding step
 * a second after they reached it. The screen finishes by loading `/` itself, and
 * a full page load reads the new profile (and theme) fresh.
 */
export async function completeOnboarding(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return persistPreferences(formData);
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
