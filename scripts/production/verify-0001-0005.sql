-- READ-ONLY. Were migrations 0001–0005 applied by hand (SQL editor) before the CLI kept a history?
-- (docs/PRODUCTION-HANDOFF-YONI.md §D1). Run it BEFORE any `supabase migration repair`.
--   npx supabase db query --linked -f scripts/production/verify-0001-0005.sql
--
-- One row per migration: how many of the objects it creates exist, which are missing, and the verdict.
-- "APPLIED" = every object that migration creates is in the database → it may be marked applied.
-- Anything else → do NOT repair that version; stop and send Ori the whole output.
-- The last row looks for objects of LATER migrations (0007–0018): the expected answer is "none" — if some
-- exist, more was applied by hand than the history says, and the plan must be decided with Ori.
-- Objects are matched by name (functions by name, not signature: later migrations legitimately redefine some).
with fn(name) as (select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace),
checks(version, object, ok) as (
  values
  -- 0001_schema.sql: types, tables, functions, triggers, indexes
    ('0001', 'type deal_category',              to_regtype('public.deal_category') is not null),
    ('0001', 'type deal_status',                to_regtype('public.deal_status') is not null),
    ('0001', 'type report_status',              to_regtype('public.report_status') is not null),
    ('0001', 'type admin_level',                to_regtype('public.admin_level') is not null),
    ('0001', 'table beers',                     to_regclass('public.beers') is not null),
    ('0001', 'table stores',                    to_regclass('public.stores') is not null),
    ('0001', 'table profiles',                  to_regclass('public.profiles') is not null),
    ('0001', 'table user_favorite_beers',       to_regclass('public.user_favorite_beers') is not null),
    ('0001', 'table admins',                    to_regclass('public.admins') is not null),
    ('0001', 'table deals',                     to_regclass('public.deals') is not null),
    ('0001', 'table deal_reports',              to_regclass('public.deal_reports') is not null),
    ('0001', 'table push_subscriptions',        to_regclass('public.push_subscriptions') is not null),
    ('0001', 'table app_settings',              to_regclass('public.app_settings') is not null),
    ('0001', 'table push_log',                  to_regclass('public.push_log') is not null),
    ('0001', 'function touch_updated_at',       exists (select 1 from fn where name = 'touch_updated_at')),
    ('0001', 'function sync_primary_beer',      exists (select 1 from fn where name = 'sync_primary_beer')),
    ('0001', 'function handle_new_user',        exists (select 1 from fn where name = 'handle_new_user')),
    ('0001', 'trigger on_auth_user_created',    exists (select 1 from pg_trigger where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass)),
    ('0001', 'trigger favorite_beers_sync_primary', exists (select 1 from pg_trigger where tgname = 'favorite_beers_sync_primary')),
    ('0001', 'trigger profiles_touch',          exists (select 1 from pg_trigger where tgname = 'profiles_touch')),
    ('0001', 'trigger deals_touch',             exists (select 1 from pg_trigger where tgname = 'deals_touch')),
    ('0001', 'trigger app_settings_touch',      exists (select 1 from pg_trigger where tgname = 'app_settings_touch')),
    ('0001', 'index deals_public_by_beer_idx',  to_regclass('public.deals_public_by_beer_idx') is not null),
    ('0001', 'index deals_public_by_store_idx', to_regclass('public.deals_public_by_store_idx') is not null),
    ('0001', 'index deals_moderation_idx',      to_regclass('public.deals_moderation_idx') is not null),
    ('0001', 'index deal_reports_one_open_per_user_idx', to_regclass('public.deal_reports_one_open_per_user_idx') is not null),
    ('0001', 'index push_subscriptions_user_idx', to_regclass('public.push_subscriptions_user_idx') is not null),
  -- 0002_functions.sql: the public view and the RPC functions
    ('0002', 'view deals_public',               to_regclass('public.deals_public') is not null),
    ('0002', 'function is_admin',               exists (select 1 from fn where name = 'is_admin')),
    ('0002', 'function is_super_admin',         exists (select 1 from fn where name = 'is_super_admin')),
    ('0002', 'function require_admin',          exists (select 1 from fn where name = 'require_admin')),
    ('0002', 'function require_super_admin',    exists (select 1 from fn where name = 'require_super_admin')),
    ('0002', 'function save_preferences',       exists (select 1 from fn where name = 'save_preferences')),
    ('0002', 'function approve_deal',           exists (select 1 from fn where name = 'approve_deal')),
    ('0002', 'function set_deal_status',        exists (select 1 from fn where name = 'set_deal_status')),
    ('0002', 'function admin_update_deal',      exists (select 1 from fn where name = 'admin_update_deal')),
    ('0002', 'function resolve_report',         exists (select 1 from fn where name = 'resolve_report')),
    ('0002', 'function set_weekly_deal',        exists (select 1 from fn where name = 'set_weekly_deal')),
    ('0002', 'function update_notification_settings', exists (select 1 from fn where name = 'update_notification_settings')),
    ('0002', 'function grant_admin',            exists (select 1 from fn where name = 'grant_admin')),
    ('0002', 'function revoke_admin',           exists (select 1 from fn where name = 'revoke_admin')),
    ('0002', 'function save_push_subscription', exists (select 1 from fn where name = 'save_push_subscription')),
    ('0002', 'anon may read deals_public',      to_regclass('public.deals_public') is not null and has_table_privilege('anon', 'public.deals_public', 'select')),
  -- 0003_rls.sql: row level security on the ten tables, their policies, the image bucket and its policies
    ('0003', 'RLS on all ten 0001 tables',      (select count(*) = 10 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relrowsecurity
                                                   and c.relname in ('beers','stores','profiles','user_favorite_beers','admins','deals','deal_reports','push_subscriptions','app_settings','push_log'))),
    ('0003', 'the 22 table policies',           (select count(*) = 22 from pg_policies where schemaname = 'public' and policyname in (
                                                   'stores_read','stores_admin_write','reports_read_own','reports_read_admin','reports_file','reports_admin_update',
                                                   'push_subscriptions_own','push_log_read_own','profiles_update_own','profiles_read_own','favorites_write_own',
                                                   'favorites_read_own','deals_super_admin_delete','deals_submit','deals_read_own','deals_read_approved',
                                                   'deals_read_admin','deals_admin_update','beers_read','beers_admin_write','app_settings_read','admins_read'))),
    ('0003', 'storage bucket deal-images',      exists (select 1 from storage.buckets where id = 'deal-images')),
    ('0003', 'the 3 image policies',            (select count(*) = 3 from pg_policies where schemaname = 'storage' and policyname in (
                                                   'users upload deal images into their own folder','deal images are public','admins manage deal images'))),
  -- 0004_seed.sql: the first 22 beers and 15 shops (by slug)
    ('0004', 'the 22 seeded beers',             (select count(*) = 22 from public.beers where slug in (
                                                   'goldstar','maccabee','heineken','carlsberg','corona','tuborg','stella','becks','tuborg-red','paulaner','weihen',
                                                   'erdinger','guinness','leffe','desperados','budweiser','shapiro','alexander','malka','negev','bazelet','somersby'))),
    ('0004', 'the 15 seeded shops',             (select count(*) = 15 from public.stores where slug in (
                                                   'rami-levy','shufersal','yochananof','victory','osher-ad','yeinot-bitan','tiv-taam','mahsanei','carrefour',
                                                   'hatzi-hinam','super-yuda','king-store','ampm','liquor-store','makolet'))),
  -- 0005_one_deal_per_shelf.sql: the unique index and the approve_deal that explains the collision
    ('0005', 'index deals_one_approved_per_shelf_idx', to_regclass('public.deals_one_approved_per_shelf_idx') is not null),
    ('0005', 'approve_deal explains a duplicate', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'approve_deal'
                                                   and prosrc like '%כבר יש מבצע מאושר על הבירה הזו%'))
),
later(object, present) as (
  values
    ('0007 skus / price_observations',  to_regclass('public.skus') is not null or to_regclass('public.price_observations') is not null),
    ('0009 offers_feed',                 to_regclass('public.offers_feed') is not null),
    ('0012 notification_events',         to_regclass('public.notification_events') is not null),
    ('0013 ingestion_runs',              to_regclass('public.ingestion_runs') is not null),
    ('0014 promotion_groups',            to_regclass('public.promotion_groups') is not null),
    ('0017 promotions / branch_scans',   to_regclass('public.promotions') is not null or to_regclass('public.branch_scans') is not null),
    ('0018 price_obs_live_store',        to_regclass('public.price_obs_live_store') is not null)
)
select version,
       count(*) filter (where ok)                                     as present,
       count(*)                                                       as expected,
       coalesce(string_agg(object, ' · ') filter (where not ok), '')  as detail,
       case when bool_and(ok) then 'APPLIED — may be marked applied' else 'NOT PROVEN — do not repair; send Ori this output' end as verdict
  from checks
 group by version
union all
select 'later',
       count(*) filter (where present),
       count(*),
       coalesce(string_agg(object, ' · ') filter (where present), ''),
       case when bool_or(present) then 'LATER OBJECTS EXIST — stop; send Ori this output' else 'none (as expected)' end
  from later
 order by 1;
