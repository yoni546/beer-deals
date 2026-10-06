import type { ContainerType, Offer, Packaging } from "@/lib/db/types";
import { classOfPack } from "@/lib/offer-logic";

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

/** The three categories a person sees — never "מארזים" (src/lib/offer-logic.ts, PackClass). */
export const PACK_CLASS_HE = { small_multipack: "שישיות", case: "ארגזים", single: "בודדים" } as const;

const PACK_NAME_HE: Record<number, string> = { 2: "זוג", 3: "שלישייה", 4: "רביעייה", 5: "חמישייה", 6: "שישייה", 8: "שמינייה", 10: "עשירייה" };

/**
 * What a pack of N is called on an Israeli shelf. The real count, always: a four-pack is a רביעייה and
 * an eight a שמינייה, even though both are listed under "שישיות". Only a bottle crate (packaging
 * 'bottle_crate', on evidence) is a ארגז; 24 cans or a carton of 24 bottles are a מארז 24 (src/lib/
 * offer-logic.ts, classOfPack). A single has no pack word.
 */
export function packNameHe(quantity: number, packaging: Packaging | null = null): string | null {
  if (quantity <= 1) return null;
  if (classOfPack({ pack_quantity: quantity, packaging }) === "case") return "ארגז";
  return PACK_NAME_HE[quantity] ?? `מארז ${quantity}`;
}

/**
 * "שישייה · 6×330 מ״ל · פחית" — the pack as printed on a shelf label: its name, the real count and size,
 * the container when the chain says it. Led by the variant when there is one ("לא מסונן · 500 מ״ל · פחית",
 * "0.0 · רביעייה · 4×330 מ״ל · בקבוק"): two variants in the same can are two different products.
 * Legacy deals only know a category.
 */
export function packText(offer: Pick<Offer, "volume_ml" | "pack_quantity" | "container" | "pack_label"> & { variant?: string | null; packaging?: Packaging | null }): string {
  if (!offer.volume_ml || !offer.pack_quantity) return offer.pack_label;
  const size = offer.pack_quantity > 1 ? `${offer.pack_quantity}×${volumeHe(offer.volume_ml)}` : volumeHe(offer.volume_ml);
  const container = offer.container ? CONTAINER_HE[offer.container] : "";
  return [offer.variant || "", packNameHe(offer.pack_quantity, offer.packaging ?? null) ?? "", size, container].filter(Boolean).join(" · ");
}

export type ConditionChip = { label: string; kind: "multi" | "club" | "limit" | "coupon" };

/** The terms of a promotion as short chips: "2 ב־₪45", "חברי מועדון", "עד 6 ללקוח", "בקנייה מעל ₪75". */
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
  if (c.max_qty) chips.push({ label: `עד ${c.max_qty} ללקוח`, kind: "limit" });
  if (c.min_basket_agorot) chips.push({ label: `בקנייה מעל ₪${Math.round(c.min_basket_agorot / 100)}`, kind: "limit" });
  return chips;
}

/**
 * The bottle deposit beside a price (migration 0014). Shelf prices in Israel exclude it; it is shown
 * apart — "+ ₪1.80 פיקדון" — so it is never mistaken for part of a saving. Null when unknown.
 */
export function depositHe(depositAgorot: number | null | undefined, included: boolean | null | undefined): string | null {
  if (!depositAgorot || depositAgorot <= 0) return null;
  if (included) return "כולל פיקדון";
  const shekels = (depositAgorot / 100).toFixed(2);
  return `+ ₪${shekels} פיקדון`;
}

/**
 * Where a price was seen. Prices are per branch; a chain row is never "the chain's price":
 * one branch is named, several are counted.
 */
export function whereSeenHe(row: { branch_count?: number | null; branch_name?: string | null; branch_city?: string | null }): string | null {
  const n = row.branch_count ?? 0;
  if (n > 1) return `ב־${n} סניפים`;
  if (n === 1 && row.branch_name) return `בסניף ${row.branch_name.trim()}`;
  return null;
}

export type ScopeText = {
  /** The short line on the deal. */
  label: string;
  /** What the sheet adds, when there is more to say. */
  detail: string | null;
  /** There are branches to list (the sheet can open). */
  inspectable: boolean;
};

/**
 * What a deal may say about WHERE it runs (0.9.0, migration 0017). The database decides the scope with one
 * rule (promotion_scope); this only words it, and never says more than the scope allows:
 *
 *   chainwide                 "בכל הרשת"               — the chain's word, or every known branch checked and listing it
 *   participating_branches    "בסניפים משתתפים"        — "12 מתוך 18 סניפים שנבדקו" in the sheet
 *   single_branch             "<branch> בלבד"          — the one branch of several checked that lists it
 *   unknown, all checked list it   "נצפה בכל 12 הסניפים שנבדקו"   (not "בכל הרשת": not every branch was checked)
 *   unknown, one branch seen       "נצפה בסניף <branch>"
 *   unknown, nothing current       "זמינות לפי סניף"
 *
 * Null for offers the scan model does not cover (a user-submitted deal): the caller says nothing about scope.
 */
export function scopeHe(row: {
  scope?: string | null;
  scope_evidence?: string | null;
  branches_known?: number | null;
  branches_checked?: number | null;
  branches_matching?: number | null;
  only_branch_name?: string | null;
  branch_name?: string | null;
}): ScopeText | null {
  if (!row.scope) return null;
  const known = row.branches_known ?? 0;
  const checked = row.branches_checked ?? 0;
  const matching = row.branches_matching ?? 0;
  const name = (row.only_branch_name ?? row.branch_name ?? "").trim();
  switch (row.scope) {
    case "chainwide":
      return {
        label: "בכל הרשת",
        detail: row.scope_evidence === "source_declared" ? "לפי הרשת עצמה" : `נמצא בכל ${known} הסניפים של הרשת`,
        inspectable: false,
      };
    case "participating_branches":
      return { label: "בסניפים משתתפים", detail: `${matching} מתוך ${checked} סניפים שנבדקו`, inspectable: true };
    case "single_branch":
      return { label: name ? `${name} בלבד` : "בסניף אחד בלבד", detail: `נמצא בסניף אחד מתוך ${checked} שנבדקו`, inspectable: true };
    default:
      if (checked >= 2 && matching === checked) {
        return { label: `נצפה בכל ${checked} הסניפים שנבדקו`, detail: known > checked ? `נבדקו ${checked} מתוך ${known} סניפים` : null, inspectable: true };
      }
      if (matching === 1) return { label: name ? `נצפה בסניף ${name}` : "נצפה בסניף אחד", detail: known > 1 ? `נבדקו ${checked} מתוך ${known} סניפים` : null, inspectable: true };
      if (matching > 1) return { label: `נצפה ב־${matching} סניפים`, detail: `נבדקו ${checked} מתוך ${known} סניפים`, inspectable: true };
      return { label: "זמינות לפי סניף", detail: null, inspectable: false };
  }
}

/** "החל מ־": the lowest of several branch prices that differ. */
export const isFromPrice = (row: { branch_count?: number | null; price_agorot: number; max_price_agorot?: number | null }) =>
  (row.branch_count ?? 0) > 1 && (row.max_price_agorot ?? row.price_agorot) > row.price_agorot;
