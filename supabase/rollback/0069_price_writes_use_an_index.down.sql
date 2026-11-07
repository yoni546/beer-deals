-- Undo 0069: record_prices as 0013 wrote it and record_price as 0066 wrote it, then drop the two indexes.
-- No data changes: 0069 added no row and altered none.

create or replace function public.record_prices(
  p_source_slug text,
  p_items       jsonb,
  p_run_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item      jsonb;
  idx       integer := 0;
  accepted  integer := 0;
  errors    jsonb   := '[]'::jsonb;
  held      jsonb   := '[]'::jsonb;
  v_status  text;
  v_reason  text;
  v_raw     jsonb;
  v_price   integer;
  v_median  numeric;
  v_chains  integer;
  v_prev    integer;
begin
  perform public.require_price_writer();

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items must be a json array' using errcode = '22023';
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    idx := idx + 1;
    begin
      v_status := coalesce(item ->> 'status', 'live');
      v_reason := null;
      v_raw    := item -> 'raw';
      v_price  := (item ->> 'price_agorot')::integer;

      if v_status = 'live' and v_price is not null and v_price > 0 then
        select percentile_cont(0.5) within group (order by r.price_agorot), count(distinct r.store_id)
          into v_median, v_chains
          from public.price_observations r
         where r.sku_id = (item ->> 'sku_id')::uuid
           and r.kind = 'regular' and r.status = 'live'
           and r.observed_at > now() - interval '30 days';

        if v_chains >= 3 and (v_price > v_median * 10 or v_price < v_median / 10) then
          v_reason := 'price_out_of_range';
        else
          select o.price_agorot into v_prev
            from public.price_observations o
           where o.sku_id = (item ->> 'sku_id')::uuid
             and o.store_id = (item ->> 'store_id')::uuid
             and o.branch_id is not distinct from (item ->> 'branch_id')::uuid
             and o.kind = (item ->> 'kind')::public.price_kind
             and o.status = 'live'
             and o.observed_at > (item ->> 'observed_at')::timestamptz - interval '2 days'
             and (
               (item ->> 'kind') = 'regular'
               or o.identity_key = coalesce(item ->> 'natural_key', '')
             )
           order by o.observed_at desc, o.id desc
           limit 1;
          if v_prev is not null and abs(v_price - v_prev)::numeric / v_prev > 0.40 then
            v_reason := 'sudden_change';
          end if;
        end if;
      end if;

      if v_reason is not null then
        v_status := 'held';
        v_raw := coalesce(v_raw, '{}'::jsonb) || jsonb_build_object('held_reason', v_reason);
        held := held || jsonb_build_object('index', idx, 'reason', v_reason);
      end if;

      perform public.record_price(
        p_sku_id       := (item ->> 'sku_id')::uuid,
        p_store_id     := (item ->> 'store_id')::uuid,
        p_kind         := (item ->> 'kind')::public.price_kind,
        p_price_agorot := v_price,
        p_observed_at  := (item ->> 'observed_at')::timestamptz,
        p_source_slug  := p_source_slug,
        p_branch_id    := (item ->> 'branch_id')::uuid,
        p_valid_from   := (item ->> 'valid_from')::timestamptz,
        p_valid_to     := (item ->> 'valid_to')::timestamptz,
        p_promo_type   := (item ->> 'promo_type')::public.promo_type,
        p_conditions   := coalesce(item -> 'conditions', '{}'::jsonb),
        p_natural_key  := item ->> 'natural_key',
        p_content_hash := item ->> 'content_hash',
        p_raw          := v_raw,
        p_run_id       := p_run_id,
        p_status       := v_status
      );
      accepted := accepted + 1;
    exception when others then
      -- The held entry (if any) was for a record that then failed anyway: report it as an error only.
      if v_reason is not null then
        held := (select coalesce(jsonb_agg(h), '[]'::jsonb) from jsonb_array_elements(held) h where (h ->> 'index')::integer <> idx);
      end if;
      errors := errors || jsonb_build_object('index', idx, 'code', sqlstate, 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'accepted', accepted,
    'rejected', jsonb_array_length(errors),
    'held', jsonb_array_length(held),
    'errors', errors,
    'held_items', held
  );
end;
$$;

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
  v_same     public.price_observations;
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

  -- 0066 · UNCHANGED IS NOT NEW. The same price, for the same pack, at the same branch, under the same identity
  -- and terms, re-read from a newer file, does not add a row: the live row is marked as seen again (observed_at
  -- moves forward, so close_missing_promotions keeps it and the 14-day windows still see it). One row per WEEK is
  -- still written for an unchanged price, so the Deal Score's history (0027: live + superseded rows over 180 days,
  -- at least 4 of them) keeps its samples — at a seventh of the volume a daily row cost.
  if p_status = 'live' then
    select * into v_same
      from public.price_observations o
     where o.sku_id = p_sku_id
       and o.store_id = p_store_id
       and o.branch_id is not distinct from p_branch_id
       and o.kind = p_kind
       and o.identity_key = v_identity
       and o.source_id = v_source.id
       and o.status = 'live'
       and o.price_agorot = v_price
       and o.promo_type is not distinct from p_promo_type
       and o.valid_from is not distinct from p_valid_from
       and o.valid_to is not distinct from p_valid_to
       and o.conditions = coalesce(p_conditions, '{}'::jsonb)
     order by o.observed_at desc, o.id desc
     limit 1;

    if found and p_observed_at < coalesce(v_same.first_observed_at, v_same.observed_at) + interval '7 days' then
      if p_observed_at > v_same.observed_at then
        update public.price_observations
           set first_observed_at = coalesce(first_observed_at, observed_at),
               observed_at       = p_observed_at
         where id = v_same.id
        returning * into v_same;
      end if;
      return v_same;
    end if;
  end if;


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

drop index if exists public.price_obs_live_branch;
drop index if exists public.price_obs_live_sku_recent;
