import { OfferLine } from "@/components/OfferLine";
import { Tape } from "@/components/ui/Tape";
import { formatPrice } from "@/lib/money";
import type { WatchHit } from "@/lib/offer-logic";

/**
 * "The price you were waiting for" (migration 0037).
 *
 * The one thing on Home that somebody explicitly asked to be told. It sits above
 * everything the app chose for them, because they chose this — and it says which
 * price was reached, so the claim is checkable rather than a feeling.
 *
 * Absent entirely when nothing reached its price. An empty frame saying "no beer you
 * follow is cheap today" is a daily reminder of nothing happening, on the screen a
 * person opens to find beer.
 */
export function WatchHits({ hits }: { hits: WatchHit[] }) {
  if (hits.length === 0) return null;

  return (
    <section aria-labelledby="watch-hits" className="mb-6">
      <h2 id="watch-hits" className="mb-2 text-sm font-semibold text-on-ground-2">
        {hits.length === 1 ? "המחיר שחיכיתם לו" : "המחירים שחיכיתם להם"}
      </h2>
      <Tape as="div" className="divide-y divide-dotted divide-paper-line">
        {hits.map(({ offer, reachedPrice }) => (
          <div key={offer.offer_key}>
            {reachedPrice !== null && (
              <p className="px-4 pt-3 text-sm font-semibold text-ink">
                ביקשתם מתחת ל<span className="num">{formatPrice(reachedPrice)}</span>
              </p>
            )}
            <OfferLine offer={offer} lead="beer" />
          </div>
        ))}
      </Tape>
    </section>
  );
}
