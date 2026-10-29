import { Price } from "@/components/ui/Price";
import { Tape } from "@/components/ui/Tape";
import { formatPrice } from "@/lib/money";
import { SHOPS, crateText, perUnitAgorot, unitWord, type ShopCrate } from "@/lib/shops";

/**
 * Crates at liquor shops (0068): what the shop's own website asks, beside the supermarkets' prices.
 *
 * WORDED AS WHAT IT IS. A website's price is not a shelf price: it is often different at the shop's counter,
 * delivery is charged on top (per crate, at most of them), and nobody here has checked it in person. So the
 * heading says "the price on the shop's site, before delivery", the figure is in ink rather than the deal
 * colour (it is not a saving against anything), and every line leads to the page it came from. The price
 * per bottle or can is the number that compares across pack sizes and with a supermarket's six-pack.
 */
export function ShopCrates({ crates, beerNames }: { crates: ShopCrate[]; /** By beer_id, where the list mixes beers (Home). */ beerNames?: Record<string, string> }) {
  if (crates.length === 0) return null;
  return (
    <Tape className="pb-1" data-shop-crates>
      <p className="px-4 pt-3 pb-1 text-sm text-ink-2">המחיר באתר החנות, לפני משלוח. לחיצה פותחת את הדף בחנות.</p>
      <div className="divide-y divide-paper-line">
        {crates.map((crate) => (
          <article key={crate.url} className="px-4 pt-2 pb-3">
            <a href={crate.url} target="_blank" rel="noopener noreferrer" className="line">
              <span className="min-w-0">
                {beerNames?.[crate.beer_id] ? `${beerNames[crate.beer_id]} · ` : ""}
                {SHOPS[crate.shop]?.name ?? crate.shop}
              </span>
              <span aria-hidden className="leader-fill" />
              <Price agorot={crate.price_agorot} size="md" className="shrink-0 text-ink" />
            </a>
            <div className="facts">
              <span className="fact">{crateText(crate)}</span>
              <span className="fact">
                <span aria-hidden className="text-paper-line">
                  ·{" "}
                </span>
                <span className="num">{formatPrice(perUnitAgorot(crate))}</span> {unitWord(crate.container)}
              </span>
              {crate.pickup_only && (
                <span className="rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink">איסוף עצמי בלבד</span>
              )}
            </div>
          </article>
        ))}
      </div>
    </Tape>
  );
}
