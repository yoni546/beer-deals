/**
 * Money is a whole number of agorot, everywhere. Prices are never floats.
 *
 * The conversion happens on the *string* because the obvious arithmetic is
 * wrong: `parseFloat("24.90") * 100` is 2489.9999999999995, and rounding that
 * away works until the day it does not.
 */

/** "24.90" | "24" | "24.9" -> 2490 | 2400 | 2490. Returns null if unparseable. */
export function shekelsToAgorot(input: string): number | null {
  const stripped = input.trim().replace(/[₪\s]/g, "");

  // A comma here is a decimal separator, not a thousands separator — "24,90"
  // is how plenty of people type ₪24.90, and deleting the comma instead would
  // silently turn that into ₪2,490. Anything else with a comma in it falls
  // through to the pattern below and is rejected rather than guessed at.
  const cleaned = stripped.replace(",", ".");

  if (!/^\d{1,6}(\.\d{1,2})?$/.test(cleaned)) return null;

  const [whole, fraction = ""] = cleaned.split(".");
  const agorot = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(agorot) ? agorot : null;
}

/** 2490 -> "24.90". Always two decimals: "₪24.9" reads like a typo. */
export function formatAgorot(agorot: number): string {
  const sign = agorot < 0 ? "-" : "";
  const abs = Math.abs(agorot);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 2490 -> "₪24.90" */
export function formatPrice(agorot: number): string {
  return `₪${formatAgorot(agorot)}`;
}

/**
 * Mirrors the generated column in Postgres so an unsaved form can preview the
 * same number the database will store. The database remains the source of
 * truth; this is never persisted.
 */
export function discountPercent(dealAgorot: number, regularAgorot: number): number | null {
  if (regularAgorot <= 0 || dealAgorot <= 0 || dealAgorot >= regularAgorot) return null;
  return Math.round(((regularAgorot - dealAgorot) * 100) / regularAgorot);
}
