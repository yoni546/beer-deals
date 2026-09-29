-- ---------------------------------------------------------------------------
-- 0013 · Ingestion safety: idempotent runs, sanity gates, and a rollback that works
--
-- Prepares the write path for the first real import (audit §19 items 6, 10, 12). It
-- does not import anything and nothing calls it yet.
--
--   start_ingestion_run / finish_ingestion_run   a file is imported once: same source + same
--                                                file hash is a no-op, however often it is rung
--   record_prices (replaced)                     holds implausible prices instead of publishing
--                                                them, and says how many it held
--   rollback_ingestion_run                       undoes a run and PUTS BACK what it replaced
--
-- Why rollback is more than "reject the rows": recording a new price marks the previous live one
-- `superseded`, and a superseded row can never change again (the ledger is append-only,
-- migration 0008). Rejecting a bad run's rows alone would therefore leave the shelf with NO
-- price at all. Rollback re-records the predecessor as a new live observation (same values,
-- same observed_at, so freshness stays honest) and links it to the row it restores.
--
-- Additive. Rollback of this migration: drop the three functions, restore record_prices() from
-- 0008, drop the index and the column.
-- ---------------------------------------------------------------------------

-- 1. A file is imported once.
alter table public.ingestion_runs add column file_hash text;

create unique index ingestion_runs_one_per_file
  on public.ingestion_runs (source_id, file_hash)
  where file_hash is not null and status in ('running', 'succeeded');

create or replace function public.start_ingestion_run(p_source_slug text, p_file_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.sources;
  v_run    public.ingestion_runs;
begin
  perform public.require_price_writer();

  select * into v_source from public.sources where slug = p_source_slug;
  if not found then
    raise exception 'unknown source %', p_source_slug using errcode = 'P0002';
  end if;

  if p_file_hash is not null then
    select * into v_run from public.ingestion_runs
     where source_id = v_source.id and file_hash = p_file_hash and status in ('running', 'succeeded');
    if found then
      return jsonb_build_object('run_id', v_run.id, 'already_imported', true, 'status', v_run.status);
    end if;
  end if;

  insert into public.ingestion_runs (source_id, file_hash) values (v_source.id, p_file_hash) returning * into v_run;
  return jsonb_build_object('run_id', v_run.id, 'already_imported', false, 'status', v_run.status);
end;
$$;

create or replace function public.finish_ingestion_run(p_run_id uuid, p_status text, p_stats jsonb default '{}'::jsonb)
returns public.ingestion_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.ingestion_runs;
begin
  perform public.require_price_writer();
  if p_status not in ('succeeded', 'failed') then
    raise exception 'a run finishes as succeeded or failed' using errcode = '22023';
  end if;

  update public.ingestion_runs
     set status = p_status, finished_at = now(), stats = stats || coalesce(p_stats, '{}'::jsonb)
   where id = p_run_id and status = 'running'
  returning * into v_run;

  if not found then
    raise exception 'no running ingestion run %', p_run_id using errcode = 'P0002';
  end if;
  return v_run;
end;
$$;

-- 2. Sanity gates in the batch entry point. A price that fails is HELD (stored, invisible to the
--    public, visible to admins) rather than published or thrown away, and the caller is told.
--    Held rows keep the reason in `raw.held_reason`.
--
--      price_out_of_range   more than 10x or less than 1/10 of the SKU's median regular price
--                           across chains (needs 3+ chains to have an opinion)
--      sudden_change        moved more than 40% from the previous live price of the same shelf
--                           and kind within 2 days
--
--    (A saving above 70% is held by the read model itself, migration 0009.) Rows the caller
--    already marked `held` pass through untouched.
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

-- 3. Undo a run, and put back what it replaced.
create or replace function public.rollback_ingestion_run(p_run_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run      public.ingestion_runs;
  v_bad      public.price_observations;
  v_cur      public.price_observations;
  v_prev     public.price_observations;
  v_rejected integer := 0;
  v_restored integer := 0;
begin
  if not (public.is_super_admin() or current_setting('role', true) = 'service_role') then
    raise exception 'super admin or service privileges required' using errcode = '42501';
  end if;

  select * into v_run from public.ingestion_runs where id = p_run_id for update;
  if not found then
    raise exception 'unknown ingestion run %', p_run_id using errcode = 'P0002';
  end if;
  if v_run.status = 'rolled_back' then
    return v_run.stats -> 'rollback';
  end if;

  -- Only rows still standing can be rejected; history that later runs already replaced is
  -- left as it is (it is not on any shelf).
  for v_bad in
    select * from public.price_observations
     where run_id = p_run_id and status in ('live', 'held')
     order by id
  loop
    perform pg_advisory_xact_lock(hashtext(v_bad.sku_id::text || v_bad.store_id::text));
    update public.price_observations set status = 'rejected' where id = v_bad.id;
    v_rejected := v_rejected + 1;

    if v_bad.status = 'live' then
      -- Walk back to the last price that did not come from this run.
      v_cur := v_bad;
      loop
        select * into v_prev from public.price_observations p
         where p.superseded_by = v_cur.id
         order by p.observed_at desc, p.id desc limit 1;
        exit when not found;
        exit when v_prev.run_id is distinct from p_run_id;
        v_cur := v_prev;
      end loop;

      if found and v_prev.status = 'superseded' then
        insert into public.price_observations (
          sku_id, store_id, branch_id, kind, price_agorot, observed_at, valid_from, valid_to,
          promo_type, conditions, identity_key, source_id, run_id, natural_key, content_hash,
          raw, status, created_by
        ) values (
          v_prev.sku_id, v_prev.store_id, v_prev.branch_id, v_prev.kind, v_prev.price_agorot,
          v_prev.observed_at, v_prev.valid_from, v_prev.valid_to,
          v_prev.promo_type, v_prev.conditions, v_prev.identity_key, v_prev.source_id, null, v_prev.natural_key, null,
          jsonb_build_object('restored_from', v_prev.id, 'rollback_of_run', p_run_id),
          'live', auth.uid()
        );
        v_restored := v_restored + 1;
      end if;
    end if;
  end loop;

  -- A bad price must not be announced later.
  update public.notification_events e
     set status = 'done', outcome = 'rolled_back', processed_at = now()
   where e.status = 'pending'
     and e.offer_key in (select 'obs:' || o.id from public.price_observations o where o.run_id = p_run_id);

  update public.ingestion_runs
     set status = 'rolled_back',
         finished_at = coalesce(finished_at, now()),
         stats = stats || jsonb_build_object(
           'rollback', jsonb_build_object('rejected', v_rejected, 'restored', v_restored, 'reason', p_reason, 'at', now())
         )
   where id = p_run_id;

  return jsonb_build_object('rejected', v_rejected, 'restored', v_restored, 'reason', p_reason);
end;
$$;

-- 4. Who may call what.
revoke all on function public.start_ingestion_run(text, text) from public, anon;
revoke all on function public.finish_ingestion_run(uuid, text, jsonb) from public, anon;
revoke all on function public.rollback_ingestion_run(uuid, text) from public, anon;
revoke execute on function public.record_prices(text, jsonb, uuid) from public, anon;
grant execute on function public.start_ingestion_run(text, text) to authenticated, service_role;
grant execute on function public.finish_ingestion_run(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.rollback_ingestion_run(uuid, text) to authenticated, service_role;
grant execute on function public.record_prices(text, jsonb, uuid) to authenticated, service_role;

-- The definer functions do the writing; the service role needs to read the run it is working on.
grant select on public.ingestion_runs to service_role;

-- 5. A price restored by a rollback is not news.
create or replace function public.enqueue_promotion_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'promotion' or new.status <> 'live' then
    return new;
  end if;
  if new.raw ? 'restored_from' then
    return new;
  end if;

  -- Invented prices never wake anyone up.
  if exists (select 1 from public.sources s where s.id = new.source_id and s.slug = 'sample-data') then
    return new;
  end if;

  insert into public.notification_events (dedupe_key, offer_key, beer_id, expires_at)
  select 'promo:' || new.sku_id || ':' || new.store_id || ':' || new.identity_key || ':' || new.price_agorot
                   || ':' || coalesce(new.valid_from::date::text, ''),
         'obs:' || new.id,
         k.beer_id,
         coalesce(new.valid_to, now() + interval '24 hours')
    from public.skus k
   where k.id = new.sku_id
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;
