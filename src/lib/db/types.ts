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
  /** product_categories.slug (migration 0014): beer | non_alcoholic | radler | malt | cider */
  category?: string;
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
  /** Where they said they live, and how far they will go (migration 0026). */
  home_city: string | null;
  home_lat: number | null;
  home_lon: number | null;
  /** 0 = nationwide. Null = never asked, or declined. */
  search_radius_km: number | null;
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
  /** Who submitted it. Null for a chain feed row and for a deal an admin typed in. */
  created_by: string | null;
  entered_by_admin: boolean;
  /** The name they chose to be credited by (0030); null when they have not chosen one. */
  contributors: { display_name: string } | null;
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
/** skus.packaging (0021): a bottle crate only on evidence; never inferred from the count. */
export type Packaging = "single" | "multipack" | "bottle_crate";
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
  /** Only with a basket over this amount ("מעל 75"): anyone can get it, but not on its own. */
  min_basket_agorot?: number;
  /** "2 for ₪45": qty packs for total_agorot. The per-pack price is ceil(total / qty). */
  multi_buy?: { qty: number; total_agorot: number };
  club?: string;
  coupon?: boolean;
  note_he?: string;
  /** Who can redeem it (0014). The read views only ever return "everyone". */
  audience?: "everyone" | "club" | "payment" | "coupon" | "personal" | "restricted";
  /** The bottle deposit: {agorot per pack, included in the price?, why we think so}. */
  deposit?: { agorot: number | null; included: boolean; basis?: string };
};

/**
 * Where a promotion is available (migration 0017), measured against what was checked — never assumed.
 * Null on offers the scan model does not cover (user-submitted deals, older imports).
 */
export type PromotionScope = {
  promotion_id: number | null;
  scope: "chainwide" | "participating_branches" | "single_branch" | "unknown" | null;
  scope_evidence: "source_declared" | "observed_all_known_eligible_branches" | "observed_subset" | "insufficient_coverage" | null;
  /** Branches the chain's latest scan accounted for (its Stores file). */
  branches_known: number | null;
  /** Of those, the ones whose current promotions file was read. */
  branches_checked: number | null;
  /** Of those, the ones whose current file lists this promotion. */
  branches_matching: number | null;
  coverage_as_of: string | null;
  /** The one branch, when it runs at exactly one. */
  only_branch_name: string | null;
  only_branch_city: string | null;
};

/** Where a price was seen, and how it relates to the deposit (migrations 0014–0015). */
export type PriceProvenance = {
  variant: string;
  category: string;
  /** ₪0.30 × containers, per pack; null when unknown or not applicable. */
  deposit_agorot: number | null;
  deposit_included: boolean | null;
  /** How many of the chain's branches this price (or promotion) was seen at. */
  branch_count: number;
  branch_id: string | null;
  branch_name: string | null;
  branch_city: string | null;
};

/**
 * One row of `offers_feed`: the single thing the app reads for "what is on offer".
 *
 * `value_pct` and `reference_agorot` are only set when the reference price can be
 * trusted (same SKU, same chain, seen in the last 14 days, from a chain feed or
 * an administrator, and the saving is at most 70 %). A null means "do not claim a
 * saving" — show the price alone. Never derive a percentage in the UI.
 */
/** The bands of the Deal Score (migration 0027, docs/DEAL-SCORE.md). */
export type ScoreBand = "amazing" | "very_good" | "fair" | "weak";

export type DealScore = {
  score: number;
  band: ScoreBand;
};

/**
 * What the people who were in the shop say (migration 0031, `offer_standings`).
 *
 * 'quiet' never reaches the app: an offer nobody has spoken about carries no
 * standing at all, so the line says nothing rather than "unconfirmed".
 */
export type OfferStanding = "ended" | "still_there" | "unclear";

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
  /** From skus (src/lib/offers.ts withPackaging); null for legacy deals and when unknown. */
  packaging?: Packaging | null;
  /**
   * How good this deal is (migration 0027). ABSENT, never zero, when there is no
   * trusted reference price to measure it against — the UI shows no score at all
   * rather than a number it cannot defend.
   */
  deal_score?: DealScore | null;
  /**
   * The name the person who submitted this deal chose to be credited by (0030).
   * Null when nobody submitted it (a chain feed) or when they have not chosen one —
   * in which case the line says nothing, rather than "anonymous".
   */
  found_by?: string | null;
  /**
   * What people report about this offer (0031). Null when nobody has said anything —
   * the overwhelmingly common case, and the line then says nothing at all.
   *
   * 'ended' is a LABEL, never a deletion: the offer stays on the screen with what
   * people said about it, because the chain feed may still be right and a shelf may
   * be refilled. Only a person takes a deal down.
   */
  standing?: OfferStanding | null;
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
} & Partial<PriceProvenance> &
  Partial<PromotionScope>;

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
  /** From skus (src/lib/offers.ts withPackaging). */
  packaging?: Packaging | null;
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
  /** The highest current price among the branches seen; above price_agorot → "החל מ־". */
  max_price_agorot?: number;
} & Partial<PriceProvenance>;

/**
 * One row of `group_offers_feed` (0014): "any N of these packs for ₪X" at a chain — ONE offer across
 * several packs. Never shown as a per-pack price of any one of them.
 */
export type GroupOffer = {
  offer_key: string;
  group_id: number;
  store_id: string;
  store_slug: string;
  store_name: string;
  description_he: string;
  required_qty: number;
  total_agorot: number;
  per_unit_agorot: number;
  deposit_agorot: number | null;
  deposit_included: boolean | null;
  valid_from: string | null;
  valid_to: string | null;
  observed_at: string;
  is_sample: boolean;
  beer_ids: string[];
  beer_slugs: string[];
  packs: Array<{ sku_id: string; beer_slug: string; beer_name: string; label: string; container: ContainerType; volume_ml: number; pack_quantity: number; packaging?: Packaging | null }>;
  branch_count: number;
  branch_id: string | null;
  branch_name: string | null;
  branch_city: string | null;
} & Partial<PromotionScope>;
