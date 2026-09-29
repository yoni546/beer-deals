/**
 * SUPPLEMENT to the installed skill's parser, for one field it drops.
 *
 * parse_price_xml.py (v1.6.0) emits `discounted_price` only for the Cerberus-style dialect; for the
 * Shufersal/Carrefour-style layout (Groups/Group/PromotionItems/PromotionItem) it keeps RewardType,
 * MinQty and DiscountRate but not the item's <DiscountedPrice>. Every chain fetched on 2026-09-29 was
 * parsed as that layout, and all six publish <DiscountedPrice> per item (docs/INGESTION-DRY-RUN.md).
 * Without it a promotion's price can only be read from its free-text description.
 *
 * This reads exactly that field from the same PromoFull file and merges it into the skill's items under
 * the skill's own name (`discounted_price`). It is not a second parser: everything else still comes from
 * the skill. Remove it when the skill emits the field (reported upstream: see INGESTION-READINESS §8).
 */
import { gunzipSync } from "node:zlib";

const text = (block, tag) => (block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) ?? [])[1]?.trim() ?? "";

/** @returns {Map<string, string>} "promotionId|itemCode" → DiscountedPrice as written ("55.00"), non-empty only */
export function discountedPrices(gzOrXml) {
  const xml = Buffer.isBuffer(gzOrXml) && gzOrXml[0] === 0x1f && gzOrXml[1] === 0x8b ? gunzipSync(gzOrXml).toString("utf8") : String(gzOrXml);
  const out = new Map();
  for (const promo of xml.split(/<Promotion>/).slice(1)) {
    const id = text(promo, "PromotionID") || text(promo, "PromotionId");
    for (const item of promo.split(/<PromotionItem>/).slice(1)) {
      const price = text(item, "DiscountedPrice");
      if (id && price) out.set(`${id}|${text(item, "ItemCode")}`, price);
    }
  }
  return out;
}

/**
 * The skill's promotions, with `discounted_price` filled in where the file has one and the skill left it out.
 * @template {{promotion_id: string, items: Array<{item_code: string, discounted_price?: string}>}} P
 * @param {P[]} promotions
 * @param {Map<string, string>} prices
 * @returns {P[]}
 */
export function withDiscountedPrices(promotions, prices) {
  return promotions.map((p) => ({
    ...p,
    items: p.items.map((i) => (i.discounted_price ? i : { ...i, discounted_price: prices.get(`${p.promotion_id}|${i.item_code}`) ?? "" })),
  }));
}
