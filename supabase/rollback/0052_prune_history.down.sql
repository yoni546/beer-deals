-- Rollback of 0052_prune_history.sql. Puts back the 0014 append-only guard and the 0015 record_price (a new row
-- for every file), drops prune_history, the superseded_by index and first_observed_at. Rows already pruned are NOT
-- restored: the backup taken before the first prune is the way back. Then:
--   npx supabase migration repair --status reverted 0052

drop function if exists public.prune_history(text, boolean, integer);
drop function if exists public.prune_history(boolean, integer);

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


drop index if exists public.price_obs_superseded_by;
drop index if exists public.price_obs_rejected;
drop index if exists public.promotion_groups_dead;
alter table public.price_observations drop column if exists first_observed_at;
