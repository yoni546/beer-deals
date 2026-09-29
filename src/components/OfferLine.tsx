import Link from "next/link";
import { ChevronDownIcon } from "@/components/ui/icons";
import { Price, Saving, UnitPrice } from "@/components/ui/Price";
import { ReportDealButton } from "@/components/ReportDealButton";
import type { Offer } from "@/lib/db/types";
import { conditionChips, packText, relativeTimeHe, validUntilHe } from "@/lib/format";
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
 * The saving chip only ever shows the database's VERIFIED value (offers_feed.value_pct).
 * Without one there is no strikethrough and no "you save" — just the price, and a market
 * comparison when there is one. The details fold out below (native <details>, no script).
 */
export function OfferLine({
  offer,
  lead,
  showStore = lead !== "chain",
  now = Date.now(),
}: {
  offer: Offer;
  lead: LineLead;
  /** Name the chain on the second row. Off where the page or heading already says which chain. */
  showStore?: boolean;
  now?: number;
}) {
  const pack = packText(offer);
  const until = validUntilHe(offer.valid_to, now);
  const chips = conditionChips(offer);
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

  const hasMeta = showStore || Boolean(until) || chips.length > 0 || offer.needs_review;

  const hasReference = offer.value_pct !== null && offer.reference_agorot !== null;
  const summaryParts: React.ReactNode[] = [];
  if (hasReference) summaryParts.push(<span key="r">במקום <s className="num">{formatPrice(offer.reference_agorot!)}</s></span>);
  else if (offer.market_value_pct !== null) summaryParts.push(<span key="m">זול ב־<span className="num">{offer.market_value_pct}%</span> מהממוצע ברשתות</span>);
  if (offer.unit_price_per_liter_agorot !== null) summaryParts.push(<UnitPrice key="l" agorotPerLiter={offer.unit_price_per_liter_agorot} />);

  return (
    <article className="px-4">
      <Link href={primaryHref} className="flex min-h-11 items-baseline gap-2 pt-3 pb-1 text-base leading-snug font-semibold text-ink">
        <span className="min-w-0">{title}</span>
        <span aria-hidden className="leader-fill" />
        <Price agorot={offer.effective_agorot} size="md" className="shrink-0 text-price" />
      </Link>

      {hasMeta && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-ink-2">
          {showStore && (
            <Link href={storeHref} className="inline-flex min-h-11 min-w-11 items-center justify-center font-medium underline-offset-4 hover:underline">
              {offer.store_name}
            </Link>
          )}
          {showStore && until && (
            <span aria-hidden className="text-paper-line">
              ·
            </span>
          )}
          {until && <span>{until}</span>}
          {chips.map((chip) => (
            <span key={chip.label} className="rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink">
              {chip.label}
            </span>
          ))}
          {offer.needs_review && (
            <span className="hatch rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink">
              אחוז ההנחה בבדיקה
            </span>
          )}
        </div>
      )}

      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-ink-2 marker:hidden [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
            {summaryParts.length === 0 && <span>פרטים</span>}
            {summaryParts.map((node, i) => (
              <span key={i} className="inline-flex items-center gap-2">
                {i > 0 && <span aria-hidden className="text-paper-line">·</span>}
                {node}
              </span>
            ))}
          </span>
          {offer.value_pct !== null && (
            <Saving pct={offer.value_pct} className="shrink-0 rounded-md bg-deal px-2 py-1 text-sm font-bold text-on-deal" />
          )}
          <span aria-hidden className="shrink-0 text-ink-2 transition-transform group-open:rotate-180">
            <ChevronDownIcon size={18} />
          </span>
          <span className="sr-only">פרטים נוספים</span>
        </summary>

        <dl className="mb-3 space-y-1.5 border-t border-dashed border-paper-line pt-3 text-sm">
          <Row label="חנות">{offer.store_name}</Row>
          <Row label="אריזה">{pack}</Row>
          {offer.reference_agorot !== null && offer.value_pct !== null && (
            <Row label="מחיר רגיל">
              <span className="num">{formatPrice(offer.reference_agorot)}</span>{" "}
              <span className="text-ink-2">({offer.reference_trust === "feed" ? "מפרסום הרשת" : "אושר על ידי מנהל"})</span>
            </Row>
          )}
          {offer.market_reference_agorot !== null && (
            <Row label="ממוצע ברשתות אחרות">
              <span className="num">{formatPrice(offer.market_reference_agorot)}</span>
            </Row>
          )}
          {offer.observed_at && <Row label="נראה לאחרונה">{relativeTimeHe(offer.observed_at, now)}</Row>}
          {offer.notes && <Row label="הערה">{offer.notes}</Row>}
          {offer.origin === "legacy" && (
            <div className="pt-1">
              <ReportDealButton dealId={offer.offer_key.replace(/^deal:/, "")} />
            </div>
          )}
        </dl>
      </details>
    </article>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-ink-2">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}
