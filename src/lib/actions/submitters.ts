"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { describeDbError, type ActionResult } from "@/lib/actions/result";

/**
 * Stopping, and un-stopping, one account from submitting deals (migration 0035).
 *
 * Both call an RPC that checks the caller's role in Postgres and records the act
 * with its reason. Neither touches anything else about the account.
 */

export async function blockSubmitter(userId: string, reason: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("admin_block_submitter", { p_user_id: userId, p_reason: reason });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidatePath("/admin", "layout");
  return { ok: true, message: "החשבון לא יכול לשלוח מבצעים חדשים. כל השאר לא נגענו בו." };
}

export async function unblockSubmitter(userId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("admin_unblock_submitter", { p_user_id: userId });
  if (error) return { ok: false, error: describeDbError(error) };

  revalidatePath("/admin", "layout");
  return { ok: true, message: "החסימה הוסרה." };
}
