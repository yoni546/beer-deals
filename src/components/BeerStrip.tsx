import Link from "next/link";
import { OfferLine, type LineLead } from "@/components/OfferLine";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { Tape } from "@/components/ui/Tape";
import type { Offer } from "@/lib/db/types";

/**
 * A strip of paper for one heading (a beer, a pack, a chain) and its lines, ruled
 * with dotted lines between them. `limit` keeps a busy beer from taking over Home:
 * the rest is one tap away, and the count says how many.
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
  headingLevel?: "h2" | "h3";
}) {
  const shown = limit ? offers.slice(0, limit) : offers;
  const hidden = offers.length - shown.length;
  const Heading = headingLevel;

  return (
    <Tape printIn={printIn} className="pb-1">
      <div className="flex items-center justify-between gap-3 px-4 pt-2">
        <Heading className="min-w-0 truncate text-lg leading-tight font-bold text-ink">
          {href ? (
            <Link href={href} className="inline-flex min-h-11 min-w-11 items-center underline-offset-4 hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </Heading>
        {aside && <span className="shrink-0 text-sm text-ink-2">{aside}</span>}
      </div>

      <div className="divide-y divide-dotted divide-paper-line [&>*+*]:pt-0">
        {shown.map((offer) => (
          <OfferLine key={offer.offer_key} offer={offer} lead={lead} showStore={showStore} />
        ))}
      </div>

      {hidden > 0 && moreHref && (
        <Link href={moreHref} className="tear flex min-h-12 items-center justify-between px-4 text-sm font-semibold text-ink">
          עוד {hidden} {hidden === 1 ? "מבצע" : "מבצעים"} · {title}
          <ChevronLeftIcon size={18} />
        </Link>
      )}
    </Tape>
  );
}
