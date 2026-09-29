"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SearchIcon, CloseIcon } from "@/components/ui/icons";
import { Saving } from "@/components/ui/Price";
import { Tape } from "@/components/ui/Tape";
import { search } from "@/lib/search";

export type ListingItem = {
  slug: string;
  label: string;
  /** Also matched against, so typing "goldstar" finds גולדסטאר. */
  alias?: string | null;
  /** Offers on right now. */
  count: number;
  /** Best VERIFIED saving among them, if any. */
  bestValuePct: number | null;
  /** 1–4 for one of the person's ranked beers. */
  rank?: number | null;
};

/**
 * The searchable list behind "בירות" and "סופרים".
 *
 * Filtering runs in the browser over a list of a few dozen rows: a round trip per
 * keystroke would be slower, and would fail on a supermarket's wifi. Matching is Hebrew-aware
 * (niqqud, final letters, a missing or swapped letter — src/lib/search.ts).
 *
 * `basePath` is a string, never a function: functions cannot cross from a Server Component
 * to a Client Component, and doing so once took these very pages down with an HTTP 500.
 */
export function ListingSearch({
  items,
  basePath,
  placeholder,
  emptyLabel,
  mineLabel,
  allLabel,
}: {
  items: ListingItem[];
  basePath: string;
  placeholder: string;
  emptyLabel: string;
  mineLabel?: string;
  allLabel: string;
}) {
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  const matches = useMemo(() => search(items, query, (item) => [item.label, item.alias ?? ""]), [items, query]);
  const mine = items.filter((item) => item.rank).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  // Beers and chains with something on offer come first; the rest keep their incoming order.
  const rest = items.filter((item) => !item.rank).sort((a, b) => Number(b.count > 0) - Number(a.count > 0));

  return (
    <div>
      <div role="search" className="relative mb-5">
        <SearchIcon size={20} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-ink-2" />
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="field ps-12 pe-12"
        />
        {searching && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="נקו את החיפוש"
            className="absolute end-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-ink-2"
          >
            <CloseIcon size={18} />
          </button>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {searching ? `${matches.length} תוצאות` : ""}
      </p>

      {searching ? (
        matches.length === 0 ? (
          <Tape className="px-5 py-8 text-center">
            <p className="text-base font-bold text-ink">{emptyLabel}</p>
            <p className="mt-2 text-sm text-ink-2">בדקו את האיות, או נסו רק חלק מהשם.</p>
          </Tape>
        ) : (
          <Rows items={matches} basePath={basePath} />
        )
      ) : (
        <div className="space-y-7">
          {mine.length > 0 && mineLabel && <Rows items={mine} basePath={basePath} heading={mineLabel} />}
          <Rows items={mine.length > 0 && mineLabel ? rest : items} basePath={basePath} heading={mine.length > 0 && mineLabel ? allLabel : undefined} />
        </div>
      )}
    </div>
  );
}

function Rows({ items, basePath, heading }: { items: ListingItem[]; basePath: string; heading?: string }) {
  return (
    <Tape as="div" className="pb-1">
      {heading && <h2 className="px-4 pt-4 pb-1 text-sm font-semibold text-ink-2">{heading}</h2>}
      <ul className="divide-y divide-dotted divide-paper-line">
        {items.map((item) => (
          <li key={item.slug}>
            <Link href={`${basePath}/${item.slug}`} className="flex min-h-14 items-center gap-3 px-4 py-2">
              {item.rank ? (
                <span
                  aria-hidden
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    item.rank === 1 ? "bg-deal text-on-deal" : "border border-paper-line text-ink"
                  }`}
                >
                  {item.rank}
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold text-ink">
                  {item.rank ? <span className="sr-only">מקום {item.rank}: </span> : null}
                  {item.label}
                </span>
                {item.alias && (
                  <span className="block truncate text-xs text-ink-2">
                    <bdi>{item.alias}</bdi>
                  </span>
                )}
              </span>
              {item.count > 0 ? (
                <span className="flex shrink-0 items-center gap-2 text-sm text-ink-2">
                  {item.bestValuePct !== null && <Saving pct={item.bestValuePct} className="rounded-md bg-deal px-2 py-1 text-sm font-bold text-on-deal" />}
                  <span>
                    {item.count} {item.count === 1 ? "מבצע" : "מבצעים"}
                  </span>
                </span>
              ) : item.rank ? (
                <span className="shrink-0 text-sm text-ink-2">אין מבצע</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </Tape>
  );
}
