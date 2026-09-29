"use client";

import { useState, useTransition } from "react";
import { Notice } from "@/components/Chrome";
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
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const deal = report.deals;

  function run(work: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const result = await work();
      setMessage({ ok: result.ok, text: result.ok ? (result.message ?? "בוצע.") : (result.error ?? "שגיאה.") });
    });
  }

  return (
    <article className="px-4 py-4">
      <p className="text-sm text-ink-2">דווח שהמבצע נגמר</p>

      {deal ? (
        <p className="mt-1 text-base leading-snug font-bold text-ink">
          {deal.beers?.name_he} · {CATEGORY_LABEL_ONE[deal.category]}{" "}
          <span className="num text-price">{formatPrice(deal.deal_price_agorot)}</span> ·{" "}
          {deal.stores?.name_he}
        </p>
      ) : (
        <p className="mt-1 text-base font-bold text-ink-2">המבצע כבר לא קיים</p>
      )}

      {report.reason && <p className="mt-1 text-sm leading-relaxed text-ink-2">{report.reason}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
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
            className="btn btn-danger py-2"
          >
            להסיר את המבצע
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => resolveReport(report.id, "dismissed"))}
          className="btn btn-quiet py-2 text-center"
        >
          המבצע עדיין תקף — סגירת הדיווח
        </button>
      </div>

      {message && (
        <div className="mt-3">
          <Notice tone={message.ok ? "info" : "error"}>{message.text}</Notice>
        </div>
      )}
    </article>
  );
}
