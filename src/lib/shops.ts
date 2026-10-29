/**
 * Liquor shops whose websites' crate prices the app shows (migration 0068, scripts/shops/).
 *
 * Fixed data, here rather than in a table: two shops, each chosen by the owner (2026-10-30) because their
 * terms do not forbid reading their pages. Adding one means checking its terms first, then a reader in
 * scripts/shops/lib/crates.mjs and a line here.
 */
export const SHOPS: Record<string, { name: string; note: string }> = {
  eliasi: { name: "אליאסי משקאות", note: "משלוח לכל הארץ, נגבה לכל ארגז" },
  winehouse: { name: "בית היין", note: "תל אביב ונתניה" },
};

export type ShopCrate = {
  shop: string;
  beer_id: string;
  variant: string;
  title: string;
  pack_quantity: number;
  volume_ml: number | null;
  container: "can" | "bottle" | null;
  price_agorot: number;
  url: string;
  pickup_only: boolean;
  seen_at: string;
};

/** A shop's price is shown for three days after the site last showed it. */
export const SHOP_PRICE_DAYS = 3;

/** "24 × 500 מ״ל · פחית", from what the page said; nothing is filled in that it did not. */
export function crateText(crate: Pick<ShopCrate, "pack_quantity" | "volume_ml" | "container" | "variant">): string {
  const size = crate.volume_ml ? `${crate.pack_quantity} × ${crate.volume_ml} מ״ל` : `${crate.pack_quantity} יח׳`;
  const container = crate.container === "can" ? "פחיות" : crate.container === "bottle" ? "בקבוקים" : null;
  return [crate.variant || null, size, container].filter(Boolean).join(" · ");
}

/** What one bottle or can costs in the crate, in agorot (rounded up: never cheaper than it is). */
export const perUnitAgorot = (crate: Pick<ShopCrate, "price_agorot" | "pack_quantity">) => Math.ceil(crate.price_agorot / crate.pack_quantity);

export const unitWord = (container: ShopCrate["container"]) => (container === "can" ? "לפחית" : container === "bottle" ? "לבקבוק" : "ליחידה");
