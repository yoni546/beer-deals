/**
 * What every server action returns. `useActionState` needs a serialisable
 * value, and a thrown error in a Server Action reaches the browser as a generic
 * "an error occurred" — so failures are values here, with a message the user
 * can act on.
 */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export const IDLE: ActionResult = { ok: true };

/**
 * Postgres errors arrive with a code and a message we wrote in the migration.
 * `42501` is insufficient_privilege — that is an RLS or require_admin() refusal
 * and always means the request should not have been made, so it gets a fixed
 * message rather than the raw database text.
 *
 * Which means the choice of code in a migration decides whether the sentence
 * written there ever reaches a person. A refusal of an ORDINARY request — a rate
 * limit (0033), a blocked submitter (0035) — must not use 42501, or the careful
 * Hebrew explaining what to do next is replaced by "you have no permission for
 * this". Those raise 54000 and P0001 respectively and fall through to the
 * message below, on purpose.
 */
export function describeDbError(error: { code?: string; message: string } | null): string {
  if (!error) return "משהו השתבש. נסו שוב.";
  if (error.code === "42501") return "אין לכם הרשאה לפעולה הזו.";
  if (error.code === "23505") return "כבר קיים רישום כזה.";
  if (error.code === "P0002") return "לא נמצא.";
  return error.message || "משהו השתבש. נסו שוב.";
}
