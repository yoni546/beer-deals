-- ---------------------------------------------------------------------------
-- 0055 — the catalogue rebuild says WHERE, so it is allowed to run
--
-- MEASURED, production, 2026-10-24. The import succeeded — 797 branches, 32,971
-- regular prices, 14,085 promotions, 0 errors — and the app still said the
-- prices were eight days old, because `offers_feed` showed what it showed on
-- 2026-10-12. Two lines in the run's log, and nowhere else:
--
--   deal scores:    canceling statement due to statement timeout
--   offers catalog: DELETE requires a WHERE clause
--
-- WHAT THAT MESSAGE IS. Supabase runs the `safeupdate` guard on the role behind
-- the API, so an UPDATE or DELETE arriving through PostgREST without a filter is
-- refused rather than run — the protection against a forgotten filter emptying a
-- table. 0044's rebuild clears the whole table on purpose:
--
--   delete from public.offers_catalog;
--
-- and the guard cannot tell that apart from the accident it exists to stop. It
-- is in force for the whole session, inside a SECURITY DEFINER function as much
-- as outside one, so the function could never run through `db.rpc(...)`.
--
-- WHY NOBODY SAW IT FOR TWELVE DAYS. The table was filled once, by hand, in the
-- SQL editor the day 0044 was written — where the guard is off. Every import
-- since has written its prices correctly and then failed, in one line, to
-- publish them. The run still exits zero, because this step is deliberately not
-- a `must`: a refresh that fails should not throw away an import's prices. So
-- the only visible symptom was the one the owner reported, in the app: the
-- prices had stopped moving.
--
-- THE FIX, which is one predicate. `offer_key is not null` is true of every row
-- the rebuild inserts — it is `'obs:' || observation_id` — and the column is
-- nullable (0044 builds the table with CREATE TABLE AS, which does not carry a
-- NOT NULL across), so the planner keeps the qualifier instead of folding it
-- away, and the guard sees a filtered DELETE. Same rows deleted, same single
-- transaction, same behaviour on failure.
--
-- `where true` would read better and would not work: Postgres constant-folds it
-- out of the plan and the guard sees an unqualified DELETE again.
--
-- The scores timeout is the other half of the same stall and is not this file's
-- business: 0054 moves the market comparison out of the per-row path.
--
-- Nothing else changes. One function redefined, body identical but for the
-- WHERE; safe to run twice.
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
  --
  -- The WHERE is not a filter, it is a password: see the note at the top. Every
  -- row has an offer_key, so this clears the table, which is what a rebuild is.
  delete from public.offers_catalog where offer_key is not null;
  insert into public.offers_catalog
  select s.*, now() from public.offers_catalog_source s;
  get diagnostics written = row_count;

  return written;
end;
$$;

revoke execute on function public.refresh_offers_catalog() from public, anon;
grant execute on function public.refresh_offers_catalog() to authenticated, service_role;
