import type { ReactNode } from "react";
import { Tape } from "@/components/ui/Tape";

/**
 * Admin-only layout helpers, kept beside the admin components so the panel pages
 * share one rhythm: a heading on the counter, then the work on paper beneath it.
 */

/** A titled block of the panel: heading (and an optional line of explanation) on the counter. */
export function AdminSection({ title, note, children }: { title: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl leading-tight font-bold text-on-ground">{title}</h2>
      {note && <p className="mt-1 text-sm leading-relaxed text-on-ground-2">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** One strip of paper holding a run of rows, ruled off with dotted lines. */
export function AdminList({ children }: { children: ReactNode }) {
  return (
    <Tape as="div" className="divide-y divide-dotted divide-paper-line">
      {children}
    </Tape>
  );
}
