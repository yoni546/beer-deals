import type { DealCategory } from "@/lib/categories";

export type DealStatus = "pending" | "approved" | "rejected" | "inactive";
export type ReportStatus = "open" | "resolved" | "dismissed";
export type AdminLevel = "admin" | "super_admin";

export type Beer = {
  id: string;
  slug: string;
  name_he: string;
  name_en: string;
  theme_base: string;
  theme_surface: string;
  theme_accent: string;
  theme_ink: string;
  sort_order: number;
  is_active: boolean;
};

export type Store = {
  id: string;
  slug: string;
  name_he: string;
  is_active: boolean;
};

export type Profile = {
  id: string;
  first_name: string | null;
  primary_beer_id: string | null;
  notifications_enabled: boolean;
  onboarded_at: string | null;
  /** A theme slug the person chose in Settings; null = follow favourite #1. */
};

/** A row of public.deals_public — an approved deal with its beer and store. */
export type PublicDeal = {
  id: string;
  beer_id: string;
  store_id: string;
  category: DealCategory;
  deal_price_agorot: number;
  regular_price_agorot: number;
  discount_percent: number;
  image_url: string | null;
  notes: string | null;
  approved_at: string | null;
  created_at: string;
  beer_slug: string;
  beer_name: string;
  beer_accent: string;
  store_slug: string;
  store_name: string;
};

/** A row of public.deals as an admin sees it, with the status still attached. */
export type AdminDeal = {
  id: string;
  category: DealCategory;
  deal_price_agorot: number;
  regular_price_agorot: number;
  discount_percent: number;
  image_url: string | null;
  notes: string | null;
  status: DealStatus;
  created_at: string;
  approved_at: string | null;
  beer_id: string;
  store_id: string;
  beers: Pick<Beer, "id" | "slug" | "name_he"> | null;
  stores: Pick<Store, "id" | "slug" | "name_he"> | null;
};

export type DealReport = {
  id: string;
  deal_id: string;
  reason: string | null;
  status: ReportStatus;
  created_at: string;
  deals: AdminDeal | null;
};

export type AppSettings = {
  weekly_deal_id: string | null;
  notify_min_discount_percent: number;
  notify_max_price_agorot: number;
  notify_cooldown_hours: number;
  notify_daily_cap: number;
  notify_quiet_start: number;
  notify_quiet_end: number;
  weekly_deal_preferred_beer_slug: string | null;
};

// --- Catalogue model (migrations 0007–0009) ----------------------------------

export type ContainerType = "bottle" | "can" | "keg" | "draft" | "other";
export type PromoType = "price_cut" | "multi_buy" | "club_price" | "coupon" | "gift" | "other";
export type ReferenceTrust = "feed" | "moderated" | "unverified";

export type Brand = { id: string; slug: string; name_he: string; name_en: string };

/** A sellable unit: identified by container, volume and pack size — never by brand name. */
export type Sku = {
  id: string;
  beer_id: string;
  container: ContainerType;
  volume_ml: number;
  pack_quantity: number;
  total_volume_ml: number;
  display_he: string;
  is_active: boolean;
};

/** Structured promotion terms (price_observations.conditions). */
export type OfferConditions = {
  min_qty?: number;
  max_qty?: number;
  /** "2 for ₪45": qty packs for total_agorot. The per-pack price is ceil(total / qty). */
  multi_buy?: { qty: number; total_agorot: number };
  club?: string;
  coupon?: boolean;
  note_he?: string;
};

/**
 * One row of `offers_feed`: the single thing the app reads for "what is on offer".
 *
 * `value_pct` and `reference_agorot` are only set when the reference price can be
 * trusted (same SKU, same chain, seen in the last 14 days, from a chain feed or
 * an administrator, and the saving is at most 70 %). A null means "do not claim a
 * saving" — show the price alone. Never derive a percentage in the UI.
 */
export type Offer = {
  offer_key: string;
  origin: "catalog" | "legacy";
  sku_id: string | null;
  beer_id: string;
  beer_slug: string;
  beer_name: string;
  store_id: string;
  store_slug: string;
  store_name: string;
  /** "גולדסטאר 6×330 מ״ל פחית" for catalogue offers; "שישייה/ארגז/בודד" for legacy deals. */
  pack_label: string;
  container: ContainerType | null;
  volume_ml: number | null;
  pack_quantity: number | null;
  /** Price of one pack. For a multi-buy this is the per-pack price of the deal. */
  effective_agorot: number;
  unit_price_per_liter_agorot: number | null;
  reference_agorot: number | null;
  reference_trust: ReferenceTrust | null;
  value_pct: number | null;
  needs_review: boolean;
  market_reference_agorot: number | null;
  market_value_pct: number | null;
  promo_type: PromoType | null;
  conditions: OfferConditions;
  valid_from: string | null;
  valid_to: string | null;
  observed_at: string | null;
  is_sample: boolean;
  notes: string | null;
};

/** One row of `regular_prices_feed`: the latest regular (non-promotional) price of a pack at a chain. */
export type RegularPrice = {
  observation_id: number;
  sku_id: string;
  beer_id: string;
  beer_slug: string;
  beer_name: string;
  container: ContainerType;
  volume_ml: number;
  pack_quantity: number;
  pack_label: string;
  store_id: string;
  store_slug: string;
  store_name: string;
  price_agorot: number;
  unit_price_per_liter_agorot: number;
  observed_at: string;
  is_sample: boolean;
  trust: ReferenceTrust;
  is_stale: boolean;
};
