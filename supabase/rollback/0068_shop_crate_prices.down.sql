-- Undo 0068: the shops' crate prices are derived from public pages and re-read daily; nothing is lost
-- that the next run would not fetch again.
drop table if exists public.shop_crate_prices;
