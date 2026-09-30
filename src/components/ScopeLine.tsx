"use client";

import { useState } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import type { ScopeText } from "@/lib/format";

type Branch = { branch_name: string | null; branch_city: string | null; observed_at: string };

/**
 * Where a deal runs, in one quiet line ("בכל הרשת", "בסניפים משתתפים", "נצפה בסניף X"). When there are
 * branches to list, the line opens a compact sheet with them — fetched only then, never with the page.
 */
export function ScopeLine({ text, promotionId }: { text: ScopeText; promotionId: number | null | undefined }) {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [failed, setFailed] = useState(false);

  if (!text.inspectable || !promotionId) {
    return (
      <span data-scope title={text.detail ?? undefined}>
        {text.label}
        {text.detail && <span className="sr-only"> ({text.detail})</span>}
      </span>
    );
  }

  async function load() {
    if (branches || failed) return;
    try {
      const res = await fetch(`/api/promotions/${promotionId}/branches`);
      if (!res.ok) throw new Error(String(res.status));
      setBranches(((await res.json()) as { branches: Branch[] }).branches);
    } catch {
      setFailed(true);
    }
  }

  return (
    <details className="group/scope w-full" data-scope onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && load()}>
      <summary className="-ms-1 inline-flex min-h-11 cursor-pointer list-none items-center gap-1 ps-1 font-medium text-ink underline decoration-dotted underline-offset-4 [&::-webkit-details-marker]:hidden">
        {text.label}
        <ChevronDownIcon size={14} className="transition-transform group-open/scope:rotate-180" />
      </summary>
      <div className="mb-1 rounded-lg border border-paper-line px-3 py-2 text-sm text-ink-2">
        {text.detail && <p className="mb-1 font-medium text-ink">{text.detail}</p>}
        {failed ? (
          <p>לא הצלחנו לטעון את רשימת הסניפים. נסו שוב מאוחר יותר.</p>
        ) : branches === null ? (
          <p role="status">טוענים סניפים…</p>
        ) : branches.length === 0 ? (
          <p>אין כרגע סניף שבו המבצע נמצא ברשימה העדכנית.</p>
        ) : (
          <ul className="max-h-56 overflow-y-auto" aria-label="הסניפים שבהם נמצא המבצע">
            {branches.map((b, i) => (
              <li key={i} className="flex justify-between gap-3 py-1">
                <span className="text-ink">{b.branch_name ?? "סניף"}</span>
                {b.branch_city && !/^\d+$/.test(b.branch_city) && <span>{b.branch_city}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
