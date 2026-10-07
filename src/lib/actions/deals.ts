"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import { shekelsToAgorot } from "@/lib/money";
import { DEAL_CATEGORIES } from "@/lib/categories";
import { describeDbError, type ActionResult } from "@/lib/actions/result";

/** Where an uploaded deal photo legitimately lives — this project's own public bucket. */
const DEAL_IMAGE_PREFIX = `${publicEnv.supabaseUrl}/storage/v1/object/public/deal-images/`;

const submission = z
  .object({
    beerId: z.uuid("בחרו בירה"),
    storeId: z.uuid("בחרו חנות"),
    category: z.enum(DEAL_CATEGORIES),
    dealPrice: z.string().min(1, "מה המחיר במבצע?"),
    regularPrice: z.string().min(1, "מה המחיר הרגיל?"),
    notes: z.string().max(280).optional(),
    /**
     * The attached photo, and the only field on this form whose value is later
     * rendered to a MODERATOR as a link.
     *
     * It used to be `z.string().optional()` — anything at all — and
     * DealActions.tsx put it straight into an href. Any visitor (an anonymous
     * session is minted automatically) could submit a deal with
     * `javascript:...` and wait for an admin to click "view the attached photo":
     * that scheme executes in the current document whatever `target` says, which
     * is script execution in a super-admin's session, one server-action call away
     * from grant_admin. `data:text/html` and a convincing look-alike host are the
     * quieter versions of the same thing.
     *
     * So it is pinned to the one place an upload can legitimately be: this
     * project's own public bucket. Nothing else is a photo of a shelf label.
     */
    imageUrl: z
      .string()
      .url("קישור התמונה לא תקין.")
      .refine((value) => value.startsWith(DEAL_IMAGE_PREFIX), "אפשר לצרף רק תמונה שהועלתה דרך האפליקציה.")
      .optional(),
  })
  .transform((value, ctx) => {
    const deal = shekelsToAgorot(value.dealPrice);
    const regular = shekelsToAgorot(value.regularPrice);

    if (deal === null) {
      ctx.addIssue({ code: "custom", message: "מחיר המבצע לא תקין — למשל 24.90" });
      return z.NEVER;
    }
    if (regular === null) {
      ctx.addIssue({ code: "custom", message: "המחיר הרגיל לא תקין — למשל 39.90" });
      return z.NEVER;
    }
    if (deal >= regular) {
      // The same rule as the CHECK constraint, caught early so the user gets a
      // sentence instead of a constraint-violation message.
      ctx.addIssue({ code: "custom", message: "מחיר המבצע צריך להיות נמוך מהמחיר הרגיל." });
      return z.NEVER;
    }

    return { ...value, dealAgorot: deal, regularAgorot: regular };
  });

/**
 * Submit a deal. It is stored as `pending` and is invisible to everyone but its
 * author and the admins until somebody approves it — enforced by the RLS
 * policy, not by this function.
 */
export async function submitDeal(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = submission.safeParse({
    beerId: formData.get("beerId"),
    storeId: formData.get("storeId"),
    category: formData.get("category"),
    dealPrice: formData.get("dealPrice"),
    regularPrice: formData.get("regularPrice"),
    notes: (formData.get("notes") as string) || undefined,
    imageUrl: (formData.get("imageUrl") as string) || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "בדקו את הפרטים." };
  }

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "לא הצלחנו לזהות אתכם. רעננו את הדף." };

  const { error } = await supabase.from("deals").insert({
    beer_id: parsed.data.beerId,
    store_id: parsed.data.storeId,
    category: parsed.data.category,
    deal_price_agorot: parsed.data.dealAgorot,
    regular_price_agorot: parsed.data.regularAgorot,
    notes: parsed.data.notes ?? null,
    image_url: parsed.data.imageUrl ?? null,
    created_by: auth.user.id,
    status: "pending",
  });

  if (error) return { ok: false, error: describeDbError(error) };

  revalidatePath("/submit");
  return { ok: true, message: "תודה! המבצע נשלח לאישור ויפורסם אחרי בדיקה." };
}

/**
 * Report that a deal has ended.
 *
 * This creates a task for an admin and touches nothing else. A user report must
 * never take a deal down on its own — otherwise one person, or one bug, could
 * empty the app.
 */
export async function reportDeal(dealId: string, reason: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "לא הצלחנו לזהות אתכם. רעננו את הדף." };

  const { error } = await supabase.from("deal_reports").insert({
    deal_id: dealId,
    reported_by: auth.user.id,
    reason: reason.slice(0, 280) || null,
    status: "open",
  });

  // A partial unique index allows one open report per person per deal. Hitting
  // it means they already told us, which is a success from their point of view.
  if (error && error.code !== "23505") return { ok: false, error: describeDbError(error) };

  return { ok: true, message: "תודה, העברנו לבדיקה." };
}
