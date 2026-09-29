-- ---------------------------------------------------------------------------
-- 0007 — catalogue model, part 1 of 3: tables   (0008 = write path, 0009 = read model).
--
-- WHY. Until now a "beer" was a brand name and a "deal" was a row with a
-- three-value pack category (sixpack | case | single). That cannot say that
-- Goldstar 6×330ml and Goldstar 6×500ml are different products, cannot hold a
-- regular (non-promotional) price, has no dates, no source and no history.
--
-- WHAT. Purely additive. Nothing existing is dropped, renamed or rewritten:
--   brand    → brands                       (new)
--   variant  → beers.variant                (new column; `beers` keeps meaning
--                                            "brand + variant", so favourites,
--                                            themes and every FK are untouched)
--   product  → skus                         (container · volume_ml · pack_quantity)
--   chain    → stores (+ kind)              (existing)
--   branch   → branches                     (new, optional)
--   price    → price_observations           (new, append-only ledger of regular
--                                            prices AND promotions, with source,
--                                            observed_at, validity window and
--                                            structured conditions)
-- The old `deals` table keeps working unchanged (user submissions + moderation);
-- 0009 exposes both worlds to the app through one read view.
--
-- Rollback: everything in 0007–0009 can be dropped without touching existing
-- data (the exact statements are at the end of 0009).
-- ---------------------------------------------------------------------------

create type public.container_type as enum ('bottle', 'can', 'keg', 'draft', 'other');
create type public.price_kind     as enum ('regular', 'promotion');
create type public.promo_type     as enum ('price_cut', 'multi_buy', 'club_price', 'coupon', 'gift', 'other');
create type public.source_kind    as enum ('chain_feed', 'admin', 'user_submission', 'scraper', 'import');

-- --------------------------------------------------------------------------
-- Brands, and beers as brand + variant.
-- --------------------------------------------------------------------------

create table public.brands (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name_he    text not null,
  name_en    text not null,
  created_at timestamptz not null default now()
);

-- One brand per existing beer, except the one variant we already know of:
-- "Tuborg Red" is a variant of the Tuborg brand, not a brand of its own.
insert into public.brands (slug, name_he, name_en)
select b.slug, b.name_he, b.name_en
  from public.beers b
 where b.slug <> 'tuborg-red'
on conflict (slug) do nothing;

alter table public.beers
  add column brand_id uuid references public.brands (id) on delete restrict,
  add column variant  text check (variant is null or char_length(trim(variant)) between 1 and 40);

update public.beers b
   set brand_id = br.id
  from public.brands br
 where b.brand_id is null
   and br.slug = case when b.slug = 'tuborg-red' then 'tuborg' else b.slug end;

update public.beers set variant = 'red' where slug = 'tuborg-red' and variant is null;

alter table public.beers alter column brand_id set not null;

-- A brand has at most one beer per variant (and one "plain" beer).
create unique index beers_brand_variant_key on public.beers (brand_id, coalesce(variant, ''));

-- --------------------------------------------------------------------------
-- SKUs: the sellable unit, identified by physical facts — never by brand name.
--
-- Goldstar 6×330ml can and Goldstar 6×500ml bottle share a brand and nothing
-- else, so they are two rows. `unique (…)` is what makes "the same product" mean
-- the same container, the same volume and the same pack size.
-- --------------------------------------------------------------------------

create table public.skus (
  id              uuid primary key default gen_random_uuid(),
  beer_id         uuid not null references public.beers (id) on delete restrict,
  container       public.container_type not null,
  volume_ml       integer not null check (volume_ml between 50 and 100000),
  pack_quantity   integer not null default 1 check (pack_quantity between 1 and 96),
  total_volume_ml integer generated always as (volume_ml * pack_quantity) stored,
  display_he      text not null check (char_length(trim(display_he)) between 1 and 120),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (beer_id, container, volume_ml, pack_quantity)
);

create index skus_beer_idx on public.skus (beer_id) where is_active;

-- Many barcodes (GTINs, or a chain's internal code) can point at one SKU. A chain
-- code is only meaningful inside its chain, hence the optional store scope.
create table public.sku_barcodes (
  id         uuid primary key default gen_random_uuid(),
  sku_id     uuid not null references public.skus (id) on delete cascade,
  barcode    text not null check (barcode ~ '^[0-9A-Za-z._-]{3,40}$'),
  store_id   uuid references public.stores (id) on delete cascade,
  is_gtin    boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index sku_barcodes_key
  on public.sku_barcodes (barcode, coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index sku_barcodes_sku_idx on public.sku_barcodes (sku_id);

-- --------------------------------------------------------------------------
-- Chains and branches.
--
-- `stores` stays "chains, not branches". It only gains a kind, because two seeded
-- rows were never chains at all: "liquor store" and "neighbourhood shop" are
-- categories of shop, and a price feed can never come from them.
-- --------------------------------------------------------------------------

alter table public.stores
  add column kind text not null default 'chain' check (kind in ('chain', 'independent', 'category'));

update public.stores set kind = 'category' where slug in ('liquor-store', 'makolet') and kind = 'chain';

create table public.branches (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores (id) on delete cascade,
  external_ref text,                       -- the chain's own id for the branch
  name_he      text,
  city         text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (store_id, external_ref)
);

create index branches_store_idx on public.branches (store_id) where is_active;

-- --------------------------------------------------------------------------
-- Where a price came from.
-- --------------------------------------------------------------------------

create table public.sources (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name       text not null,
  kind       public.source_kind not null,
  -- 0..100. Only kinds 'chain_feed' and 'admin' may serve as the reference for a
  -- discount percentage; this number is for ranking conflicting sources later.
  trust      smallint not null default 50 check (trust between 0 and 100),
  created_at timestamptz not null default now()
);

insert into public.sources (slug, name, kind, trust) values
  ('admin',           'Entered by an administrator', 'admin',           90),
  ('user-submission', 'Submitted by a user',         'user_submission', 40),
  -- Invented prices for development and staging (supabase/seed/dev-catalog.sql).
  -- Everything recorded under this source is flagged is_sample in the read views,
  -- and a production server never shows it (src/lib/demo.ts).
  ('sample-data',     'Sample data (dev/staging only)', 'admin',        10)
on conflict (slug) do nothing;

-- One row per import, so a bad run can be found and undone as a unit.
create table public.ingestion_runs (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references public.sources (id) on delete restrict,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'rolled_back')),
  stats       jsonb not null default '{}'::jsonb
);

create index ingestion_runs_source_idx on public.ingestion_runs (source_id, started_at desc);

-- --------------------------------------------------------------------------
-- The price ledger. APPEND-ONLY.
--
-- Regular prices and promotions are the same kind of fact — "at this time, at
-- this place, from this source, this SKU cost this much" — distinguished by
-- `kind`. A price change is a NEW row; the old one becomes `superseded`. Rows
-- are never updated (except their status) and never deleted, so history, audit
-- and rollback come for free.
--
--   price_agorot   the price of ONE pack (whole agorot, like everywhere else).
--                  For a multi-buy ("2 for ₪45") it is the effective per-pack
--                  price, ceil(45.00/2); `conditions.multi_buy` keeps the truth.
--   observed_at    when the source said so. Not when we stored it.
--   valid_from/to  a promotion's window. NULL valid_to = end unknown (such a
--                  promotion stops being shown a week after it was last seen).
--   conditions     {min_qty, max_qty, multi_buy:{qty,total_agorot}, club, coupon,
--                   note_he} — structured, not free text.
--   identity_key   what makes two rows "the same offer, updated": 'regular' for
--                  regular prices; the chain's promotion id, or a hash of the
--                  promotion's terms.
--   content_hash   idempotency: replaying the same source record adds nothing.
-- --------------------------------------------------------------------------

create table public.price_observations (
  id           bigint generated always as identity primary key,
  sku_id       uuid not null references public.skus (id) on delete restrict,
  store_id     uuid not null references public.stores (id) on delete restrict,
  branch_id    uuid references public.branches (id) on delete restrict,
  kind         public.price_kind not null,
  price_agorot integer not null check (price_agorot > 0),
  observed_at  timestamptz not null,
  valid_from   timestamptz,
  valid_to     timestamptz,
  promo_type   public.promo_type,
  conditions   jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),
  identity_key text not null,
  source_id    uuid not null references public.sources (id) on delete restrict,
  run_id       uuid references public.ingestion_runs (id) on delete restrict,
  natural_key  text,
  content_hash text,
  raw          jsonb,
  status       text not null default 'live' check (status in ('live', 'held', 'superseded', 'rejected')),
  superseded_by bigint references public.price_observations (id),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),

  -- A promotion says what kind it is; a regular price is not a promotion and has
  -- no end date of its own.
  constraint price_obs_kind_shape check (
    (kind = 'promotion' and promo_type is not null)
    or (kind = 'regular' and promo_type is null and valid_to is null)
  ),
  constraint price_obs_window check (valid_to is null or valid_from is null or valid_to > valid_from),

  -- A multi-buy must carry its terms, and the stored per-pack price must be
  -- exactly what those terms imply — so the two can never disagree.
  constraint price_obs_multi_buy check (
    promo_type is distinct from 'multi_buy'
    or (
      coalesce((conditions #>> '{multi_buy,qty}')::int >= 2, false)
      and coalesce((conditions #>> '{multi_buy,total_agorot}')::int > 0, false)
      and price_agorot = ceil((conditions #>> '{multi_buy,total_agorot}')::numeric / (conditions #>> '{multi_buy,qty}')::int)
    )
  )
);

-- Replaying a source record is a no-op.
create unique index price_obs_idempotent on public.price_observations (source_id, content_hash)
  where content_hash is not null;

-- "What is the current regular price / promotion for this SKU at this chain?"
create index price_obs_lookup on public.price_observations (sku_id, store_id, kind, observed_at desc)
  where status = 'live';

create index price_obs_identity on public.price_observations (sku_id, store_id, kind, identity_key);
create index price_obs_run on public.price_observations (run_id) where run_id is not null;
