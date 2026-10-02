-- ---------------------------------------------------------------------------
-- Rolling back a whole-chain import, in bounded pieces.
--
-- `rollback_ingestion_run` walks every live or held observation of a run in one
-- transaction. For a small run that is fine. For Shufersal — 417 branches, tens
-- of thousands of observations — the call outlives the API gateway's timeout,
-- and the caller is left not knowing whether the work committed. That is the
-- worst state to be in while undoing a bad import.
--
-- So the work is made resumable instead of faster. Each call does at most
-- `p_limit` observations and returns how many are left. The driver loops until
-- `done` is true. Nothing depends on a single long transaction surviving.
--
-- The properties this relies on, in order of importance:
--
--   * IDEMPOTENT. A processed observation becomes 'rejected', and the next
--     batch selects only 'live' and 'held'. Re-running after a timeout, a
--     crash, or a double-click resumes; it does not redo.
--   * BOUNDED. One batch, one transaction. A batch that fails rolls back only
--     itself, and the batches before it stay done.
--   * SINGLE-RUN. Every statement is keyed on `run_id = p_run_id`. There is no
--     path here that can touch an observation belonging to another import.
--   * The run is marked 'rolled_back' only when nothing is left, so a half-
--     finished rollback never looks finished.
--
-- The original function is kept and still works. This is the one to use for
-- anything chain-sized.
-- ---------------------------------------------------------------------------

create or replace function public.rollback_ingestion_run_batch(
  p_run_id uuid,
  p_limit  integer default 500,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run       public.ingestion_runs;
  v_bad       public.price_observations;
  v_cur       public.price_observations;
  v_prev      public.price_observations;
  v_found     boolean;
  v_rejected  integer := 0;
  v_restored  integer := 0;
  v_remaining integer;
  v_prior     jsonb;
begin
  if not (public.is_super_admin() or current_setting('role', true) = 'service_role') then
    raise exception 'super admin or service privileges required' using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'p_limit must be between 1 and 5000' using errcode = '22023';
  end if;

  select * into v_run from public.ingestion_runs where id = p_run_id for update;
  if not found then
    raise exception 'unknown ingestion run %', p_run_id using errcode = 'P0002';
  end if;

  -- Already finished: say so rather than starting again.
  if v_run.status = 'rolled_back' then
    return coalesce(v_run.stats -> 'rollback', '{}'::jsonb) || jsonb_build_object('done', true, 'batch_rejected', 0);
  end if;

  for v_bad in
    select * from public.price_observations
     where run_id = p_run_id and status in ('live', 'held')
     order by id
     limit p_limit
  loop
    perform pg_advisory_xact_lock(hashtext(v_bad.sku_id::text || v_bad.store_id::text));
    update public.price_observations set status = 'rejected' where id = v_bad.id;
    v_rejected := v_rejected + 1;

    if v_bad.status = 'live' then
      v_cur := v_bad;
      v_found := false;
      loop
        select * into v_prev from public.price_observations p
         where p.superseded_by = v_cur.id
         order by p.observed_at desc, p.id desc
         limit 1;
        exit when not found;
        v_found := true;
        -- Stop at the first observation this run did not write: that is the
        -- state the shelf was in before the import, and the one to restore.
        exit when v_prev.run_id is distinct from p_run_id;
        v_cur := v_prev;
      end loop;

      if v_found and v_prev.status = 'superseded' and v_prev.run_id is distinct from p_run_id then
        insert into public.price_observations (
          sku_id, store_id, branch_id, kind, price_agorot, observed_at, valid_from, valid_to,
          promo_type, conditions, identity_key, source_id, run_id, natural_key, content_hash,
          raw, status, created_by
        ) values (
          v_prev.sku_id, v_prev.store_id, v_prev.branch_id, v_prev.kind, v_prev.price_agorot,
          v_prev.observed_at, v_prev.valid_from, v_prev.valid_to,
          v_prev.promo_type, v_prev.conditions, v_prev.identity_key, v_prev.source_id, null,
          v_prev.natural_key, null,
          jsonb_build_object('restored_from', v_prev.id, 'rollback_of_run', p_run_id),
          'live', auth.uid()
        );
        v_restored := v_restored + 1;
      end if;
    end if;
  end loop;

  select count(*) into v_remaining
    from public.price_observations
   where run_id = p_run_id and status in ('live', 'held');

  -- Totals accumulate across batches, so progress survives a resumed rollback.
  v_prior := coalesce(v_run.stats -> 'rollback', '{}'::jsonb);

  v_run.stats := coalesce(v_run.stats, '{}'::jsonb) || jsonb_build_object(
    'rollback', jsonb_build_object(
      'reason',        coalesce(p_reason, v_prior ->> 'reason'),
      'rejected',      coalesce((v_prior ->> 'rejected')::integer, 0) + v_rejected,
      'restored',      coalesce((v_prior ->> 'restored')::integer, 0) + v_restored,
      'batches',       coalesce((v_prior ->> 'batches')::integer, 0) + 1,
      'last_batch_at', now()
    )
  );

  update public.ingestion_runs
     set stats  = v_run.stats,
         -- Only when nothing is left. A half-finished rollback must never read
         -- as finished, or the next operator will stop too early.
         status = case when v_remaining = 0 then 'rolled_back' else status end
   where id = p_run_id;

  return jsonb_build_object(
    'run_id',         p_run_id,
    'batch_rejected', v_rejected,
    'batch_restored', v_restored,
    'remaining',      v_remaining,
    'done',           v_remaining = 0,
    'total',          v_run.stats -> 'rollback'
  );
end;
$$;

revoke all on function public.rollback_ingestion_run_batch(uuid, integer, text) from public, anon;
grant execute on function public.rollback_ingestion_run_batch(uuid, integer, text) to authenticated, service_role;
