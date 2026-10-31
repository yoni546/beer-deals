import Link from "next/link";
import { OfferLine, type LineLead } from "@/components/OfferLine";
import { BeerBottle } from "@/components/ui/Bottle";
import { ChevronDownIcon, ChevronLeftIcon } from "@/components/ui/icons";
import { Tape } from "@/components/ui/Tape";
import type { Offer } from "@/lib/db/types";
import type { NearbyBranch } from "@/lib/distance";

/**
 * A strip of paper for one heading (a beer, a pack, a chain) and its lines, ruled
 * with dotted lines between them. `limit` keeps a busy beer from taking over Home:
 * the rest is one tap away, and the count says how many. Without `moreHref` the
 * rest opens right here (native <details>): a strip that is not about one beer or
 * one chain has no page of its own to send you to.
 */
export function Strip({
  title,
  href,
  aside,
  offers,
  lead,
  showStore,
  limit,
  moreHref,
  printIn = false,
  headingLevel = "h2",
  beerSlug,
  perLiter = false,
  distances,
  branches,
}: {
  title: string;
  href?: string;
  aside?: React.ReactNode;
  offers: Offer[];
  lead: LineLead;
  showStore?: boolean;
  limit?: number;
  moreHref?: string;
  printIn?: boolean;
  headingLevel?: "h2" | "h3" | "h4";
  /** When the strip is about one beer: its bottle beside the heading. */
  beerSlug?: string;
  /** The list is ordered per litre: each line shows that number. */
  perLiter?: boolean;
  /** How far each offer is, by offer_key. Only the ones we could place are in it. */
  distances?: Record<string, number>;
  /** Which branch that distance is to, by offer_key — named on the line, with a tap to Waze. */
  branches?: Record<string, NearbyBranch>;
}) {
  const shown = limit ? offers.slice(0, limit) : offers;
  const hidden = offers.length - shown.length;
  const line = (offer: Offer) => (
    <OfferLine
      key={offer.offer_key}
      offer={offer}
      lead={lead}
      showStore={showStore}
      perLiter={perLiter}
      distanceKm={distances?.[offer.offer_key]}
      nearestBranch={branches?.[offer.offer_key]}
    />
  );
  const count = `${hidden} ${hidden === 1 ? "מבצע" : "מבצעים"}`;
  const Heading = headingLevel;

  return (
    <Tape printIn={printIn} className="pb-1">
      <div className="flex items-center justify-between gap-3 px-4 pt-2">
        {beerSlug && <BeerBottle slug={beerSlug} height={30} className="shrink-0 self-center" />}
        <Heading className="min-w-0 flex-1 truncate text-lg leading-tight font-bold text-ink">
          {href ? (
            <Link href={href} prefetch={false} className="inline-flex min-h-11 min-w-11 items-center underline-offset-4 hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </Heading>
        {aside && <span className="shrink-0 text-sm text-ink-2">{aside}</span>}
      </div>

      <div className="divide-y divide-paper-line">{shown.map(line)}</div>

      {hidden > 0 &&
        (moreHref ? (
          <Link href={moreHref} prefetch={false} className="tear flex min-h-12 items-center justify-between px-4 text-sm font-semibold text-ink">
            עוד {count} · {title}
            <ChevronLeftIcon size={18} />
          </Link>
        ) : (
          <details className="group/more" data-strip-more>
            <summary className="tear flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-ink group-open/more:hidden [&::-webkit-details-marker]:hidden">
              הציגו עוד {count}
              <ChevronDownIcon size={18} />
            </summary>
            <div className="divide-y divide-paper-line border-t border-paper-line">{offers.slice(shown.length).map(line)}</div>
          </details>
        ))}
    </Tape>
  );
}
