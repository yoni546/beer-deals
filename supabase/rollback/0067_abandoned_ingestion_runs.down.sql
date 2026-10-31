-- Undo 0067: start_ingestion_run as 0013 wrote it (a `running` run blocks the same file for ever).
-- Runs 0067 already marked `failed` (stats.abandoned) stay failed: they never finished.

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

revoke all on function public.start_ingestion_run(text, text) from public, anon;
grant execute on function public.start_ingestion_run(text, text) to authenticated, service_role;
