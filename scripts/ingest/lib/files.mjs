/**
 * Feed file names (the skill, references/chain-feeds.md): two shapes are in use and a single
 * chain's listing carries both, prefix case varies, and "price" is a prefix of "pricefull" — so
 * match the longer prefix first and parse positionally from the RIGHT.
 *
 *   3-segment  PriceFull7290058140886-039-202607150513.gz
 *   5-segment  PriceFull7290058140886-001-001-20260827-001001.gz
 */

/** @returns {"PriceFull"|"PromoFull"|"Price"|"Promo"|"Stores"|"other"} */
export function kindOf(name) {
  const n = String(name).toLowerCase();
  if (n.startsWith("pricefull")) return "PriceFull";
  if (n.startsWith("promofull")) return "PromoFull";
  if (n.startsWith("price")) return "Price";
  if (n.startsWith("promo")) return "Promo";
  if (n.startsWith("stores")) return "Stores";
  return "other";
}

/** @returns {{chainId: string, subChain: string | null, store: string, stamp: string}} */
export function parseFileName(name) {
  const base = String(name).replace(/\.(xml\.)?gz$|\.xml$/i, "");
  const parts = base.replace(/^[A-Za-z]+/, "").split("-");
  if (parts.length >= 5) {
    return { chainId: parts[0], subChain: parts[parts.length - 4], store: parts[parts.length - 3], stamp: parts[parts.length - 2] + parts[parts.length - 1] };
  }
  if (parts.length === 3) return { chainId: parts[0], subChain: null, store: parts[1], stamp: parts[2] };
  return { chainId: parts[0], subChain: null, store: parts[1] ?? "", stamp: parts.slice(2).join("") };
}
