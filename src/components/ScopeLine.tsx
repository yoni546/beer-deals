"use client";

import { useState } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import { kmHe, type ScopeText } from "@/lib/format";

type Branch = {
  branch_name: string | null;
  branch_city: string | null;
  observed_at: string;
  /** Null when we do not know where this branch is (0026) — never zero. */
  km?: number | null;
  /** 'locality' means the CITY centre, not the shop. Said, not implied. */
  geo_precision?: string | null;
};

type Sheet = {
  branches: Branch[];
  /** Does this person have a home on record to measure from? */
  home: boolean;
  /** Do we know where any of these branches are? */
  locatable: boolean;
};

/**
 * Where a deal runs, in one quiet line ("בכל הרשת", "בסניפים משתתפים", "נצפה בסניף X"). When there are
 * branches to list, the line opens a compact sheet with them — fetched only then, never with the page.
 */
export function ScopeLine({ text, promotionId }: { text: ScopeText; promotionId: number | null | undefined }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [failed, setFailed] = useState(false);
  const branches = sheet?.branches ?? null;

  if (!text.inspectable || !promotionId) {
    return (
      <span data-scope title={text.detail ?? undefined}>
        {text.label}
        {text.detail && <span className="sr-only"> ({text.detail})</span>}
      </span>
    );
  }

  async function load() {
    if (sheet || failed) return;
    try {
      const res = await fetch(`/api/promotions/${promotionId}/branches`);
      if (!res.ok) throw new Error(String(res.status));
      setSheet((await res.json()) as Sheet);
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
          <>
            {/* Said once, above the list, rather than as a gap on every row. Which of
                the two reasons it is matters: one is something the person can fix. */}
            {sheet && !sheet.locatable && (
              <p className="mb-1">
                {sheet.home
                  ? "עוד אין לנו את המיקומים של הסניפים, אז אי אפשר למדוד מרחק."
                  : "לא סיפרתם לנו איפה אתם, אז אי אפשר למדוד מרחק."}
              </p>
            )}
            <ul className="max-h-56 overflow-y-auto" aria-label="הסניפים שבהם נמצא המבצע">
              {branches.map((b, i) => (
                <li key={i} className="flex justify-between gap-3 py-1">
                  <span className="text-ink">{b.branch_name ?? "סניף"}</span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    {b.branch_city && !/^\d+$/.test(b.branch_city) && <span>{b.branch_city}</span>}
                    {typeof b.km === "number" && (
                      <span className="num text-ink">
                        {kmHe(b.km)}
                        {/* A locality fix is the town centre; saying "2 km" off one
                            would be a precision we do not have. */}
                        {b.geo_precision === "locality" && <span className="text-ink-2"> (מרכז העיר)</span>}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}
