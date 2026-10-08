"use client";

import { useState, useTransition } from "react";
import { Notice } from "@/components/Chrome";
import { useAdminNotice } from "@/components/admin/AdminNotices";
import { blockSubmitter, unblockSubmitter } from "@/lib/actions/submitters";
import { relativeTimeHe } from "@/lib/format";
import type { AdminSubmitter } from "@/lib/admin-queries";

/**
 * One person who has been submitting deals (migration 0035).
 *
 * What the row says about them is only what they chose to publish and what they
 * sent us. Somebody who never chose a public name is shown by their record alone,
 * and the line says that plainly rather than calling them "anonymous" — which is
 * itself a label nobody asked for (0030).
 *
 * Blocking asks for a reason in the same breath, because a block nobody can
 * explain is a block nobody can review. It is not a ban, and the button says so.
 */
export function SubmitterRow({ person }: { person: AdminSubmitter }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const notify = useAdminNotice();
  const reasonId = `block-${person.user_id}-reason`;

  function run(work: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const result = await work();
      const said = { ok: result.ok, text: result.ok ? (result.message ?? "בוצע.") : (result.error ?? "שגיאה.") };
      if (notify) notify(said);
      else setMessage(said);
      if (result.ok) {
        setAsking(false);
        setReason("");
      }
    });
  }

  return (
    <article className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-base font-bold text-ink">
          {person.display_name ?? "לא בחר שם ציבורי"}
        </p>
        {person.is_blocked && (
          <span className="hatch shrink-0 rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink">
            חסום לשליחה
          </span>
        )}
      </div>

      <p className="mt-0.5 text-sm text-ink-2">
        אושרו <span className="num font-bold text-ink">{person.approved}</span> · נדחו{" "}
        <span className="num font-bold text-ink">{person.rejected}</span> · ממתינים{" "}
        <span className="num font-bold text-ink">{person.pending}</span>
        {person.last_at && <> · אחרון {relativeTimeHe(person.last_at)}</>}
      </p>

      {person.is_blocked && person.block_reason && (
        <p className="mt-1 text-sm leading-relaxed text-ink-2">הסיבה שנרשמה: {person.block_reason}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {person.is_blocked ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => unblockSubmitter(person.user_id))}
            className="btn"
          >
            הסרת החסימה
          </button>
        ) : (
          <button
            type="button"
            aria-expanded={asking}
            onClick={() => setAsking((value) => !value)}
            className="btn btn-quiet"
          >
            {asking ? "ביטול" : "חסימת שליחה"}
          </button>
        )}
      </div>

      {asking && !person.is_blocked && (
        <div className="tear mt-3 space-y-2 pt-3">
          <label htmlFor={reasonId} className="block text-sm font-semibold text-ink">
            למה?
          </label>
          <input
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="למשל: שלח חמישה מחירים שלא קיימים"
            className="field"
          />
          <p className="text-sm leading-relaxed text-ink-2">
            החסימה מונעת שליחת מבצעים חדשים בלבד. המועדפות, ההתראות, השם והקרדיט על מה שכבר אושר — נשארים.
          </p>
          <button
            type="button"
            disabled={pending || reason.trim().length < 3}
            onClick={() => run(() => blockSubmitter(person.user_id, reason))}
            className="btn btn-danger w-full"
          >
            חסימת שליחה
          </button>
        </div>
      )}

      {message && (
        <div className="mt-2">
          <Notice tone={message.ok ? "info" : "error"}>{message.text}</Notice>
        </div>
      )}
    </article>
  );
}
