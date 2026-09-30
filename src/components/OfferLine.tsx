import Link from "next/link";
import { ChevronDownIcon } from "@/components/ui/icons";
import { Price, Saving, UnitPrice } from "@/components/ui/Price";
import { ReportDealButton } from "@/components/ReportDealButton";
import { ScopeLine } from "@/components/ScopeLine";
import type { Offer } from "@/lib/db/types";
import { conditionChips, depositHe, packText, scopeHe, validUntilHe, whereSeenHe } from "@/lib/format";
import { formatPrice } from "@/lib/money";

export type LineLead = "chain" | "beer" | "pack";

/**
 * One line of the tape: what it is, ········ what it costs.
 *
 * `lead` decides what the line is named after, because the surrounding heading has
 * already said the rest:
 *   chain  → on a beer's page, under the pack heading: "רמי לוי ········ ₪25" (the heading already names the pack)
 *   pack   → on a chain's page, under a beer heading: "6 × 330 · פחית ········ ₪25"
 *   beer   → on Home, where nothing has been said yet: "גולדסטאר · 6 × 330 ········ ₪25"
 *
 * Two levels, one unit per deal: the line (name ····· saving · price), then ONE quiet row of facts
 * (what it replaces, where, WHERE IT RUNS, until when, the deposit, the multi-buy terms). The only thing that
 * unfolds is the list of branches, when the deal runs at some of them (ScopeLine, 0.9.0).
 * The saving chip only ever shows the database's VERIFIED value (offers_feed.value_pct).
 * Without one there is no strikethrough and no "you save" — just the price, and a market
 * comparison when there is one.
 */
export function OfferLine({
  offer,
  lead,
  showStore = lead !== "chain",
  perLiter = false,
  now = Date.now(),
}: {
  offer: Offer;
  lead: LineLead;
  /** Name the chain on the second row. Off where the page or heading already says which chain. */
  showStore?: boolean;
  /** The list is ordered per litre: show that number on the line. */
  perLiter?: boolean;
  now?: number;
}) {
  const pack = packText(offer);
  const until = validUntilHe(offer.valid_to, now);
  const chips = conditionChips(offer);
  const where = whereSeenHe(offer);
  const beerHref = `/beer/${offer.beer_slug}`;
  const storeHref = `/store/${offer.store_slug}`;

  // The whole first row is one link (name ····· price) so it is a real touch target; where it
  // leads is the thing the line is *about*: a chain's page under a pack heading, else the beer.
  const primaryHref = lead === "chain" ? storeHref : beerHref;
  const title =
    lead === "chain" ? (
      offer.store_name
    ) : lead === "pack" ? (
      pack
    ) : (
      <>
        {offer.beer_name}
        <span className="font-normal text-ink-2"> · {pack}</span>
      </>
    );

  const hasReference = offer.value_pct !== null && offer.reference_agorot !== null;
  const deposit = depositHe(offer.deposit_agorot, offer.deposit_included);
  const Dot = () => (
    <span aria-hidden className="text-paper-line">
      ·
    </span>
  );
  // One quiet row of facts, in reading order: what it replaces, where, until when, what else is paid.
  const facts: React.ReactNode[] = [];
  if (hasReference) {
    const source = offer.reference_trust === "feed" ? "מפרסום הרשת" : "אושר על ידי מנהל";
    facts.push(
      <span key="r" title={`המחיר הרגיל, ${source}`}>
        במקום <s className="num">{formatPrice(offer.reference_agorot!)}</s>
        <span className="sr-only"> (המחיר הרגיל, {source})</span>
      </span>,
    );
  }
  else if (offer.market_value_pct !== null) facts.push(<span key="m">זול ב־<span className="num">{offer.market_value_pct}%</span> מהממוצע</span>);
  if (showStore)
    facts.push(
      <Link key="s" href={storeHref} className="inline-flex min-h-11 min-w-11 items-center justify-center font-medium text-ink underline-offset-4 hover:underline">
        {offer.store_name}
      </Link>,
    );
  if (until) facts.push(<span key="u">{until}</span>);
  if (deposit) facts.push(<span key="d" className="num">{deposit}</span>);
  if (perLiter && offer.unit_price_per_liter_agorot !== null) facts.push(<UnitPrice key="l" agorotPerLiter={offer.unit_price_per_liter_agorot} />);
  // Where it runs (0017): never implies the whole chain without evidence. Without scope data (a user-submitted
  // deal), the branch it was seen at, as before.
  const scope = scopeHe(offer);
  if (scope) facts.push(<ScopeLine key="w" text={scope} promotionId={offer.promotion_id} />);
  else if (where && !showStore) facts.push(<span key="w">{where}</span>);

  return (
    <article className="px-4 pt-2 pb-3.5">
      <Link href={primaryHref} className="flex min-h-11 items-baseline gap-2 pt-2 text-base leading-snug font-semibold text-ink">
        <span className="min-w-0">{title}</span>
        <span aria-hidden className="leader-fill" />
        {offer.value_pct !== null && (
          <Saving pct={offer.value_pct} className="shrink-0 self-center rounded-md bg-deal px-2 py-0.5 text-sm font-bold text-on-deal" />
        )}
        <Price agorot={offer.effective_agorot} size="md" className="shrink-0 text-price" />
      </Link>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
        {facts.map((node, i) => (
          <span key={i} className="inline-flex items-center gap-2">
            {i > 0 && <Dot />}
            {node}
          </span>
        ))}
        {chips.map((chip) => (
          <span key={chip.label} className="rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink">
            {chip.label}
          </span>
        ))}
        {offer.needs_review && (
          <span className="hatch rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink">אחוז ההנחה בבדיקה</span>
        )}
      </div>

      {offer.origin === "legacy" && (
        // A user-submitted deal (the old flow): the only line with anything more to do.
        <details className="group">
          <summary className="-ms-1 inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center gap-1 ps-1 text-xs font-semibold text-ink-2 [&::-webkit-details-marker]:hidden">
            דיווח על המבצע
            <span aria-hidden className="transition-transform group-open:rotate-180">
              <ChevronDownIcon size={14} />
            </span>
          </summary>
          <div className="pb-2">
            <ReportDealButton dealId={offer.offer_key.replace(/^deal:/, "")} />
          </div>
        </details>
      )}
    </article>
  );
}

