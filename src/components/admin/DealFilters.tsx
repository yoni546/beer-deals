import Link from "next/link";
import { Segmented } from "@/components/ui/Chip";
import { withParams } from "@/lib/urls";
import type { AdminDealFilter } from "@/lib/admin-queries";
import type { Beer, Store } from "@/lib/db/types";

/**
 * Narrowing the moderation list (Phase U).
 *
 * The state is in the URL, like every other filter in this app (src/lib/urls.ts):
 * a moderator can refresh, use the back button, keep a tab open on "rejected, Rami
 * Levy" and send somebody the link to what they are looking at. A client component
 * holding this in useState would lose all four.
 *
 * Which is also why the two long lists are <form> GETs with a plain <select> and a
 * submit button rather than an onChange that navigates: it works before hydration,
 * and a select that jumps the moment you touch it is unusable with a keyboard.
 */

const STATUS_LABEL: Array<{ value: AdminDealFilter["status"]; label: string }> = [
  { value: "pending", label: "ממתינים" },
  { value: "approved", label: "מאושרים" },
  { value: "rejected", label: "נדחו" },
  { value: "inactive", label: "הוסרו" },
  { value: "all", label: "הכול" },
];

const SOURCE_LABEL: Array<{ value: AdminDealFilter["source"]; label: string }> = [
  { value: "all", label: "כל המקורות" },
  { value: "users", label: "ממשתמשים" },
  { value: "admins", label: "ממנהלים" },
];

export function DealFilters({
  filter,
  beers,
  stores,
}: {
  filter: AdminDealFilter;
  beers: Beer[];
  stores: Store[];
}) {
  const current: Record<string, string | undefined> = {
    status: filter.status,
    source: filter.source,
    store: filter.store,
    beer: filter.beer,
    q: filter.q,
  };
  const defaults = { status: "pending", source: "all" };
  const link = (patch: Record<string, string | undefined>) =>
    withParams("/admin/queue", current, patch, defaults);

  const chosen = [
    filter.store && { label: stores.find((s) => s.slug === filter.store)?.name_he ?? filter.store, patch: { store: undefined } },
    filter.beer && { label: beers.find((b) => b.slug === filter.beer)?.name_he ?? filter.beer, patch: { beer: undefined } },
    filter.q?.trim() && { label: `״${filter.q.trim()}״`, patch: { q: undefined } },
  ].filter(Boolean) as Array<{ label: string; patch: Record<string, string | undefined> }>;

  return (
    <div className="space-y-3">
      <Segmented
        label="סטטוס"
        items={STATUS_LABEL.map((item) => ({
          href: link({ status: item.value }),
          label: item.label,
          selected: filter.status === item.value,
        }))}
      />

      <Segmented
        label="מקור"
        items={SOURCE_LABEL.map((item) => ({
          href: link({ source: item.value }),
          label: item.label,
          selected: filter.source === item.value,
        }))}
      />

      {/* A GET form, so the chosen values end up in the URL exactly as the links do. */}
      <form action="/admin/queue" method="get" className="space-y-3 rounded-2xl border border-ground-line p-3">
        <input type="hidden" name="status" value={filter.status} />
        <input type="hidden" name="source" value={filter.source} />

        <div className="flex gap-3">
          <div className="flex-1">
            {/* "הצגה לפי…", not "חנות": the add-a-deal form on the same page has a
                "חנות" field of its own, and two controls with one name is a real
                ambiguity for a screen reader, not only for a test. */}
            <label htmlFor="filter-store" className="mb-1 block text-sm font-semibold text-on-ground">
              הצגה לפי חנות
            </label>
            <select id="filter-store" name="store" defaultValue={filter.store ?? ""} className="field">
              <option value="">כל החנויות</option>
              {stores.map((store) => (
                <option key={store.slug} value={store.slug}>
                  {store.name_he}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor="filter-beer" className="mb-1 block text-sm font-semibold text-on-ground">
              הצגה לפי בירה
            </label>
            <select id="filter-beer" name="beer" defaultValue={filter.beer ?? ""} className="field">
              <option value="">כל הבירות</option>
              {beers.map((beer) => (
                <option key={beer.slug} value={beer.slug}>
                  {beer.name_he}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="filter-q" className="mb-1 block text-sm font-semibold text-on-ground">
            חיפוש בהערה
          </label>
          <input
            id="filter-q"
            name="q"
            type="search"
            defaultValue={filter.q ?? ""}
            placeholder="למשל: מועדון"
            className="field"
          />
        </div>

        <button type="submit" className="btn btn-ghost w-full">
          סינון
        </button>
      </form>

      {chosen.length > 0 && (
        <ul className="flex flex-wrap items-center gap-2">
          {chosen.map((item) => (
            <li key={item.label}>
              {/* Each chosen filter carries its own way out. A "clear all" alone makes
                  somebody start over to drop one of three. */}
              <Link
                href={link(item.patch)}
                replace
                scroll={false}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-ground-line px-3.5 text-sm font-semibold text-on-ground"
              >
                {item.label}
                <span aria-hidden>×</span>
                <span className="sr-only">ביטול הסינון</span>
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/admin/queue"
              replace
              scroll={false}
              className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-on-ground-2 underline underline-offset-4"
            >
              ניקוי הכול
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}
