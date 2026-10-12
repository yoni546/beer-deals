import Link from "next/link";
import { ChevronDownIcon } from "@/components/ui/icons";
import { DealScoreChip } from "@/components/ui/DealScore";
import { Price, Saving, UnitPrice } from "@/components/ui/Price";
import { OfferFeedback } from "@/components/OfferFeedback";
import { NearestBranch } from "@/components/NearestBranch";
import { ScopeLine } from "@/components/ScopeLine";
import type { Offer } from "@/lib/db/types";
import type { NearbyBranch } from "@/lib/distance";
import { conditionChips, depositHe, kmHe, packText, scopeHe, validUntilHe, whereSeenHe } from "@/lib/format";
import { formatPrice } from "@/lib/money";

export type LineLead = "chain" | "beer" | "pack";

/**
 * How a standing is worded on the line (0031).
 *
 * Carefully hedged, because the app does not know: people REPORT that a deal has
 * ended, and the chain's own feed may still be listing it. A disagreement is shown
 * as a disagreement rather than resolved by a rule, and 'still_there' is worth
 * saying out loud -- it is the only thing on the line that somebody actually went
 * and checked.
 */
function standingHe(standing: Offer["standing"]): { text: string; hatched: boolean } | null {
  if (standing === "ended") return { text: "משתמשים מדווחים שהמבצע נגמר", hatched: true };
  if (standing === "unclear") return { text: "יש דיווחים סותרים", hatched: true };
  if (standing === "still_there") return { text: "משתמשים אישרו שהמבצע קיים", hatched: false };
  return null;
}

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
  distanceKm,
  nearestBranch,
  now = Date.now(),
}: {
  offer: Offer;
  lead: LineLead;
  /** Name the chain on the second row. Off where the page or heading already says which chain. */
  showStore?: boolean;
  /** The list is ordered per litre: show that number on the line. */
  perLiter?: boolean;
  /** How far the nearest branch of this chain is. Omitted when we cannot place it. */
  distanceKm?: number;
  /** The branch that distance is to — named, with its address, and a tap to Waze. */
  nearestBranch?: NearbyBranch;
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
      <Link key="s" href={storeHref} prefetch={false} className="inline-flex min-h-11 min-w-11 items-center justify-center font-medium text-ink underline-offset-4 hover:underline">
        {offer.store_name}
      </Link>,
    );
  // How far, when the page is measuring. Never a guess: the caller only passes one for
  // an offer we could actually place (src/lib/distance.ts).
  if (distanceKm !== undefined) {
    facts.push(
      <span key="km" className="font-medium text-ink">
        <span className="num">{kmHe(distanceKm)}</span> ממך
      </span>,
    );
    // And WHICH shop that is. A distance on its own left the person to work out the
    // branch and type it into Waze themselves, which is most of the work.
    if (nearestBranch) facts.push(<NearestBranch key="branch" place={nearestBranch} storeName={offer.store_name} />);
  }
  // Somebody went and looked. Only shown for a person who chose to be named (0030):
  // the rest say nothing, which is not the same as saying "anonymous".
  if (offer.found_by) facts.push(<span key="by">דווח על ידי {offer.found_by}</span>);
  if (until) facts.push(<span key="u">{until}</span>);
  if (deposit) facts.push(<span key="d" className="num">{deposit}</span>);
  if (perLiter && offer.unit_price_per_liter_agorot !== null) facts.push(<UnitPrice key="l" agorotPerLiter={offer.unit_price_per_liter_agorot} />);
  // Where it runs (0017): never implies the whole chain without evidence. Without scope data (a user-submitted
  // deal), the branch it was seen at, as before.
  const standing = standingHe(offer.standing);
  const scope = scopeHe(offer);
  if (scope) facts.push(<ScopeLine key="w" text={scope} promotionId={offer.promotion_id} />);
  else if (where && !showStore) facts.push(<span key="w">{where}</span>);

  return (
    <article className="px-4 pt-2 pb-3.5">
      {/* A busy chain page renders ~170 of these, i.e. ~340 anchors. */}
      <Link href={primaryHref} prefetch={false} className="flex min-h-11 items-baseline gap-2 pt-2 text-base leading-snug font-semibold text-ink">
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
        {/* How good the deal is, as against how much is off (the badge on the line above).
            Absent when there is no trusted reference to score it against. */}
        <DealScoreChip score={offer.deal_score} />
        {chips.map((chip) => (
          <span key={chip.label} className="rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink">
            {chip.label}
          </span>
        ))}
        {offer.needs_review && (
          <span className="hatch rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink">אחוז ההנחה בבדיקה</span>
        )}
        {/* What the people who were in the shop say (0031). The offer stays on the
            screen either way -- this is a label, not a removal -- and it is hatched as
            well as worded, because unverified data is never marked by colour alone. */}
        {standing && (
          <span className={`${standing.hatched ? "hatch " : ""}rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink`}>
            {standing.text}
          </span>
        )}
      </div>

      {/* Every offer, not only the user-submitted ones. Until 0031 the chain feed --
          the bulk of what anybody sees -- had no report path at all. */}
      <details className="group" data-feedback>
        <summary className="-ms-1 inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center gap-1 ps-1 text-xs font-semibold text-ink-2 [&::-webkit-details-marker]:hidden">
          הייתם שם?
          <span aria-hidden className="transition-transform group-open:rotate-180">
            <ChevronDownIcon size={14} />
          </span>
        </summary>
        <div className="pb-2">
          <OfferFeedback offerKey={offer.offer_key} seenPriceAgorot={offer.effective_agorot} />
        </div>
      </details>
    </article>
  );
}

