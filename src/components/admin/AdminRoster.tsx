"use client";

import { useActionState, useState, useTransition } from "react";
import { grantAdmin, revokeAdmin } from "@/lib/actions/admin";
import { IDLE } from "@/lib/actions/result";

type Row = { user_id: string; level: string; created_at: string };

/**
 * Adding and removing admins. Super admin only — and the check that matters is
 * in grant_admin/revoke_admin, which raise 42501 for anyone else.
 */
export function AdminRoster({ roster, currentUserId }: { roster: Row[]; currentUserId: string }) {
  const [state, submit, pending] = useActionState(grantAdmin, IDLE);
  const [message, setMessage] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();

  const field = "w-full rounded-2xl bg-[color:var(--surface)] px-4 py-3 text-sm ring-1 ring-white/10 outline-none";

  return (
    <div className="space-y-6">
      <form action={submit} className="space-y-2">
        <label htmlFor="email" className="block text-sm font-bold">
          הוספת מנהל לפי אימייל
        </label>
        <p className="text-xs opacity-50">
          המשתמש צריך להיות כבר רשום עם האימייל הזה בסופאבייס.
        </p>
        <input id="email" name="email" type="email" required dir="ltr" className={field} />
        <select name="level" defaultValue="admin" aria-label="רמת הרשאה" className={field}>
          <option value="admin">מנהל</option>
          <option value="super_admin">מנהל על</option>
        </select>
        {!state.ok && <p className="text-sm text-red-300">{state.error}</p>}
        {state.ok && state.message && (
          <p className="text-sm text-[color:var(--accent)]">{state.message}</p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-2xl bg-[color:var(--accent)] px-4 py-3 text-sm font-bold text-[color:var(--base)] disabled:opacity-40"
        >
          הוספה
        </button>
      </form>

      <div className="space-y-2">
        <h3 className="text-sm font-black opacity-70">מנהלים קיימים</h3>
        {roster.map((row) => (
          <div
            key={row.user_id}
            className="flex items-center justify-between gap-3 rounded-2xl bg-[color:var(--surface)] px-4 py-3 ring-1 ring-white/10"
          >
            <div className="min-w-0">
              <p className="truncate font-mono text-xs opacity-70" dir="ltr">
                {row.user_id}
              </p>
              <p className="text-xs opacity-55">
                {row.level === "super_admin" ? "מנהל על" : "מנהל"}
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
                    setMessage(result.ok ? "ההרשאה הוסרה." : result.error);
                  })
                }
                className="shrink-0 rounded-xl px-3 py-2 text-xs font-bold ring-1 ring-white/10"
              >
                הסרה
              </button>
            )}
          </div>
        ))}
        {message && <p className="text-xs opacity-70">{message}</p>}
      </div>
    </div>
  );
}
