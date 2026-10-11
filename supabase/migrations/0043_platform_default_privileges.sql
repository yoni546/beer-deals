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
--   2. Revokes everything from anon and authenticated, on every table and view
--      in public.
--   3. Re-grants exactly what migrations 0001–0042 actually grant — the list
--      below is replayed from their own GRANT **and REVOKE** statements in
--      migration order, not retyped from memory. Reading only the grants
--      handed `beers` its DELETE back, which 0034 had removed on purpose
--      (a beer is deactivated, never deleted: somebody's favourite points
--      at it). The sweep caught that, which is the whole point of it.
--
-- `service_role` is deliberately left alone. It bypasses RLS by design, it is
-- the key the ingestion and the notification worker run as, it is server-only
-- and never shipped to a browser, and narrowing it is a separate change with
-- its own failure modes. It is not the role a visitor arrives as.
--
-- Additive and reversible in the sense that matters: it only removes privileges
-- nothing is supposed to be using, and re-states the ones that are. If it were
-- to break something, the symptom is a permission error naming the table, and
-- the fix is a grant.
-- ---------------------------------------------------------------------------

-- 1. The source.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- 2. The accumulated grants. Safe for sequences: every generated key in this
--    schema is an identity column, and an identity column needs no sequence
--    privilege from the role doing the insert.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 3. What the migrations actually mean to grant.
grant select on public.admins to authenticated;
grant select on public.app_settings to anon, authenticated;
grant select on public.beers to anon;
grant select, insert, update on public.beers to authenticated;
grant select on public.branch_scans to authenticated;
grant select on public.branches to anon;
grant select, insert, update, delete on public.branches to authenticated;
grant select on public.brands to anon;
grant select, insert, update, delete on public.brands to authenticated;
grant select on public.contributors to anon, authenticated;
grant select, insert, update on public.deal_reports to authenticated;
grant select on public.deals to anon;
grant select, insert, update, delete on public.deals to authenticated;
grant select on public.deals_public to anon, authenticated;
grant select on public.group_offers_feed to anon, authenticated;
grant select on public.ingestion_runs to authenticated;
grant select on public.offer_feedback to anon, authenticated;
grant select on public.offer_scores to anon, authenticated;
grant select on public.offers_feed to anon, authenticated;
grant select on public.offers_ranked to anon, authenticated;
grant select on public.price_observations to anon, authenticated;
grant select on public.product_categories to anon, authenticated;
grant select on public.profiles to authenticated;
grant select on public.promotion_branches to anon, authenticated;
grant select on public.promotion_group_items to anon, authenticated;
grant select on public.promotion_groups to anon, authenticated;
grant select on public.promotion_occurrences to anon, authenticated;
grant select on public.promotions to anon, authenticated;
grant select on public.promotions_current to anon, authenticated;
grant select on public.push_log to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.regular_prices_current to anon, authenticated;
grant select on public.regular_prices_feed to anon, authenticated;
grant select on public.sku_barcodes to anon;
grant select, insert, update, delete on public.sku_barcodes to authenticated;
grant select on public.skus to anon;
grant select, insert, update, delete on public.skus to authenticated;
grant select, update on public.source_products to authenticated;
grant select on public.sources to anon, authenticated;
grant select on public.stores to anon;
grant select, insert, update, delete on public.stores to authenticated;
grant select, insert, update, delete on public.user_favorite_beers to authenticated;
grant select, insert, update, delete on public.watchlist to authenticated;
-- And the three tables that are meant to have nothing, named here so that the
-- intent is visible rather than implied by their absence from the list above:
-- admin_actions (0032), display_name_changes (0033), submission_blocks (0035).
-- Each is reached only through a guarded SECURITY DEFINER function.
