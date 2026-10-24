-- ---------------------------------------------------------------------------
-- 0056 — the three end-of-import refreshes get long enough to finish
--
-- MEASURED, production, 2026-10-24, the run straight after 0055 removed the
-- DELETE refusal. The refusal is gone and all three refreshes now report the
-- same thing in its place:
--
--   deal scores:      canceling statement due to statement timeout
--   market reference: canceling statement due to statement timeout
--   offers catalog:   canceling statement due to statement timeout
--
-- WHAT IS CANCELLING THEM. Supabase sets a short statement_timeout on the roles
-- behind the API so that no one request can hold the free tier's single small
-- instance. For a page read that is exactly right, and nothing here changes it.
-- These three are not page reads: they are the end of an import, computing the
-- read model for some 14,000 offers out of 180 days of a price ledger. They are
-- the one thing in this system that is SUPPOSED to take tens of seconds, they
-- run once a day, and nobody is waiting on them.
--
-- ON THE ROLE, NOT ON THE FUNCTION, and the difference is not cosmetic.
-- Postgres arms the statement_timeout timer when a top-level statement STARTS;
-- raising the GUC part-way through that statement — which is what a function's
-- own `SET` does, applied as the function is entered — does not re-arm a timer
-- that is already counting. A setting attached to the role is applied by
-- PostgREST before the statement begins, which is early enough to matter. So
-- the ceiling goes on service_role, the role the import writes as.
--
-- WHAT THAT WIDENS. service_role is the server-side key only: the import, the
-- notification worker, the cache doorbell. It is never in a browser and never
-- reachable by anon or authenticated, whose timeouts are untouched — a slow page
-- query is still cancelled in seconds, exactly as before. What this allows is
-- for our own maintenance to take a minute when it needs one.
--
-- WHY 120 SECONDS. Long enough for the measurements we have — the feed query the
-- catalogue is built from was 15.3 s in production before 0044, and the market
-- comparison about 12 s as one set-based pass — with room for the data to grow,
-- and short enough that a refresh which has genuinely gone wrong still gives up.
-- Supabase's HTTP gateway gives up before that anyway, near 100 s, and when it
-- does the client disconnects and Postgres cancels the query: 120 s is an honest
-- ceiling, not a promise that anything may run that long.
--
-- An import does not fail when a refresh fails. All three are deliberately not
-- `must` (scripts/ingest/run.mjs §10): the prices are in and correct either way,
-- and undoing a correct import over an unscored deal would be the worse outcome.
-- Which is also why these failures were invisible for twelve days — and why
-- run.mjs now records how long each one took, so the next import says whether
-- 120 s was enough instead of leaving the question open.
--
-- One setting. Safe to run twice.
-- ---------------------------------------------------------------------------

alter role service_role set statement_timeout = '120s';

comment on function public.refresh_market_reference() is
  'Recomputes the cross-chain price comparison (0054). An end-of-import job, not '
  'a page read: it runs under service_role''s longer statement_timeout (0056).';
