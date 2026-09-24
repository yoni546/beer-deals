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
  weekly_deal_preferred_beer_slug: string | null;
};
