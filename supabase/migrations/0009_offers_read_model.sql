-- ---------------------------------------------------------------------------
-- 0009 — catalogue model, part 3 of 3: what the app reads.
--
-- Views only (security_invoker: they run with the caller's permissions, so the
-- RLS on the ledger is what keeps unpublished rows out, not the WHERE clauses).
--
--   regular_prices_current   the latest live regular price per SKU × chain × branch
--   promotions_current       live promotions that are in force RIGHT NOW
--   offers_ranked            those promotions, with unit price, a verified
--                            discount % and a market comparison
--   offers_feed              offers_ranked + the legacy `deals`, in one shape,
--                            so the app has a single thing to read while the old
--                            submission/moderation flow is still in use
--
-- HOW A DISCOUNT % IS DERIVED — and when it is deliberately NOT.
-- The old model stored a percentage computed from whatever "regular price" a
-- person typed. A percentage is a claim about savings, so it is only produced
-- when the reference price can be trusted:
--   * the reference is the current regular price of the SAME SKU at the SAME
--     chain, seen within the last 14 days (older = unknown, not "still true");
--   * it came from a chain feed or an administrator (never a raw user report);
--   * the promotion is actually cheaper than it;
--   * the result is at most 70 % — beyond that it is far more likely a bad
--     barcode or unit mismatch than a real bargain, so it is held for review
--     (`needs_review`) instead of being shown.
-- Everything else gets NULL, and the UI shows the price without a "you save".
--
-- A second, independent number compares against the MEDIAN regular price of the
-- same SKU at other chains (`market_value_pct`, needs at least two other chains).
-- A chain cannot inflate its own "before" price to fake that one.
-- ---------------------------------------------------------------------------

create view public.regular_prices_current
with (security_invoker = on)
as
select distinct on (o.sku_id, o.store_id, o.branch_id)
       o.id, o.sku_id, o.store_id, o.branch_id, o.price_agorot, o.observed_at, o.source_id,
       (src.slug = 'sample-data') as is_sample
  from public.price_observations o
  join public.sources src on src.id = o.source_id
 where o.kind = 'regular' and o.status = 'live'
 order by o.sku_id, o.store_id, o.branch_id, o.observed_at desc, o.id desc;

-- A promotion is in force when its window has started and not ended. One with no
-- end date is only trusted for a week after it was last seen: "unknown" must not
-- turn into "forever".
create view public.promotions_current
with (security_invoker = on)
as
select o.*
  from public.price_observations o
 where o.kind = 'promotion'
   and o.status = 'live'
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
  be.variant,
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
  o.promo_type,
  o.conditions,
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
join public.beers  be on be.id = s.beer_id
join public.brands br on br.id = be.brand_id
join public.stores st on st.id = o.store_id
join public.sources psrc on psrc.id = o.source_id
left join lateral (
  select r.price_agorot, r.observed_at,
         case src.kind when 'chain_feed' then 'feed' when 'admin' then 'moderated' else 'unverified' end as trust
    from public.regular_prices_current r
    join public.sources src on src.id = r.source_id
   where r.sku_id = o.sku_id
     and r.store_id = o.store_id
     and (r.branch_id is null or r.branch_id is not distinct from o.branch_id)
     and r.observed_at >= now() - interval '14 days'
   order by (r.branch_id is not distinct from o.branch_id) desc, r.observed_at desc
   limit 1
) ref on true
left join lateral (
  select round((ref.price_agorot - o.price_agorot) * 100.0 / ref.price_agorot)::integer as raw
   where ref.trust in ('feed', 'moderated') and ref.price_agorot > o.price_agorot
) pct on true
left join lateral (
  select (percentile_cont(0.5) within group (order by r.price_agorot))::integer as median_agorot,
         count(distinct r.store_id)::integer as chains
    from public.regular_prices_current r
    join public.sources src on src.id = r.source_id and src.kind in ('chain_feed', 'admin')
   where r.sku_id = o.sku_id
     and r.store_id <> o.store_id
     and r.observed_at >= now() - interval '14 days'
  having count(distinct r.store_id) >= 2
) mk on true;

-- --------------------------------------------------------------------------
-- The single feed the app reads. Catalogue offers first-class; legacy approved
-- deals (a pack *category*, an admin-vouched regular price, no SKU) alongside,
-- until the old submission flow is retired. `is_sample` marks invented data (the
-- 'sample-data' source, or a legacy deal carrying the sample note) so a production
-- server can refuse it (src/lib/demo.ts).
-- --------------------------------------------------------------------------

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
  o.conditions ->> 'note_he'                as notes
from public.offers_ranked o

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
  'moderated',                               -- an administrator approved this deal, price and all
  case when d.discount_percent between 1 and 70 then d.discount_percent end,
  d.discount_percent > 70,
  null::integer, null::integer,
  null::public.promo_type,
  '{}'::jsonb,
  null::timestamptz, null::timestamptz,
  d.approved_at,
  coalesce(d.notes = 'מבצע לדוגמה', false),   -- the legacy sample-deal marker (see 0006)
  d.notes
from public.deals_public d;

grant select on public.regular_prices_current, public.promotions_current, public.offers_ranked, public.offers_feed
  to anon, authenticated, service_role;
-- offers_feed reads the legacy view too, and views run with the caller's privileges.
grant select on public.deals_public to service_role;

-- --------------------------------------------------------------------------
-- Rollback for 0007–0009 (nothing that existed before is touched):
--
--   drop view if exists public.offers_feed, public.offers_ranked,
--        public.promotions_current, public.regular_prices_current;
--   drop function if exists public.record_prices(text, jsonb, uuid);
--   drop function if exists public.record_price(uuid, uuid, public.price_kind, integer,
--        timestamptz, text, uuid, timestamptz, timestamptz, public.promo_type, jsonb,
--        text, text, jsonb, uuid, text);
--   drop function if exists public.require_price_writer();
--   drop table if exists public.price_observations, public.ingestion_runs, public.sources,
--        public.branches, public.sku_barcodes, public.skus;
--   drop function if exists public.price_observations_guard();
--   alter table public.stores drop column if exists kind;
--   alter table public.beers drop column if exists variant, drop column if exists brand_id;
--   drop table if exists public.brands;
--   drop type if exists public.source_kind, public.promo_type, public.price_kind, public.container_type;
-- --------------------------------------------------------------------------
