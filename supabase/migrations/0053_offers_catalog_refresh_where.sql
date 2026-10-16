-- ---------------------------------------------------------------------------
-- 0053 · The chain half of the feed is refreshed by the import again
--
-- 0044's refresh_offers_catalog() emptied the table with `delete from public.offers_catalog;`. Supabase runs
-- requests that arrive through its API with pg_safeupdate, which refuses a DELETE without a WHERE clause — so
-- every import's call failed ("DELETE requires a WHERE clause"), run.mjs logged it and went on (by design: a
-- failed refresh keeps the previous rows), and the table kept the rows of the one refresh made in the SQL
-- editor. Measured on staging 2026-10-16: offers_catalog newest observation 2026-10-12, the ledger 2026-10-14.
-- The tests run on PGlite, which has no pg_safeupdate, and could not see it.
--
-- Fixing that showed the second reason: computing the catalogue takes longer than the 8 s an API request gets
-- (production measured 15.3 s for the same work; staging 30 s under load). service_role has no statement_timeout
-- of its own, so it inherited the authenticator's 8 s. It gets its own 180 s: only server code holds that key
-- (the import, the notification worker, admin actions); anon (3 s) and authenticated (8 s) are untouched.
-- Measured on staging after this migration: refresh_offers_catalog through the API wrote 687 offers (the table had
-- held 524, from 2026-10-12).
--
-- Same function, the same one transaction, with an explicit `where true`. tests/security-sweep.test.ts now
-- refuses an unqualified DELETE or UPDATE in any function.
-- Rollback: the 0044 definition, and  alter role service_role reset statement_timeout;
-- ---------------------------------------------------------------------------

create or replace function public.refresh_offers_catalog()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  written integer;
begin
  perform public.require_price_writer();

  -- One transaction: readers keep seeing the previous rows until it commits, and
  -- a failure leaves the old ones in place rather than an empty feed.
  -- `where true`: pg_safeupdate (on for every API request) refuses a DELETE without a WHERE clause.
  delete from public.offers_catalog where true;
  insert into public.offers_catalog
  select s.*, now() from public.offers_catalog_source s;
  get diagnostics written = row_count;

  return written;
end;
$$;

alter role service_role set statement_timeout = '180s';
notify pgrst, 'reload config';
