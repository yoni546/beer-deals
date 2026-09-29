import Link from "next/link";
import { CATEGORY_LABEL_ONE } from "@/lib/categories";
import { formatPrice } from "@/lib/money";
import type { PublicDeal } from "@/lib/db/types";
import { ReportDealButton } from "@/components/ReportDealButton";

/**
 * The deal card.
 *
 * The visual hierarchy is the product. Someone standing in an aisle needs the
 * price first, then which shop, then how good a deal it is. So the price is the
 * only large type on the card; the store and the regular price are deliberately
 * quiet, and the discount badge sits to the side where it is scannable down a
 * column without competing with the number that matters.
 *
 * The beer and the store are links to their own pages, so a card is never a
 * dead end: from any deal you can see everything else for that beer or at that
 * shop. (Only the names link, not the whole card, because the card also holds
 * the "deal has ended" button and a link may not contain a button.)
 *
 * The discount is read from the database's generated column — it is never
 * computed here and never entered by anyone.
 */
export function DealCard({
  deal,
  showBeerName = true,
  showStoreName = true,
  highlight = false,
}: {
  deal: PublicDeal;
  showBeerName?: boolean;
  showStoreName?: boolean;
  highlight?: boolean;
}) {
  // Vertical padding cancelled by negative margin: a tap area of at least 44px
  // without changing how the card looks.
  const nameLink = "-my-3 inline-block py-3 underline-offset-4 hover:underline focus-visible:underline";

  return (
    <article
      className={[
        "relative flex items-stretch gap-3 rounded-2xl p-4",
        "bg-[color:var(--surface)]",
        highlight
          ? "ring-2 ring-[color:var(--accent)]"
          : "ring-1 ring-white/10",
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        {showBeerName && (
          <p className="truncate text-sm font-medium opacity-70">
            <Link href={`/beer/${deal.beer_slug}?c=${deal.category}`} className={nameLink}>
              {deal.beer_name}
            </Link>
          </p>
        )}

        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
          <span className="text-base opacity-70">{CATEGORY_LABEL_ONE[deal.category]}</span>
          <span className="num text-3xl font-black tracking-tight text-[color:var(--accent)]">
            {formatPrice(deal.deal_price_agorot)}
          </span>
        </p>

        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs opacity-60">
          {showStoreName && (
            <Link
              href={`/store/${deal.store_slug}?c=${deal.category}`}
              className={`${nameLink} font-medium`}
            >
              {deal.store_name}
            </Link>
          )}
          {showStoreName && <span aria-hidden>·</span>}
          <span>
            מחיר רגיל{" "}
            <span className="num line-through">{formatPrice(deal.regular_price_agorot)}</span>
          </span>
        </p>

        {deal.notes && <p className="mt-1.5 text-xs opacity-60">{deal.notes}</p>}

        <ReportDealButton dealId={deal.id} />
      </div>

      <div className="flex shrink-0 flex-col items-center justify-center">
        <div
          className="rounded-xl bg-[color:var(--accent)] px-2.5 py-2 text-center leading-none text-[color:var(--base)]"
          /* The minus sits after the number in the source but before it on
             screen, because the line is isolated LTR — "25%-" as the spec
             writes it. */
        >
          <span className="num text-xl font-black">{deal.discount_percent}%-</span>
          <span className="mt-0.5 block text-[10px] font-bold opacity-80">הנחה</span>
        </div>
      </div>
    </article>
  );
}

/** Shown wherever a beer the user picked simply has no live deal. */
export function NoDealCard({ beerName }: { beerName: string }) {
  return (
    <article className="flex items-center justify-between rounded-2xl bg-[color:var(--surface)]/60 p-4 ring-1 ring-white/5">
      <p className="text-sm font-medium opacity-70">{beerName}</p>
      <p className="text-sm opacity-45">אין כרגע מבצע מאושר</p>
    </article>
  );
}
