"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Tape } from "@/components/ui/Tape";

/**
 * One part of the page could not be read.
 *
 * This is NOT an empty state and must never be mistaken for one. "אין מבצעים" is a
 * fact about the world; this says the opposite — that we could not look — which is
 * the distinction CLAUDE.md insists on for prices and which the admin screens used
 * to get wrong (a failed queue read rendered "nothing is pending").
 *
 * It replaces one strip, not the screen: whatever else loaded is still on the page.
 * Retry is a soft refresh of the server render, so a transient timeout — the usual
 * cause — costs one tap instead of a lost page.
 */
export function CouldNotLoad({ what, headingLevel = 2 }: { what: string; headingLevel?: 2 | 3 }) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const Heading = `h${headingLevel}` as "h2" | "h3";

  return (
    <Tape className="px-5 py-6 text-center" role="status">
      <Heading className="text-base font-bold text-ink">לא הצלחנו לטעון {what}</Heading>
      <div aria-hidden className="mx-auto my-3 w-16 border-t-2 border-dotted border-paper-line" />
      <p className="text-sm leading-relaxed text-ink-2">
        זה לא אומר שאין {what} — רק שלא הצלחנו להסתכל כרגע.
      </p>
      <button
        type="button"
        onClick={() => startRetry(() => router.refresh())}
        disabled={retrying}
        className="btn btn-quiet mt-4 w-full disabled:opacity-60"
      >
        {retrying ? "טוענים…" : "ניסיון נוסף"}
      </button>
    </Tape>
  );
}
