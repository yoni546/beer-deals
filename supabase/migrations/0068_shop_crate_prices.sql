-- ---------------------------------------------------------------------------
-- 0068 — crate prices at liquor shops' websites.
--
-- WHY. A crate (24 bottles or cans) is what many people buy beer in, and the
-- supermarkets' price-transparency files almost never carry one: in production on
-- 2026-10-30 the whole feed had two crate SKUs, and no chain had ever published a
-- promotion on a crate. Crates are sold by liquor and drinks shops, which are not
-- bound by the transparency law and publish no files. Their websites do show a
-- price, and the owner chose (2026-10-30) to read it from the two shops whose terms
-- do not forbid it — אליאסי משקאות and בית היין — while asking the others for leave.
--
-- WHAT THIS IS, AND IS NOT. One row per crate on a shop's site: the shop's own
-- title, the pack read from it, the price the site shows, and the page it is on.
-- It is NOT a price_observation: those are shelf prices at a branch, carry an
-- ingestion run and feed the Deal Score, and a website's price is none of those
-- (online prices often differ from a shop's counter, and delivery is extra). So it
-- has a table of its own, and the app words it as "the price on the shop's site".
--
-- FRESHNESS. `seen_at` is when the site last showed the row. The app reads only
-- rows seen in the last three days; a crate that leaves the site stops being shown
-- without anything having to delete it, and the writer clears rows unseen for a week.
--
-- WHO WRITES. The daily import's service role, nothing else. Everybody may read:
-- these are public prices on public pages.
-- ---------------------------------------------------------------------------

create table if not exists public.shop_crate_prices (
  id             uuid primary key default gen_random_uuid(),
  -- The shop, by a slug the app knows (src/lib/shops.ts): eliasi, winehouse.
  shop           text not null check (shop ~ '^[a-z0-9-]{2,40}$'),
  beer_id        uuid not null references public.beers (id) on delete cascade,
  -- '' = the beer's main product, as skus.variant (0014).
  variant        text not null default '',
  -- The shop's own name for it, kept so a person can recognise it on the site.
  title          text not null check (length(title) between 3 and 200),
  pack_quantity  integer not null check (pack_quantity between 10 and 48),
  volume_ml      integer check (volume_ml between 200 and 1000),
  container      text check (container in ('can', 'bottle')),
  -- A crate under ₪20 or over ₪1,000 is a misread, not a price.
  price_agorot   integer not null check (price_agorot between 2000 and 100000),
  url            text not null check (url ~ '^https://[a-z0-9.-]+/' and length(url) <= 500),
  in_stock       boolean not null default true,
  pickup_only    boolean not null default false,
  seen_at        timestamptz not null default now(),
  unique (shop, url)
);

comment on table public.shop_crate_prices is
  'Crate prices shown on liquor shops'' websites (0068): the shop''s title, the pack, the price and the page. Not shelf prices; written by the daily import only.';

create index if not exists shop_crate_prices_beer_idx on public.shop_crate_prices (beer_id, seen_at desc);

alter table public.shop_crate_prices enable row level security;

grant select on public.shop_crate_prices to anon, authenticated;
grant select, insert, update, delete on public.shop_crate_prices to service_role;

create policy shop_crate_prices_read on public.shop_crate_prices
  for select to anon, authenticated using (true);
