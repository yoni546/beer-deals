-- Rollback of 0017_branch_scope.sql (rehearsed on STAGING, 2026-09-30).
-- Restores the 0015 feed views, then drops what 0017 added. Prices, promotions and groups themselves are
-- untouched: 0017 only added evidence beside them. After running it, mark the migration reverted:
--   npx supabase migration repair --status reverted 0017

-- The 0015 views (column lists as 0015 defines them).
drop view if exists public.promotion_branches;
drop view if exists public.offers_feed;
drop view if exists public.group_offers_feed;

create view public.offers_feed
with (security_invoker = on)
as
select
  'obs:' || o.observation_id::text as offer_key, 'catalog'::text as origin, o.sku_id, o.beer_id, o.beer_slug, o.beer_name,
  o.store_id, o.store_slug, o.store_name, o.sku_name as pack_label, o.container, o.volume_ml, o.pack_quantity,
  o.effective_agorot, o.unit_price_per_liter_agorot, o.reference_agorot, o.reference_trust, o.value_pct, o.needs_review,
  o.market_reference_agorot, o.market_value_pct, o.promo_type, o.conditions, o.valid_from, o.valid_to, o.observed_at,
  o.is_sample, o.conditions ->> 'note_he' as notes, o.variant, o.category, o.deposit_agorot, o.deposit_included,
  o.branch_count, o.branch_id, bn.name_he as branch_name, bn.city as branch_city
from (
  select distinct on (r.sku_id, r.store_id, r.identity_key) r.*,
         count(*) over (partition by r.sku_id, r.store_id, r.identity_key)::integer as branch_count
    from public.offers_ranked r
   order by r.sku_id, r.store_id, r.identity_key, r.effective_agorot, r.value_pct desc nulls last, r.observed_at desc
) o
left join public.branches bn on bn.id = o.branch_id
union all
select 'deal:' || d.id::text, 'legacy', null::uuid, d.beer_id, d.beer_slug, d.beer_name, d.store_id, d.store_slug, d.store_name,
  case d.category when 'sixpack' then 'שישייה' when 'case' then 'ארגז' else 'בודד' end,
  null::public.container_type, null::integer, null::integer, d.deal_price_agorot, null::integer, d.regular_price_agorot, 'moderated',
  case when d.discount_percent between 1 and 70 then d.discount_percent end, d.discount_percent > 70, null::integer, null::integer,
  null::public.promo_type, '{}'::jsonb, null::timestamptz, null::timestamptz, d.approved_at, coalesce(d.notes = 'מבצע לדוגמה', false),
  d.notes, '', 'beer', null::integer, null::boolean, 1, null::uuid, null::text, null::text
from public.deals_public d;

create view public.group_offers_feed
with (security_invoker = on)
as
select distinct on (g.store_id, g.natural_key)
  'grp:' || g.id::text as offer_key, g.id as group_id, g.store_id, st.slug as store_slug, st.name_he as store_name, g.description_he,
  g.required_qty, g.total_agorot, ceil(g.total_agorot::numeric / g.required_qty)::integer as per_unit_agorot, g.deposit_agorot,
  g.deposit_included, g.valid_from, g.valid_to, g.observed_at, (src.slug = 'sample-data') as is_sample, items.beer_ids, items.beer_slugs,
  items.packs, count(*) over (partition by g.store_id, g.natural_key)::integer as branch_count, g.branch_id, bn.name_he as branch_name,
  bn.city as branch_city
from public.promotion_groups g
join public.stores st on st.id = g.store_id
left join public.branches bn on bn.id = g.branch_id
join public.sources src on src.id = g.source_id
cross join lateral (
  select array_agg(distinct k.beer_id) as beer_ids, array_agg(distinct be.slug) as beer_slugs,
         jsonb_agg(jsonb_build_object('sku_id', k.id, 'beer_slug', be.slug, 'beer_name', be.name_he, 'label', k.display_he,
                                      'container', k.container, 'volume_ml', k.volume_ml, 'pack_quantity', k.pack_quantity)
                   order by be.slug, k.volume_ml, k.pack_quantity) as packs
    from public.promotion_group_items gi
    join public.skus k on k.id = gi.sku_id
    join public.product_categories pc on pc.slug = k.category and pc.in_scope
    join public.beers be on be.id = k.beer_id
   where gi.group_id = g.id
) items
where g.status = 'live' and g.audience = 'everyone' and items.packs is not null
  and (g.valid_from is null or g.valid_from <= now())
  and ((g.valid_to is not null and g.valid_to > now()) or (g.valid_to is null and g.observed_at > now() - interval '7 days'))
order by g.store_id, g.natural_key, g.total_agorot, g.observed_at desc;

grant select on public.offers_feed, public.group_offers_feed to anon, authenticated, service_role;

drop function if exists public.refresh_promotion_scope(uuid);
drop function if exists public.close_missing_promotions(uuid, timestamptz);
drop function if exists public.record_promotion_occurrences(uuid, jsonb);
drop function if exists public.record_branch_scan(text, uuid, timestamptz, jsonb);
drop function if exists public.promotion_scope(text, integer, integer, integer);
drop view if exists public.promotion_occurrences;
drop table if exists public.promotion_occurrences;
drop table if exists public.promotions;
drop table if exists public.branch_scans;
alter table public.branches drop column if exists listed_in_stores_file, drop column if exists source_listed_at;
