-- Rollback of 0018_read_model_at_scale.sql (rehearsed on STAGING, 2026-09-30, inside a transaction).
-- Puts back the 0014 definition of offers_ranked (same columns: the feeds on top of it are untouched) and
-- drops the index. After running it, mark the migration reverted:
--   npx supabase migration repair --status reverted 0018

drop index if exists public.price_obs_live_store;

create or replace view public.offers_ranked
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
