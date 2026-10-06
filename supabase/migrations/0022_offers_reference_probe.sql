-- ---------------------------------------------------------------------------
-- 0022 · The deals read model: one index probe per offer instead of a scan of every branch
--
-- Measured 2026-10-06 (offers_feed for one chain, as the public): every promotion row of offers_ranked
-- looked up its reference regular price through price_obs_live_store (store_id, kind, sku_id), which
-- returns that pack's live regular price at EVERY branch of the chain; branch and age were then filtered
-- and sorted to keep one row. For Rami Levy that was 1,752 lookups and ~389k of the query's ~467k buffer
-- touches — the reason a cold cache cost seconds.
--
-- Same rows, same order of preference (this branch's newest regular price within 14 days, else the
-- chain-wide one), found by two one-row probes of a partial index on (sku, store, branch, newest first).
-- The index also carries price_agorot and source_id, so each chain's lowest regular price (store_min) is
-- read from the index rather than from 51k table rows. Staging (warm, as the public): Rami Levy 0.42 → 0.22 s,
-- Shufersal 1.7 → 0.46 s, a beer page 2.36 → 0.89 s; buffers per chain query 467k → 43k.
--
-- Proven on staging: the new view and 0018's return the identical multiset of rows (except all both
-- ways, all chains). Columns unchanged.
--
-- Additive: one index, one view replaced with identical columns. Rollback:
-- supabase/rollback/0022_offers_reference_probe.down.sql (0018's view; the index is harmless to keep).
-- ---------------------------------------------------------------------------

create index if not exists price_obs_live_regular
  on public.price_observations (sku_id, store_id, branch_id, observed_at desc, id desc)
  include (price_agorot, source_id)
  where kind = 'regular' and status = 'live';

create or replace view public.offers_ranked
with (security_invoker = on)
as
with store_min as materialized (
  -- one number per chain: its lowest current regular price for this pack
  select r.sku_id, r.store_id, min(r.price_agorot) as price_agorot
    from public.regular_prices_current r
    join public.sources src on src.id = r.source_id and src.kind in ('chain_feed', 'admin')
   where r.observed_at >= now() - interval '14 days'
   group by r.sku_id, r.store_id
),
market as materialized (
  -- for a pack at a chain: the median of the OTHER chains' numbers, when there are at least two
  select p.sku_id, p.store_id,
         (percentile_cont(0.5) within group (order by m.price_agorot))::integer as median_agorot,
         count(*)::integer as chains
    from (select distinct sku_id, store_id from public.promotions_current) p
    join store_min m on m.sku_id = p.sku_id and m.store_id <> p.store_id
   group by p.sku_id, p.store_id
  having count(*) >= 2
)
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
  -- 0022: the same row as 0018's single query — this branch's newest regular price, else the chain-wide
  -- (branch-less) one — found by two one-row probes of price_obs_live_regular instead of reading every
  -- branch's price of the pack and sorting them.
  select r.price_agorot
         + case when coalesce(r.deposit_included, false) = coalesce(o.deposit_included, false) then 0
                when coalesce(r.deposit_included, false) then -coalesce(r.deposit_agorot, 0)
                else coalesce(r.deposit_agorot, 0) end as price_agorot,
         r.observed_at,
         case src.kind when 'chain_feed' then 'feed' when 'admin' then 'moderated' else 'unverified' end as trust
    from (
    (select r.id, 0 as prio
       from public.price_observations r
      where r.kind = 'regular' and r.status = 'live'
        and r.sku_id = o.sku_id and r.store_id = o.store_id and r.branch_id = o.branch_id
        and r.observed_at >= now() - interval '14 days'
      order by r.observed_at desc, r.id desc
      limit 1)
      union all
    (select r.id, 1 as prio
       from public.price_observations r
      where r.kind = 'regular' and r.status = 'live'
        and r.sku_id = o.sku_id and r.store_id = o.store_id and r.branch_id is null
        and r.observed_at >= now() - interval '14 days'
      order by r.observed_at desc, r.id desc
      limit 1)
      order by prio
      limit 1
    ) pick
    join public.price_observations r on r.id = pick.id
    join public.sources src on src.id = r.source_id
) ref on true
left join lateral (
  select round((ref.price_agorot - o.price_agorot) * 100.0 / ref.price_agorot)::integer as raw
   where ref.trust in ('feed', 'moderated') and ref.price_agorot > o.price_agorot
) pct on true
left join market mk on mk.sku_id = o.sku_id and mk.store_id = o.store_id;
