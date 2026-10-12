-- ---------------------------------------------------------------------------
-- 0043 — take back the privileges the platform handed out, and stop it from
--        handing out any more.
--
-- Found on staging, 2026-10-11, by running the schema's own verification
-- against a real Supabase project for the first time. `anon` — the role every
-- visitor's browser arrives as — held SELECT, INSERT, DELETE and TRUNCATE on
-- `public.admin_actions`, the append-only admin audit log. No migration grants
-- that. 0032 deliberately grants NOTHING on that table and says so in a
-- comment: reading goes through admin_audit(), writing through
-- record_admin_action(), and the table itself is meant to be unreachable.
--
-- The grants came from Supabase. Every project is created with
--
--   alter default privileges in schema public
--     grant all on tables to postgres, anon, authenticated, service_role;
--
-- so a table created by any later migration is handed to the API roles before
-- that migration has said anything. The whole schema was written on the
-- opposite assumption — that a table nobody grants is a table nobody reaches —
-- which is true on a bare Postgres and false here. 123 unintended write
-- privileges for anon, across 87 tables.
--
-- WHAT WAS ACTUALLY EXPOSED. Less than the grant list suggests, because the
-- other half of the design held: row level security is on for every table in
-- public, and a table with RLS and no policy for a role answers that role with
-- nothing. So the audit log's contents were not readable and not writable
-- through the REST API. Two things were real anyway:
--
--   * TRUNCATE is not subject to RLS. A role holding it can empty a table
--     whatever the policies say. PostgREST does not expose TRUNCATE, so there
--     is no path to it from the public API that I can find — but "no path I
--     can find" is not the same as "no path", and it should never have been
--     reachable to look for.
--   * The defence we describe everywhere as two independent layers was one
--     layer. CLAUDE.md's first non-negotiable is that authorization lives in
--     Postgres with explicit per-table GRANTs; that had quietly stopped being
--     true of every table added since the project was created.
--
-- WHY THE TESTS SAID OTHERWISE. tests/security-sweep.test.ts asserts exactly
-- this ("gives the anonymous public no way to write anything") and passed,
-- because PGlite has no such default privileges and the test bootstrap did not
-- add them. The bootstrap now does, the sweep now fails without this migration,
-- and the same question will be asked of every table added from here on.
--
-- WHAT THIS DOES
--   1. Stops the bleeding: revokes the default privileges, so a table created
--      by a later migration arrives unreachable, as the schema assumes.
--   2. Revokes everything from anon, authenticated and service_role, on every
--      table and view in public.
--   3. Re-grants exactly what migrations 0001–0042 actually grant — the list
--      below is replayed from their own GRANT and REVOKE statements in
--      migration order, COLUMN-LEVEL GRANTS INCLUDED, not retyped from memory.
--      Two things only a replay gets right, and the suite caught both:
--        * `beers` loses DELETE. 0003 grants it, 0034 takes it away on purpose
--          (a beer is deactivated, never deleted — somebody's favourite points
--          at it), and reading the grants alone hands it back.
--        * `profiles` keeps UPDATE on two columns and no more. 0010 revokes
--          table-wide UPDATE and re-grants `update (first_name,
--          notifications_enabled)`; a version of this migration that ignored
--          column grants left people unable to change their own name.
--
-- `service_role` IS in scope, which was not the first plan. It bypasses RLS by
-- design and is server-only, so the exposure is nothing like anon's — but the
-- suite settled it: three tests assert that the worker's role has "exactly the
-- privileges it uses, and no more" (0006, and twice in notifications-security),
-- and they failed the moment the bootstrap started handing out the platform's
-- defaults. The schema states an intention about this role that the platform
-- had quietly voided too, so it is restored here on the same terms: revoke, then
-- re-grant what the migrations actually give it, including 0006's single column
-- on `deals`.
--
-- Additive and reversible in the sense that matters: it only removes privileges
-- nothing is supposed to be using, and re-states the ones that are. If it were
-- to break something, the symptom is a permission error naming the table, and
-- the fix is a grant.
-- ---------------------------------------------------------------------------

-- 1. The source.
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;

-- 2. The accumulated grants. Safe for sequences: every generated key in this
--    schema is an identity column, and an identity column needs no sequence
--    privilege from the role doing the insert.
revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;

-- 3. What the migrations actually mean to grant.
grant select on public.admins to authenticated;
grant select on public.app_settings to anon, authenticated, service_role;
grant select on public.beers to anon, service_role;
grant select, insert, update on public.beers to authenticated;
grant select on public.branch_scans to authenticated, service_role;
grant select on public.branches to anon;
grant select, insert, update on public.branches to service_role;
grant select, insert, update, delete on public.branches to authenticated;
grant select on public.brands to anon, service_role;
grant select, insert, update, delete on public.brands to authenticated;
grant select on public.contributors to anon, authenticated, service_role;
grant select, insert, update on public.deal_reports to authenticated;
grant select on public.deals to anon, service_role;
grant select, insert, update, delete on public.deals to authenticated;
grant update (notified_at) on public.deals to service_role;
grant select on public.deals_public to anon, authenticated, service_role;
grant select on public.group_offers_feed to anon, authenticated, service_role;
grant select on public.ingestion_runs to authenticated;
grant select, insert, update on public.ingestion_runs to service_role;
grant select, insert, update on public.notification_deliveries to service_role;
grant select, update on public.notification_events to service_role;
grant select on public.offer_feedback to anon, authenticated, service_role;
grant select on public.offer_scores to anon, authenticated, service_role;
grant select on public.offers_feed to anon, authenticated, service_role;
grant select on public.offers_ranked to anon, authenticated, service_role;
grant select on public.price_observations to anon, authenticated, service_role;
grant select on public.product_categories to anon, authenticated, service_role;
grant select on public.profiles to authenticated, service_role;
grant update (first_name, notifications_enabled) on public.profiles to authenticated;
grant select on public.promotion_branches to anon, authenticated, service_role;
grant select on public.promotion_group_items to anon, authenticated, service_role;
grant select on public.promotion_groups to anon, authenticated, service_role;
grant select on public.promotion_occurrences to anon, authenticated, service_role;
grant select on public.promotions to anon, authenticated, service_role;
grant select on public.promotions_current to anon, authenticated, service_role;
grant select on public.push_log to authenticated;
grant select, insert on public.push_log to service_role;
grant select, delete on public.push_subscriptions to service_role;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.regular_prices_current to anon, authenticated, service_role;
grant select on public.regular_prices_feed to anon, authenticated, service_role;
grant select on public.sku_barcodes to anon;
grant select, insert, update on public.sku_barcodes to service_role;
grant select, insert, update, delete on public.sku_barcodes to authenticated;
grant select on public.skus to anon;
grant select, insert, update on public.skus to service_role;
grant select, insert, update, delete on public.skus to authenticated;
grant select, update on public.source_products to authenticated;
grant select, insert, update on public.source_products to service_role;
grant select on public.sources to anon, authenticated, service_role;
grant select on public.stores to anon, service_role;
grant select, insert, update, delete on public.stores to authenticated;
grant select on public.user_favorite_beers to service_role;
grant select, insert, update, delete on public.user_favorite_beers to authenticated;
grant select on public.watchlist to service_role;
grant select, insert, update, delete on public.watchlist to authenticated;

-- One tool loses a privilege it was using: scripts/seed-demo-deals.mjs inserts
-- into `deals` as the service role, which no migration ever granted — it worked
-- only because the platform had. It is a dev/staging seeder that already refuses
-- to run against production, and widening the boundary of the live write path to
-- keep a seeder convenient is the wrong trade. If it is wanted back, it should
-- go through admin_add_deal() like every other manual deal.
--
-- And the three tables that are meant to have nothing, named here so that the
-- intent is visible rather than implied by their absence from the list above:
-- admin_actions (0032), display_name_changes (0033), submission_blocks (0035).
-- Each is reached only through a guarded SECURITY DEFINER function.
