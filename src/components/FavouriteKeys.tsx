import Link from "next/link";
import { BeerBottle } from "@/components/ui/Bottle";
import type { Beer } from "@/lib/db/types";
import type { BeerSummary } from "@/lib/offer-logic";

/**
 * The person's four beers, in their own order: each one's own bottle, a small rank, its name — standing
 * on the counter, no cards. #1 is marked (it sets the look and is the only beer that may notify). A beer
 * with a deal on a pack or case right now says how many, in a few words; one without says nothing, and is
 * never left out, so the row always reads as the same four beers.
 */
export function FavouriteKeys({
  beers,
  summaries,
}: {
  beers: Beer[];
  summaries: Record<string, BeerSummary>;
}) {
  return (
    // Sized from how many beers there are, not fixed at four (0024): with one to three,
    // a four-column grid left the keys hanging against one edge.
    <ol
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(beers.length, 1), 4)}, minmax(0, 1fr))` }}
      aria-label="הבירות שלי, לפי הסדר"
    >
      {beers.map((beer, index) => {
        const count = summaries[beer.id]?.count ?? 0;
        return (
          <li key={beer.id} data-rank={index + 1}>
            <Link href={`/beer/${beer.slug}`} className="favourite-key flex flex-col items-center gap-1 rounded-xl px-1 pt-1 pb-1.5 text-center">
              <span className="relative flex h-[4.5rem] items-end justify-center">
                <BeerBottle slug={beer.slug} height={72} />
                <span
                  aria-hidden
                  className={`num absolute -top-1 -start-3 rounded-full px-1.5 text-[0.75rem] leading-5 font-bold ${
                    index === 0 ? "bg-deal text-on-deal" : "bg-ground text-on-ground-2 ring-1 ring-ground-line"
                  }`}
                >
                  #{index + 1}
                </span>
              </span>
              <span className="w-full truncate text-[0.8125rem] leading-tight font-semibold text-on-ground">
                <span className="sr-only">מקום {index + 1}: </span>
                {beer.name_he}
              </span>
              {count > 0 && (
                <span className="text-[0.75rem] leading-none text-on-ground-2">
                  {count} {count === 1 ? "מבצע" : "מבצעים"}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
