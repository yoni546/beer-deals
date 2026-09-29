import Link from "next/link";
import { Price, UnitPrice } from "@/components/ui/Price";
import { Tape } from "@/components/ui/Tape";
import type { RegularPrice } from "@/lib/db/types";
import { packText, relativeTimeHe } from "@/lib/format";

/**
 * A regular (non-promotional) price as one line of the tape. It looks like an offer line
 * with the volume turned down: the figure is in ink, not the price colour, because the
 * price colour means "cheaper than usual" and a regular price never is.
 *
 * Anything old or unconfirmed is labelled in words and hatched, so a shelf price that
 * may have changed is never mistaken for one seen this morning.
 */
export function RegularLine({
  price,
  lead,
  now = Date.now(),
}: {
  price: RegularPrice;
  /** chain: on a beer page under its pack heading. pack: on a chain page under a beer heading. */
  lead: "chain" | "pack";
  now?: number;
}) {
  const href = lead === "chain" ? `/store/${price.store_slug}` : `/beer/${price.beer_slug}`;
  const title = lead === "chain" ? price.store_name : packText(price);
  const unconfirmed = price.trust === "unverified";

  return (
    <article className="px-4 pb-3">
      <Link href={href} className="flex min-h-11 items-baseline gap-2 pt-3 pb-1 text-base leading-snug font-semibold text-ink">
        <span className="min-w-0">{title}</span>
        <span aria-hidden className="leader-fill" />
        <Price agorot={price.price_agorot} size="md" className="shrink-0 text-ink" />
      </Link>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-ink-2">
        <UnitPrice agorotPerLiter={price.unit_price_per_liter_agorot} />
        <span aria-hidden className="text-paper-line">
          ·
        </span>
        <span>נראה {relativeTimeHe(price.observed_at, now)}</span>
        {price.is_stale && (
          <span className="hatch rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink">לא עודכן זמן רב</span>
        )}
        {unconfirmed && (
          <span className="hatch rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink">לא מאומת</span>
        )}
      </div>
    </article>
  );
}

export function RegularStrip({
  title,
  href,
  aside,
  prices,
  lead,
}: {
  title: string;
  href?: string;
  aside?: React.ReactNode;
  prices: RegularPrice[];
  lead: "chain" | "pack";
}) {
  return (
    <Tape className="pb-1">
      <div className="flex items-center justify-between gap-3 px-4 pt-2">
        <h2 className="min-w-0 truncate text-lg leading-tight font-bold text-ink">
          {href ? (
            <Link href={href} className="inline-flex min-h-11 min-w-11 items-center underline-offset-4 hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </h2>
        {aside && <span className="shrink-0 text-sm text-ink-2">{aside}</span>}
      </div>
      <div className="divide-y divide-dotted divide-paper-line">
        {prices.map((price) => (
          <RegularLine key={price.observation_id} price={price} lead={lead} />
        ))}
      </div>
    </Tape>
  );
}
