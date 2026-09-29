"use server";

import { revalidatePath } from "next/cache";
import { isThemeSlug } from "@/design/themes";
import { describeDbError, type ActionResult } from "@/lib/actions/result";
import { supabaseServer } from "@/lib/supabase/server";

const APPEARANCES = ["system", "light", "dark"] as const;

/**
 * Settings → look and feel. Both choices are stored on the person's profile so they follow
 * them to every device they sign in on.
 *
 *   theme       a slug from src/design/themes.ts, or "auto" (= follow favourite #1)
 *   appearance  "system" | "light" | "dark"
 *
 * Either may be omitted to leave it as it is. Input from a browser is untrusted: an
 * unknown slug or mode is refused here (and, for the slug's shape, again by a CHECK in
 * the database), so nothing arbitrary ever ends up inside the injected theme stylesheet.
 */
export async function saveAppearance(input: { theme?: string; appearance?: string }): Promise<ActionResult> {
  const patch: { theme_override?: string | null; appearance?: string } = {};

  if (input.theme !== undefined) {
    if (input.theme !== "auto" && !isThemeSlug(input.theme)) return { ok: false, error: "המראה הזה לא קיים." };
    patch.theme_override = input.theme === "auto" ? null : input.theme;
  }
  if (input.appearance !== undefined) {
    if (!(APPEARANCES as readonly string[]).includes(input.appearance)) return { ok: false, error: "המצב הזה לא קיים." };
    patch.appearance = input.appearance;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "לא הצלחנו לזהות אתכם." };

  const { error } = await supabase.from("profiles").update(patch).eq("id", auth.user.id);
  if (error) return { ok: false, error: describeDbError(error) };

  // The theme lives in the root layout, so every screen has to be re-rendered.
  revalidatePath("/", "layout");
  return { ok: true, message: "נשמר." };
}
