import Link from "next/link";
import { BeerMark } from "@/components/ui/Bottle";
import { Saving } from "@/components/ui/Price";
import type { Beer } from "@/lib/db/types";
import type { BeerSummary } from "@/lib/offer-logic";

/**
 * The person's four beers as four keys in a row, in their own order. Rank #1 is lit —
 * it sets the theme and is the only beer that may send a notification. A key with
 * no offer right now is dimmed and says so; it is never left out, so the row always
 * reads as the same four beers.
 */
export function FavouriteKeys({
  beers,
  summaries,
}: {
  beers: Beer[];
  summaries: Record<string, BeerSummary>;
}) {
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="ארבע הבירות שלי, לפי הסדר">
      {beers.map((beer, index) => {
        const summary = summaries[beer.id] ?? { count: 0, bestValuePct: null };
        const has = summary.count > 0;
        const lead = index === 0;
        return (
          <li key={beer.id}>
            <Link
              href={`/beer/${beer.slug}`}
              className="tape tape-flat flex h-[6.5rem] flex-col justify-between rounded-xl p-2.5"
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">
                <span
                  aria-hidden
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                    lead ? "bg-deal text-on-deal" : "border border-paper-line text-ink"
                  }`}
                >
                  {index + 1}
                </span>
                <span className="sr-only">מקום {index + 1}: </span>
                {lead && <span>ראשית</span>}
                <BeerMark slug={beer.slug} height={30} className="ms-auto -mt-1" />
              </span>
              {/* A long single-word name ("גולדסטאר") cannot wrap; it gets a slightly smaller size instead of being clipped. */}
              <span
                className={`line-clamp-2 leading-tight font-bold text-ink ${
                  Math.max(...beer.name_he.split(/\s+/).map((w) => w.length)) > 7 ? "text-[0.8rem]" : "text-[0.95rem]"
                }`}
              >
                {beer.name_he}
              </span>
              <span className={`text-xs ${has ? "font-semibold text-price" : "text-ink-2"}`}>
                {has ? (
                  summary.bestValuePct !== null ? (
                    <>עד <Saving pct={summary.bestValuePct} /></>
                  ) : (
                    <>{summary.count} {summary.count === 1 ? "מבצע" : "מבצעים"}</>
                  )
                ) : (
                  "אין מבצע"
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
