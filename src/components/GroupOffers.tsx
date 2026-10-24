import Link from "next/link";
import { ScopeLine } from "@/components/ScopeLine";
import { Price } from "@/components/ui/Price";
import { Tape } from "@/components/ui/Tape";
import type { GroupOffer } from "@/lib/db/types";
import { depositHe, packText, scopeHe, validUntilHe, whereSeenHe } from "@/lib/format";
import { formatPrice } from "@/lib/money";

/**
 * A mix-and-match offer as the chain states it: "any 2 of these for ₪35". It is ONE offer across
 * several packs (migration 0014), so it is never shown as a price of any single pack — the per-pack
 * figure is secondary, labelled as what it is ("יוצא ₪17.50 לאריזה"). Worded as what the shopper does
 * (0.9.0): "2 ב־₪35 · לבחירה מהמוצרים שבמבצע", not as a category name.
 */
export function GroupOfferLine({ offer, showStore = true, now = Date.now() }: { offer: GroupOffer; showStore?: boolean; now?: number }) {
  const until = validUntilHe(offer.valid_to, now);
  const deposit = depositHe(offer.deposit_agorot, offer.deposit_included);
  const where = whereSeenHe(offer);
  const scope = scopeHe(offer);
  const beers = [...new Set(offer.packs.map((p) => p.beer_name))];

  return (
    <article className="px-4 pt-1 pb-3.5">
      <Link href={`/store/${offer.store_slug}`} className="line">
        <span className="min-w-0">{showStore ? offer.store_name : beers.join(" / ")}</span>
        <span aria-hidden className="leader-fill" />
        <span className="shrink-0 text-sm font-semibold text-ink-2">
          <span className="num">{offer.required_qty}</span> ב־
        </span>
        <Price agorot={offer.total_agorot} size="md" className="shrink-0 text-price" />
      </Link>
      <p className="text-sm text-ink-2">
        <span className="font-semibold text-ink">לבחירה מהמוצרים שבמבצע:</span>{" "}
        {offer.packs.map((pack, i) => (
          <span key={pack.sku_id}>
            {i > 0 && " · "}
            <Link href={`/beer/${pack.beer_slug}`} className="text-ink underline-offset-4 hover:underline">
              {pack.beer_name} {packText({ ...pack, pack_label: pack.label })}
            </Link>
          </span>
        ))}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
        {[
          <span key="u">
            יוצא <span className="num">{formatPrice(offer.per_unit_agorot)}</span> לאריזה
          </span>,
          until ? <span key="t">{until}</span> : null,
          deposit ? <span key="d" className="num">{deposit}</span> : null,
          scope ? <ScopeLine key="w" text={scope} promotionId={offer.promotion_id} /> : where ? <span key="w">{where}</span> : null,
        ]
          .filter(Boolean)
          .map((node, i) => (
            <span key={i} className="fact">
              {i > 0 && (
                <span aria-hidden className="text-paper-line">
                  ·
                </span>
              )}
              {node}
            </span>
          ))}
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
  headingLevel?: "h2" | "h3" | "h4";
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
      <div className="divide-y divide-paper-line">
        {offers.map((offer) => (
          <GroupOfferLine key={offer.offer_key} offer={offer} showStore={showStore} />
        ))}
      </div>
    </Tape>
  );
}
