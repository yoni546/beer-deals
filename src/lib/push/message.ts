import { packText } from "@/lib/format";
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
 *
 * Where it runs (0.9.0, migration 0017) ends the body only when the scope is KNOWN: "בכל הרשת",
 * "בסניפים משתתפים", or the one branch ("גבעת שאול בלבד"). An unknown scope adds nothing — a notification
 * never implies the whole chain without evidence.
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
  > &
    Partial<Pick<Offer, "scope" | "only_branch_name">>,
): PushMessage {
  const multi = offer.conditions?.multi_buy;
  const verified = offer.value_pct !== null && offer.reference_agorot !== null;
  const price = multi ? `${multi.qty} ב־${formatPrice(multi.total_agorot)}` : formatPrice(offer.effective_agorot);

  // THE TITLE CARRIES THE FACT, not an advertisement.
  //
  // It used to read "מבצע חדש ברמי לוי" with the beer and the price in the body.
  // That is the shape of every promotional push ever sent — a phrase with no
  // information in it — and on 2026-10-25 Chrome put one of ours behind a
  // "Possible spam" warning with an Unsubscribe button on it. Whatever its
  // classifier weighed, a line that says WHICH BEER, HOW MUCH and WHERE is both
  // the more useful notification and the less dismissible one: somebody reading
  // only the bold line already knows whether they care.
  // The body carries the pack and the evidence. It leads with the pack so the
  // line is never empty: an unverified offer with an unknown scope would
  // otherwise have nothing left to say, and a notification with a blank body is
  // both uglier and more suspicious-looking than one with a short true one.
  const pieces = [packText(offer)];
  // "instead of" only for a plain price with a trusted reference; a multi-buy states its terms.
  if (verified && !multi) pieces.push(`במקום ${formatPrice(offer.reference_agorot!)}`);
  if (verified) pieces.push(`−${offer.value_pct}%`);
  const where =
    offer.scope === "chainwide"
      ? "בכל הרשת"
      : offer.scope === "participating_branches"
        ? "בסניפים משתתפים"
        : offer.scope === "single_branch"
          ? offer.only_branch_name
            ? `${offer.only_branch_name.trim()} בלבד`
            : "בסניף אחד בלבד"
          : null;
  if (where) pieces.push(where);
  // No "members only" wording: an offer that is not for everyone is never announced (migration 0014).

  return {
    // Short enough to survive a phone's truncation: the beer, the price, the shop.
    title: `${offer.beer_name} ${price} ${inChain(offer.store_name)}`,
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
    // Also specific, and also for the classifier's sake: "בדיקת התראה" with a
    // generic body is the most spam-shaped thing this app ever sends.
    title: "התראות עובדות במכשיר הזה",
    body: "זו הבדיקה שביקשתם מההגדרות. מבצע אמיתי ייראה כך, עם הבירה והמחיר בשורה הראשונה.",
    url: "/settings",
    tag: "test",
  };
}
