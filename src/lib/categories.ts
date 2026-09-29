export const DEAL_CATEGORIES = ["sixpack", "case", "single"] as const;

export type DealCategory = (typeof DEAL_CATEGORIES)[number];

/** Plural — the tab labels. */
export const CATEGORY_LABEL: Record<DealCategory, string> = {
  sixpack: "שישיות",
  case: "ארגזים",
  single: "בודדים",
};

/** Singular — reads correctly on a single deal card: "שישייה – ₪24.90". */
export const CATEGORY_LABEL_ONE: Record<DealCategory, string> = {
  sixpack: "שישייה",
  case: "ארגז",
  single: "בודד",
};

/**
 * Prices are never compared across categories, so an unrecognised category
 * falls back to a fixed default rather than to "all" — a mixed list would
 * silently put a ₪24.90 sixpack above a ₪8.90 single and make the cheaper one
 * look worse.
 */
export function parseCategory(value: string | undefined | null): DealCategory {
  return DEAL_CATEGORIES.includes(value as DealCategory) ? (value as DealCategory) : "sixpack";
}
