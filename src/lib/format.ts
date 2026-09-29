import type { ContainerType, Offer } from "@/lib/db/types";

/**
 * Hebrew wording for time, packs and promotion terms. Pure functions of their
 * inputs (the clock is a parameter), so they are testable without a browser.
 */

const TZ = "Asia/Jerusalem";

/** Calendar parts in Israel time — a "day" is an Israeli day, wherever the server runs. */
function israelParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

const dayNumber = (date: Date) => {
  const { y, m, d } = israelParts(date);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};

const WEEKDAY = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

/** "עכשיו", "לפני 3 שעות", "אתמול", "לפני 9 ימים". */
export function relativeTimeHe(iso: string, now: number = Date.now()): string {
  const then = new Date(iso);
  const minutes = Math.max(0, Math.round((now - then.getTime()) / 60_000));
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return minutes === 1 ? "לפני דקה" : `לפני ${minutes} דקות`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "לפני שעה" : hours === 2 ? "לפני שעתיים" : `לפני ${hours} שעות`;
  const days = dayNumber(new Date(now)) - dayNumber(then);
  if (days <= 1) return "אתמול";
  if (days === 2) return "לפני יומיים";
  return `לפני ${days} ימים`;
}

/** Whole days since `iso`, by the Israeli calendar. */
export function daysSince(iso: string, now: number = Date.now()): number {
  return dayNumber(new Date(now)) - dayNumber(new Date(iso));
}

/** "עד סוף היום", "עד מחר", "עד יום ה׳", "עד 12.10". Null when there is no end date. */
export function validUntilHe(validTo: string | null, now: number = Date.now()): string | null {
  if (!validTo) return null;
  const end = new Date(validTo);
  const left = dayNumber(end) - dayNumber(new Date(now));
  if (left < 0) return null;
  if (left === 0) return "עד סוף היום";
  if (left === 1) return "עד מחר";
  const { m, d } = israelParts(end);
  if (left <= 6) {
    const weekday = new Date(Date.UTC(israelParts(end).y, m - 1, d)).getUTCDay();
    return `עד יום ${WEEKDAY[weekday]}`;
  }
  return `עד ${d}.${m}`;
}

const CONTAINER_HE: Record<ContainerType, string> = {
  bottle: "בקבוק",
  can: "פחית",
  keg: "חבית",
  draft: "מהחבית",
  other: "",
};

export function volumeHe(ml: number): string {
  if (ml < 1000) return `${ml} מ״ל`;
  const liters = ml / 1000;
  return `${Number.isInteger(liters) ? liters : liters.toFixed(2).replace(/0$/, "")} ל׳`;
}

/** "6 × 330 מ״ל · פחית" — the pack as printed on a shelf label. Legacy deals only know a category. */
export function packText(offer: Pick<Offer, "volume_ml" | "pack_quantity" | "container" | "pack_label">): string {
  if (!offer.volume_ml || !offer.pack_quantity) return offer.pack_label;
  const size = offer.pack_quantity > 1 ? `${offer.pack_quantity} × ${volumeHe(offer.volume_ml)}` : volumeHe(offer.volume_ml);
  const container = offer.container ? CONTAINER_HE[offer.container] : "";
  return container ? `${size} · ${container}` : size;
}

export type ConditionChip = { label: string; kind: "multi" | "club" | "limit" | "coupon" };

/** The terms of a promotion as short chips: "2 ב־₪45", "חברי מועדון", "עד 6 ליחידות". */
export function conditionChips(offer: Pick<Offer, "conditions" | "promo_type">): ConditionChip[] {
  const c = offer.conditions ?? {};
  const chips: ConditionChip[] = [];
  if (c.multi_buy) {
    const total = c.multi_buy.total_agorot;
    const shekels = total % 100 === 0 ? String(total / 100) : (total / 100).toFixed(2);
    chips.push({ label: `${c.multi_buy.qty} ב־₪${shekels}`, kind: "multi" });
  }
  if (c.club || offer.promo_type === "club_price") chips.push({ label: c.club ? `חברי ${c.club}` : "חברי מועדון", kind: "club" });
  if (c.coupon || offer.promo_type === "coupon") chips.push({ label: "עם קופון", kind: "coupon" });
  if (c.min_qty && c.min_qty > 1 && !c.multi_buy) chips.push({ label: `מינימום ${c.min_qty} יחידות`, kind: "limit" });
  if (c.max_qty) chips.push({ label: `עד ${c.max_qty} ליחידות`, kind: "limit" });
  return chips;
}
