import { conditionChips, packText } from "@/lib/format";
import { formatPrice } from "@/lib/money";
import type { Offer } from "@/lib/db/types";

/**
 * The notification text and where a tap goes. Pure, so it can be read and tested without a
 * database or a push service.
 *
 *   Title  מבצע חדש ברמי לוי
 *   Body   גולדסטאר 6 × 330 מ״ל · פחית · ₪25.00 במקום ₪37.90 · −34%
 *
 * "במקום ₪X" and the percentage appear only when the database vouched for the reference
 * price (offer.value_pct / reference_agorot are set). Nothing here computes a saving.
 */

/** "ב" + a Hebrew chain name ("ברמי לוי"); a Latin name takes a maqaf ("ב־AM:PM"). */
function inChain(name: string): string {
  return /^[֐-׿]/.test(name) ? `ב${name}` : `ב־${name}`;
}

export type PushMessage = {
  title: string;
  body: string;
  /** Where a tap goes: a beer page, addressed by slug (never by database id). */
  url: string;
  /** Same tag ⇒ the newer notification replaces the older instead of stacking. */
  tag: string;
};

export function buildOfferNotification(
  offer: Pick<
    Offer,
    | "offer_key"
    | "sku_id"
    | "beer_id"
    | "beer_slug"
    | "beer_name"
    | "store_slug"
    | "store_name"
    | "volume_ml"
    | "pack_quantity"
    | "container"
    | "pack_label"
    | "effective_agorot"
    | "reference_agorot"
    | "value_pct"
    | "conditions"
    | "promo_type"
    | "origin"
  >,
): PushMessage {
  const multi = offer.conditions?.multi_buy;
  const verified = offer.value_pct !== null && offer.reference_agorot !== null;
  const price = multi ? `${multi.qty} ב־${formatPrice(multi.total_agorot)}` : formatPrice(offer.effective_agorot);

  const pieces = [
    `${offer.beer_name} ${packText(offer)}`,
    // "instead of" only for a plain price with a trusted reference; a multi-buy states its terms.
    verified && !multi ? `${price} במקום ${formatPrice(offer.reference_agorot!)}` : price,
  ];
  if (verified) pieces.push(`−${offer.value_pct}%`);
  // A club-only price is worth saying: it is not everyone's price.
  const club = conditionChips(offer).find((chip) => chip.kind === "club");
  if (club) pieces.push(club.label);

  return {
    title: `מבצע חדש ${inChain(offer.store_name)}`,
    body: pieces.join(" · "),
    url: buildBeerPath({ beerSlug: offer.beer_slug }),
    tag: `offer:${offer.sku_id ?? offer.beer_id}:${offer.store_slug}`,
  };
}

/**
 * Where tapping a notification goes.
 *
 * Beer pages are addressed by SLUG (`/beer/goldstar`). This used to be built from the beer's
 * database id, which no route answers to, so every notification opened a 404. Taking the slug
 * (not an id) as the input makes that mistake impossible to repeat by accident.
 */
export function buildBeerPath(input: { beerSlug: string }): string {
  return `/beer/${encodeURIComponent(input.beerSlug)}`;
}

/** The text of "send me a test push" (Settings). */
export function buildTestNotification(): PushMessage {
  return {
    title: "בדיקת התראה",
    body: "אם אתם קוראים את זה, התראות עובדות במכשיר הזה.",
    url: "/settings",
    tag: "test",
  };
}
