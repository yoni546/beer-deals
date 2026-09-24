"use client";

import { useState, useTransition } from "react";
import { resolveReport, setDealStatus } from "@/lib/actions/admin";
import { CATEGORY_LABEL_ONE } from "@/lib/categories";
import { formatPrice } from "@/lib/money";
import type { DealReport } from "@/lib/db/types";

/**
 * A user report, and the decision it asks for.
 *
 * Taking the deal down and closing the report are two separate buttons on
 * purpose. "The deal has ended" is a claim, not a verdict: an admin may check
 * and find it still running, and the report should then close with the deal
 * untouched. Collapsing these into one button would make every report a
 * removal.
 */
export function ReportRow({ report }: { report: DealReport }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const deal = report.deals;

  function run(work: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const result = await work();
      setMessage(result.ok ? (result.message ?? "בוצע.") : (result.error ?? "שגיאה."));
    });
  }

  const button = "rounded-xl px-3 py-2 text-xs font-bold ring-1 ring-white/10 disabled:opacity-40";

  return (
    <article className="rounded-2xl bg-[color:var(--surface)] p-4 ring-1 ring-white/10">
      <p className="text-xs opacity-55">דווח שהמבצע נגמר</p>

      {deal ? (
        <p className="mt-1 font-bold">
          {deal.beers?.name_he} · {CATEGORY_LABEL_ONE[deal.category]}{" "}
          <span className="num">{formatPrice(deal.deal_price_agorot)}</span> ·{" "}
          {deal.stores?.name_he}
        </p>
      ) : (
        <p className="mt-1 font-bold opacity-60">המבצע כבר לא קיים</p>
      )}

      {report.reason && <p className="mt-1 text-xs opacity-60">{report.reason}</p>}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {deal && deal.status === "approved" && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const removed = await setDealStatus(deal.id, "inactive");
                if (!removed.ok) return removed;
                return resolveReport(report.id, "resolved");
              })
            }
            className={`${button} bg-[color:var(--accent)] text-[color:var(--base)]`}
          >
            להסיר את המבצע
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => resolveReport(report.id, "dismissed"))}
          className={button}
        >
          המבצע עדיין תקף — סגירת הדיווח
        </button>
      </div>

      {message && <p className="mt-2 text-xs opacity-70">{message}</p>}
    </article>
  );
}
