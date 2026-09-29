"use client";

import { useState, useTransition } from "react";
import { reportDeal } from "@/lib/actions/deals";

/**
 * "The deal has ended."
 *
 * Lives inside a line's folded-out details, not on the line itself: it is rarely needed
 * and must never compete with the price. Pressing it files a report for an administrator;
 * it does not remove anything, and the confirmation says so, because a person who thinks
 * they just deleted a deal will hesitate to press it next time.
 */
export function ReportDealButton({ dealId }: { dealId: string }) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const [pending, startTransition] = useTransition();

  if (state === "done") {
    return <p className="text-sm text-ink-2">תודה, העברנו לבדיקה. המבצע לא יוסר עד שמישהו יבדוק.</p>;
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await reportDeal(dealId, "");
            setState(result.ok ? "done" : "error");
          })
        }
        className="inline-flex min-h-11 items-center rounded-full border border-paper-line px-4 text-sm font-semibold text-ink disabled:opacity-50"
      >
        {pending ? "שולחים…" : "המבצע נגמר?"}
      </button>
      {state === "error" && (
        <p role="alert" className="text-sm text-danger">
          לא הצלחנו לשלוח. נסו שוב.
        </p>
      )}
    </div>
  );
}
