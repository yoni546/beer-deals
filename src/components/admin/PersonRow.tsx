import { SubmitterRow } from "@/components/admin/SubmitterRow";
import { relativeTimeHe } from "@/lib/format";
import type { AdminPerson } from "@/lib/admin-queries";

/**
 * One person in the panel (migration 0041).
 *
 * The blocking control is the one from the submitters screen, unchanged — one
 * action, one component, one set of words, so the two screens cannot drift into
 * describing the same thing differently.
 *
 * What is NOT on this row: the private first name, coordinates, email, and
 * anything about their notifications. The town answers every question this screen
 * exists for, and a coordinate is a doorstep.
 */

const LEVEL_HE: Record<string, string> = {
  moderator: "מנהל תוכן",
  admin: "מנהל",
  super_admin: "מנהל על",
};

const RADIUS_HE = (km: number | null) =>
  km === null ? "לא קבעו מרחק" : km === 0 ? "בכל הארץ" : `עד ${km} ק״מ`;

export function PersonRow({ person }: { person: AdminPerson }) {
  return (
    <div>
      <div className="px-4 pt-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-sm text-ink-2">
            {person.home_city ?? "לא אמרו איפה"} · {RADIUS_HE(person.search_radius_km)} · נרשמו{" "}
            {relativeTimeHe(person.registered_at)}
          </p>
          {person.admin_level && (
            <span className="rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink">
              {LEVEL_HE[person.admin_level] ?? person.admin_level}
            </span>
          )}
        </div>
        {person.favourites.length > 0 && (
          <p className="mt-0.5 text-sm text-ink-2">
            {/* In their own order: #1 first, because #1 is the app. */}
            הבירות שלהם: {person.favourites.join(" · ")}
          </p>
        )}
      </div>
      <SubmitterRow
        person={{
          user_id: person.user_id,
          display_name: person.display_name,
          approved: person.approved,
          rejected: person.rejected,
          pending: person.pending,
          last_at: person.registered_at,
          is_blocked: person.is_blocked,
          block_reason: person.block_reason,
        }}
      />
    </div>
  );
}
