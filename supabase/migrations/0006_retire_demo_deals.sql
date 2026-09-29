-- ---------------------------------------------------------------------------
-- 0006 — hotfix data changes (safe to re-run; no schema is dropped or rewritten)
--
--  1. Retire the sample ("demo") deals that were seeded into production.
--  2. Make `notifications_enabled` mean what it says.
--  3. Give the push sender's service role the privileges it actually uses.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- 1. Sample deals.
--
-- supabase/MAKE_ME_ADMIN.sql used to insert 15 invented prices, marked only by
-- the note below. They were then shown to real users as real deals — including
-- as the "deal of the week". Taking them to `inactive` uses the state the
-- product already has for "no longer public": the rows stay (so the change can
-- be inspected, and dev/staging seeds can recreate them), but nothing shows
-- them. Approval attribution is cleared, as set_deal_status() does.
-- --------------------------------------------------------------------------

update public.app_settings
   set weekly_deal_id = null
 where weekly_deal_id in (select id from public.deals where notes = 'מבצע לדוגמה');

update public.deals
   set status = 'inactive', approved_by = null, approved_at = null
 where notes = 'מבצע לדוגמה' and status <> 'inactive';

-- --------------------------------------------------------------------------
-- 2. Notification preference.
--
-- `notifications_enabled` defaulted to TRUE, so every profile claimed to want
-- push whether or not a device had ever subscribed, and the Settings switch
-- showed "active" for people who had never been asked. A push needs BOTH a
-- subscription and this flag, so only profiles that actually have a
-- subscription keep it.
-- --------------------------------------------------------------------------

alter table public.profiles alter column notifications_enabled set default false;

update public.profiles p
   set notifications_enabled = false
 where p.notifications_enabled
   and not exists (select 1 from public.push_subscriptions s where s.user_id = p.id);

-- --------------------------------------------------------------------------
-- 3. Service role privileges.
--
-- The project is set up with "automatically expose new tables" OFF (see
-- docs/setup.md), which also means nothing is granted to `service_role` unless
-- a migration says so. The push sender (src/lib/push/notify.ts) reads and
-- writes the tables below with that role. Least privilege: exactly these verbs,
-- and on `deals` only the one column the sender updates.
-- --------------------------------------------------------------------------

grant select on
  public.profiles,
  public.deals,
  public.beers,
  public.stores,
  public.app_settings,
  public.user_favorite_beers
to service_role;

grant select, delete on public.push_subscriptions to service_role;
grant select, insert on public.push_log to service_role;
grant update (notified_at) on public.deals to service_role;
