import { ClockIcon } from "@/components/ui/icons";
import { daysSince, relativeTimeHe } from "@/lib/format";

/**
 * "Updated 3 hours ago" — the honest answer to "can I trust these prices?". Old data
 * is labelled as old and hatched, in words as well as pattern, so it is never mistaken for fresh.
 */
export function Freshness({ at, now = Date.now() }: { at: string | null; now?: number }) {
  if (!at) return null;
  const stale = daysSince(at, now) >= 3;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${stale ? "hatch rounded-full border border-ground-line px-2 py-0.5" : ""} text-on-ground-2`}
      title={stale ? "המחירים לא עודכנו לאחרונה" : undefined}
    >
      <ClockIcon size={14} />
      {stale ? "לא עודכן" : "עודכן"} {relativeTimeHe(at, now)}
    </span>
  );
}
