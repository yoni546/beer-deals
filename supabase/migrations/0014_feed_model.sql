-- ---------------------------------------------------------------------------
-- 0014 · The model the real feeds need
--
-- The ingestion dry run on six chains' real files (docs/INGESTION-DRY-RUN.md, 2026-09-29) found
-- seven places where the feeds and the catalogue model disagreed. This migration closes them.
-- Every change is additive: new tables and columns, views rebuilt, functions extended. No row is
-- deleted or rewritten.
--
--  1. Product category.   A pack is beer, non-alcoholic beer or radler (shown), or malt drink or
--                         cider (kept out for now). Explicit, so a category can be switched on
--                         later without bending the beer schema.
--  2. Variant.            "גולדסטאר לא מסונן" and "גולדסטאר" in the same 500 ml can are different
--                         products; the SKU identity now includes the variant.
--  3. Feed identity.      A feed's publisher is not always the retailer (Carrefour's feed carries
--                         a Yeinot Bitan branch; Dor Alon's carries AM:PM). Branches keep the
--                         feed's own chain / sub-chain / store codes and point at the retailer.
--  4. Source products.    Every product a feed lists, by (publisher, item code): the raw name, the
--                         SKU it was matched to — or why it was not (the review queue).
--  5. Audience.           Only offers everyone can redeem are shown. Club, payment-method, coupon
--                         and personal offers are recorded for provenance but never published.
--  6. Deposit.            Shelf prices exclude the bottle deposit (₪0.30 a container); kept apart
--                         so it can be shown ("+ ₪1.80 פיקדון") and never distort a saving.
--  7. Group promotions.   "Any 3 of these for ₪30" is ONE offer across several SKUs, not a ₪10
--                         price for each.
--  8. Chain vs branch.    Prices stay per branch. The app reads one row per pack × chain: the
--                         lowest price among branches ("החל מ־"), how many branches, and whether
--                         they differ. No chain-wide price is invented.
--
-- Rollback (reverse order): restore the views, the enqueue trigger function and
-- rollback_ingestion_run from 0009/0011/0013; drop record_promotion_group, is_universal_offer,
-- promotion_group_items, promotion_groups, source_products; drop the new columns of
-- price_observations, branches, skus and beers; restore the old SKU unique constraint; drop
-- product_categories. Feed sources inserted below can stay (they are reference data).
-- ---------------------------------------------------------------------------

-- 1. Categories ---------------------------------------------------------------

create table public.product_categories (
  slug       text primary key check (slug ~ '^[a-z_]+$'),
  name_he    text not null,
  in_scope   boolean not null,
  sort_order smallint not null default 0
);

insert into public.product_categories (slug, name_he, in_scope, sort_order) values
  ('beer',          'בירה',               true,  1),
  ('non_alcoholic', 'בירה ללא אלכוהול',   true,  2),
  ('radler',        'רדלר',               true,  3),
  ('malt',          'משקה מאלט',          false, 4),
  ('cider',         'סיידר',              false, 5);

alter table public.beers
  add column category text not null default 'beer' references public.product_categories (slug);

-- Somersby is a cider: out of scope for now. People who already chose it keep it (nothing is
-- removed); new lists and prices leave it out.
update public.beers set category = 'cider' where slug = 'somersby';

-- 2. Variant + category per pack ---------------------------------------------

alter table public.skus
  add column variant  text not null default '' check (char_length(variant) <= 40),
  add column category text not null default 'beer' references public.product_categories (slug);

alter table public.skus drop constraint skus_beer_id_container_volume_ml_pack_quantity_key;
alter table public.skus
  add constraint skus_identity unique (beer_id, variant, container, volume_ml, pack_quantity);

-- 3. Feed identity on branches -----------------------------------------------

alter table public.branches
  add column feed_chain_code     text check (feed_chain_code ~ '^[0-9]{13}$'),
  add column feed_sub_chain_code text,
  add column feed_store_code     text,
  add column address             text,
  add column last_seen_at        timestamptz;

create unique index branches_feed_identity
  on public.branches (feed_chain_code, coalesce(feed_sub_chain_code, ''), feed_store_code)
  where feed_chain_code is not null;

-- One source per publisher. Trust = what the law requires them to publish.
insert into public.sources (slug, name, kind, trust) values
  ('feed-carrefour',   'Carrefour Israel price feed (Carrefour, Yeinot Bitan)', 'chain_feed', 80),
  ('feed-shufersal',   'Shufersal price feed',     'chain_feed', 80),
  ('feed-rami-levy',   'Rami Levy price feed',     'chain_feed', 80),
  ('feed-yochananof',  'Yochananof price feed',    'chain_feed', 80),
  ('feed-osher-ad',    'Osher Ad price feed',      'chain_feed', 80),
  ('feed-tiv-taam',    'Tiv Taam price feed',      'chain_feed', 80),
  ('feed-victory',     'Victory price feed',       'chain_feed', 80),
  ('feed-mahsanei',    'Mahsanei HaShuk price feed', 'chain_feed', 80),
  ('feed-hatzi-hinam', 'Hatzi Hinam price feed',   'chain_feed', 80),
  ('feed-king-store',  'King Store price feed',    'chain_feed', 80),
  ('feed-dor-alon',    'Dor Alon price feed (AM:PM)', 'chain_feed', 80)
on conflict (slug) do nothing;

-- 4. Source products: the alias table and the review queue --------------------

create table public.source_products (
  id              bigint generated always as identity primary key,
  feed_chain_code text not null check (feed_chain_code ~ '^[0-9]{13}$'),
  item_code       text not null check (char_length(item_code) between 1 and 40),
  raw_name        text not null,
  manufacturer    text,
  sku_id          uuid references public.skus (id) on delete set null,
  -- matched: priced as sku_id · review: a human must decide · ignored: not in scope
  status          text not null default 'review' check (status in ('matched', 'review', 'ignored')),
  match_basis     text check (match_basis in ('rules', 'barcode', 'admin')),
  reason          text,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  unique (feed_chain_code, item_code),
  constraint source_products_matched_has_sku check (status <> 'matched' or sku_id is not null)
);

create index source_products_review_idx on public.source_products (status, last_seen_at desc) where status = 'review';

alter table public.source_products enable row level security;
grant select, update on public.source_products to authenticated;
create policy source_products_admin on public.source_products for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.source_products to service_role;

-- 5 + 6. Audience and deposit on the ledger ----------------------------------
-- Stored in `conditions` (the ledger's structured terms) and exposed as typed columns, so
-- record_price() and record_prices() keep their signatures:
--   conditions.audience  everyone | club | payment | coupon | personal | restricted
--   conditions.deposit   {agorot, included, basis}

alter table public.price_observations
  add column audience text generated always as (coalesce(conditions ->> 'audience', 'everyone')) stored,
  add column deposit_agorot integer generated always as ((conditions #>> '{deposit,agorot}')::integer) stored,
  add column deposit_included boolean generated always as ((conditions #>> '{deposit,included}')::boolean) stored;

alter table public.price_observations
  add constraint price_obs_audience check (audience in ('everyone', 'club', 'payment', 'coupon', 'personal', 'restricted')),
  add constraint price_obs_deposit check (deposit_agorot is null or deposit_agorot between 0 and 5000);

-- The append-only guard (0008) compares whole rows. In a BEFORE UPDATE trigger generated columns
-- are not computed yet, so it must skip them — safely: they are derived from `conditions`, which
-- it still compares.
create or replace function public.price_observations_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'price observations are append-only; mark a bad row rejected instead'
      using errcode = '42501';
  end if;

  if (to_jsonb(new) - 'status' - 'superseded_by' - 'created_by' - 'audience' - 'deposit_agorot' - 'deposit_included')
     is distinct from
     (to_jsonb(old) - 'status' - 'superseded_by' - 'created_by' - 'audience' - 'deposit_agorot' - 'deposit_included') then
    raise exception 'price observations are append-only; record a new observation instead of editing one'
      using errcode = '42501';
  end if;

  if old.status in ('superseded', 'rejected') and new.status is distinct from old.status then
    raise exception 'a % observation cannot change status again', old.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Who may redeem an offer. Everything the old model already knew as restricted counts too.
create or replace function public.is_universal_offer(p_promo_type public.promo_type, p_conditions jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(p_conditions ->> 'audience', 'everyone') = 'everyone'
     and p_promo_type is distinct from 'club_price'
     and p_promo_type is distinct from 'coupon'
     -- conditions.club names the club ("שופרסל פלוס"); any value at all means members only
     and coalesce(nullif(p_conditions ->> 'club', ''), 'false') = 'false'
     and coalesce(p_conditions ->> 'coupon', 'false') = 'false'
$$;

grant execute on function public.is_universal_offer(public.promo_type, jsonb) to anon, authenticated, service_role;

-- 7. Group promotions ---------------------------------------------------------

create table public.promotion_groups (
  id              bigint generated always as identity primary key,
  store_id        uuid not null references public.stores (id) on delete restrict,
  branch_id       uuid references public.branches (id) on delete restrict,
  source_id       uuid not null references public.sources (id) on delete restrict,
  run_id          uuid references public.ingestion_runs (id) on delete restrict,
  natural_key     text not null,                 -- the chain's promotion id
  description_he  text not null check (char_length(description_he) between 1 and 200),
  required_qty    integer not null check (required_qty between 2 and 48),
  total_agorot    integer not null check (total_agorot > 0),
  audience        text not null default 'everyone' check (audience in ('everyone', 'club', 'payment', 'coupon', 'personal', 'restricted')),
  deposit_agorot  integer check (deposit_agorot between 0 and 5000),   -- per unit, when known
  deposit_included boolean,
  valid_from      timestamptz,
  valid_to        timestamptz,
  observed_at     timestamptz not null,
  status          text not null default 'live' check (status in ('live', 'held', 'superseded', 'rejected')),
  raw             jsonb,
  content_hash    text,
  created_at      timestamptz not null default now(),
  constraint promotion_groups_window check (valid_to is null or valid_from is null or valid_to > valid_from)
);

create unique index promotion_groups_idempotent on public.promotion_groups (source_id, content_hash) where content_hash is not null;
create index promotion_groups_live on public.promotion_groups (store_id, natural_key) where status = 'live';

create table public.promotion_group_items (
  group_id bigint not null references public.promotion_groups (id) on delete cascade,
  sku_id   uuid not null references public.skus (id) on delete restrict,
  primary key (group_id, sku_id)
);

alter table public.promotion_groups enable row level security;
alter table public.promotion_group_items enable row level security;
grant select on public.promotion_groups, public.promotion_group_items to anon, authenticated, service_role;
create policy promotion_groups_read_live on public.promotion_groups for select to anon, authenticated using (status = 'live');
create policy promotion_groups_read_admin on public.promotion_groups for select to authenticated using (public.is_admin());
create policy promotion_group_items_read on public.promotion_group_items for select to anon, authenticated using (true);

-- The only way in (like record_price for single-SKU prices). A new live group supersedes the
-- previous live one with the same chain promotion at the same branch.
create or replace function public.record_promotion_group(
  p_source_slug text,
  p_group       jsonb,
  p_run_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.sources;
  v_id     bigint;
  v_skus   uuid[];
  v_status text := coalesce(p_group ->> 'status', 'live');
  v_aud    text := coalesce(p_group ->> 'audience', 'everyone');
begin
  perform public.require_price_writer();

  select * into v_source from public.sources where slug = p_source_slug;
  if not found then
    raise exception 'unknown source %', p_source_slug using errcode = 'P0002';
  end if;
  if v_status not in ('live', 'held') then
    raise exception 'status must be live or held' using errcode = '22023';
  end if;
  -- A restricted offer is kept for the record, never published.
  if v_aud <> 'everyone' then
    v_status := 'held';
  end if;

  select array_agg(distinct s::uuid) into v_skus from jsonb_array_elements_text(p_group -> 'sku_ids') s;
  if v_skus is null or array_length(v_skus, 1) < 2 then
    raise exception 'a group promotion needs at least two different SKUs (one SKU is a multi_buy price)' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_skus) s where not exists (select 1 from public.skus k where k.id = s and k.is_active)) then
    raise exception 'unknown or inactive sku in the group' using errcode = 'P0002';
  end if;

  if p_group ? 'content_hash' then
    select id into v_id from public.promotion_groups where source_id = v_source.id and content_hash = p_group ->> 'content_hash';
    if found then
      return jsonb_build_object('id', v_id, 'replayed', true);
    end if;
  end if;

  insert into public.promotion_groups (
    store_id, branch_id, source_id, run_id, natural_key, description_he, required_qty, total_agorot,
    audience, deposit_agorot, deposit_included, valid_from, valid_to, observed_at, status, raw, content_hash
  ) values (
    (p_group ->> 'store_id')::uuid, (p_group ->> 'branch_id')::uuid, v_source.id, p_run_id,
    p_group ->> 'natural_key', p_group ->> 'description_he',
    (p_group ->> 'required_qty')::integer, (p_group ->> 'total_agorot')::integer,
    v_aud, (p_group ->> 'deposit_agorot')::integer, (p_group ->> 'deposit_included')::boolean,
    (p_group ->> 'valid_from')::timestamptz, (p_group ->> 'valid_to')::timestamptz,
    (p_group ->> 'observed_at')::timestamptz, v_status, p_group -> 'raw', p_group ->> 'content_hash'
  )
  returning id into v_id;

  insert into public.promotion_group_items (group_id, sku_id) select v_id, s from unnest(v_skus) s;

  if v_status = 'live' then
    update public.promotion_groups g
       set status = 'superseded'
     where g.store_id = (p_group ->> 'store_id')::uuid
       and g.branch_id is not distinct from (p_group ->> 'branch_id')::uuid
       and g.natural_key = p_group ->> 'natural_key'
       and g.status = 'live'
       and g.id <> v_id
       and g.observed_at <= (p_group ->> 'observed_at')::timestamptz;
  end if;

  return jsonb_build_object('id', v_id, 'replayed', false, 'status', v_status);
end;
$$;

revoke all on function public.record_promotion_group(text, jsonb, uuid) from public, anon;
grant execute on function public.record_promotion_group(text, jsonb, uuid) to authenticated, service_role;

-- 8. The read model -----------------------------------------------------------
-- Rebuilt so that everything the app reads is: in scope, redeemable by everyone, one row per
-- pack × chain, with the deposit alongside.

drop view if exists public.offers_feed;
drop view if exists public.offers_ranked;
drop view if exists public.regular_prices_feed;

-- Live promotions in force now, redeemable by everyone.
create or replace view public.promotions_current
with (security_invoker = on)
as
select o.*
  from public.price_observations o
 where o.kind = 'promotion'
   and o.status = 'live'
   and public.is_universal_offer(o.promo_type, o.conditions)
   and (o.valid_from is null or o.valid_from <= now())
   and (
     (o.valid_to is not null and o.valid_to > now())
     or (o.valid_to is null and o.observed_at > now() - interval '7 days')
   );

create view public.offers_ranked
with (security_invoker = on)
as
select
  o.id                                   as observation_id,
  o.sku_id,
  s.beer_id,
  be.slug                                as beer_slug,
  be.name_he                             as beer_name,
  be.name_en                             as beer_name_en,
  s.variant,
  s.category,
  br.slug                                as brand_slug,
  s.container,
  s.volume_ml,
  s.pack_quantity,
  s.total_volume_ml,
  s.display_he                           as sku_name,
  o.store_id,
  st.slug                                as store_slug,
  st.name_he                             as store_name,
  o.branch_id,
  o.identity_key,
  o.promo_type,
  o.conditions,
  o.deposit_agorot,
  o.deposit_included,
  o.valid_from,
  o.valid_to,
  o.observed_at,
  (psrc.slug = 'sample-data')            as is_sample,
  o.price_agorot                         as effective_agorot,
  round(o.price_agorot::numeric * 1000 / s.total_volume_ml)::integer as unit_price_per_liter_agorot,
  ref.price_agorot                       as reference_agorot,
  ref.observed_at                        as reference_observed_at,
  ref.trust                              as reference_trust,
  case when pct.raw between 1 and 70 then pct.raw end as value_pct,
  coalesce(pct.raw > 70, false)          as needs_review,
  mk.median_agorot                       as market_reference_agorot,
  mk.chains                              as market_chains,
  case when mk.median_agorot > o.price_agorot
       then round((mk.median_agorot - o.price_agorot) * 100.0 / mk.median_agorot)::integer
  end                                    as market_value_pct
from public.promotions_current o
join public.skus   s  on s.id  = o.sku_id
join public.product_categories pc on pc.slug = s.category and pc.in_scope
join public.beers  be on be.id = s.beer_id
join public.brands br on br.id = be.brand_id
join public.stores st on st.id = o.store_id
join public.sources psrc on psrc.id = o.source_id
left join lateral (
  -- The reference is the same pack at the same chain (same branch first), with the deposit
  -- treated the same way on both sides: a deposit difference is never a "saving".
  select r.price_agorot
         + case when coalesce(r.deposit_included, false) = coalesce(o.deposit_included, false) then 0
                when coalesce(r.deposit_included, false) then -coalesce(r.deposit_agorot, 0)
                else coalesce(r.deposit_agorot, 0) end as price_agorot,
         r.observed_at,
         case src.kind when 'chain_feed' then 'feed' when 'admin' then 'moderated' else 'unverified' end as trust
    from public.price_observations r
    join public.sources src on src.id = r.source_id
   where r.kind = 'regular' and r.status = 'live'
     and r.sku_id = o.sku_id
     and r.store_id = o.store_id
     and (r.branch_id is null or r.branch_id is not distinct from o.branch_id)
     and r.observed_at >= now() - interval '14 days'
   order by (r.branch_id is not distinct from o.branch_id) desc, r.observed_at desc, r.id desc
   limit 1
) ref on true
left join lateral (
  select round((ref.price_agorot - o.price_agorot) * 100.0 / ref.price_agorot)::integer as raw
   where ref.trust in ('feed', 'moderated') and ref.price_agorot > o.price_agorot
) pct on true
left join lateral (
  select (percentile_cont(0.5) within group (order by m.price_agorot))::integer as median_agorot,
         count(*)::integer as chains
    from (
      -- one number per other chain: its lowest current regular price for this pack
      select min(r.price_agorot) as price_agorot
        from public.regular_prices_current r
        join public.sources src on src.id = r.source_id and src.kind in ('chain_feed', 'admin')
       where r.sku_id = o.sku_id
         and r.store_id <> o.store_id
         and r.observed_at >= now() - interval '14 days'
       group by r.store_id
    ) m
  having count(*) >= 2
) mk on true;

-- One row per offer per chain: the same chain promotion at several branches is ONE offer
-- (the cheapest branch's terms), with the number of branches it was seen at.
create view public.offers_feed
with (security_invoker = on)
as
select
  'obs:' || o.observation_id::text          as offer_key,
  'catalog'::text                           as origin,
  o.sku_id,
  o.beer_id, o.beer_slug, o.beer_name,
  o.store_id, o.store_slug, o.store_name,
  o.sku_name                                as pack_label,
  o.container, o.volume_ml, o.pack_quantity,
  o.effective_agorot,
  o.unit_price_per_liter_agorot,
  o.reference_agorot,
  o.reference_trust,
  o.value_pct,
  o.needs_review,
  o.market_reference_agorot,
  o.market_value_pct,
  o.promo_type,
  o.conditions,
  o.valid_from, o.valid_to,
  o.observed_at,
  o.is_sample,
  o.conditions ->> 'note_he'                as notes,
  o.variant,
  o.category,
  o.deposit_agorot,
  o.deposit_included,
  o.branch_count
from (
  select distinct on (r.sku_id, r.store_id, r.identity_key)
         r.*,
         count(*) over (partition by r.sku_id, r.store_id, r.identity_key)::integer as branch_count
    from public.offers_ranked r
   order by r.sku_id, r.store_id, r.identity_key, r.effective_agorot, r.value_pct desc nulls last, r.observed_at desc
) o

union all

select
  'deal:' || d.id::text,
  'legacy',
  null::uuid,
  d.beer_id, d.beer_slug, d.beer_name,
  d.store_id, d.store_slug, d.store_name,
  case d.category when 'sixpack' then 'שישייה' when 'case' then 'ארגז' else 'בודד' end,
  null::public.container_type, null::integer, null::integer,
  d.deal_price_agorot,
  null::integer,
  d.regular_price_agorot,
  'moderated',
  case when d.discount_percent between 1 and 70 then d.discount_percent end,
  d.discount_percent > 70,
  null::integer, null::integer,
  null::public.promo_type,
  '{}'::jsonb,
  null::timestamptz, null::timestamptz,
  d.approved_at,
  coalesce(d.notes = 'מבצע לדוגמה', false),
  d.notes,
  '',
  'beer',
  null::integer,
  null::boolean,
  1
from public.deals_public d;

-- Regular prices, one row per pack × chain. Branches are not averaged or invented into a
-- "chain price": the row carries the LOWEST current price among the chain's branches, the
-- highest, and how many branches were seen — the app says "החל מ־" when they differ.
create view public.regular_prices_feed
with (security_invoker = on)
as
with latest as (
  select r.*, s.beer_id, s.container, s.volume_ml, s.pack_quantity, s.total_volume_ml,
         s.display_he, s.variant, s.category, o.deposit_agorot, o.deposit_included,
         case src.kind when 'chain_feed' then 'feed' when 'admin' then 'moderated' else 'unverified' end as trust
    from public.regular_prices_current r
    join public.price_observations o on o.id = r.id
    join public.skus s on s.id = r.sku_id
    join public.product_categories pc on pc.slug = s.category and pc.in_scope
    join public.sources src on src.id = r.source_id
)
select distinct on (l.sku_id, l.store_id)
  l.id                        as observation_id,
  l.sku_id,
  l.beer_id,
  be.slug                     as beer_slug,
  be.name_he                  as beer_name,
  l.container,
  l.volume_ml,
  l.pack_quantity,
  l.display_he                as pack_label,
  l.store_id,
  st.slug                     as store_slug,
  st.name_he                  as store_name,
  l.branch_id,
  l.price_agorot,
  round(l.price_agorot::numeric * 1000 / l.total_volume_ml)::integer as unit_price_per_liter_agorot,
  l.observed_at,
  l.is_sample,
  l.trust,
  (l.observed_at < now() - interval '14 days') as is_stale,
  l.variant,
  l.category,
  l.deposit_agorot,
  l.deposit_included,
  count(*) over w::integer                     as branch_count,
  (max(l.price_agorot) over w)::integer        as max_price_agorot
from latest l
join public.beers  be on be.id = l.beer_id
join public.stores st on st.id = l.store_id
window w as (partition by l.sku_id, l.store_id)
-- fresh prices first, then the cheapest branch
order by l.sku_id, l.store_id, (l.observed_at < now() - interval '14 days'), l.price_agorot, l.observed_at desc;

-- Group promotions in force, redeemable by everyone, one row per chain promotion (cheapest
-- branch), with the eligible packs.
create view public.group_offers_feed
with (security_invoker = on)
as
select distinct on (g.store_id, g.natural_key)
  'grp:' || g.id::text                       as offer_key,
  g.id                                       as group_id,
  g.store_id,
  st.slug                                    as store_slug,
  st.name_he                                 as store_name,
  g.description_he,
  g.required_qty,
  g.total_agorot,
  ceil(g.total_agorot::numeric / g.required_qty)::integer as per_unit_agorot,
  g.deposit_agorot,
  g.deposit_included,
  g.valid_from,
  g.valid_to,
  g.observed_at,
  (src.slug = 'sample-data')                 as is_sample,
  items.beer_ids,
  items.beer_slugs,
  items.packs,
  count(*) over (partition by g.store_id, g.natural_key)::integer as branch_count
from public.promotion_groups g
join public.stores  st  on st.id  = g.store_id
join public.sources src on src.id = g.source_id
cross join lateral (
  select array_agg(distinct k.beer_id)  as beer_ids,
         array_agg(distinct be.slug)    as beer_slugs,
         jsonb_agg(jsonb_build_object('sku_id', k.id, 'beer_slug', be.slug, 'beer_name', be.name_he, 'label', k.display_he,
                                      'container', k.container, 'volume_ml', k.volume_ml, 'pack_quantity', k.pack_quantity)
                   order by be.slug, k.volume_ml, k.pack_quantity) as packs
    from public.promotion_group_items gi
    join public.skus k on k.id = gi.sku_id
    join public.product_categories pc on pc.slug = k.category and pc.in_scope
    join public.beers be on be.id = k.beer_id
   where gi.group_id = g.id
) items
where g.status = 'live'
  and g.audience = 'everyone'
  and items.packs is not null
  and (g.valid_from is null or g.valid_from <= now())
  and ((g.valid_to is not null and g.valid_to > now()) or (g.valid_to is null and g.observed_at > now() - interval '7 days'))
order by g.store_id, g.natural_key, g.total_agorot, g.observed_at desc;

grant select on public.promotions_current, public.offers_ranked, public.offers_feed, public.regular_prices_feed,
  public.group_offers_feed, public.product_categories to anon, authenticated, service_role;

alter table public.product_categories enable row level security;
create policy product_categories_read on public.product_categories for select to anon, authenticated using (true);

-- 9. Notifications: only offers everyone can use, and only packs in scope ---------

create or replace function public.enqueue_promotion_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'promotion' or new.status <> 'live' then
    return new;
  end if;
  if new.raw ? 'restored_from' then
    return new;
  end if;
  if not public.is_universal_offer(new.promo_type, new.conditions) then
    return new;
  end if;
  if exists (select 1 from public.sources s where s.id = new.source_id and s.slug = 'sample-data') then
    return new;
  end if;

  insert into public.notification_events (dedupe_key, offer_key, beer_id, expires_at)
  select 'promo:' || new.sku_id || ':' || new.store_id || ':' || new.identity_key || ':' || new.price_agorot
                   || ':' || coalesce(new.valid_from::date::text, ''),
         'obs:' || new.id,
         k.beer_id,
         coalesce(new.valid_to, now() + interval '24 hours')
    from public.skus k
    join public.product_categories pc on pc.slug = k.category and pc.in_scope
   where k.id = new.sku_id
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

-- 10. Rollback covers group promotions too ------------------------------------

create or replace function public.rollback_ingestion_run(p_run_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run      public.ingestion_runs;
  v_bad      public.price_observations;
  v_cur      public.price_observations;
  v_prev     public.price_observations;
  v_rejected integer := 0;
  v_restored integer := 0;
  v_groups   integer := 0;
begin
  if not (public.is_super_admin() or current_setting('role', true) = 'service_role') then
    raise exception 'super admin or service privileges required' using errcode = '42501';
  end if;

  select * into v_run from public.ingestion_runs where id = p_run_id for update;
  if not found then
    raise exception 'unknown ingestion run %', p_run_id using errcode = 'P0002';
  end if;
  if v_run.status = 'rolled_back' then
    return v_run.stats -> 'rollback';
  end if;

  for v_bad in
    select * from public.price_observations
     where run_id = p_run_id and status in ('live', 'held')
     order by id
  loop
    perform pg_advisory_xact_lock(hashtext(v_bad.sku_id::text || v_bad.store_id::text));
    update public.price_observations set status = 'rejected' where id = v_bad.id;
    v_rejected := v_rejected + 1;

    if v_bad.status = 'live' then
      v_cur := v_bad;
      loop
        select * into v_prev from public.price_observations p
         where p.superseded_by = v_cur.id
         order by p.observed_at desc, p.id desc limit 1;
        exit when not found;
        exit when v_prev.run_id is distinct from p_run_id;
        v_cur := v_prev;
      end loop;

      if found and v_prev.status = 'superseded' then
        insert into public.price_observations (
          sku_id, store_id, branch_id, kind, price_agorot, observed_at, valid_from, valid_to,
          promo_type, conditions, identity_key, source_id, run_id, natural_key, content_hash,
          raw, status, created_by
        ) values (
          v_prev.sku_id, v_prev.store_id, v_prev.branch_id, v_prev.kind, v_prev.price_agorot,
          v_prev.observed_at, v_prev.valid_from, v_prev.valid_to,
          v_prev.promo_type, v_prev.conditions, v_prev.identity_key, v_prev.source_id, null, v_prev.natural_key, null,
          jsonb_build_object('restored_from', v_prev.id, 'rollback_of_run', p_run_id),
          'live', auth.uid()
        );
        v_restored := v_restored + 1;
      end if;
    end if;
  end loop;

  -- Group promotions of the run: rejected. (A group superseded by this run is not restored: the
  -- next import re-records the chain's current promotions, and a group's window is short.)
  update public.promotion_groups set status = 'rejected'
   where run_id = p_run_id and status in ('live', 'held');
  get diagnostics v_groups = row_count;

  update public.notification_events e
     set status = 'done', outcome = 'rolled_back', processed_at = now()
   where e.status = 'pending'
     and e.offer_key in (select 'obs:' || o.id from public.price_observations o where o.run_id = p_run_id);

  update public.ingestion_runs
     set status = 'rolled_back',
         finished_at = coalesce(finished_at, now()),
         stats = stats || jsonb_build_object(
           'rollback', jsonb_build_object('rejected', v_rejected, 'restored', v_restored, 'groups_rejected', v_groups,
                                          'reason', p_reason, 'at', now())
         )
   where id = p_run_id;

  return jsonb_build_object('rejected', v_rejected, 'restored', v_restored, 'groups_rejected', v_groups, 'reason', p_reason);
end;
$$;

-- The service role manages its own run's branches, SKUs and review queue (0008 granted insert and
-- update on skus and branches already).
grant select on public.product_categories to service_role;
