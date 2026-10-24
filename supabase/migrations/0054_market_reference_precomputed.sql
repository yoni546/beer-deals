-- ---------------------------------------------------------------------------
-- 0054 · The market comparison is computed once per import, not once per read.
--
-- WHY. The notification worker has failed every hour since 2026-10-17 — 100
-- consecutive runs, zero successes — with
--
--   offers unavailable: canceling statement due to statement timeout
--
-- It reads one row: `offers_ranked where observation_id = <one id>`. Measured on
-- production 2026-10-23, EXPLAIN (ANALYZE) on exactly that query:
--
--   Execution Time: 7900 ms          for ONE row
--     store_min  GroupAggregate      3662 ms over 52,254 rows
--     market     GroupAggregate      7850 ms over 14,614 rows
--
-- Both aggregates run over the whole dataset before the `observation_id` filter
-- is applied, because `as materialized` is an optimisation fence: the planner
-- cannot push the outer filter into them. Asking for one row costs the same as
-- asking for all of them.
--
-- 0018 introduced those CTEs to stop the same work happening once per ROW, and
-- that was right at staging's scale (~10,600 promotions). Production now holds
-- more, and "once per query" is still an aggregate over everything. 0022 then
-- fixed the reference-price probe, which was the other half; this is the half
-- that was left.
--
-- WHAT. The quantity does not change between imports — it changes when prices
-- change, which is when an import runs. So it becomes a materialized view,
-- refreshed at the end of ingestion and indexed, and the read turns from
-- "aggregate fifty thousand rows" into an index lookup.
--
-- offers_ranked keeps every column, name, type and meaning. Only the speed
-- changes.
--
-- Rollback: the 0022 definition of offers_ranked, then
-- `drop materialized view public.market_reference`.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- The precomputed comparison: exactly the store_min + market pair from 0022,
-- lifted out of the query.
-- --------------------------------------------------------------------------

drop materialized view if exists public.market_reference;

create materialized view public.market_reference as
with store_min as (
  -- one number per chain: its lowest current regular price for this pack
  select r.sku_id, r.store_id, min(r.price_agorot) as price_agorot
    from public.regular_prices_current r
    join public.sources src on src.id = r.source_id and src.kind in ('chain_feed', 'admin')
   where r.observed_at >= now() - interval '14 days'
   group by r.sku_id, r.store_id
)
-- for a pack at a chain: the median of the OTHER chains' numbers, when there are at least two
select p.sku_id,
       p.store_id,
       (percentile_cont(0.5) within group (order by m.price_agorot))::integer as median_agorot,
       count(*)::integer                                                      as chains
  from (select distinct sku_id, store_id from public.promotions_current) p
  join store_min m on m.sku_id = p.sku_id and m.store_id <> p.store_id
 group by p.sku_id, p.store_id
having count(*) >= 2;

-- Unique, because REFRESH ... CONCURRENTLY requires one, and concurrently is
-- what keeps the site readable while an import rebuilds the comparison.
create unique index market_reference_key on public.market_reference (sku_id, store_id);

-- offers_ranked runs as the caller (security_invoker), so the caller must be
-- able to read what it joins. Without this an anonymous visitor gets
-- "permission denied for materialized view market_reference".
--
-- What it exposes: a median of public shelf prices per pack and chain. No user
-- data, and nothing not already derivable from the price feeds.
grant select on public.market_reference to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- offers_ranked: the same view, with the two CTEs replaced by a join.
-- --------------------------------------------------------------------------

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
left join public.market_reference mk on mk.sku_id = o.sku_id and mk.store_id = o.store_id;

-- --------------------------------------------------------------------------
-- Refreshing it.
--
-- CONCURRENTLY so readers are never blocked: the site stays up while an import
-- rebuilds the comparison. It needs the unique index above and cannot run
-- inside a transaction block, so the caller invokes it on its own.
--
-- Safe to call when nothing has changed; it recomputes the same rows.
-- --------------------------------------------------------------------------

create or replace function public.refresh_market_reference()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The same gate as refresh_offers_catalog (0044): rebuilding the comparison is
  -- part of the price write path, and an importer is exactly who may do it.
  perform public.require_price_writer();

  refresh materialized view concurrently public.market_reference;
end;
$$;

revoke all on function public.refresh_market_reference() from public, anon;
grant execute on function public.refresh_market_reference() to authenticated, service_role;
