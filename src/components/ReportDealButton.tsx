"use client";

import { useState, useTransition } from "react";
import { reportDeal } from "@/lib/actions/deals";

/**
 * "The deal has ended."
 *
 * Small and quiet on purpose — it sits on every approved card but must never
 * compete with the price. Pressing it files a report for an admin; it does not
 * remove anything, and the confirmation says so, because a user who thinks they
 * just deleted a deal will hesitate to press it next time.
 */
export function ReportDealButton({ dealId }: { dealId: string }) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const [pending, startTransition] = useTransition();

  if (state === "done") {
    return <p className="mt-2 text-[11px] opacity-50">תודה, העברנו לבדיקה.</p>;
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await reportDeal(dealId, "");
          setState(result.ok ? "done" : "error");
        })
      }
      className="mt-2 -mr-1 rounded-lg px-1 py-1 text-[11px] opacity-45 underline underline-offset-2 transition hover:opacity-80 disabled:opacity-30"
    >
      {state === "error" ? "לא הצלחנו לשלוח — נסו שוב" : "דווח שהמבצע נגמר"}
    </button>
  );
}
