-- 0067: a run that never finished does not block the next one.
--
-- WHAT HAPPENED (production, 2026-10-27 to 2026-10-29). The daily import was cancelled
-- at the workflow's 180-minute limit three days running. A cancelled job never reaches
-- finish_ingestion_run, so each publisher's run stayed `running` for ever. The next
-- evening's import read the same files (the chains had not published new ones), hashed
-- them to the same value, and start_ingestion_run answered "already imported" from the
-- dead run. Shufersal, Tiv Taam, Yochananof, King Store, Fresh Market and four more were
-- skipped, their promotions aged out, and the app showed them with no deals at all.
--
-- THE RULE. A run still `running` more than four hours after it started is not running:
-- the longest job allowed is three hours (ingest-*.yml, timeout-minutes: 180). Before
-- looking for an earlier run of the same files, start_ingestion_run marks such runs of
-- this source `failed`, with `abandoned: true` in their stats, and so does not mistake
-- them for an import. Whatever they wrote stays as written: every row was accepted by
-- the same checks as any other, and replaying the same file marks those prices seen again
-- (0066) rather than duplicating them.
--
-- Everything else in the function is 0013's, unchanged.

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

  update public.ingestion_runs
     set status = 'failed',
         finished_at = now(),
         stats = stats || jsonb_build_object('abandoned', true, 'abandoned_at', now())
   where source_id = v_source.id
     and status = 'running'
     and started_at < now() - interval '4 hours';

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

revoke all on function public.start_ingestion_run(text, text) from public, anon;
grant execute on function public.start_ingestion_run(text, text) to authenticated, service_role;
