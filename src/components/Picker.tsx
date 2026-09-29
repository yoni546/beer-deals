"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type PickerItem = {
  slug: string;
  label: string;
  /** Also matched against, so typing "goldstar" finds גולדסטאר. */
  alias?: string;
  accent?: string;
  surface?: string;
  ink?: string;
};

/**
 * Search-and-pick, used for both beers and stores.
 *
 * Filtering happens in the browser over a list of a few dozen rows: a round
 * trip per keystroke would be slower and would fail on a supermarket's wifi,
 * and the whole list is small enough to have been sent already.
 */
export function Picker({
  items,
  basePath,
  placeholder,
  emptyLabel,
}: {
  items: PickerItem[];
  /**
   * Where each item links: `${basePath}/${slug}`. A string, not a function —
   * this is a Client Component, and functions cannot be passed to one from a
   * Server Component. Passing one made /beer and /store return HTTP 500.
   */
  basePath: string;
  placeholder: string;
  emptyLabel: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) ||
        (item.alias ?? "").toLowerCase().includes(needle),
    );
  }, [items, query]);

  return (
    <div>
      <input
        type="search"
        inputMode="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="mb-4 w-full rounded-2xl bg-[color:var(--surface)] px-4 py-3.5 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-[color:var(--accent)]"
      />

      {filtered.length === 0 ? (
        <p className="rounded-2xl bg-[color:var(--surface)]/60 px-4 py-8 text-center text-sm opacity-55">
          {emptyLabel}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {filtered.map((item) => (
            <li key={item.slug}>
              <Link
                href={`${basePath}/${item.slug}`}
                className="flex min-h-16 items-center justify-center rounded-2xl px-3 py-4 text-center text-sm font-bold ring-1 ring-white/10"
                style={
                  item.surface
                    ? { background: item.surface, color: item.ink }
                    : undefined
                }
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
