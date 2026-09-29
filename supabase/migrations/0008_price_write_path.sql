-- ---------------------------------------------------------------------------
-- 0008 — catalogue model, part 2 of 3: how prices get in, and who may.
--
--   * the ledger is append-only (a trigger enforces it, not a convention)
--   * record_price() / record_prices() are the ONLY write path: one place that
--     validates, computes multi-buy prices, ignores replays and supersedes
--     the previous price — used by admins today and by ingestion later
--   * RLS + explicit grants for every new table, in the style of 0003
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Append-only.
--
-- An observation says what a source claimed at a moment in time. Editing it
-- would rewrite history, so the only things that may ever change are its
-- lifecycle (`status`, `superseded_by`) and who created it (`created_by`, which
-- Postgres nulls when that account is deleted). Deleting is refused outright;
-- to undo a bad import, mark its rows `rejected` by run id.
-- --------------------------------------------------------------------------

create or replace function public.price_observations_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'price observations are append-only; mark a bad row rejected instead'
      using errcode = '42501';
  end if;

  if (to_jsonb(new) - 'status' - 'superseded_by' - 'created_by')
     is distinct from
     (to_jsonb(old) - 'status' - 'superseded_by' - 'created_by') then
    raise exception 'price observations are append-only; record a new observation instead of editing one'
      using errcode = '42501';
  end if;

  -- History does not come back to life.
  if old.status in ('superseded', 'rejected') and new.status is distinct from old.status then
    raise exception 'a % observation cannot change status again', old.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger price_observations_append_only
  before update or delete on public.price_observations
  for each row execute function public.price_observations_guard();

-- --------------------------------------------------------------------------
-- Who may write prices: an admin, or the service role (ingestion). Raises rather
-- than returning false, like require_admin().
-- --------------------------------------------------------------------------

create or replace function public.require_price_writer()
returns void
language plpgsql
stable
as $$
begin
  if not (public.is_admin() or current_setting('role', true) = 'service_role') then
    raise exception 'admin or service privileges required' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.require_price_writer() from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- record_price — validate, then insert one observation.
--
-- Supersession (a price change is a new row, the old one is kept):
--   * a new LIVE observation supersedes the previous live one for the same
--     (sku, store, branch, kind, identity)…
--   * …unless a NEWER live observation already exists, in which case the new
--     one is history and is stored as `superseded`. So back-filling old data in
--     any order can never replace what is currently true.
-- Replaying a record (same source + content_hash) returns the stored row.
-- --------------------------------------------------------------------------

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
     where source_id = v_source.id and content_hash = p_content_hash;
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

-- --------------------------------------------------------------------------
-- record_prices — the batch entry point for ingestion.
--
-- Takes an array of the same fields (jsonb) and applies each one on its own, so
-- a single malformed record is reported instead of sinking the whole import.
-- Returns {accepted, rejected, errors:[{index, code, message}]}.
-- --------------------------------------------------------------------------

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
  item     jsonb;
  idx      integer := 0;
  accepted integer := 0;
  errors   jsonb   := '[]'::jsonb;
begin
  perform public.require_price_writer();

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items must be a json array' using errcode = '22023';
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    idx := idx + 1;
    begin
      perform public.record_price(
        p_sku_id       := (item ->> 'sku_id')::uuid,
        p_store_id     := (item ->> 'store_id')::uuid,
        p_kind         := (item ->> 'kind')::public.price_kind,
        p_price_agorot := (item ->> 'price_agorot')::integer,
        p_observed_at  := (item ->> 'observed_at')::timestamptz,
        p_source_slug  := p_source_slug,
        p_branch_id    := (item ->> 'branch_id')::uuid,
        p_valid_from   := (item ->> 'valid_from')::timestamptz,
        p_valid_to     := (item ->> 'valid_to')::timestamptz,
        p_promo_type   := (item ->> 'promo_type')::public.promo_type,
        p_conditions   := coalesce(item -> 'conditions', '{}'::jsonb),
        p_natural_key  := item ->> 'natural_key',
        p_content_hash := item ->> 'content_hash',
        p_raw          := item -> 'raw',
        p_run_id       := p_run_id,
        p_status       := coalesce(item ->> 'status', 'live')
      );
      accepted := accepted + 1;
    exception when others then
      errors := errors || jsonb_build_object('index', idx, 'code', sqlstate, 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('accepted', accepted, 'rejected', jsonb_array_length(errors), 'errors', errors);
end;
$$;

revoke execute on function public.record_price(uuid, uuid, public.price_kind, integer, timestamptz, text, uuid, timestamptz, timestamptz, public.promo_type, jsonb, text, text, jsonb, uuid, text) from public, anon;
revoke execute on function public.record_prices(text, jsonb, uuid) from public, anon;
grant execute on function public.record_price(uuid, uuid, public.price_kind, integer, timestamptz, text, uuid, timestamptz, timestamptz, public.promo_type, jsonb, text, text, jsonb, uuid, text) to authenticated, service_role;
grant execute on function public.record_prices(text, jsonb, uuid) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- Row level security and grants for the new tables (same rules as 0003:
-- grant exactly the verbs needed, then open rows one policy at a time).
-- --------------------------------------------------------------------------

alter table public.brands              enable row level security;
alter table public.skus                enable row level security;
alter table public.sku_barcodes        enable row level security;
alter table public.branches            enable row level security;
alter table public.sources             enable row level security;
alter table public.ingestion_runs      enable row level security;
alter table public.price_observations  enable row level security;

-- Catalogue: world-readable, admin-writable (like beers and stores).
grant select on public.brands, public.skus, public.sku_barcodes, public.branches, public.sources to anon, authenticated;
grant insert, update, delete on public.brands, public.skus, public.sku_barcodes, public.branches to authenticated;

create policy brands_read on public.brands for select to anon, authenticated using (true);
create policy brands_admin_write on public.brands for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy skus_read on public.skus for select to anon, authenticated using (true);
create policy skus_admin_write on public.skus for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy sku_barcodes_read on public.sku_barcodes for select to anon, authenticated using (true);
create policy sku_barcodes_admin_write on public.sku_barcodes for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy branches_read on public.branches for select to anon, authenticated using (true);
create policy branches_admin_write on public.branches for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Sources: readable (a slug and a kind), never writable through the API.
create policy sources_read on public.sources for select to anon, authenticated using (true);

-- Import bookkeeping: admins can look, only the service role (and the definer
-- functions above) writes.
grant select on public.ingestion_runs to authenticated;
create policy ingestion_runs_admin_read on public.ingestion_runs for select to authenticated using (public.is_admin());

-- The ledger: the public sees LIVE rows, admins see everything, and nobody can
-- insert, update or delete through the API at all — record_price() is the door.
grant select on public.price_observations to anon, authenticated;
create policy price_obs_read_live on public.price_observations for select to anon, authenticated using (status = 'live');
create policy price_obs_read_admin on public.price_observations for select to authenticated using (public.is_admin());

-- The service role bypasses RLS but not privileges. Reads, plus the bookkeeping
-- tables it owns; price writes go through record_price().
grant select on public.brands, public.skus, public.sku_barcodes, public.branches, public.sources, public.price_observations to service_role;
grant select, insert, update on public.ingestion_runs to service_role;
grant insert, update on public.skus, public.sku_barcodes, public.branches to service_role;
