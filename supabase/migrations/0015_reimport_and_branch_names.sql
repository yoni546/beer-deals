-- ---------------------------------------------------------------------------
-- 0015 · Re-import after rollback; branch names in the read model
--
-- Found by the first real ingestion into STAGING (docs/INGESTION-STAGING-REPORT.md, 2026-09-29):
--
-- 1. A rolled-back file could not be imported again. Idempotency matched the content hash of the
--    rows the rollback had REJECTED, so the re-import silently wrote nothing and the shelf stayed
--    empty. A rejected row no longer counts: replay protection covers only rows still standing.
-- 2. Prices are per branch (0014). A price seen at one branch must say which, instead of standing
--    in for the chain: the read views now carry the branch's name and city.
--
-- Additive: an index is replaced by a narrower one, two functions and three views are replaced with
-- one line / three columns added each. Rollback: re-run the same statements from 0008 and 0014.
-- ---------------------------------------------------------------------------

-- 1. Idempotency ignores rejected rows.
drop index if exists public.price_obs_idempotent;
create unique index price_obs_idempotent on public.price_observations (source_id, content_hash)
  where content_hash is not null and status <> 'rejected';

drop index if exists public.promotion_groups_idempotent;
create unique index promotion_groups_idempotent on public.promotion_groups (source_id, content_hash)
  where content_hash is not null and status <> 'rejected';

create or replace function public.record_price(
  p_sku_id       uuid,
  p_store_id     uuid,
  p_kind         public.price_kind,
  p_price_agorot integer,
  p_observed_at  timestamptz,
  p_source_slug  text,
  p_branch_id    uuid                 default null,
  p_valid_from   timestamptz          default null,
  p_valid_to     timestamptz          default null,
  p_promo_type   public.promo_type    default null,
  p_conditions   jsonb                default '{}'::jsonb,
  p_natural_key  text                 default null,
  p_content_hash text                 default null,
  p_raw          jsonb                default null,
  p_run_id       uuid                 default null,
  p_status       text                 default 'live'
)
returns public.price_observations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source   public.sources;
  v_existing public.price_observations;
  v_row      public.price_observations;
  v_price    integer := p_price_agorot;
  v_identity text;
  v_qty      integer;
  v_total    integer;
  v_newer    bigint;
begin
  perform public.require_price_writer();

  select * into v_source from public.sources where slug = p_source_slug;
  if not found then
    raise exception 'unknown source %', p_source_slug using errcode = 'P0002';
  end if;

  if p_status not in ('live', 'held') then
    raise exception 'status must be live or held' using errcode = '22023';
  end if;
  if not exists (select 1 from public.skus where id = p_sku_id and is_active) then
    raise exception 'unknown or inactive sku' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.stores where id = p_store_id) then
    raise exception 'unknown store' using errcode = 'P0002';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and store_id = p_store_id
  ) then
    raise exception 'the branch does not belong to that store' using errcode = '22023';
  end if;

  -- Replay: nothing to do.
  if p_content_hash is not null then
    select * into v_existing
      from public.price_observations
     where source_id = v_source.id and content_hash = p_content_hash and status <> 'rejected';
    if found then
      return v_existing;
    end if;
  end if;

  if p_kind = 'promotion' then
    if p_promo_type is null then
      raise exception 'a promotion needs a promo_type' using errcode = '22023';
    end if;

    if p_promo_type = 'multi_buy' then
      v_qty   := (p_conditions #>> '{multi_buy,qty}')::integer;
      v_total := (p_conditions #>> '{multi_buy,total_agorot}')::integer;
      if v_qty is null or v_qty < 2 or v_total is null or v_total <= 0 then
        raise exception 'a multi_buy needs conditions.multi_buy = {qty >= 2, total_agorot > 0}'
          using errcode = '22023';
      end if;
      if v_price is not null and v_price <> ceil(v_total::numeric / v_qty)::integer then
        raise exception 'price_agorot must equal ceil(total_agorot / qty) for a multi_buy'
          using errcode = '22023';
      end if;
      v_price := ceil(v_total::numeric / v_qty)::integer;
    end if;

    v_identity := coalesce(
      p_natural_key,
      md5(concat_ws('|', p_promo_type::text, p_valid_from::text, p_valid_to::text, p_conditions::text))
    );
  else
    if p_promo_type is not null or p_valid_to is not null then
      raise exception 'a regular price has no promo_type and no end date' using errcode = '22023';
    end if;
    v_identity := 'regular';
  end if;

  if v_price is null then
    raise exception 'a price is required' using errcode = '22023';
  end if;

  -- One writer at a time per SKU × chain, so two imports cannot both decide they
  -- are "the newest".
  perform pg_advisory_xact_lock(hashtext(p_sku_id::text || p_store_id::text));

  insert into public.price_observations (
    sku_id, store_id, branch_id, kind, price_agorot, observed_at, valid_from, valid_to,
    promo_type, conditions, identity_key, source_id, run_id, natural_key, content_hash,
    raw, status, created_by
  ) values (
    p_sku_id, p_store_id, p_branch_id, p_kind, v_price, p_observed_at, p_valid_from, p_valid_to,
    p_promo_type, coalesce(p_conditions, '{}'::jsonb), v_identity, v_source.id, p_run_id, p_natural_key, p_content_hash,
    p_raw, p_status, auth.uid()
  )
  returning * into v_row;

  if p_status = 'live' then
    select o.id into v_newer
      from public.price_observations o
     where o.sku_id = v_row.sku_id
       and o.store_id = v_row.store_id
       and o.branch_id is not distinct from v_row.branch_id
       and o.kind = v_row.kind
       and o.identity_key = v_row.identity_key
       and o.status = 'live'
       and o.id <> v_row.id
       and (o.observed_at > v_row.observed_at or (o.observed_at = v_row.observed_at and o.id > v_row.id))
     order by o.observed_at desc, o.id desc
     limit 1;

    if v_newer is not null then
      update public.price_observations set status = 'superseded', superseded_by = v_newer where id = v_row.id;
    else
      update public.price_observations o
         set status = 'superseded', superseded_by = v_row.id
       where o.sku_id = v_row.sku_id
         and o.store_id = v_row.store_id
         and o.branch_id is not distinct from v_row.branch_id
         and o.kind = v_row.kind
         and o.identity_key = v_row.identity_key
         and o.status = 'live'
         and o.id <> v_row.id;
    end if;

    select * into v_row from public.price_observations where id = v_row.id;
  end if;

  return v_row;
end;
$$;

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
    select id into v_id from public.promotion_groups where source_id = v_source.id and content_hash = p_group ->> 'content_hash' and status <> 'rejected';
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

-- 2. Branch name and city beside every price.
create or replace view public.offers_feed
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
  o.branch_count,
  o.branch_id,
  bn.name_he                                as branch_name,
  bn.city                                   as branch_city
from (
  select distinct on (r.sku_id, r.store_id, r.identity_key)
         r.*,
         count(*) over (partition by r.sku_id, r.store_id, r.identity_key)::integer as branch_count
    from public.offers_ranked r
   order by r.sku_id, r.store_id, r.identity_key, r.effective_agorot, r.value_pct desc nulls last, r.observed_at desc
) o
left join public.branches bn on bn.id = o.branch_id

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
  1,
  null::uuid,
  null::text,
  null::text
from public.deals_public d;

create or replace view public.regular_prices_feed
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
  (max(l.price_agorot) over w)::integer        as max_price_agorot,
  bn.name_he                                   as branch_name,
  bn.city                                      as branch_city
from latest l
join public.beers  be on be.id = l.beer_id
join public.stores st on st.id = l.store_id
left join public.branches bn on bn.id = l.branch_id
window w as (partition by l.sku_id, l.store_id)
-- fresh prices first, then the cheapest branch
order by l.sku_id, l.store_id, (l.observed_at < now() - interval '14 days'), l.price_agorot, l.observed_at desc;

create or replace view public.group_offers_feed
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
  count(*) over (partition by g.store_id, g.natural_key)::integer as branch_count,
  g.branch_id,
  bn.name_he                                 as branch_name,
  bn.city                                    as branch_city
from public.promotion_groups g
join public.stores  st  on st.id  = g.store_id
left join public.branches bn on bn.id = g.branch_id
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
