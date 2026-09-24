import Link from "next/link";
import { CATEGORY_EMOJI, CATEGORY_LABEL, DEAL_CATEGORIES, type DealCategory } from "@/lib/categories";

/**
 * Six-packs / cases / singles.
 *
 * Links rather than client-side state, so the chosen category is in the URL:
 * it survives a refresh, it can be shared, and the back button does what the
 * user expects. There is deliberately no "all" tab — a list mixing the three
 * would be sorted by a price that means three different things.
 */
export function CategoryTabs({
  basePath,
  active,
  extraParams,
}: {
  basePath: string;
  active: DealCategory;
  extraParams?: Record<string, string>;
}) {
  return (
    <nav className="mb-4 flex gap-1.5 rounded-2xl bg-[color:var(--surface)] p-1.5 ring-1 ring-white/10">
      {DEAL_CATEGORIES.map((category) => {
        const params = new URLSearchParams({ ...extraParams, c: category });
        const selected = category === active;
        return (
          <Link
            key={category}
            href={`${basePath}?${params}`}
            aria-current={selected ? "page" : undefined}
            className={[
              "flex-1 rounded-xl px-2 py-2.5 text-center text-sm font-bold transition",
              selected
                ? "bg-[color:var(--accent)] text-[color:var(--base)]"
                : "opacity-60 hover:opacity-90",
            ].join(" ")}
          >
            <span aria-hidden className="ml-1">
              {CATEGORY_EMOJI[category]}
            </span>
            {CATEGORY_LABEL[category]}
          </Link>
        );
      })}
    </nav>
  );
}
