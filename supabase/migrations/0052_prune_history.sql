-- ---------------------------------------------------------------------------
-- 0052 · Price history that stops growing by itself, and a cleanup of what nothing reads
--
-- Measured on staging (2026-10-14, 2½ weeks of daily full-branch imports): 845 MB, of which the price
-- ledger is 689 MB / 770,556 rows. Every import re-recorded every price and promotion, changed or not —
-- ~60,000 rows (~37 MB) a day; production reached 548 MB of the free plan's 500 MB in two weeks.
--   - 475,477 of the 491,368 superseded rows had exactly the price of the row that replaced them;
--   - 209,401 rows were REJECTED (rolled-back runs, resets) — no screen or computation reads them;
--   - 159,928 of 182,778 promotion occurrences belonged to files no longer current (scope reads only the
--     latest scan of each chain, 0017); 10,615 of 11,737 branch scans were older scans;
--   - 30,741 of 36,021 mix-and-match groups were superseded or rejected.
--
-- 1. record_price: an UNCHANGED price is seen again, not written again (one sample row a week is kept for the
--    Deal Score's history). New column first_observed_at remembers when the unchanged run began.
-- 2. prune_history(p_kind, p_apply, p_batch): deletes, in bounded batches and one kind per call, only what
--    nothing reads —
--      rejected price rows; occurrences not in the latest scan's files; branch scans older than 7 days that
--      are not their chain's latest scan; superseded and rejected group promotions (their items cascade).
--    Live, held and superseded price rows are untouched (the Deal Score reads 180 days of live + superseded);
--    notification events are untouched (their dedupe keys are what stop a deal being announced twice).
--    Without p_apply it only counts. Executable by the service role only (the import's credentials).
-- 3. An index on superseded_by (a delete from the ledger checks that no row still points at it), and two
--    partial indexes on what is pruned.
--
-- Deleting frees space for reuse; the size Supabase reports drops only after `vacuum full` on the table
-- (docs/PRUNE-HISTORY.md). Rollback: supabase/rollback/0052_prune_history.down.sql (the deleted rows are not
-- restored by it — the backup taken before the first prune is the way back).
-- ---------------------------------------------------------------------------

alter table public.price_observations add column if not exists first_observed_at timestamptz;

create index if not exists price_obs_superseded_by on public.price_observations (superseded_by)
  where superseded_by is not null;

-- What prune_history looks for, found without reading the whole ledger (a full read of 689 MB took 7.8 s on
-- staging, against the service role's 8 s statement timeout). Both stay small: what they index is pruned daily.
create index if not exists price_obs_rejected on public.price_observations (id) where status = 'rejected';
create index if not exists promotion_groups_dead on public.promotion_groups (id) where status in ('superseded', 'rejected');

-- The ledger stays append-only (0008/0014), with exactly two exceptions, each as narrow as it can be:
--   - SEEN AGAIN: a live row may have observed_at moved FORWARD (and first_observed_at set once, to the old
--     observed_at). Price, terms, identity, source and run never change.
--   - PRUNED: a REJECTED row may be deleted, and only inside prune_history() (it sets beer_deals.prune for its
--     own transaction). Every other delete is refused, as before.
create or replace function public.price_observations_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'rejected' and current_setting('beer_deals.prune', true) = 'on' then
      return old;
    end if;
    raise exception 'price observations are append-only; mark a bad row rejected instead'
      using errcode = '42501';
  end if;

  if (to_jsonb(new) - 'status' - 'superseded_by' - 'created_by' - 'audience' - 'deposit_agorot' - 'deposit_included'
                    - 'observed_at' - 'first_observed_at')
     is distinct from
     (to_jsonb(old) - 'status' - 'superseded_by' - 'created_by' - 'audience' - 'deposit_agorot' - 'deposit_included'
                    - 'observed_at' - 'first_observed_at') then
    raise exception 'price observations are append-only; record a new observation instead of editing one'
      using errcode = '42501';
  end if;

  if new.observed_at is distinct from old.observed_at
     or new.first_observed_at is distinct from old.first_observed_at then
    if old.status <> 'live' or new.status <> 'live'
       or new.observed_at < old.observed_at
       or old.first_observed_at is not null and new.first_observed_at is distinct from old.first_observed_at
       or old.first_observed_at is null and new.first_observed_at is distinct from old.observed_at then
      raise exception 'only a live observation may be seen again, and only later'
        using errcode = '42501';
    end if;
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

  -- 0052 · UNCHANGED IS NOT NEW. The same price, for the same pack, at the same branch, under the same identity
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

-- One kind per call: each call is one statement under the service role's 8 s statement timeout (measured on
-- staging: all four kinds in one call took 7.4 s with a cold cache).
drop function if exists public.prune_history(boolean, integer);

create or replace function public.prune_history(p_kind text, p_apply boolean default false, p_batch integer default 5000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids bigint[];
  v_n   integer := 0;
begin
  -- The writer's guard; and execute is granted to the service role alone (below), so in practice it is the import's.
  perform public.require_price_writer();
  if p_batch is null or p_batch < 1 or p_batch > 50000 then
    raise exception 'p_batch must be between 1 and 50000' using errcode = '22023';
  end if;

  if p_kind = 'rejected_prices' then
    -- Price rows marked rejected (rolled-back runs, resets). A row still pointing at one lets go of it first.
    if not p_apply then
      return (select count(*) from public.price_observations where status = 'rejected');
    end if;
    select array_agg(id) into v_ids
      from (select id from public.price_observations where status = 'rejected' order by id limit p_batch) b;
    if v_ids is not null then
      perform set_config('beer_deals.prune', 'on', true);
      update public.price_observations set superseded_by = null where superseded_by = any(v_ids);
      delete from public.price_observations where id = any(v_ids);
      get diagnostics v_n = row_count;
      perform set_config('beer_deals.prune', 'off', true);
    end if;
    return v_n;

  elsif p_kind = 'stale_occurrences' then
    -- Listed in a file that is no longer its branch's file in its chain's latest scan (scope reads only that).
    select array_agg(o.id) into v_ids
      from (select o.id
              from public.promotion_occurrences o
             where not exists (
                     select 1
                       from (select distinct on (x.store_id) x.store_id, x.scan_id
                               from public.branch_scans x
                              order by x.store_id, x.scanned_at desc) l
                       join public.branch_scans s on s.scan_id = l.scan_id and s.store_id = l.store_id
                      where l.store_id = o.store_id and s.branch_id = o.branch_id and s.promo_file = o.source_file)
             limit case when p_apply then p_batch else null end) o;
    if not p_apply then
      return coalesce(cardinality(v_ids), 0);
    end if;
    if v_ids is not null then
      delete from public.promotion_occurrences where id = any(v_ids);
      get diagnostics v_n = row_count;
    end if;
    return v_n;

  elsif p_kind = 'old_branch_scans' then
    -- Older than a week, and not its chain's latest scan (the latest is always kept).
    select array_agg(s.id) into v_ids
      from (select s.id
              from public.branch_scans s
             where s.scanned_at < now() - interval '7 days'
               and s.scan_id <> (select x.scan_id from public.branch_scans x
                                  where x.store_id = s.store_id order by x.scanned_at desc limit 1)
             limit case when p_apply then p_batch else null end) s;
    if not p_apply then
      return coalesce(cardinality(v_ids), 0);
    end if;
    if v_ids is not null then
      delete from public.branch_scans where id = any(v_ids);
      get diagnostics v_n = row_count;
    end if;
    return v_n;

  elsif p_kind = 'old_groups' then
    -- Group promotions that were replaced or rejected (their items go with them: on delete cascade).
    if not p_apply then
      return (select count(*) from public.promotion_groups where status in ('superseded', 'rejected'));
    end if;
    delete from public.promotion_groups
     where id in (select id from public.promotion_groups where status in ('superseded', 'rejected') limit p_batch);
    get diagnostics v_n = row_count;
    return v_n;
  end if;

  raise exception 'unknown kind %: rejected_prices, stale_occurrences, old_branch_scans or old_groups', p_kind
    using errcode = '22023';
end;
$$;

revoke execute on function public.prune_history(text, boolean, integer) from public, anon, authenticated;
grant execute on function public.prune_history(text, boolean, integer) to service_role;
