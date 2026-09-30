-- READ-ONLY. After `supabase db push`: is the schema release 0.9.0 needs all there? (docs/PRODUCTION-HANDOFF-YONI.md §D)
--   npx supabase db query --linked -f scripts/production/verify-schema.sql
-- Every column must be true (and missing must be empty). Nothing is written.
with checks(name, ok) as (
  values
    ('migrations 0001–0018 recorded',            (select count(*) = 18 and max(version) = '0018' from supabase_migrations.schema_migrations where version between '0001' and '0018')),
    ('0006 sample deals retired',                 (select count(*) = 0 from public.deals where notes = 'מבצע לדוגמה' and status <> 'inactive')),
    ('0007 catalogue tables',                     to_regclass('public.skus') is not null and to_regclass('public.price_observations') is not null and to_regclass('public.sources') is not null),
    ('0009 offers read model',                    to_regclass('public.offers_ranked') is not null and to_regclass('public.offers_feed') is not null),
    ('0011 regular prices feed',                  to_regclass('public.regular_prices_feed') is not null),
    ('0012 notification outbox',                  to_regclass('public.notification_events') is not null and to_regclass('public.notification_deliveries') is not null),
    ('0013 ingestion runs + rollback',            to_regclass('public.ingestion_runs') is not null and to_regprocedure('public.rollback_ingestion_run(uuid,text)') is not null),
    ('0014 mix-and-match + universal-only rule',  to_regclass('public.promotion_groups') is not null and to_regclass('public.group_offers_feed') is not null and to_regprocedure('public.is_universal_offer(public.promo_type,jsonb)') is not null),
    ('0016 retailers (19) and beers (34+)',       (select count(*) >= 19 from public.stores) and (select count(*) >= 34 from public.beers)),
    ('0017 branch scans',                         to_regclass('public.branch_scans') is not null),
    ('0017 canonical promotions',                 to_regclass('public.promotions') is not null),
    ('0017 promotion occurrences',                to_regclass('public.promotion_occurrences') is not null),
    ('0017 promotion_branches view',              to_regclass('public.promotion_branches') is not null),
    ('0017 feeds carry scope',                    (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name in ('offers_feed', 'group_offers_feed') and column_name = 'scope')),
    ('0017 scope rule: all branches → chainwide', (select scope = 'chainwide' from public.promotion_scope(null, 18, 18, 18))),
    ('0017 scope rule: a sample is never chainwide', (select scope = 'unknown' from public.promotion_scope(null, 18, 1, 1))),
    ('0017 scope rule: some of all → participating', (select scope = 'participating_branches' from public.promotion_scope(null, 18, 18, 12))),
    ('0017 scope rule: one of all → single branch', (select scope = 'single_branch' from public.promotion_scope(null, 18, 18, 1))),
    ('0018 index price_obs_live_store',           to_regclass('public.price_obs_live_store') is not null),
    ('0018 offers_ranked computes once per query', position('store_min' in pg_get_viewdef('public.offers_ranked'::regclass)) > 0),
    ('RLS on every public table',                 (select count(*) = 0 from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)),
    ('feeds readable by the public role',         has_table_privilege('anon', 'public.offers_feed', 'select') and has_table_privilege('anon', 'public.promotion_branches', 'select'))
)
select count(*) filter (where ok) as passed,
       count(*)                   as total,
       coalesce(string_agg(name, ' · ') filter (where not ok or ok is null), '') as missing
  from checks;
