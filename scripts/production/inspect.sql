-- READ-ONLY. What a database holds, before and after migrating (docs/PRODUCTION-HANDOFF-YONI.md §C, §D).
-- Safe on any schema version: a table that does not exist yet is reported as null, never an error.
--   npx supabase db query --linked -f scripts/production/inspect.sql
-- It prints counts only — no names, e-mails, prices or keys.
create or replace function pg_temp.n(t text, filter text default 'true') returns bigint language plpgsql as $$
declare v bigint;
begin
  if to_regclass(t) is null then return null; end if;
  execute format('select count(*) from %s where %s', t, filter) into v;
  return v;
end $$;
-- The CLI's migration history. The table does not exist on a database the CLI never pushed to.
create or replace function pg_temp.history(what text) returns text language plpgsql as $$
declare v text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then return 'no history table'; end if;
  if what = 'latest' then
    select max(version) into v from supabase_migrations.schema_migrations;
  else
    select coalesce(string_agg(version, ',' order by version), 'empty') into v from supabase_migrations.schema_migrations;
  end if;
  return v;
end $$;

select
  current_database()                                                            as database,
  pg_temp.history('latest')                                                     as latest_migration,
  pg_temp.history('all')                                                        as migrations_recorded,
  pg_temp.n('auth.users')                                                       as auth_users,
  pg_temp.n('auth.users', 'is_anonymous')                                       as auth_users_anonymous,
  pg_temp.n('public.profiles')                                                  as profiles,
  pg_temp.n('public.user_favorite_beers')                                       as favourites,
  pg_temp.n('public.push_subscriptions')                                        as push_subscriptions,
  pg_temp.n('public.beers')                                                     as beers,
  pg_temp.n('public.stores')                                                    as retailers,
  pg_temp.n('public.deals')                                                     as legacy_deals,
  pg_temp.n('public.deals', $f$status = 'approved'$f$)                          as legacy_deals_public,
  -- the 15 invented "מבצע לדוגמה" prices once seeded into production: migration 0006 retires them
  pg_temp.n('public.deals', $f$notes = 'מבצע לדוגמה' and status <> 'inactive'$f$) as legacy_sample_deals_still_shown,
  pg_temp.n('public.price_observations', $f$kind = 'regular' and status = 'live'$f$)   as regular_prices_live,
  pg_temp.n('public.price_observations', $f$kind = 'promotion' and status = 'live'$f$) as promotions_live,
  pg_temp.n('public.price_observations', $f$status = 'held'$f$)                        as held_for_review,
  pg_temp.n('public.promotion_groups', $f$status = 'live'$f$)                          as mix_and_match_live,
  pg_temp.n('public.promotions')                                                as canonical_promotions,
  pg_temp.n('public.promotion_occurrences')                                     as promotion_occurrences,
  pg_temp.n('public.branches')                                                  as branches,
  pg_temp.n('public.branch_scans')                                              as branch_scans,
  pg_temp.n('public.ingestion_runs')                                            as import_runs,
  pg_temp.n('public.ingestion_runs', $f$status = 'running'$f$)                  as import_runs_open,
  pg_temp.n('public.notification_events', $f$status = 'pending'$f$)             as notifications_pending,
  pg_temp.n('public.notification_deliveries', $f$status = 'sent'$f$)            as notifications_sent_ever;
