-- ---------------------------------------------------------------------------
-- 0071 · Deleting an account is fast: every column that points at a person has an index
--
-- In-app account deletion (0070) timed out in production on its first real use ("canceling statement due to
-- statement timeout"). Deleting an auth user makes Postgres visit every row that references it, to cascade or
-- to set it null, and price_observations.created_by (810 MB on 2026-11-09) had no index: each deletion read
-- the whole price ledger. The other unindexed links are small tables, indexed here too so the rule is simple:
-- a column that references auth.users is indexed (tests/delete-my-account.test.ts holds it).
--
-- price_observations: a partial index on the rows that HAVE a creator (an admin's or a user's price; feed rows
-- have none), so it is tiny. Building it reads the table once and blocks writes to it meanwhile; apply it
-- outside 05:00–11:00 UTC, when the daily import writes. Reads are not blocked.
-- Rollback: supabase/rollback/0071_index_every_link_to_a_person.down.sql.
-- ---------------------------------------------------------------------------

create index if not exists price_obs_created_by on public.price_observations (created_by) where created_by is not null;
create index if not exists deals_approved_by on public.deals (approved_by) where approved_by is not null;
create index if not exists offer_feedback_reported_by on public.offer_feedback (reported_by);
create index if not exists deal_reports_resolved_by on public.deal_reports (resolved_by) where resolved_by is not null;
create index if not exists admins_added_by on public.admins (added_by) where added_by is not null;
create index if not exists submission_blocks_blocked_by on public.submission_blocks (blocked_by) where blocked_by is not null;
