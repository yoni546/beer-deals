import Link from "next/link";
import { Price } from "@/components/ui/Price";
import { Tape } from "@/components/ui/Tape";
import type { GroupOffer } from "@/lib/db/types";
import { depositHe, validUntilHe, whereSeenHe } from "@/lib/format";
import { formatPrice } from "@/lib/money";

/**
 * A mix-and-match offer as the chain states it: "any 2 of these for ₪35". It is ONE offer across
 * several packs (migration 0014), so it is never shown as a price of any single pack — the per-pack
 * figure is secondary, labelled as what it is ("יוצא ₪17.50 לאריזה").
 */
export function GroupOfferLine({ offer, showStore = true, now = Date.now() }: { offer: GroupOffer; showStore?: boolean; now?: number }) {
  const until = validUntilHe(offer.valid_to, now);
  const deposit = depositHe(offer.deposit_agorot, offer.deposit_included);
  const where = whereSeenHe(offer);
  const beers = [...new Set(offer.packs.map((p) => p.beer_name))];

  return (
    <article className="px-4 pb-3">
      <Link href={`/store/${offer.store_slug}`} className="flex min-h-11 items-baseline gap-2 pt-3 pb-1 text-base leading-snug font-semibold text-ink">
        <span className="min-w-0">{showStore ? offer.store_name : beers.join(" / ")}</span>
        <span aria-hidden className="leader-fill" />
        <span className="shrink-0 text-sm font-semibold text-ink-2">
          <span className="num">{offer.required_qty}</span> ב־
        </span>
        <Price agorot={offer.total_agorot} size="md" className="shrink-0 text-price" />
      </Link>
      <p className="text-sm text-ink-2">
        לבחירה:{" "}
        {offer.packs.map((pack, i) => (
          <span key={pack.sku_id}>
            {i > 0 && " · "}
            <Link href={`/beer/${pack.beer_slug}`} className="text-ink underline-offset-4 hover:underline">
              {pack.label}
            </Link>
          </span>
        ))}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
        <span>
          יוצא <span className="num">{formatPrice(offer.per_unit_agorot)}</span> לאריזה
        </span>
        {deposit && <span className="num">· {deposit}</span>}
        {until && <span>· {until}</span>}
        {where && <span>· {where}</span>}
      </div>
    </article>
  );
}

export function GroupStrip({
  title,
  offers,
  showStore = true,
  headingLevel = "h2",
}: {
  title: string;
  offers: GroupOffer[];
  showStore?: boolean;
  headingLevel?: "h2" | "h3";
}) {
  if (offers.length === 0) return null;
  const Heading = headingLevel;
  return (
    <Tape className="pb-1">
      <div className="flex items-center justify-between gap-3 px-4 pt-2">
        <Heading className="min-h-11 min-w-0 truncate pt-2 text-lg leading-tight font-bold text-ink">{title}</Heading>
        <span className="shrink-0 text-sm text-ink-2">
          {offers.length} {offers.length === 1 ? "מבצע" : "מבצעים"}
        </span>
      </div>
      <div className="divide-y divide-dotted divide-paper-line">
        {offers.map((offer) => (
          <GroupOfferLine key={offer.offer_key} offer={offer} showStore={showStore} />
        ))}
      </div>
    </Tape>
  );
}
