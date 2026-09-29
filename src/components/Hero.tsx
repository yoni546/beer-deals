import Link from "next/link";
import { Price, Saving, UnitPrice } from "@/components/ui/Price";
import { Tape } from "@/components/ui/Tape";
import type { Hero as HeroPick } from "@/lib/offer-logic";
import { conditionChips, packText, validUntilHe } from "@/lib/format";
import { formatPrice } from "@/lib/money";

const REASON: Record<HeroPick["reason"] | "editor", string> = {
  value: "הכי משתלם עכשיו",
  market: "זול משאר הרשתות",
  favourite: "הכי זול לליטר מהבירות שלי",
  editor: "מבצע השבוע",
};

/**
 * The receipt's TOTAL: the one deal worth knowing about. The whole block is a single
 * link to that beer (a stretched link — one target, nothing nested), the price is the
 * largest figure in the product, and the saving line only appears when it is verified.
 */
export function Hero({ pick, editorial = false, now = Date.now() }: { pick: HeroPick; editorial?: boolean; now?: number }) {
  const { offer } = pick;
  const label = REASON[editorial ? "editor" : pick.reason];
  const chips = conditionChips(offer);
  const until = validUntilHe(offer.valid_to, now);
  const verified = offer.value_pct !== null && offer.reference_agorot !== null;

  return (
    <Tape printIn className="relative px-5 py-5" aria-labelledby="hero-title">
      <p className="text-sm font-semibold text-ink-2">{label}</p>

      <h2 id="hero-title" className="mt-1 text-[1.75rem] leading-tight font-bold text-ink">
        <Link href={`/beer/${offer.beer_slug}`} className="inline-flex min-h-11 items-center after:absolute after:inset-0 after:content-['']">
          {offer.beer_name}
        </Link>
      </h2>
      <p className="mt-0.5 text-sm text-ink-2">
        {packText(offer)} · {offer.store_name}
      </p>

      <div aria-hidden className="tear my-4" />

      <div className="flex items-end justify-between gap-4">
        <Price agorot={offer.effective_agorot} size="lg" className="text-price" />
        {offer.value_pct !== null && (
          <Saving pct={offer.value_pct} className="mb-1 rounded-lg bg-deal px-3 py-1.5 text-lg font-bold text-on-deal" />
        )}
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
        {verified && (
          <span>
            במקום <s className="num">{formatPrice(offer.reference_agorot!)}</s>
          </span>
        )}
        {offer.unit_price_per_liter_agorot !== null && <UnitPrice agorotPerLiter={offer.unit_price_per_liter_agorot} />}
        {until && <span>{until}</span>}
        {chips.map((chip) => (
          <span key={chip.label} className="rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink">
            {chip.label}
          </span>
        ))}
      </p>
    </Tape>
  );
}
