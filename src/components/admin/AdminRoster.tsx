"use client";

import { useActionState, useState, useTransition } from "react";
import { Notice } from "@/components/Chrome";
import { useAdminNotice } from "@/components/admin/AdminNotices";
import { Tape } from "@/components/ui/Tape";
import { grantAdmin, revokeAdmin } from "@/lib/actions/admin";
import { IDLE } from "@/lib/actions/result";

type Row = { user_id: string; level: string; created_at: string };

/** What each role may actually do, said where somebody is choosing one. */
const LEVEL_HE: Record<string, string> = {
  moderator: "מנהל תוכן · מאשר ודוחה מבצעים",
  admin: "מנהל · גם בירות, מבצע השבוע וכיסוי",
  super_admin: "מנהל על · גם הרשאות, מחיקה והתראות",
};

/**
 * Adding and removing admins. Super admin only — and the check that matters is
 * in grant_admin/revoke_admin, which raise 42501 for anyone else.
 */
export function AdminRoster({ roster, currentUserId }: { roster: Row[]; currentUserId: string }) {
  const [state, submit, pending] = useActionState(grantAdmin, IDLE);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Revoking takes the person off the list, so the row cannot report it. See AdminNotices.
  const notify = useAdminNotice();
  const [removing, startRemoving] = useTransition();

  return (
    <div className="space-y-8">
      <Tape className="px-5 py-6">
        <form action={submit} className="space-y-3">
          <label htmlFor="email" className="block text-base font-bold text-ink">
            הוספת מנהל לפי אימייל
          </label>
          <p className="text-sm leading-relaxed text-ink-2">
            המשתמש צריך להיות כבר רשום עם האימייל הזה בסופאבייס.
          </p>
          <input id="email" name="email" type="email" required dir="ltr" className="field" />
          {/* Four roles since 0040. "User" is the absence of a row, so it is not
              here: you remove somebody rather than demote them to it. */}
          <select name="level" defaultValue="moderator" aria-label="רמת הרשאה" className="field">
            <option value="moderator">מנהל תוכן</option>
            <option value="admin">מנהל</option>
            <option value="super_admin">מנהל על</option>
          </select>
          {!state.ok && <Notice>{state.error}</Notice>}
          {state.ok && state.message && <Notice tone="info">{state.message}</Notice>}
          <button type="submit" disabled={pending} className="btn w-full">
            הוספה
          </button>
        </form>
      </Tape>

      <div>
        <h3 className="mb-3 text-base font-bold text-on-ground">מנהלים קיימים</h3>
        <Tape as="ul" className="divide-y divide-dotted divide-paper-line">
          {roster.map((row) => (
            <li key={row.user_id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-ink" dir="ltr">
                  {row.user_id}
                </p>
                <p className="text-sm text-ink-2">
                  {LEVEL_HE[row.level] ?? row.level}
                  {row.user_id === currentUserId ? " · זה אתם" : ""}
                </p>
              </div>
              {row.user_id !== currentUserId && (
                <button
                  type="button"
                  disabled={removing}
                  onClick={() =>
                    startRemoving(async () => {
                      const result = await revokeAdmin(row.user_id);
                      const said = result.ok
                        ? { ok: true, text: "ההרשאה הוסרה." }
                        : { ok: false, text: result.error };
                      if (notify) notify(said);
                      else setMessage(said);
                    })
                  }
                  className="btn btn-danger shrink-0"
                >
                  הסרה
                </button>
              )}
            </li>
          ))}
        </Tape>
        {message && (
          <div className="mt-3">
            <Notice tone={message.ok ? "info" : "error"}>{message.text}</Notice>
          </div>
        )}
      </div>
    </div>
  );
}
