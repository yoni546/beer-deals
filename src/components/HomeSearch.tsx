"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CloseIcon, GlassIcon, SearchIcon, StoreIcon } from "@/components/ui/icons";
import { Tape } from "@/components/ui/Tape";
import { search } from "@/lib/search";

type Entry = { slug: string; label: string; alias?: string | null };

const MAX_BEERS = 5;
const MAX_STORES = 3;

/**
 * One search box on Home for both things people look for: a beer or a chain.
 *
 * It filters a list that is already on the page (a few dozen names), so there is no request
 * per keystroke. Matching is Hebrew-aware (src/lib/search.ts). Enter opens the best match, so
 * "גולד" + Enter is two taps to the Goldstar page. Results are plain links: the box never
 * traps anyone, and it works the same with a keyboard or a screen reader.
 *
 * The full lists, with the person's favourites first, are the "בירות" and "סופרים" tabs.
 */
export function HomeSearch({ beers, stores }: { beers: Entry[]; stores: Entry[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  const beerHits = useMemo(() => search(beers, query, (b) => [b.label, b.alias ?? ""]).slice(0, MAX_BEERS), [beers, query]);
  const storeHits = useMemo(() => search(stores, query, (s) => [s.label]).slice(0, MAX_STORES), [stores, query]);
  const first = beerHits[0] ? `/beer/${beerHits[0].slug}` : storeHits[0] ? `/store/${storeHits[0].slug}` : null;

  return (
    <div role="search">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (first) router.push(first);
        }}
        className="relative"
      >
        <SearchIcon size={20} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-ink-2" />
        <input
          type="search"
          inputMode="search"
          enterKeyHint="go"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="חיפוש בירה או סופר"
          aria-label="חיפוש בירה או סופר"
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
      </form>

      {searching && (
        <div className="mt-3" aria-live="polite">
          {beerHits.length + storeHits.length === 0 ? (
            <Tape className="px-5 py-5 text-center">
              <p className="text-base font-bold text-ink">לא מצאנו בירה או סופר בשם הזה</p>
              <p className="mt-1 text-sm text-ink-2">בדקו את האיות, או נסו רק חלק מהשם.</p>
              <button type="button" onClick={() => setQuery("")} className="btn btn-quiet mt-4">
                נקו את החיפוש
              </button>
            </Tape>
          ) : (
            <Tape as="div" className="pb-1">
              <ul className="divide-y divide-dotted divide-paper-line">
                {beerHits.map((beer) => (
                  <Result key={`b-${beer.slug}`} href={`/beer/${beer.slug}`} label={beer.label} alias={beer.alias} kind="בירה" />
                ))}
                {storeHits.map((store) => (
                  <Result key={`s-${store.slug}`} href={`/store/${store.slug}`} label={store.label} kind="סופר" />
                ))}
              </ul>
            </Tape>
          )}
        </div>
      )}
    </div>
  );
}

function Result({ href, label, alias, kind }: { href: string; label: string; alias?: string | null; kind: "בירה" | "סופר" }) {
  const Icon = kind === "בירה" ? GlassIcon : StoreIcon;
  return (
    <li>
      <Link href={href} prefetch={false} className="flex min-h-14 items-center gap-3 px-4 py-2 text-ink">
        <span aria-hidden className="shrink-0 text-ink-2">
          <Icon size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold">{label}</span>
          {alias && (
            <span className="block truncate text-xs text-ink-2">
              <bdi>{alias}</bdi>
            </span>
          )}
        </span>
        <span className="shrink-0 text-sm text-ink-2">{kind}</span>
      </Link>
    </li>
  );
}
