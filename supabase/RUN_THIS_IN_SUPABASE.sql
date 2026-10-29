-- ===========================================================================
-- Beer Deals — the whole schema, in one file.   *** GENERATED — DO NOT EDIT ***
--
-- Regenerate with:  npm run sql:build     (source: supabase/migrations/*.sql)
--
-- Paste all of this into the Supabase SQL Editor and press Run, once, on a
-- FRESH project. Re-running it will complain that the types already exist,
-- which is harmless but means nothing after that point gets applied.
--
-- Existing projects: apply only the migrations you have not run yet, in order.
-- ===========================================================================

-- ======================== 0001_schema.sql ========================

-- ---------------------------------------------------------------------------
-- Beer Deals — core schema
--
-- Money is stored as a whole number of agorot in an integer column, never as a
-- float. `parseFloat('24.90') * 100` is 2489.9999999999995; a price that is
-- wrong in the fourth decimal place is still a wrong price. The client converts
-- on the *string* (see src/lib/money.ts) and the database only ever sees an int.
--
-- The discount percentage is a GENERATED column. The spec says users never type
-- it, and a generated column is the only way to make that structurally true —
-- there is no code path, RPC or admin edit that can make it disagree with the
-- two prices it is derived from.
-- ---------------------------------------------------------------------------

-- gen_random_uuid() is core Postgres since 13, so no extension is needed.
-- (Requiring pgcrypto would also break the PGlite-based tests, which run the
-- real migrations against Postgres compiled to WebAssembly.)

-- --------------------------------------------------------------------------
-- Enums
-- --------------------------------------------------------------------------

-- The three deal categories. Prices are NEVER compared across categories, so
-- every read path filters on this column.
create type public.deal_category as enum ('sixpack', 'case', 'single');

create type public.deal_status as enum ('pending', 'approved', 'rejected', 'inactive');

create type public.report_status as enum ('open', 'resolved', 'dismissed');

-- Two levels only. `super_admin` is the sole level that may write to
-- public.admins — i.e. that may create or destroy other admins.
create type public.admin_level as enum ('admin', 'super_admin');

-- --------------------------------------------------------------------------
-- Beers
--
-- theme_* drives the personalised look. These are our own colours chosen to
-- evoke each beer, not brand assets: no logos, no official palettes, no
-- trade dress. The layout is identical for every theme; only the colour
-- variables change.
-- --------------------------------------------------------------------------

create table public.beers (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name_he       text not null,
  name_en       text not null,
  theme_base    text not null default '#1c1917',  -- page background
  theme_surface text not null default '#292524',  -- card background
  theme_accent  text not null default '#f59e0b',  -- price, primary buttons
  theme_ink     text not null default '#fafaf9',  -- text on base
  sort_order    integer not null default 100,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create index beers_active_idx on public.beers (is_active, sort_order, name_he);

-- --------------------------------------------------------------------------
-- Stores
--
-- Chains, not branches. The spec is explicit: a deal belongs to "רמי לוי", not
-- to "רמי לוי, סניף תלפיות". There is deliberately no branch table.
-- --------------------------------------------------------------------------

create table public.stores (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name_he    text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create index stores_active_idx on public.stores (is_active, name_he);

-- --------------------------------------------------------------------------
-- Profiles
--
-- One row per auth user, including anonymous ones. Everyone who opens the app
-- gets an anonymous Supabase session, so every visitor has a real auth.uid()
-- and RLS — not the frontend — owns every access decision.
--
-- primary_beer_id is denormalised from user_favorite_beers rank 1. It is kept
-- in step by a trigger below rather than by application code, because it drives
-- both the theme and who gets notified.
-- --------------------------------------------------------------------------

create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  first_name            text check (char_length(trim(first_name)) between 1 and 40),
  primary_beer_id       uuid references public.beers (id) on delete set null,
  notifications_enabled boolean not null default true,
  onboarded_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- Favourite beers — exactly a ranked list, enforced by the keys.
--
-- rank is 1..4 and unique per profile, so "two beers ranked #2" cannot exist.
-- rank 1 IS the Primary Beer; there is no second source of truth.
-- --------------------------------------------------------------------------

create table public.user_favorite_beers (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  beer_id    uuid not null references public.beers (id) on delete cascade,
  rank       smallint not null check (rank between 1 and 4),
  primary key (profile_id, rank),
  unique (profile_id, beer_id)
);

-- --------------------------------------------------------------------------
-- Admins
--
-- Deliberately a separate table rather than a column on profiles: a role is not
-- a preference, and keeping it apart means the policy that guards it can be
-- read on its own. Only a super_admin may write here (see 0003_rls.sql).
-- --------------------------------------------------------------------------

create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  level      public.admin_level not null default 'admin',
  added_by   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- Deals
--
-- A submitted deal is born `pending` and is invisible to the public until an
-- admin approves it. The default on `status` is part of that guarantee: an
-- INSERT that forgets to set it still cannot publish anything.
-- --------------------------------------------------------------------------

create table public.deals (
  id                 uuid primary key default gen_random_uuid(),
  beer_id            uuid not null references public.beers (id) on delete restrict,
  store_id           uuid not null references public.stores (id) on delete restrict,
  category           public.deal_category not null,

  -- Whole agorot. Strictly positive, and a "deal" that costs at least as much
  -- as the regular price is not a deal.
  deal_price_agorot    integer not null check (deal_price_agorot > 0),
  regular_price_agorot integer not null check (regular_price_agorot > 0),
  constraint deals_price_is_a_discount check (deal_price_agorot < regular_price_agorot),

  -- Computed, never entered. Rounded to the nearest whole percent for display.
  discount_percent integer generated always as (
    round(((regular_price_agorot - deal_price_agorot)::numeric * 100) / regular_price_agorot)
  ) stored,

  image_url   text,
  notes       text check (char_length(notes) <= 280),

  status      public.deal_status not null default 'pending',
  created_by  uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  updated_at  timestamptz not null default now(),

  -- Set when a push has gone out for this deal, so approving → editing →
  -- re-approving cannot notify the same people twice.
  notified_at timestamptz,

  -- An approved deal must record who approved it and when. This is an audit
  -- trail the UI cannot forget to write.
  constraint deals_approved_is_attributed check (
    status <> 'approved' or (approved_by is not null and approved_at is not null)
  )
);

-- The hot path: "approved deals for this beer in this category, cheapest
-- first". Ordering lives in the index so the list is already sorted.
create index deals_public_by_beer_idx
  on public.deals (beer_id, category, deal_price_agorot)
  where status = 'approved';

-- "approved deals at this store in this category", ordered by how good they are.
create index deals_public_by_store_idx
  on public.deals (store_id, category, discount_percent desc)
  where status = 'approved';

-- The admin queue.
create index deals_moderation_idx on public.deals (status, created_at desc);

create index deals_created_by_idx on public.deals (created_by, created_at desc);

-- --------------------------------------------------------------------------
-- Deal reports
--
-- A report NEVER changes the deal. It creates a task for an admin, who decides.
-- There is no trigger here that touches deals.status, and that absence is the
-- feature.
-- --------------------------------------------------------------------------

create table public.deal_reports (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals (id) on delete cascade,
  reported_by uuid references auth.users (id) on delete set null,
  reason      text check (char_length(reason) <= 280),
  status      public.report_status not null default 'open',
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),

  -- One open report per person per deal: re-reporting is a no-op, not a way to
  -- flood the admin queue.
  constraint deal_reports_resolution_is_attributed check (
    status = 'open' or (resolved_by is not null and resolved_at is not null)
  )
);

create unique index deal_reports_one_open_per_user_idx
  on public.deal_reports (deal_id, reported_by)
  where status = 'open' and reported_by is not null;

create index deal_reports_queue_idx on public.deal_reports (status, created_at desc);

-- --------------------------------------------------------------------------
-- Push subscriptions — one row per browser/device endpoint.
-- --------------------------------------------------------------------------

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- --------------------------------------------------------------------------
-- App settings — a single row, held to one row by the primary key.
--
-- Holds the admin-chosen Weekly Deal and the thresholds that decide what counts
-- as a "strong" deal worth waking someone's phone for.
-- --------------------------------------------------------------------------

create table public.app_settings (
  id                        boolean primary key default true check (id),
  weekly_deal_id            uuid references public.deals (id) on delete set null,
  weekly_deal_set_by        uuid references auth.users (id) on delete set null,
  weekly_deal_set_at        timestamptz,

  -- Notification thresholds. A deal must clear BOTH to be push-worthy.
  notify_min_discount_percent integer not null default 25
    check (notify_min_discount_percent between 0 and 100),
  notify_max_price_agorot     integer not null default 3000
    check (notify_max_price_agorot > 0),

  -- Never wake the same person about the same beer more often than this.
  notify_cooldown_hours integer not null default 20 check (notify_cooldown_hours >= 0),

  -- When a Goldstar deal and another beer's deal are both candidates for the
  -- Weekly Deal, Goldstar wins ties. Stored as a slug so it is changeable.
  weekly_deal_preferred_beer_slug text default 'goldstar',

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.app_settings (id) values (true);

-- Records what we actually sent, so the cooldown above is enforceable and so a
-- notification bug is diagnosable after the fact.
create table public.push_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  deal_id    uuid references public.deals (id) on delete set null,
  beer_id    uuid references public.beers (id) on delete set null,
  sent_at    timestamptz not null default now()
);

create index push_log_user_beer_idx on public.push_log (user_id, beer_id, sent_at desc);

-- --------------------------------------------------------------------------
-- updated_at
-- --------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger deals_touch before update on public.deals
  for each row execute function public.touch_updated_at();

create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------
-- Primary Beer = favourite rank 1, kept true by the database.
--
-- Application code sets the ranked list; this trigger derives the Primary Beer
-- from it. Keeping them in step in TypeScript would mean a half-finished
-- onboarding could leave a profile themed after a beer the user never picked.
-- --------------------------------------------------------------------------

create or replace function public.sync_primary_beer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_profile uuid := coalesce(new.profile_id, old.profile_id);
begin
  update public.profiles p set primary_beer_id = (
       select f.beer_id from public.user_favorite_beers f
        where f.profile_id = target_profile and f.rank = 1
     )
   where p.id = target_profile;
  return null;
end;
$$;

create trigger favorite_beers_sync_primary
  after insert or update or delete on public.user_favorite_beers
  for each row execute function public.sync_primary_beer();

-- --------------------------------------------------------------------------
-- A profile row for every auth user, anonymous ones included, created by the
-- database at sign-up. If the client had to create it, a user whose first
-- request failed would exist in auth but nowhere else.
-- --------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ======================== 0002_functions.sql ========================

-- ---------------------------------------------------------------------------
-- Beer Deals — authorisation helpers and the write API.
--
-- Every privileged state change goes through a function here rather than
-- through a raw UPDATE from the client. Two reasons:
--   1. Transitions are atomic and complete — approving a deal sets status,
--      approved_by and approved_at together, so the audit trail cannot be
--      forgotten.
--   2. The permission check lives next to the write, in the database. Hiding a
--      button in React is a courtesy to the user, not a security boundary.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Role checks.
--
-- SECURITY DEFINER because policies ON public.admins would otherwise have to
-- read public.admins to decide whether you may read public.admins. `stable`
-- lets the planner call it once per statement instead of once per row.
-- --------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a
     where a.user_id = auth.uid() and a.level = 'super_admin'
  );
$$;

revoke execute on function public.is_admin() from public;
revoke execute on function public.is_super_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;
grant execute on function public.is_super_admin() to authenticated, anon;

-- Raises rather than returning false: a caller that forgets to check the result
-- of a boolean helper fails open, and a caller that ignores an exception does
-- not exist.
create or replace function public.require_admin()
returns void
language plpgsql
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.require_super_admin()
returns void
language plpgsql
stable
as $$
begin
  if not public.is_super_admin() then
    raise exception 'super admin privileges required' using errcode = '42501';
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- Onboarding: name + exactly four ranked beers, written as one transaction.
--
-- Taking the whole ranked list at once is what makes the state legal at every
-- commit. Four separate inserts from the client could leave a profile with two
-- favourites and a theme derived from a beer the user was still choosing.
-- --------------------------------------------------------------------------

create or replace function public.save_preferences(
  p_first_name text,
  p_beer_ids   uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  i   integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_beer_ids is null or array_length(p_beer_ids, 1) <> 4 then
    raise exception 'choose exactly four beers' using errcode = '22023';
  end if;

  if (select count(distinct b) from unnest(p_beer_ids) b) <> 4 then
    raise exception 'the four beers must be different' using errcode = '22023';
  end if;

  update public.profiles set first_name   = trim(p_first_name),
         onboarded_at = coalesce(onboarded_at, now())
   where id = uid;

  -- Replace the list wholesale. Ranks are a unique key, so shuffling an
  -- existing list in place would collide partway through.
  delete from public.user_favorite_beers where profile_id = uid;

  for i in 1 .. 4 loop
    insert into public.user_favorite_beers (profile_id, beer_id, rank)
    values (uid, p_beer_ids[i], i::smallint);
  end loop;
end;
$$;

-- --------------------------------------------------------------------------
-- Moderation.
--
-- Note what approve_deal does NOT do: it does not send a notification. Deciding
-- whether a deal is push-worthy needs the thresholds in app_settings and a web
-- push library, so it happens in a server action after this returns. The
-- database's job is to make the state change correct and attributable.
-- --------------------------------------------------------------------------

create or replace function public.approve_deal(p_deal_id uuid)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.deals;
begin
  perform public.require_admin();

  update public.deals set status      = 'approved',
         approved_by = auth.uid(),
         approved_at = now()
   where id = p_deal_id
  returning * into row;

  if row.id is null then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;

  return row;
end;
$$;

create or replace function public.set_deal_status(p_deal_id uuid, p_status public.deal_status)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.deals;
begin
  perform public.require_admin();

  if p_status = 'approved' then
    -- Approval carries an audit trail, so it has its own entry point.
    return public.approve_deal(p_deal_id);
  end if;

  update public.deals set status = p_status,
         -- Leaving approved_by/at set on a deal that is no longer approved
         -- would misreport who stands behind it now.
         approved_by = null,
         approved_at = null
   where id = p_deal_id
  returning * into row;

  if row.id is null then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;

  -- A deal that is no longer public cannot remain the Weekly Deal.
  update public.app_settings set weekly_deal_id = null
   where id and weekly_deal_id = p_deal_id;

  return row;
end;
$$;

-- Editing a deal. Prices come in as agorot; discount_percent recomputes itself.
create or replace function public.admin_update_deal(
  p_deal_id              uuid,
  p_beer_id              uuid,
  p_store_id             uuid,
  p_category             public.deal_category,
  p_deal_price_agorot    integer,
  p_regular_price_agorot integer,
  p_notes                text
)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.deals;
begin
  perform public.require_admin();

  update public.deals set beer_id              = p_beer_id,
         store_id             = p_store_id,
         category             = p_category,
         deal_price_agorot    = p_deal_price_agorot,
         regular_price_agorot = p_regular_price_agorot,
         notes                = p_notes
   where id = p_deal_id
  returning * into row;

  if row.id is null then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;

  return row;
end;
$$;

-- --------------------------------------------------------------------------
-- Reports.
--
-- resolve_report only closes the report. Whether the deal itself comes down is
-- a separate, explicit call to set_deal_status — an admin decision, never a
-- consequence of someone pressing "the deal has ended".
-- --------------------------------------------------------------------------

create or replace function public.resolve_report(
  p_report_id uuid,
  p_status    public.report_status
)
returns public.deal_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.deal_reports;
begin
  perform public.require_admin();

  if p_status = 'open' then
    raise exception 'a report is resolved or dismissed, not reopened' using errcode = '22023';
  end if;

  update public.deal_reports set status = p_status, resolved_by = auth.uid(), resolved_at = now()
   where id = p_report_id
  returning * into row;

  if row.id is null then
    raise exception 'report not found' using errcode = 'P0002';
  end if;

  return row;
end;
$$;

-- --------------------------------------------------------------------------
-- Weekly Deal and notification thresholds.
-- --------------------------------------------------------------------------

create or replace function public.set_weekly_deal(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  if p_deal_id is not null and not exists (
    select 1 from public.deals d where d.id = p_deal_id and d.status = 'approved'
  ) then
    raise exception 'the weekly deal must be an approved deal' using errcode = '22023';
  end if;

  update public.app_settings set weekly_deal_id     = p_deal_id,
         weekly_deal_set_by = auth.uid(),
         weekly_deal_set_at = now(),
         updated_by         = auth.uid()
   where id;
end;
$$;

create or replace function public.update_notification_settings(
  p_min_discount_percent integer,
  p_max_price_agorot     integer,
  p_cooldown_hours       integer
)
returns public.app_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.app_settings;
begin
  -- Thresholds decide who gets woken up at 22:00, so this is a super-admin
  -- setting rather than an ordinary admin one, per the spec.
  perform public.require_super_admin();

  update public.app_settings set notify_min_discount_percent = p_min_discount_percent,
         notify_max_price_agorot     = p_max_price_agorot,
         notify_cooldown_hours       = p_cooldown_hours,
         updated_by                  = auth.uid()
   where id
  returning * into row;

  return row;
end;
$$;

-- --------------------------------------------------------------------------
-- Admin management — super admin only.
--
-- Takes an email rather than a uuid because that is what a human knows. The
-- person must already have signed in at least once with that email; we do not
-- create accounts here.
-- --------------------------------------------------------------------------

create or replace function public.grant_admin(p_email text, p_level public.admin_level)
returns public.admins
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  row    public.admins;
begin
  perform public.require_super_admin();

  select u.id into target
    from auth.users u
   where lower(u.email) = lower(trim(p_email))
   limit 1;

  if target is null then
    raise exception 'no user has signed in with that email yet' using errcode = 'P0002';
  end if;

  insert into public.admins (user_id, level, added_by)
  values (target, p_level, auth.uid())
  on conflict (user_id) do update set level = excluded.level
  returning * into row;

  return row;
end;
$$;

create or replace function public.revoke_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_super_admin();

  if p_user_id = auth.uid() then
    -- Guards against the one irreversible mistake in this system: an admin
    -- table with nobody left who can write to it.
    raise exception 'you cannot remove yourself' using errcode = '22023';
  end if;

  delete from public.admins where user_id = p_user_id;
end;
$$;

-- --------------------------------------------------------------------------
-- Push subscriptions. Upsert on the endpoint: browsers hand back the same
-- endpoint for the same install, and re-subscribing should not pile up rows.
-- --------------------------------------------------------------------------

create or replace function public.save_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update set user_id    = excluded.user_id,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        user_agent = excluded.user_agent,
        last_seen  = now();
end;
$$;

-- --------------------------------------------------------------------------
-- The read model.
--
-- security_invoker = on means this view is not a hole in RLS: it runs with the
-- caller's permissions, so the `status = 'approved'` filter below is a
-- convenience and the policy on public.deals is still what enforces it.
-- --------------------------------------------------------------------------

create view public.deals_public
with (security_invoker = on)
as
select
  d.id,
  d.beer_id,
  d.store_id,
  d.category,
  d.deal_price_agorot,
  d.regular_price_agorot,
  d.discount_percent,
  d.image_url,
  d.notes,
  d.approved_at,
  d.created_at,
  b.slug         as beer_slug,
  b.name_he      as beer_name,
  b.theme_accent as beer_accent,
  s.slug         as store_slug,
  s.name_he      as store_name
from public.deals d
join public.beers  b on b.id = d.beer_id
join public.stores s on s.id = d.store_id
where d.status = 'approved';

grant select on public.deals_public to anon, authenticated;

grant execute on function public.save_preferences(text, uuid[])            to authenticated;
grant execute on function public.approve_deal(uuid)                        to authenticated;
grant execute on function public.set_deal_status(uuid, public.deal_status) to authenticated;
grant execute on function public.admin_update_deal(uuid, uuid, uuid, public.deal_category, integer, integer, text) to authenticated;
grant execute on function public.resolve_report(uuid, public.report_status) to authenticated;
grant execute on function public.set_weekly_deal(uuid)                     to authenticated;
grant execute on function public.update_notification_settings(integer, integer, integer) to authenticated;
grant execute on function public.grant_admin(text, public.admin_level)     to authenticated;
grant execute on function public.revoke_admin(uuid)                        to authenticated;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- require_admin/require_super_admin are internal; nothing outside these
-- functions should be calling them.
revoke execute on function public.require_admin()       from public, anon, authenticated;
revoke execute on function public.require_super_admin() from public, anon, authenticated;

-- ======================== 0003_rls.sql ========================

-- ---------------------------------------------------------------------------
-- Beer Deals — Row Level Security.
--
-- Every table is locked by default and opened one policy at a time. The rule
-- the spec cares most about — "a submitted deal is not visible until an admin
-- approves it" — is a SELECT policy here, not a WHERE clause in a component.
-- If every line of the frontend were deleted, these rules would still hold.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Table privileges.
--
-- Two different questions, and both have to be answered. A GRANT decides
-- whether a role may touch the table at all; a POLICY decides which rows it
-- then sees. RLS on a table with no grant is unreachable, and a grant with no
-- policy is wide open — so each table below gets exactly the verbs it needs.
--
-- These are written out rather than left to Supabase's "automatically expose
-- new tables" setting, which hands every new table to the API by default. That
-- setting is off for this project on purpose: a table added later should be
-- invisible until somebody deliberately opens it, not the other way round. The
-- tests run against these same grants, so a missing one fails the suite instead
-- of production.
-- --------------------------------------------------------------------------

grant select on public.beers        to anon, authenticated;
grant select on public.stores       to anon, authenticated;
grant select on public.app_settings to anon, authenticated;
grant select on public.deals        to anon, authenticated;

-- Catalogue edits are an admin job, gated by the policies below.
grant insert, update, delete on public.beers  to authenticated;
grant insert, update, delete on public.stores to authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_favorite_beers to authenticated;

-- Reading the roster answers "am I an admin?". Writing it is possible only
-- through grant_admin()/revoke_admin(), which run as the owner — so no INSERT,
-- UPDATE or DELETE is granted here at all.
grant select on public.admins to authenticated;

-- INSERT is a submission; UPDATE and DELETE are admin-only by policy.
grant insert, update, delete on public.deals to authenticated;

grant select, insert, update on public.deal_reports to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Written only by the notification sender, which uses the service role.
grant select on public.push_log to authenticated;

alter table public.beers               enable row level security;
alter table public.stores              enable row level security;
alter table public.profiles            enable row level security;
alter table public.user_favorite_beers enable row level security;
alter table public.admins              enable row level security;
alter table public.deals               enable row level security;
alter table public.deal_reports        enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.app_settings        enable row level security;
alter table public.push_log            enable row level security;

-- --------------------------------------------------------------------------
-- Catalogue: world-readable, admin-writable.
-- --------------------------------------------------------------------------

create policy beers_read on public.beers
  for select to anon, authenticated using (true);

create policy beers_admin_write on public.beers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy stores_read on public.stores
  for select to anon, authenticated using (true);

create policy stores_admin_write on public.stores
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- Profiles: yours, and nobody else's.
--
-- Admins are deliberately NOT given read access to every profile. Moderating
-- deals does not require knowing who else uses the app; the notification sender
-- reads profiles with the service role, outside RLS, for the one job that needs
-- it.
-- --------------------------------------------------------------------------

create policy profiles_read_own on public.profiles
  for select to authenticated using (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- No INSERT policy: rows are created by the on_auth_user_created trigger.
-- No DELETE policy: profiles die with their auth user, by cascade.

create policy favorites_read_own on public.user_favorite_beers
  for select to authenticated using (profile_id = auth.uid());

create policy favorites_write_own on public.user_favorite_beers
  for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- --------------------------------------------------------------------------
-- Admins.
--
-- Readable by any signed-in user so the app can ask "am I an admin?" and so an
-- admin can see the roster. Writable only through grant_admin/revoke_admin,
-- which check is_super_admin() — there is no policy that permits a direct
-- INSERT here at all, which is the point: a regular admin cannot promote
-- themselves even if they craft the request by hand.
-- --------------------------------------------------------------------------

create policy admins_read on public.admins
  for select to authenticated using (true);

-- --------------------------------------------------------------------------
-- Deals — the central rule.
--
-- Three separate SELECT policies, which PostgreSQL ORs together:
--   * everyone sees approved deals,
--   * you see your own submissions whatever their status, so you can tell that
--     it arrived and is waiting,
--   * admins see everything, which is what makes a moderation queue possible.
-- --------------------------------------------------------------------------

create policy deals_read_approved on public.deals
  for select to anon, authenticated using (status = 'approved');

create policy deals_read_own on public.deals
  for select to authenticated using (created_by = auth.uid());

create policy deals_read_admin on public.deals
  for select to authenticated using (public.is_admin());

-- Anyone signed in may submit — but only as themselves, and only as pending.
-- The WITH CHECK is what makes "submitted deals are never published
-- automatically" true at the storage layer: a crafted insert asking for
-- status='approved' is rejected by the database.
create policy deals_submit on public.deals
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and status = 'pending'
    and approved_by is null
    and approved_at is null
  );

-- Regular users get no UPDATE and no DELETE, not even on their own submission.
-- Once it is in the queue it belongs to the moderators. Admin edits go through
-- admin_update_deal / set_deal_status.
create policy deals_admin_update on public.deals
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Deleting a deal destroys the record of who approved it. Admins deactivate
-- instead (status = 'inactive'); only a super admin may truly remove one.
create policy deals_super_admin_delete on public.deals
  for delete to authenticated using (public.is_super_admin());

-- --------------------------------------------------------------------------
-- Reports.
--
-- You may file one and see your own. You may not see other people's reports,
-- and you may not resolve anything — resolve_report() is the only way, and it
-- requires an admin.
-- --------------------------------------------------------------------------

create policy reports_read_own on public.deal_reports
  for select to authenticated using (reported_by = auth.uid());

create policy reports_read_admin on public.deal_reports
  for select to authenticated using (public.is_admin());

create policy reports_file on public.deal_reports
  for insert to authenticated
  with check (
    reported_by = auth.uid()
    and status = 'open'
    and exists (select 1 from public.deals d where d.id = deal_id and d.status = 'approved')
  );

create policy reports_admin_update on public.deal_reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- Push subscriptions: strictly your own devices. Nobody, admin included, reads
-- these through the API — the notification sender uses the service role.
-- --------------------------------------------------------------------------

create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy push_log_read_own on public.push_log
  for select to authenticated using (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- App settings.
--
-- The whole row is world-readable: the Weekly Deal is public by design, and the
-- notification thresholds are not secrets — knowing that a deal needs 25% off
-- to trigger a push tells you nothing you could abuse. Writes go through
-- set_weekly_deal (admin) and update_notification_settings (super admin).
-- --------------------------------------------------------------------------

create policy app_settings_read on public.app_settings
  for select to anon, authenticated using (true);

-- --------------------------------------------------------------------------
-- Deal images.
--
-- Public bucket, because deal photos are shown to everyone. Uploads are
-- restricted to signed-in users writing into a folder named after their own
-- user id, so one user cannot overwrite another's image.
-- --------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deal-images', 'deal-images', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

create policy "deal images are public"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'deal-images');

create policy "users upload deal images into their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'deal-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "admins manage deal images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'deal-images' and public.is_admin());

-- ======================== 0004_seed.sql ========================

-- ---------------------------------------------------------------------------
-- Beer Deals — catalogue seed.
--
-- The theme colours are ours. They are chosen to *evoke* each beer — the amber
-- of a lager, the green glass of an import, the deep red of a stout — and are
-- not sampled from anyone's brand guidelines, and no logo or trade dress is
-- reproduced anywhere in this app. The layout is byte-for-byte identical across
-- every theme; only these four variables change.
--
-- Safe to re-run: every insert is idempotent on the slug.
-- ---------------------------------------------------------------------------

insert into public.beers (slug, name_he, name_en, theme_base, theme_surface, theme_accent, theme_ink, sort_order) values
  ('goldstar',   'גולדסטאר',      'Goldstar',        '#1a1206', '#2a1e0c', '#e0a52b', '#fdf6e6',  1),
  ('maccabee',   'מכבי',          'Maccabee',        '#0d1408', '#172312', '#8cc63f', '#f2f7ea',  2),
  ('heineken',   'היינקן',        'Heineken',        '#04140b', '#0b2415', '#3fb96a', '#e9f7ee',  3),
  ('carlsberg',  'קרלסברג',       'Carlsberg',       '#06140e', '#0d2419', '#4cae7a', '#e8f5ee',  4),
  ('corona',     'קורונה',        'Corona',          '#0f1a26', '#17293a', '#f2c14e', '#eef5fb',  5),
  ('tuborg',     'טובורג',        'Tuborg',          '#06121c', '#0c2130', '#37b7d8', '#e7f5fa',  6),
  ('stella',     'סטלה ארטואה',   'Stella Artois',   '#1a1305', '#2a200b', '#d9b551', '#fbf6e8',  7),
  ('becks',      'בקס',           'Beck''s',         '#0a1408', '#132312', '#5faa46', '#edf6ea',  8),
  ('tuborg-red', 'טובורג אדום',   'Tuborg Red',      '#1a0a0a', '#2a1212', '#d9534f', '#fbecec',  9),
  ('paulaner',   'פאולנר',        'Paulaner',        '#12100a', '#221d12', '#c8a45c', '#f7f2e8', 10),
  ('weihen',     'ויינשטפן',      'Weihenstephaner', '#0a0f1a', '#121a2a', '#7c9fd4', '#eaf0f9', 11),
  ('erdinger',   'ארדינגר',       'Erdinger',        '#0d1016', '#171c26', '#9bb0cc', '#eef1f6', 12),
  ('guinness',   'גינס',          'Guinness',        '#0c0a08', '#1a1613', '#c8952f', '#f7f1e6', 13),
  ('leffe',      'לף',            'Leffe',           '#160f08', '#261a0e', '#c98b3c', '#f8efe3', 14),
  ('desperados', 'דספרדוס',       'Desperados',      '#1a1404', '#2b220a', '#e3c22e', '#fbf7e2', 15),
  ('budweiser',  'באדוויזר',      'Budweiser',       '#160709', '#260d11', '#c9322f', '#fbeaea', 16),
  ('shapiro',    'שפירא',         'Shapiro',         '#141008', '#241c0f', '#b98b3e', '#f6f0e5', 17),
  ('alexander',  'אלכסנדר',       'Alexander',       '#0a0e14', '#121822', '#6f8fb3', '#ecf1f6', 18),
  ('malka',      'מלכה',          'Malka',           '#150b12', '#26141f', '#c25b8e', '#f9ecf3', 19),
  ('negev',      'נגב',           'Negev',           '#171208', '#281f10', '#cf9a3a', '#f8f2e6', 20),
  ('bazelet',    'בזלת',          'Bazelet',         '#0c0d10', '#181a20', '#8b90a0', '#eff0f3', 21),
  ('somersby',   'סאמרסבי',       'Somersby',        '#151206', '#26220c', '#d8c14a', '#f9f6e6', 22)
on conflict (slug) do update set name_he       = excluded.name_he,
      name_en       = excluded.name_en,
      theme_base    = excluded.theme_base,
      theme_surface = excluded.theme_surface,
      theme_accent  = excluded.theme_accent,
      theme_ink     = excluded.theme_ink,
      sort_order    = excluded.sort_order;

-- Chains, not branches — a deal at רמי לוי is a deal at רמי לוי.
insert into public.stores (slug, name_he) values
  ('rami-levy',    'רמי לוי'),
  ('shufersal',    'שופרסל'),
  ('yochananof',   'יוחננוף'),
  ('victory',      'ויקטורי'),
  ('osher-ad',     'אושר עד'),
  ('yeinot-bitan', 'יינות ביתן'),
  ('tiv-taam',     'טיב טעם'),
  ('mahsanei',     'מחסני השוק'),
  ('carrefour',    'קרפור'),
  ('hatzi-hinam',  'חצי חינם'),
  ('super-yuda',   'סופר יודה'),
  ('king-store',   'קינג סטור'),
  ('ampm',         'AM:PM'),
  ('liquor-store', 'חנות אלכוהול'),
  ('makolet',      'מכולת שכונתית')
on conflict (slug) do update set name_he = excluded.name_he;

-- ======================== 0005_one_deal_per_shelf.sql ========================

-- ---------------------------------------------------------------------------
-- One approved deal per beer, per shop, per pack size.
--
-- Two approved rows for "Goldstar six-pack at Rami Levy" are not two deals —
-- they are one deal and a mistake. Whichever way it happens (a script run
-- twice, two people reporting the same sticker, an admin approving a
-- resubmission), the result is the same: the user sees the same line twice, or
-- worse, twice at different prices with no way to tell which is true.
--
-- A partial unique index says it once, for every path into the table. The
-- deliberate consequence is that replacing a deal means taking the old one down
-- first — which is the correct order anyway, since the alternative is a moment
-- where both are on the shelf.
-- ---------------------------------------------------------------------------

-- Existing duplicates have to go before the index can exist. Keep the oldest of
-- each group: it is the one whose approval history is real.
with ranked as (
  select id,
         row_number() over (
           partition by beer_id, store_id, category
           order by created_at, id
         ) as n
    from public.deals
   where status = 'approved'
)
update public.deals d set status = 'inactive', approved_by = null, approved_at = null
  from ranked
 where d.id = ranked.id and ranked.n > 1;

create unique index if not exists deals_one_approved_per_shelf_idx
  on public.deals (beer_id, store_id, category)
  where status = 'approved';

-- --------------------------------------------------------------------------
-- Approving now explains the collision instead of surfacing "duplicate key
-- value violates unique constraint", which tells an admin nothing about what
-- to do next.
-- --------------------------------------------------------------------------

create or replace function public.approve_deal(p_deal_id uuid)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  row      public.deals;
  incoming public.deals;
begin
  perform public.require_admin();

  select * into incoming from public.deals where id = p_deal_id;

  if incoming.id is null then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
      from public.deals d
     where d.status = 'approved'
       and d.id <> p_deal_id
       and d.beer_id = incoming.beer_id
       and d.store_id = incoming.store_id
       and d.category = incoming.category
  ) then
    raise exception
      'כבר יש מבצע מאושר על הבירה הזו, באותה חנות ובאותו מארז. צריך להסיר אותו קודם.'
      using errcode = '23505';
  end if;

  update public.deals set status      = 'approved',
         approved_by = auth.uid(),
         approved_at = now()
   where id = p_deal_id
  returning * into row;

  return row;
end;
$$;

-- ======================== 0006_retire_demo_deals.sql ========================

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

update public.app_settings set weekly_deal_id = null
 where weekly_deal_id in (select id from public.deals where notes = 'מבצע לדוגמה');

update public.deals set status = 'inactive', approved_by = null, approved_at = null
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

update public.profiles p set notifications_enabled = false
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

-- ======================== 0007_catalog_tables.sql ========================

-- ---------------------------------------------------------------------------
-- 0007 — catalogue model, part 1 of 3: tables   (0008 = write path, 0009 = read model).
--
-- WHY. Until now a "beer" was a brand name and a "deal" was a row with a
-- three-value pack category (sixpack | case | single). That cannot say that
-- Goldstar 6×330ml and Goldstar 6×500ml are different products, cannot hold a
-- regular (non-promotional) price, has no dates, no source and no history.
--
-- WHAT. Purely additive. Nothing existing is dropped, renamed or rewritten:
--   brand    → brands                       (new)
--   variant  → beers.variant                (new column; `beers` keeps meaning
--                                            "brand + variant", so favourites,
--                                            themes and every FK are untouched)
--   product  → skus                         (container · volume_ml · pack_quantity)
--   chain    → stores (+ kind)              (existing)
--   branch   → branches                     (new, optional)
--   price    → price_observations           (new, append-only ledger of regular
--                                            prices AND promotions, with source,
--                                            observed_at, validity window and
--                                            structured conditions)
-- The old `deals` table keeps working unchanged (user submissions + moderation);
-- 0009 exposes both worlds to the app through one read view.
--
-- Rollback: everything in 0007–0009 can be dropped without touching existing
-- data (the exact statements are at the end of 0009).
-- ---------------------------------------------------------------------------

create type public.container_type as enum ('bottle', 'can', 'keg', 'draft', 'other');
create type public.price_kind     as enum ('regular', 'promotion');
create type public.promo_type     as enum ('price_cut', 'multi_buy', 'club_price', 'coupon', 'gift', 'other');
create type public.source_kind    as enum ('chain_feed', 'admin', 'user_submission', 'scraper', 'import');

-- --------------------------------------------------------------------------
-- Brands, and beers as brand + variant.
-- --------------------------------------------------------------------------

create table public.brands (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name_he    text not null,
  name_en    text not null,
  created_at timestamptz not null default now()
);

-- One brand per existing beer, except the one variant we already know of:
-- "Tuborg Red" is a variant of the Tuborg brand, not a brand of its own.
insert into public.brands (slug, name_he, name_en)
select b.slug, b.name_he, b.name_en
  from public.beers b
 where b.slug <> 'tuborg-red'
on conflict (slug) do nothing;

alter table public.beers
  add column brand_id uuid references public.brands (id) on delete restrict,
  add column variant  text check (variant is null or char_length(trim(variant)) between 1 and 40);

update public.beers b set brand_id = br.id
  from public.brands br
 where b.brand_id is null
   and br.slug = case when b.slug = 'tuborg-red' then 'tuborg' else b.slug end;

update public.beers set variant = 'red' where slug = 'tuborg-red' and variant is null;

alter table public.beers alter column brand_id set not null;

-- A brand has at most one beer per variant (and one "plain" beer).
create unique index beers_brand_variant_key on public.beers (brand_id, coalesce(variant, ''));

-- --------------------------------------------------------------------------
-- SKUs: the sellable unit, identified by physical facts — never by brand name.
--
-- Goldstar 6×330ml can and Goldstar 6×500ml bottle share a brand and nothing
-- else, so they are two rows. `unique (…)` is what makes "the same product" mean
-- the same container, the same volume and the same pack size.
-- --------------------------------------------------------------------------

create table public.skus (
  id              uuid primary key default gen_random_uuid(),
  beer_id         uuid not null references public.beers (id) on delete restrict,
  container       public.container_type not null,
  volume_ml       integer not null check (volume_ml between 50 and 100000),
  pack_quantity   integer not null default 1 check (pack_quantity between 1 and 96),
  total_volume_ml integer generated always as (volume_ml * pack_quantity) stored,
  display_he      text not null check (char_length(trim(display_he)) between 1 and 120),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (beer_id, container, volume_ml, pack_quantity)
);

create index skus_beer_idx on public.skus (beer_id) where is_active;

-- Many barcodes (GTINs, or a chain's internal code) can point at one SKU. A chain
-- code is only meaningful inside its chain, hence the optional store scope.
create table public.sku_barcodes (
  id         uuid primary key default gen_random_uuid(),
  sku_id     uuid not null references public.skus (id) on delete cascade,
  barcode    text not null check (barcode ~ '^[0-9A-Za-z._-]{3,40}$'),
  store_id   uuid references public.stores (id) on delete cascade,
  is_gtin    boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index sku_barcodes_key
  on public.sku_barcodes (barcode, coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index sku_barcodes_sku_idx on public.sku_barcodes (sku_id);

-- --------------------------------------------------------------------------
-- Chains and branches.
--
-- `stores` stays "chains, not branches". It only gains a kind, because two seeded
-- rows were never chains at all: "liquor store" and "neighbourhood shop" are
-- categories of shop, and a price feed can never come from them.
-- --------------------------------------------------------------------------

alter table public.stores
  add column kind text not null default 'chain' check (kind in ('chain', 'independent', 'category'));

update public.stores set kind = 'category' where slug in ('liquor-store', 'makolet') and kind = 'chain';

create table public.branches (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores (id) on delete cascade,
  external_ref text,                       -- the chain's own id for the branch
  name_he      text,
  city         text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (store_id, external_ref)
);

create index branches_store_idx on public.branches (store_id) where is_active;

-- --------------------------------------------------------------------------
-- Where a price came from.
-- --------------------------------------------------------------------------

create table public.sources (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name       text not null,
  kind       public.source_kind not null,
  -- 0..100. Only kinds 'chain_feed' and 'admin' may serve as the reference for a
  -- discount percentage; this number is for ranking conflicting sources later.
  trust      smallint not null default 50 check (trust between 0 and 100),
  created_at timestamptz not null default now()
);

insert into public.sources (slug, name, kind, trust) values
  ('admin',           'Entered by an administrator', 'admin',           90),
  ('user-submission', 'Submitted by a user',         'user_submission', 40),
  -- Invented prices for development and staging (supabase/seed/dev-catalog.sql).
  -- Everything recorded under this source is flagged is_sample in the read views,
  -- and a production server never shows it (src/lib/demo.ts).
  ('sample-data',     'Sample data (dev/staging only)', 'admin',        10)
on conflict (slug) do nothing;

-- One row per import, so a bad run can be found and undone as a unit.
create table public.ingestion_runs (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references public.sources (id) on delete restrict,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'rolled_back')),
  stats       jsonb not null default '{}'::jsonb
);

create index ingestion_runs_source_idx on public.ingestion_runs (source_id, started_at desc);

-- --------------------------------------------------------------------------
-- The price ledger. APPEND-ONLY.
--
-- Regular prices and promotions are the same kind of fact — "at this time, at
-- this place, from this source, this SKU cost this much" — distinguished by
-- `kind`. A price change is a NEW row; the old one becomes `superseded`. Rows
-- are never updated (except their status) and never deleted, so history, audit
-- and rollback come for free.
--
--   price_agorot   the price of ONE pack (whole agorot, like everywhere else).
--                  For a multi-buy ("2 for ₪45") it is the effective per-pack
--                  price, ceil(45.00/2); `conditions.multi_buy` keeps the truth.
--   observed_at    when the source said so. Not when we stored it.
--   valid_from/to  a promotion's window. NULL valid_to = end unknown (such a
--                  promotion stops being shown a week after it was last seen).
--   conditions     {min_qty, max_qty, multi_buy:{qty,total_agorot}, club, coupon,
--                   note_he} — structured, not free text.
--   identity_key   what makes two rows "the same offer, updated": 'regular' for
--                  regular prices; the chain's promotion id, or a hash of the
--                  promotion's terms.
--   content_hash   idempotency: replaying the same source record adds nothing.
-- --------------------------------------------------------------------------

create table public.price_observations (
  id           bigint generated always as identity primary key,
  sku_id       uuid not null references public.skus (id) on delete restrict,
  store_id     uuid not null references public.stores (id) on delete restrict,
  branch_id    uuid references public.branches (id) on delete restrict,
  kind         public.price_kind not null,
  price_agorot integer not null check (price_agorot > 0),
  observed_at  timestamptz not null,
  valid_from   timestamptz,
  valid_to     timestamptz,
  promo_type   public.promo_type,
  conditions   jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),
  identity_key text not null,
  source_id    uuid not null references public.sources (id) on delete restrict,
  run_id       uuid references public.ingestion_runs (id) on delete restrict,
  natural_key  text,
  content_hash text,
  raw          jsonb,
  status       text not null default 'live' check (status in ('live', 'held', 'superseded', 'rejected')),
  superseded_by bigint references public.price_observations (id),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),

  -- A promotion says what kind it is; a regular price is not a promotion and has
  -- no end date of its own.
  constraint price_obs_kind_shape check (
    (kind = 'promotion' and promo_type is not null)
    or (kind = 'regular' and promo_type is null and valid_to is null)
  ),
  constraint price_obs_window check (valid_to is null or valid_from is null or valid_to > valid_from),

  -- A multi-buy must carry its terms, and the stored per-pack price must be
  -- exactly what those terms imply — so the two can never disagree.
  constraint price_obs_multi_buy check (
    promo_type is distinct from 'multi_buy'
    or (
      coalesce((conditions #>> '{multi_buy,qty}')::int >= 2, false)
      and coalesce((conditions #>> '{multi_buy,total_agorot}')::int > 0, false)
      and price_agorot = ceil((conditions #>> '{multi_buy,total_agorot}')::numeric / (conditions #>> '{multi_buy,qty}')::int)
    )
  )
);

-- Replaying a source record is a no-op.
create unique index price_obs_idempotent on public.price_observations (source_id, content_hash)
  where content_hash is not null;

-- "What is the current regular price / promotion for this SKU at this chain?"
create index price_obs_lookup on public.price_observations (sku_id, store_id, kind, observed_at desc)
  where status = 'live';

create index price_obs_identity on public.price_observations (sku_id, store_id, kind, identity_key);
create index price_obs_run on public.price_observations (run_id) where run_id is not null;

-- ======================== 0008_price_write_path.sql ========================

-- ---------------------------------------------------------------------------
-- 0008 — catalogue model, part 2 of 3: how prices get in, and who may.
--
--   * the ledger is append-only (a trigger enforces it, not a convention)
--   * record_price() / record_prices() are the ONLY write path: one place that
--     validates, computes multi-buy prices, ignores replays and supersedes
--     the previous price — used by admins today and by ingestion later
--   * RLS + explicit grants for every new table, in the style of 0003
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Append-only.
--
-- An observation says what a source claimed at a moment in time. Editing it
-- would rewrite history, so the only things that may ever change are its
-- lifecycle (`status`, `superseded_by`) and who created it (`created_by`, which
-- Postgres nulls when that account is deleted). Deleting is refused outright;
-- to undo a bad import, mark its rows `rejected` by run id.
-- --------------------------------------------------------------------------

create or replace function public.price_observations_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'price observations are append-only; mark a bad row rejected instead'
      using errcode = '42501';
  end if;

  if (to_jsonb(new) - 'status' - 'superseded_by' - 'created_by')
     is distinct from
     (to_jsonb(old) - 'status' - 'superseded_by' - 'created_by') then
    raise exception 'price observations are append-only; record a new observation instead of editing one'
      using errcode = '42501';
  end if;

  -- History does not come back to life.
  if old.status in ('superseded', 'rejected') and new.status is distinct from old.status then
    raise exception 'a % observation cannot change status again', old.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger price_observations_append_only
  before update or delete on public.price_observations
  for each row execute function public.price_observations_guard();

-- --------------------------------------------------------------------------
-- Who may write prices: an admin, or the service role (ingestion). Raises rather
-- than returning false, like require_admin().
-- --------------------------------------------------------------------------

create or replace function public.require_price_writer()
returns void
language plpgsql
stable
as $$
begin
  if not (public.is_admin() or current_setting('role', true) = 'service_role') then
    raise exception 'admin or service privileges required' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.require_price_writer() from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- record_price — validate, then insert one observation.
--
-- Supersession (a price change is a new row, the old one is kept):
--   * a new LIVE observation supersedes the previous live one for the same
--     (sku, store, branch, kind, identity)…
--   * …unless a NEWER live observation already exists, in which case the new
--     one is history and is stored as `superseded`. So back-filling old data in
--     any order can never replace what is currently true.
-- Replaying a record (same source + content_hash) returns the stored row.
-- --------------------------------------------------------------------------

create or replace function public.record_price(
  p_sku_id       uuid,
  p_store_id     uuid,
  p_kind         public.price_kind,
  p_price_agorot integer,
  p_observed_at  timestamptz,
  p_source_slug  text,
  p_branch_id    uuid                 default null,
  p_valid_from   timestamptz          default null,
  p_valid_to     timestamptz          default null,
  p_promo_type   public.promo_type    default null,
  p_conditions   jsonb                default '{}'::jsonb,
  p_natural_key  text                 default null,
  p_content_hash text                 default null,
  p_raw          jsonb                default null,
  p_run_id       uuid                 default null,
  p_status       text                 default 'live'
)
returns public.price_observations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source   public.sources;
  v_existing public.price_observations;
  v_row      public.price_observations;
  v_price    integer := p_price_agorot;
  v_identity text;
  v_qty      integer;
  v_total    integer;
  v_newer    bigint;
begin
  perform public.require_price_writer();

  select * into v_source from public.sources where slug = p_source_slug;
  if not found then
    raise exception 'unknown source %', p_source_slug using errcode = 'P0002';
  end if;

  if p_status not in ('live', 'held') then
    raise exception 'status must be live or held' using errcode = '22023';
  end if;
  if not exists (select 1 from public.skus where id = p_sku_id and is_active) then
    raise exception 'unknown or inactive sku' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.stores where id = p_store_id) then
    raise exception 'unknown store' using errcode = 'P0002';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and store_id = p_store_id
  ) then
    raise exception 'the branch does not belong to that store' using errcode = '22023';
  end if;

  -- Replay: nothing to do.
  if p_content_hash is not null then
    select * into v_existing
      from public.price_observations
     where source_id = v_source.id and content_hash = p_content_hash;
    if found then
      return v_existing;
    end if;
  end if;

  if p_kind = 'promotion' then
    if p_promo_type is null then
      raise exception 'a promotion needs a promo_type' using errcode = '22023';
    end if;

    if p_promo_type = 'multi_buy' then
      v_qty   := (p_conditions #>> '{multi_buy,qty}')::integer;
      v_total := (p_conditions #>> '{multi_buy,total_agorot}')::integer;
      if v_qty is null or v_qty < 2 or v_total is null or v_total <= 0 then
        raise exception 'a multi_buy needs conditions.multi_buy = {qty >= 2, total_agorot > 0}'
          using errcode = '22023';
      end if;
      if v_price is not null and v_price <> ceil(v_total::numeric / v_qty)::integer then
        raise exception 'price_agorot must equal ceil(total_agorot / qty) for a multi_buy'
          using errcode = '22023';
      end if;
      v_price := ceil(v_total::numeric / v_qty)::integer;
    end if;

    v_identity := coalesce(
      p_natural_key,
      md5(concat_ws('|', p_promo_type::text, p_valid_from::text, p_valid_to::text, p_conditions::text))
    );
  else
    if p_promo_type is not null or p_valid_to is not null then
      raise exception 'a regular price has no promo_type and no end date' using errcode = '22023';
    end if;
    v_identity := 'regular';
  end if;

  if v_price is null then
    raise exception 'a price is required' using errcode = '22023';
  end if;

  -- One writer at a time per SKU × chain, so two imports cannot both decide they
  -- are "the newest".
  perform pg_advisory_xact_lock(hashtext(p_sku_id::text || p_store_id::text));

  insert into public.price_observations (
    sku_id, store_id, branch_id, kind, price_agorot, observed_at, valid_from, valid_to,
    promo_type, conditions, identity_key, source_id, run_id, natural_key, content_hash,
    raw, status, created_by
  ) values (
    p_sku_id, p_store_id, p_branch_id, p_kind, v_price, p_observed_at, p_valid_from, p_valid_to,
    p_promo_type, coalesce(p_conditions, '{}'::jsonb), v_identity, v_source.id, p_run_id, p_natural_key, p_content_hash,
    p_raw, p_status, auth.uid()
  )
  returning * into v_row;

  if p_status = 'live' then
    select o.id into v_newer
      from public.price_observations o
     where o.sku_id = v_row.sku_id
       and o.store_id = v_row.store_id
       and o.branch_id is not distinct from v_row.branch_id
       and o.kind = v_row.kind
       and o.identity_key = v_row.identity_key
       and o.status = 'live'
       and o.id <> v_row.id
       and (o.observed_at > v_row.observed_at or (o.observed_at = v_row.observed_at and o.id > v_row.id))
     order by o.observed_at desc, o.id desc
     limit 1;

    if v_newer is not null then
      update public.price_observations set status = 'superseded', superseded_by = v_newer where id = v_row.id;
    else
      update public.price_observations o set status = 'superseded', superseded_by = v_row.id
       where o.sku_id = v_row.sku_id
         and o.store_id = v_row.store_id
         and o.branch_id is not distinct from v_row.branch_id
         and o.kind = v_row.kind
         and o.identity_key = v_row.identity_key
         and o.status = 'live'
         and o.id <> v_row.id;
    end if;

    select * into v_row from public.price_observations where id = v_row.id;
  end if;

  return v_row;
end;
$$;

-- --------------------------------------------------------------------------
-- record_prices — the batch entry point for ingestion.
--
-- Takes an array of the same fields (jsonb) and applies each one on its own, so
-- a single malformed record is reported instead of sinking the whole import.
-- Returns {accepted, rejected, errors:[{index, code, message}]}.
-- --------------------------------------------------------------------------

create or replace function public.record_prices(
  p_source_slug text,
  p_items       jsonb,
  p_run_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item     jsonb;
  idx      integer := 0;
  accepted integer := 0;
  errors   jsonb   := '[]'::jsonb;
begin
  perform public.require_price_writer();

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items must be a json array' using errcode = '22023';
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    idx := idx + 1;
    begin
      perform public.record_price(
        p_sku_id       := (item ->> 'sku_id')::uuid,
        p_store_id     := (item ->> 'store_id')::uuid,
        p_kind         := (item ->> 'kind')::public.price_kind,
        p_price_agorot := (item ->> 'price_agorot')::integer,
        p_observed_at  := (item ->> 'observed_at')::timestamptz,
        p_source_slug  := p_source_slug,
        p_branch_id    := (item ->> 'branch_id')::uuid,
        p_valid_from   := (item ->> 'valid_from')::timestamptz,
        p_valid_to     := (item ->> 'valid_to')::timestamptz,
        p_promo_type   := (item ->> 'promo_type')::public.promo_type,
        p_conditions   := coalesce(item -> 'conditions', '{}'::jsonb),
        p_natural_key  := item ->> 'natural_key',
        p_content_hash := item ->> 'content_hash',
        p_raw          := item -> 'raw',
        p_run_id       := p_run_id,
        p_status       := coalesce(item ->> 'status', 'live')
      );
      accepted := accepted + 1;
    exception when others then
      errors := errors || jsonb_build_object('index', idx, 'code', sqlstate, 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('accepted', accepted, 'rejected', jsonb_array_length(errors), 'errors', errors);
end;
$$;

revoke execute on function public.record_price(uuid, uuid, public.price_kind, integer, timestamptz, text, uuid, timestamptz, timestamptz, public.promo_type, jsonb, text, text, jsonb, uuid, text) from public, anon;
revoke execute on function public.record_prices(text, jsonb, uuid) from public, anon;
grant execute on function public.record_price(uuid, uuid, public.price_kind, integer, timestamptz, text, uuid, timestamptz, timestamptz, public.promo_type, jsonb, text, text, jsonb, uuid, text) to authenticated, service_role;
grant execute on function public.record_prices(text, jsonb, uuid) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- Row level security and grants for the new tables (same rules as 0003:
-- grant exactly the verbs needed, then open rows one policy at a time).
-- --------------------------------------------------------------------------

alter table public.brands              enable row level security;
alter table public.skus                enable row level security;
alter table public.sku_barcodes        enable row level security;
alter table public.branches            enable row level security;
alter table public.sources             enable row level security;
alter table public.ingestion_runs      enable row level security;
alter table public.price_observations  enable row level security;

-- Catalogue: world-readable, admin-writable (like beers and stores).
grant select on public.brands, public.skus, public.sku_barcodes, public.branches, public.sources to anon, authenticated;
grant insert, update, delete on public.brands, public.skus, public.sku_barcodes, public.branches to authenticated;

create policy brands_read on public.brands for select to anon, authenticated using (true);
create policy brands_admin_write on public.brands for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy skus_read on public.skus for select to anon, authenticated using (true);
create policy skus_admin_write on public.skus for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy sku_barcodes_read on public.sku_barcodes for select to anon, authenticated using (true);
create policy sku_barcodes_admin_write on public.sku_barcodes for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy branches_read on public.branches for select to anon, authenticated using (true);
create policy branches_admin_write on public.branches for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Sources: readable (a slug and a kind), never writable through the API.
create policy sources_read on public.sources for select to anon, authenticated using (true);

-- Import bookkeeping: admins can look, only the service role (and the definer
-- functions above) writes.
grant select on public.ingestion_runs to authenticated;
create policy ingestion_runs_admin_read on public.ingestion_runs for select to authenticated using (public.is_admin());

-- The ledger: the public sees LIVE rows, admins see everything, and nobody can
-- insert, update or delete through the API at all — record_price() is the door.
grant select on public.price_observations to anon, authenticated;
create policy price_obs_read_live on public.price_observations for select to anon, authenticated using (status = 'live');
create policy price_obs_read_admin on public.price_observations for select to authenticated using (public.is_admin());

-- The service role bypasses RLS but not privileges. Reads, plus the bookkeeping
-- tables it owns; price writes go through record_price().
grant select on public.brands, public.skus, public.sku_barcodes, public.branches, public.sources, public.price_observations to service_role;
grant select, insert, update on public.ingestion_runs to service_role;
grant insert, update on public.skus, public.sku_barcodes, public.branches to service_role;

-- ======================== 0009_offers_read_model.sql ========================

-- ---------------------------------------------------------------------------
-- 0009 — catalogue model, part 3 of 3: what the app reads.
--
-- Views only (security_invoker: they run with the caller's permissions, so the
-- RLS on the ledger is what keeps unpublished rows out, not the WHERE clauses).
--
--   regular_prices_current   the latest live regular price per SKU × chain × branch
--   promotions_current       live promotions that are in force RIGHT NOW
--   offers_ranked            those promotions, with unit price, a verified
--                            discount % and a market comparison
--   offers_feed              offers_ranked + the legacy `deals`, in one shape,
--                            so the app has a single thing to read while the old
--                            submission/moderation flow is still in use
--
-- HOW A DISCOUNT % IS DERIVED — and when it is deliberately NOT.
-- The old model stored a percentage computed from whatever "regular price" a
-- person typed. A percentage is a claim about savings, so it is only produced
-- when the reference price can be trusted:
--   * the reference is the current regular price of the SAME SKU at the SAME
--     chain, seen within the last 14 days (older = unknown, not "still true");
--   * it came from a chain feed or an administrator (never a raw user report);
--   * the promotion is actually cheaper than it;
--   * the result is at most 70 % — beyond that it is far more likely a bad
--     barcode or unit mismatch than a real bargain, so it is held for review
--     (`needs_review`) instead of being shown.
-- Everything else gets NULL, and the UI shows the price without a "you save".
--
-- A second, independent number compares against the MEDIAN regular price of the
-- same SKU at other chains (`market_value_pct`, needs at least two other chains).
-- A chain cannot inflate its own "before" price to fake that one.
-- ---------------------------------------------------------------------------

create view public.regular_prices_current
with (security_invoker = on)
as
select distinct on (o.sku_id, o.store_id, o.branch_id)
       o.id, o.sku_id, o.store_id, o.branch_id, o.price_agorot, o.observed_at, o.source_id,
       (src.slug = 'sample-data') as is_sample
  from public.price_observations o
  join public.sources src on src.id = o.source_id
 where o.kind = 'regular' and o.status = 'live'
 order by o.sku_id, o.store_id, o.branch_id, o.observed_at desc, o.id desc;

-- A promotion is in force when its window has started and not ended. One with no
-- end date is only trusted for a week after it was last seen: "unknown" must not
-- turn into "forever".
create view public.promotions_current
with (security_invoker = on)
as
select o.*
  from public.price_observations o
 where o.kind = 'promotion'
   and o.status = 'live'
   and (o.valid_from is null or o.valid_from <= now())
   and (
     (o.valid_to is not null and o.valid_to > now())
     or (o.valid_to is null and o.observed_at > now() - interval '7 days')
   );

create view public.offers_ranked
with (security_invoker = on)
as
select
  o.id                                   as observation_id,
  o.sku_id,
  s.beer_id,
  be.slug                                as beer_slug,
  be.name_he                             as beer_name,
  be.name_en                             as beer_name_en,
  be.variant,
  br.slug                                as brand_slug,
  s.container,
  s.volume_ml,
  s.pack_quantity,
  s.total_volume_ml,
  s.display_he                           as sku_name,
  o.store_id,
  st.slug                                as store_slug,
  st.name_he                             as store_name,
  o.branch_id,
  o.promo_type,
  o.conditions,
  o.valid_from,
  o.valid_to,
  o.observed_at,
  (psrc.slug = 'sample-data')            as is_sample,
  o.price_agorot                         as effective_agorot,
  round(o.price_agorot::numeric * 1000 / s.total_volume_ml)::integer as unit_price_per_liter_agorot,
  ref.price_agorot                       as reference_agorot,
  ref.observed_at                        as reference_observed_at,
  ref.trust                              as reference_trust,
  case when pct.raw between 1 and 70 then pct.raw end as value_pct,
  coalesce(pct.raw > 70, false)          as needs_review,
  mk.median_agorot                       as market_reference_agorot,
  mk.chains                              as market_chains,
  case when mk.median_agorot > o.price_agorot
       then round((mk.median_agorot - o.price_agorot) * 100.0 / mk.median_agorot)::integer
  end                                    as market_value_pct
from public.promotions_current o
join public.skus   s  on s.id  = o.sku_id
join public.beers  be on be.id = s.beer_id
join public.brands br on br.id = be.brand_id
join public.stores st on st.id = o.store_id
join public.sources psrc on psrc.id = o.source_id
left join lateral (
  select r.price_agorot, r.observed_at,
         case src.kind when 'chain_feed' then 'feed' when 'admin' then 'moderated' else 'unverified' end as trust
    from public.regular_prices_current r
    join public.sources src on src.id = r.source_id
   where r.sku_id = o.sku_id
     and r.store_id = o.store_id
     and (r.branch_id is null or r.branch_id is not distinct from o.branch_id)
     and r.observed_at >= now() - interval '14 days'
   order by (r.branch_id is not distinct from o.branch_id) desc, r.observed_at desc
   limit 1
) ref on true
left join lateral (
  select round((ref.price_agorot - o.price_agorot) * 100.0 / ref.price_agorot)::integer as raw
   where ref.trust in ('feed', 'moderated') and ref.price_agorot > o.price_agorot
) pct on true
left join lateral (
  select (percentile_cont(0.5) within group (order by r.price_agorot))::integer as median_agorot,
         count(distinct r.store_id)::integer as chains
    from public.regular_prices_current r
    join public.sources src on src.id = r.source_id and src.kind in ('chain_feed', 'admin')
   where r.sku_id = o.sku_id
     and r.store_id <> o.store_id
     and r.observed_at >= now() - interval '14 days'
  having count(distinct r.store_id) >= 2
) mk on true;

-- --------------------------------------------------------------------------
-- The single feed the app reads. Catalogue offers first-class; legacy approved
-- deals (a pack *category*, an admin-vouched regular price, no SKU) alongside,
-- until the old submission flow is retired. `is_sample` marks invented data (the
-- 'sample-data' source, or a legacy deal carrying the sample note) so a production
-- server can refuse it (src/lib/demo.ts).
-- --------------------------------------------------------------------------

create view public.offers_feed
with (security_invoker = on)
as
select
  'obs:' || o.observation_id::text          as offer_key,
  'catalog'::text                           as origin,
  o.sku_id,
  o.beer_id, o.beer_slug, o.beer_name,
  o.store_id, o.store_slug, o.store_name,
  o.sku_name                                as pack_label,
  o.container, o.volume_ml, o.pack_quantity,
  o.effective_agorot,
  o.unit_price_per_liter_agorot,
  o.reference_agorot,
  o.reference_trust,
  o.value_pct,
  o.needs_review,
  o.market_reference_agorot,
  o.market_value_pct,
  o.promo_type,
  o.conditions,
  o.valid_from, o.valid_to,
  o.observed_at,
  o.is_sample,
  o.conditions ->> 'note_he'                as notes
from public.offers_ranked o

union all

select
  'deal:' || d.id::text,
  'legacy',
  null::uuid,
  d.beer_id, d.beer_slug, d.beer_name,
  d.store_id, d.store_slug, d.store_name,
  case d.category when 'sixpack' then 'שישייה' when 'case' then 'ארגז' else 'בודד' end,
  null::public.container_type, null::integer, null::integer,
  d.deal_price_agorot,
  null::integer,
  d.regular_price_agorot,
  'moderated',                               -- an administrator approved this deal, price and all
  case when d.discount_percent between 1 and 70 then d.discount_percent end,
  d.discount_percent > 70,
  null::integer, null::integer,
  null::public.promo_type,
  '{}'::jsonb,
  null::timestamptz, null::timestamptz,
  d.approved_at,
  coalesce(d.notes = 'מבצע לדוגמה', false),   -- the legacy sample-deal marker (see 0006)
  d.notes
from public.deals_public d;

grant select on public.regular_prices_current, public.promotions_current, public.offers_ranked, public.offers_feed
  to anon, authenticated, service_role;
-- offers_feed reads the legacy view too, and views run with the caller's privileges.
grant select on public.deals_public to service_role;

-- --------------------------------------------------------------------------
-- Rollback for 0007–0009 (nothing that existed before is touched):
--
--   drop view if exists public.offers_feed, public.offers_ranked,
--        public.promotions_current, public.regular_prices_current;
--   drop function if exists public.record_prices(text, jsonb, uuid);
--   drop function if exists public.record_price(uuid, uuid, public.price_kind, integer,
--        timestamptz, text, uuid, timestamptz, timestamptz, public.promo_type, jsonb,
--        text, text, jsonb, uuid, text);
--   drop function if exists public.require_price_writer();
--   drop table if exists public.price_observations, public.ingestion_runs, public.sources,
--        public.branches, public.sku_barcodes, public.skus;
--   drop function if exists public.price_observations_guard();
--   alter table public.stores drop column if exists kind;
--   alter table public.beers drop column if exists variant, drop column if exists brand_id;
--   drop table if exists public.brands;
--   drop type if exists public.source_kind, public.promo_type, public.price_kind, public.container_type;
-- --------------------------------------------------------------------------

-- ======================== 0010_profile_and_push_hardening.sql ========================

-- ---------------------------------------------------------------------------
-- 0010 — two holes found in the 2026-09-29 audit (docs/PRODUCT-AUDIT §3.3).
--
--  S-9   A signed-in user could rewrite ANY column of their own profile, including
--        `primary_beer_id` (which decides the theme and who is notified) and
--        `onboarded_at`, by calling the API directly. Column-level privileges
--        now allow only the two columns a person legitimately edits.
--
--  S-10  Subscribing a browser that was already subscribed under a *different*
--        anonymous identity (site data cleared, new anonymous user, same push
--        endpoint) failed with an RLS error, so the device could never be
--        registered again. An endpoint belongs to whoever holds the device now.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- S-9. A profile owner may change their name and notification preference — and
-- nothing else. Everything else on a profile is set by the database: the primary
-- beer by the trigger, the onboarding timestamp by save_preferences().
-- --------------------------------------------------------------------------

revoke update on public.profiles from authenticated;
grant update (first_name, notifications_enabled) on public.profiles to authenticated;

-- save_preferences() writes `onboarded_at`, which the caller can no longer set
-- directly, so it now runs with its owner's privileges. It only ever touches the
-- rows of auth.uid(), exactly as before — the checks are unchanged.
create or replace function public.save_preferences(
  p_first_name text,
  p_beer_ids   uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  i   integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_beer_ids is null or array_length(p_beer_ids, 1) <> 4 then
    raise exception 'choose exactly four beers' using errcode = '22023';
  end if;

  if (select count(distinct b) from unnest(p_beer_ids) b) <> 4 then
    raise exception 'the four beers must be different' using errcode = '22023';
  end if;

  update public.profiles set first_name   = trim(p_first_name),
         onboarded_at = coalesce(onboarded_at, now())
   where id = uid;

  -- Replace the list wholesale. Ranks are a unique key, so shuffling an
  -- existing list in place would collide partway through.
  delete from public.user_favorite_beers where profile_id = uid;

  for i in 1 .. 4 loop
    insert into public.user_favorite_beers (profile_id, beer_id, rank)
    values (uid, p_beer_ids[i], i::smallint);
  end loop;
end;
$$;

-- --------------------------------------------------------------------------
-- S-10. Register a push endpoint for the caller, taking it over if it belonged to
-- another identity. The endpoint is an unguessable capability URL that only the
-- device holds, so presenting it is the proof that the device is the caller's.
-- --------------------------------------------------------------------------

create or replace function public.save_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update set user_id    = excluded.user_id,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        user_agent = excluded.user_agent,
        last_seen  = now();
end;
$$;

-- ======================== 0011_optional_name_and_regular_prices_feed.sql ========================

-- ---------------------------------------------------------------------------
-- 0011 — what the redesigned screens need from the database.
--
--   * save_preferences() : the name becomes optional (one fewer thing to type
--     during onboarding).
--   * regular_prices_feed : regular (non-promotional) prices with the names,
--     pack, unit price and freshness the beer and store pages display.
--
-- Additive, like 0007–0010. Rollback: drop the view and restore the previous
-- save_preferences() body from 0010.
--
-- History: an earlier draft of this file (never applied to a hosted database) also added
-- profiles.theme_override and profiles.appearance for a manual theme picker. That picker was
-- removed before release: favourite #1 alone decides the app's look (PRODUCT.md). If a
-- database was ever built from that draft, docs/STAGING.md has the one-line cleanup.
-- ---------------------------------------------------------------------------

-- The name is optional now. An empty string would violate the column's length
-- check, so it is stored as NULL ("no name yet"), which the app already handles.
create or replace function public.save_preferences(
  p_first_name text,
  p_beer_ids   uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  i   integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_beer_ids is null or array_length(p_beer_ids, 1) <> 4 then
    raise exception 'choose exactly four beers' using errcode = '22023';
  end if;

  if (select count(distinct b) from unnest(p_beer_ids) b) <> 4 then
    raise exception 'the four beers must be different' using errcode = '22023';
  end if;

  update public.profiles set first_name   = nullif(trim(p_first_name), ''),
         onboarded_at = coalesce(onboarded_at, now())
   where id = uid;

  delete from public.user_favorite_beers where profile_id = uid;

  for i in 1 .. 4 loop
    insert into public.user_favorite_beers (profile_id, beer_id, rank)
    values (uid, p_beer_ids[i], i::smallint);
  end loop;
end;
$$;

-- Regular prices, ready to show. `is_stale` = not confirmed within the last 14
-- days: the app still lists it (it is the last known price) but labels it, and it
-- no longer counts as a reference for a discount (see offers_ranked).
create view public.regular_prices_feed
with (security_invoker = on)
as
select
  r.id                        as observation_id,
  r.sku_id,
  s.beer_id,
  be.slug                     as beer_slug,
  be.name_he                  as beer_name,
  s.container,
  s.volume_ml,
  s.pack_quantity,
  s.display_he                as pack_label,
  r.store_id,
  st.slug                     as store_slug,
  st.name_he                  as store_name,
  r.branch_id,
  r.price_agorot,
  round(r.price_agorot::numeric * 1000 / s.total_volume_ml)::integer as unit_price_per_liter_agorot,
  r.observed_at,
  r.is_sample,
  case src.kind when 'chain_feed' then 'feed' when 'admin' then 'moderated' else 'unverified' end as trust,
  (r.observed_at < now() - interval '14 days') as is_stale
from public.regular_prices_current r
join public.skus    s   on s.id   = r.sku_id
join public.beers   be  on be.id  = s.beer_id
join public.stores  st  on st.id  = r.store_id
join public.sources src on src.id = r.source_id;

grant select on public.regular_prices_feed to anon, authenticated, service_role;

-- ======================== 0012_notification_pipeline.sql ========================

-- ---------------------------------------------------------------------------
-- 0012 · Notification pipeline (outbox, deliveries, rules)
--
-- Replaces "the approveDeal action decides and sends" with data-driven
-- notifications that ingestion and moderation both feed:
--
--   price_observations INSERT (promotion, live)   ┐
--   deals UPDATE → approved (legacy submissions)  ┴→ notification_events  (outbox)
--        │  a worker (src/lib/push/worker.ts) reads pending events
--        ▼
--   rules (src/lib/push/rules.ts)  →  web-push  →  notification_deliveries (every attempt)
--
-- What this fixes (audit §13): a notification could only ever be triggered by the
-- approve button; a deal seen while nobody was subscribed never notified anyone
-- later; nothing recorded the outcome per person; thresholds looked at a "was"
-- price nobody had verified.
--
-- Additive. Rollback: drop the two triggers and their functions, the three
-- tables/functions below, and the three app_settings columns. push_log and the
-- deals.notified_at column are left in place (history).
-- ---------------------------------------------------------------------------

-- 1. Rules the admin can tune (in addition to the existing thresholds).
alter table public.app_settings
  add column notify_daily_cap   smallint not null default 2  check (notify_daily_cap between 1 and 10),
  -- Israel local hours. Equal start and end means "no quiet hours".
  add column notify_quiet_start smallint not null default 22 check (notify_quiet_start between 0 and 23),
  add column notify_quiet_end   smallint not null default 8  check (notify_quiet_end between 0 and 23);

-- 2. The outbox: one row per newly live promotion (or newly approved legacy deal).
create table public.notification_events (
  id          bigint generated always as identity primary key,
  -- Idempotency. A promotion re-observed tomorrow at the same price is the same news.
  dedupe_key  text not null unique,
  -- The key offers_feed exposes ('obs:<id>' or 'deal:<uuid>'): the worker renders from it.
  offer_key   text not null,
  beer_id     uuid not null references public.beers (id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- After this, nobody is told: a deal that ended is not news.
  expires_at  timestamptz not null,
  status      text not null default 'pending' check (status in ('pending', 'done')),
  -- Why nobody was notified, or 'sent'. Machine-readable; see src/lib/push/rules.ts.
  outcome     text,
  processed_at timestamptz
);

create index notification_events_pending_idx on public.notification_events (created_at) where status = 'pending';

-- 3. One row per (event, person), plus one per test push. Written for EVERY attempt.
create table public.notification_deliveries (
  id           bigint generated always as identity primary key,
  event_id     bigint references public.notification_events (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  beer_id      uuid references public.beers (id) on delete set null,
  kind         text not null default 'offer' check (kind in ('offer', 'test')),
  -- retry = a transient failure (5xx, network); the worker tries again, up to 3 attempts.
  status       text not null check (status in ('sent', 'skipped', 'retry', 'failed')),
  reason       text,
  attempts     smallint not null default 0,
  subscriptions_total smallint not null default 0,
  subscriptions_ok    smallint not null default 0,
  http_status  integer,
  error        text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  -- Never send the same news to the same person twice. (Test pushes have no event.)
  unique (event_id, user_id)
);

create index notification_deliveries_sent_idx on public.notification_deliveries (user_id, sent_at desc) where status = 'sent';
create index notification_deliveries_recent_idx on public.notification_deliveries (created_at desc);

-- Nobody reads or writes these through the API. The worker uses the service role;
-- admins read through the definer function below.
alter table public.notification_events     enable row level security;
alter table public.notification_deliveries enable row level security;

grant select, update on public.notification_events to service_role;
grant select, insert, update on public.notification_deliveries to service_role;
-- The trigger functions below are SECURITY DEFINER; the worker also reads the feed.
grant select on public.offers_feed, public.offers_ranked, public.promotions_current, public.regular_prices_current to service_role;

-- 4. Enqueue: a promotion becoming live.
create or replace function public.enqueue_promotion_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'promotion' or new.status <> 'live' then
    return new;
  end if;

  -- Invented prices never wake anyone up.
  if exists (select 1 from public.sources s where s.id = new.source_id and s.slug = 'sample-data') then
    return new;
  end if;

  insert into public.notification_events (dedupe_key, offer_key, beer_id, expires_at)
  select 'promo:' || new.sku_id || ':' || new.store_id || ':' || new.identity_key || ':' || new.price_agorot
                   || ':' || coalesce(new.valid_from::date::text, ''),
         'obs:' || new.id,
         k.beer_id,
         coalesce(new.valid_to, now() + interval '24 hours')
    from public.skus k
   where k.id = new.sku_id
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

create trigger price_observations_enqueue_notification
  after insert on public.price_observations
  for each row execute function public.enqueue_promotion_notification();

-- 5. Enqueue: a legacy user-submitted deal being approved (until that flow is retired).
create or replace function public.enqueue_deal_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.notes is distinct from 'מבצע לדוגמה' then
    insert into public.notification_events (dedupe_key, offer_key, beer_id, expires_at)
    values ('deal:' || new.id, 'deal:' || new.id, new.beer_id, now() + interval '24 hours')
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger deals_enqueue_notification
  after update of status on public.deals
  for each row execute function public.enqueue_deal_notification();

-- 6. Admins can see what was sent, to whom (shortened id), and why not.
create or replace function public.admin_recent_deliveries(p_limit integer default 50)
returns table (
  id bigint,
  created_at timestamptz,
  kind text,
  status text,
  reason text,
  attempts smallint,
  subscriptions_ok smallint,
  subscriptions_total smallint,
  http_status integer,
  beer_name text,
  recipient text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select d.id, d.created_at, d.kind, d.status, d.reason, d.attempts,
         d.subscriptions_ok, d.subscriptions_total, d.http_status,
         b.name_he,
         left(d.user_id::text, 8)
    from public.notification_deliveries d
    left join public.beers b on b.id = d.beer_id
   order by d.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.admin_recent_deliveries(integer) from public;
grant execute on function public.admin_recent_deliveries(integer) to authenticated;

-- 7. The rules, in one call (the old three-argument function stays for older callers).
create or replace function public.update_notification_rules(
  p_min_discount_percent integer,
  p_max_price_agorot     integer,
  p_cooldown_hours       integer,
  p_daily_cap            integer,
  p_quiet_start          integer,
  p_quiet_end            integer
)
returns public.app_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.app_settings;
begin
  perform public.require_super_admin();

  update public.app_settings set notify_min_discount_percent = p_min_discount_percent,
         notify_max_price_agorot     = p_max_price_agorot,
         notify_cooldown_hours       = p_cooldown_hours,
         notify_daily_cap            = p_daily_cap,
         notify_quiet_start          = p_quiet_start,
         notify_quiet_end            = p_quiet_end,
         updated_by                  = auth.uid()
   where id
  returning * into row;

  return row;
end;
$$;

revoke all on function public.update_notification_rules(integer, integer, integer, integer, integer, integer) from public;
grant execute on function public.update_notification_rules(integer, integer, integer, integer, integer, integer) to authenticated;

-- 8. The settings row is readable by the worker.
grant select on public.app_settings to service_role;

-- ======================== 0013_ingestion_safety.sql ========================

-- ---------------------------------------------------------------------------
-- 0013 · Ingestion safety: idempotent runs, sanity gates, and a rollback that works
--
-- Prepares the write path for the first real import (audit §19 items 6, 10, 12). It
-- does not import anything and nothing calls it yet.
--
--   start_ingestion_run / finish_ingestion_run   a file is imported once: same source + same
--                                                file hash is a no-op, however often it is rung
--   record_prices (replaced)                     holds implausible prices instead of publishing
--                                                them, and says how many it held
--   rollback_ingestion_run                       undoes a run and PUTS BACK what it replaced
--
-- Why rollback is more than "reject the rows": recording a new price marks the previous live one
-- `superseded`, and a superseded row can never change again (the ledger is append-only,
-- migration 0008). Rejecting a bad run's rows alone would therefore leave the shelf with NO
-- price at all. Rollback re-records the predecessor as a new live observation (same values,
-- same observed_at, so freshness stays honest) and links it to the row it restores.
--
-- Additive. Rollback of this migration: drop the three functions, restore record_prices() from
-- 0008, drop the index and the column.
-- ---------------------------------------------------------------------------

-- 1. A file is imported once.
alter table public.ingestion_runs add column file_hash text;

create unique index ingestion_runs_one_per_file
  on public.ingestion_runs (source_id, file_hash)
  where file_hash is not null and status in ('running', 'succeeded');

create or replace function public.start_ingestion_run(p_source_slug text, p_file_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.sources;
  v_run    public.ingestion_runs;
begin
  perform public.require_price_writer();

  select * into v_source from public.sources where slug = p_source_slug;
  if not found then
    raise exception 'unknown source %', p_source_slug using errcode = 'P0002';
  end if;

  if p_file_hash is not null then
    select * into v_run from public.ingestion_runs
     where source_id = v_source.id and file_hash = p_file_hash and status in ('running', 'succeeded');
    if found then
      return jsonb_build_object('run_id', v_run.id, 'already_imported', true, 'status', v_run.status);
    end if;
  end if;

  insert into public.ingestion_runs (source_id, file_hash) values (v_source.id, p_file_hash) returning * into v_run;
  return jsonb_build_object('run_id', v_run.id, 'already_imported', false, 'status', v_run.status);
end;
$$;

create or replace function public.finish_ingestion_run(p_run_id uuid, p_status text, p_stats jsonb default '{}'::jsonb)
returns public.ingestion_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.ingestion_runs;
begin
  perform public.require_price_writer();
  if p_status not in ('succeeded', 'failed') then
    raise exception 'a run finishes as succeeded or failed' using errcode = '22023';
  end if;

  update public.ingestion_runs set status = p_status, finished_at = now(), stats = stats || coalesce(p_stats, '{}'::jsonb)
   where id = p_run_id and status = 'running'
  returning * into v_run;

  if not found then
    raise exception 'no running ingestion run %', p_run_id using errcode = 'P0002';
  end if;
  return v_run;
end;
$$;

-- 2. Sanity gates in the batch entry point. A price that fails is HELD (stored, invisible to the
--    public, visible to admins) rather than published or thrown away, and the caller is told.
--    Held rows keep the reason in `raw.held_reason`.
--
--      price_out_of_range   more than 10x or less than 1/10 of the SKU's median regular price
--                           across chains (needs 3+ chains to have an opinion)
--      sudden_change        moved more than 40% from the previous live price of the same shelf
--                           and kind within 2 days
--
--    (A saving above 70% is held by the read model itself, migration 0009.) Rows the caller
--    already marked `held` pass through untouched.
create or replace function public.record_prices(
  p_source_slug text,
  p_items       jsonb,
  p_run_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item      jsonb;
  idx       integer := 0;
  accepted  integer := 0;
  errors    jsonb   := '[]'::jsonb;
  held      jsonb   := '[]'::jsonb;
  v_status  text;
  v_reason  text;
  v_raw     jsonb;
  v_price   integer;
  v_median  numeric;
  v_chains  integer;
  v_prev    integer;
begin
  perform public.require_price_writer();

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items must be a json array' using errcode = '22023';
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    idx := idx + 1;
    begin
      v_status := coalesce(item ->> 'status', 'live');
      v_reason := null;
      v_raw    := item -> 'raw';
      v_price  := (item ->> 'price_agorot')::integer;

      if v_status = 'live' and v_price is not null and v_price > 0 then
        select percentile_cont(0.5) within group (order by r.price_agorot), count(distinct r.store_id)
          into v_median, v_chains
          from public.price_observations r
         where r.sku_id = (item ->> 'sku_id')::uuid
           and r.kind = 'regular' and r.status = 'live'
           and r.observed_at > now() - interval '30 days';

        if v_chains >= 3 and (v_price > v_median * 10 or v_price < v_median / 10) then
          v_reason := 'price_out_of_range';
        else
          select o.price_agorot into v_prev
            from public.price_observations o
           where o.sku_id = (item ->> 'sku_id')::uuid
             and o.store_id = (item ->> 'store_id')::uuid
             and o.branch_id is not distinct from (item ->> 'branch_id')::uuid
             and o.kind = (item ->> 'kind')::public.price_kind
             and o.status = 'live'
             and o.observed_at > (item ->> 'observed_at')::timestamptz - interval '2 days'
             and (
               (item ->> 'kind') = 'regular'
               or o.identity_key = coalesce(item ->> 'natural_key', '')
             )
           order by o.observed_at desc, o.id desc
           limit 1;
          if v_prev is not null and abs(v_price - v_prev)::numeric / v_prev > 0.40 then
            v_reason := 'sudden_change';
          end if;
        end if;
      end if;

      if v_reason is not null then
        v_status := 'held';
        v_raw := coalesce(v_raw, '{}'::jsonb) || jsonb_build_object('held_reason', v_reason);
        held := held || jsonb_build_object('index', idx, 'reason', v_reason);
      end if;

      perform public.record_price(
        p_sku_id       := (item ->> 'sku_id')::uuid,
        p_store_id     := (item ->> 'store_id')::uuid,
        p_kind         := (item ->> 'kind')::public.price_kind,
        p_price_agorot := v_price,
        p_observed_at  := (item ->> 'observed_at')::timestamptz,
        p_source_slug  := p_source_slug,
        p_branch_id    := (item ->> 'branch_id')::uuid,
        p_valid_from   := (item ->> 'valid_from')::timestamptz,
        p_valid_to     := (item ->> 'valid_to')::timestamptz,
        p_promo_type   := (item ->> 'promo_type')::public.promo_type,
        p_conditions   := coalesce(item -> 'conditions', '{}'::jsonb),
        p_natural_key  := item ->> 'natural_key',
        p_content_hash := item ->> 'content_hash',
        p_raw          := v_raw,
        p_run_id       := p_run_id,
        p_status       := v_status
      );
      accepted := accepted + 1;
    exception when others then
      -- The held entry (if any) was for a record that then failed anyway: report it as an error only.
      if v_reason is not null then
        held := (select coalesce(jsonb_agg(h), '[]'::jsonb) from jsonb_array_elements(held) h where (h ->> 'index')::integer <> idx);
      end if;
      errors := errors || jsonb_build_object('index', idx, 'code', sqlstate, 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'accepted', accepted,
    'rejected', jsonb_array_length(errors),
    'held', jsonb_array_length(held),
    'errors', errors,
    'held_items', held
  );
end;
$$;

-- 3. Undo a run, and put back what it replaced.
create or replace function public.rollback_ingestion_run(p_run_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run      public.ingestion_runs;
  v_bad      public.price_observations;
  v_cur      public.price_observations;
  v_prev     public.price_observations;
  v_rejected integer := 0;
  v_restored integer := 0;
begin
  if not (public.is_super_admin() or current_setting('role', true) = 'service_role') then
    raise exception 'super admin or service privileges required' using errcode = '42501';
  end if;

  select * into v_run from public.ingestion_runs where id = p_run_id for update;
  if not found then
    raise exception 'unknown ingestion run %', p_run_id using errcode = 'P0002';
  end if;
  if v_run.status = 'rolled_back' then
    return v_run.stats -> 'rollback';
  end if;

  -- Only rows still standing can be rejected; history that later runs already replaced is
  -- left as it is (it is not on any shelf).
  for v_bad in
    select * from public.price_observations
     where run_id = p_run_id and status in ('live', 'held')
     order by id
  loop
    perform pg_advisory_xact_lock(hashtext(v_bad.sku_id::text || v_bad.store_id::text));
    update public.price_observations set status = 'rejected' where id = v_bad.id;
    v_rejected := v_rejected + 1;

    if v_bad.status = 'live' then
      -- Walk back to the last price that did not come from this run.
      v_cur := v_bad;
      loop
        select * into v_prev from public.price_observations p
         where p.superseded_by = v_cur.id
         order by p.observed_at desc, p.id desc limit 1;
        exit when not found;
        exit when v_prev.run_id is distinct from p_run_id;
        v_cur := v_prev;
      end loop;

      if found and v_prev.status = 'superseded' then
        insert into public.price_observations (
          sku_id, store_id, branch_id, kind, price_agorot, observed_at, valid_from, valid_to,
          promo_type, conditions, identity_key, source_id, run_id, natural_key, content_hash,
          raw, status, created_by
        ) values (
          v_prev.sku_id, v_prev.store_id, v_prev.branch_id, v_prev.kind, v_prev.price_agorot,
          v_prev.observed_at, v_prev.valid_from, v_prev.valid_to,
          v_prev.promo_type, v_prev.conditions, v_prev.identity_key, v_prev.source_id, null, v_prev.natural_key, null,
          jsonb_build_object('restored_from', v_prev.id, 'rollback_of_run', p_run_id),
          'live', auth.uid()
        );
        v_restored := v_restored + 1;
      end if;
    end if;
  end loop;

  -- A bad price must not be announced later.
  update public.notification_events e set status = 'done', outcome = 'rolled_back', processed_at = now()
   where e.status = 'pending'
     and e.offer_key in (select 'obs:' || o.id from public.price_observations o where o.run_id = p_run_id);

  update public.ingestion_runs set status = 'rolled_back',
         finished_at = coalesce(finished_at, now()),
         stats = stats || jsonb_build_object(
           'rollback', jsonb_build_object('rejected', v_rejected, 'restored', v_restored, 'reason', p_reason, 'at', now())
         )
   where id = p_run_id;

  return jsonb_build_object('rejected', v_rejected, 'restored', v_restored, 'reason', p_reason);
end;
$$;

-- 4. Who may call what.
revoke all on function public.start_ingestion_run(text, text) from public, anon;
revoke all on function public.finish_ingestion_run(uuid, text, jsonb) from public, anon;
revoke all on function public.rollback_ingestion_run(uuid, text) from public, anon;
revoke execute on function public.record_prices(text, jsonb, uuid) from public, anon;
grant execute on function public.start_ingestion_run(text, text) to authenticated, service_role;
grant execute on function public.finish_ingestion_run(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.rollback_ingestion_run(uuid, text) to authenticated, service_role;
grant execute on function public.record_prices(text, jsonb, uuid) to authenticated, service_role;

-- The definer functions do the writing; the service role needs to read the run it is working on.
grant select on public.ingestion_runs to service_role;

-- 5. A price restored by a rollback is not news.
create or replace function public.enqueue_promotion_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'promotion' or new.status <> 'live' then
    return new;
  end if;
  if new.raw ? 'restored_from' then
    return new;
  end if;

  -- Invented prices never wake anyone up.
  if exists (select 1 from public.sources s where s.id = new.source_id and s.slug = 'sample-data') then
    return new;
  end if;

  insert into public.notification_events (dedupe_key, offer_key, beer_id, expires_at)
  select 'promo:' || new.sku_id || ':' || new.store_id || ':' || new.identity_key || ':' || new.price_agorot
                   || ':' || coalesce(new.valid_from::date::text, ''),
         'obs:' || new.id,
         k.beer_id,
         coalesce(new.valid_to, now() + interval '24 hours')
    from public.skus k
   where k.id = new.sku_id
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

-- ======================== 0014_feed_model.sql ========================

-- ---------------------------------------------------------------------------
-- 0014 · The model the real feeds need
--
-- The ingestion dry run on six chains' real files (docs/INGESTION-DRY-RUN.md, 2026-09-29) found
-- seven places where the feeds and the catalogue model disagreed. This migration closes them.
-- Every change is additive: new tables and columns, views rebuilt, functions extended. No row is
-- deleted or rewritten.
--
--  1. Product category.   A pack is beer, non-alcoholic beer or radler (shown), or malt drink or
--                         cider (kept out for now). Explicit, so a category can be switched on
--                         later without bending the beer schema.
--  2. Variant.            "גולדסטאר לא מסונן" and "גולדסטאר" in the same 500 ml can are different
--                         products; the SKU identity now includes the variant.
--  3. Feed identity.      A feed's publisher is not always the retailer (Carrefour's feed carries
--                         a Yeinot Bitan branch; Dor Alon's carries AM:PM). Branches keep the
--                         feed's own chain / sub-chain / store codes and point at the retailer.
--  4. Source products.    Every product a feed lists, by (publisher, item code): the raw name, the
--                         SKU it was matched to — or why it was not (the review queue).
--  5. Audience.           Only offers everyone can redeem are shown. Club, payment-method, coupon
--                         and personal offers are recorded for provenance but never published.
--  6. Deposit.            Shelf prices exclude the bottle deposit (₪0.30 a container); kept apart
--                         so it can be shown ("+ ₪1.80 פיקדון") and never distort a saving.
--  7. Group promotions.   "Any 3 of these for ₪30" is ONE offer across several SKUs, not a ₪10
--                         price for each.
--  8. Chain vs branch.    Prices stay per branch. The app reads one row per pack × chain: the
--                         lowest price among branches ("החל מ־"), how many branches, and whether
--                         they differ. No chain-wide price is invented.
--
-- Rollback (reverse order): restore the views, the enqueue trigger function and
-- rollback_ingestion_run from 0009/0011/0013; drop record_promotion_group, is_universal_offer,
-- promotion_group_items, promotion_groups, source_products; drop the new columns of
-- price_observations, branches, skus and beers; restore the old SKU unique constraint; drop
-- product_categories. Feed sources inserted below can stay (they are reference data).
-- ---------------------------------------------------------------------------

-- 1. Categories ---------------------------------------------------------------

create table public.product_categories (
  slug       text primary key check (slug ~ '^[a-z_]+$'),
  name_he    text not null,
  in_scope   boolean not null,
  sort_order smallint not null default 0
);

insert into public.product_categories (slug, name_he, in_scope, sort_order) values
  ('beer',          'בירה',               true,  1),
  ('non_alcoholic', 'בירה ללא אלכוהול',   true,  2),
  ('radler',        'רדלר',               true,  3),
  ('malt',          'משקה מאלט',          false, 4),
  ('cider',         'סיידר',              false, 5);

alter table public.beers
  add column category text not null default 'beer' references public.product_categories (slug);

-- Somersby is a cider: out of scope for now. People who already chose it keep it (nothing is
-- removed); new lists and prices leave it out.
update public.beers set category = 'cider' where slug = 'somersby';

-- 2. Variant + category per pack ---------------------------------------------

alter table public.skus
  add column variant  text not null default '' check (char_length(variant) <= 40),
  add column category text not null default 'beer' references public.product_categories (slug);

alter table public.skus drop constraint skus_beer_id_container_volume_ml_pack_quantity_key;
alter table public.skus
  add constraint skus_identity unique (beer_id, variant, container, volume_ml, pack_quantity);

-- 3. Feed identity on branches -----------------------------------------------

alter table public.branches
  add column feed_chain_code     text check (feed_chain_code ~ '^[0-9]{13}$'),
  add column feed_sub_chain_code text,
  add column feed_store_code     text,
  add column address             text,
  add column last_seen_at        timestamptz;

create unique index branches_feed_identity
  on public.branches (feed_chain_code, coalesce(feed_sub_chain_code, ''), feed_store_code)
  where feed_chain_code is not null;

-- One source per publisher. Trust = what the law requires them to publish.
insert into public.sources (slug, name, kind, trust) values
  ('feed-carrefour',   'Carrefour Israel price feed (Carrefour, Yeinot Bitan)', 'chain_feed', 80),
  ('feed-shufersal',   'Shufersal price feed',     'chain_feed', 80),
  ('feed-rami-levy',   'Rami Levy price feed',     'chain_feed', 80),
  ('feed-yochananof',  'Yochananof price feed',    'chain_feed', 80),
  ('feed-osher-ad',    'Osher Ad price feed',      'chain_feed', 80),
  ('feed-tiv-taam',    'Tiv Taam price feed',      'chain_feed', 80),
  ('feed-victory',     'Victory price feed',       'chain_feed', 80),
  ('feed-mahsanei',    'Mahsanei HaShuk price feed', 'chain_feed', 80),
  ('feed-hatzi-hinam', 'Hatzi Hinam price feed',   'chain_feed', 80),
  ('feed-king-store',  'King Store price feed',    'chain_feed', 80),
  ('feed-dor-alon',    'Dor Alon price feed (AM:PM)', 'chain_feed', 80)
on conflict (slug) do nothing;

-- 4. Source products: the alias table and the review queue --------------------

create table public.source_products (
  id              bigint generated always as identity primary key,
  feed_chain_code text not null check (feed_chain_code ~ '^[0-9]{13}$'),
  item_code       text not null check (char_length(item_code) between 1 and 40),
  raw_name        text not null,
  manufacturer    text,
  sku_id          uuid references public.skus (id) on delete set null,
  -- matched: priced as sku_id · review: a human must decide · ignored: not in scope
  status          text not null default 'review' check (status in ('matched', 'review', 'ignored')),
  match_basis     text check (match_basis in ('rules', 'barcode', 'admin')),
  reason          text,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  unique (feed_chain_code, item_code),
  constraint source_products_matched_has_sku check (status <> 'matched' or sku_id is not null)
);

create index source_products_review_idx on public.source_products (status, last_seen_at desc) where status = 'review';

alter table public.source_products enable row level security;
grant select, update on public.source_products to authenticated;
create policy source_products_admin on public.source_products for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.source_products to service_role;

-- 5 + 6. Audience and deposit on the ledger ----------------------------------
-- Stored in `conditions` (the ledger's structured terms) and exposed as typed columns, so
-- record_price() and record_prices() keep their signatures:
--   conditions.audience  everyone | club | payment | coupon | personal | restricted
--   conditions.deposit   {agorot, included, basis}

alter table public.price_observations
  add column audience text generated always as (coalesce(conditions ->> 'audience', 'everyone')) stored,
  add column deposit_agorot integer generated always as ((conditions #>> '{deposit,agorot}')::integer) stored,
  add column deposit_included boolean generated always as ((conditions #>> '{deposit,included}')::boolean) stored;

alter table public.price_observations
  add constraint price_obs_audience check (audience in ('everyone', 'club', 'payment', 'coupon', 'personal', 'restricted')),
  add constraint price_obs_deposit check (deposit_agorot is null or deposit_agorot between 0 and 5000);

-- The append-only guard (0008) compares whole rows. In a BEFORE UPDATE trigger generated columns
-- are not computed yet, so it must skip them — safely: they are derived from `conditions`, which
-- it still compares.
create or replace function public.price_observations_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'price observations are append-only; mark a bad row rejected instead'
      using errcode = '42501';
  end if;

  if (to_jsonb(new) - 'status' - 'superseded_by' - 'created_by' - 'audience' - 'deposit_agorot' - 'deposit_included')
     is distinct from
     (to_jsonb(old) - 'status' - 'superseded_by' - 'created_by' - 'audience' - 'deposit_agorot' - 'deposit_included') then
    raise exception 'price observations are append-only; record a new observation instead of editing one'
      using errcode = '42501';
  end if;

  if old.status in ('superseded', 'rejected') and new.status is distinct from old.status then
    raise exception 'a % observation cannot change status again', old.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Who may redeem an offer. Everything the old model already knew as restricted counts too.
create or replace function public.is_universal_offer(p_promo_type public.promo_type, p_conditions jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(p_conditions ->> 'audience', 'everyone') = 'everyone'
     and p_promo_type is distinct from 'club_price'
     and p_promo_type is distinct from 'coupon'
     -- conditions.club names the club ("שופרסל פלוס"); any value at all means members only
     and coalesce(nullif(p_conditions ->> 'club', ''), 'false') = 'false'
     and coalesce(p_conditions ->> 'coupon', 'false') = 'false'
$$;

grant execute on function public.is_universal_offer(public.promo_type, jsonb) to anon, authenticated, service_role;

-- 7. Group promotions ---------------------------------------------------------

create table public.promotion_groups (
  id              bigint generated always as identity primary key,
  store_id        uuid not null references public.stores (id) on delete restrict,
  branch_id       uuid references public.branches (id) on delete restrict,
  source_id       uuid not null references public.sources (id) on delete restrict,
  run_id          uuid references public.ingestion_runs (id) on delete restrict,
  natural_key     text not null,                 -- the chain's promotion id
  description_he  text not null check (char_length(description_he) between 1 and 200),
  required_qty    integer not null check (required_qty between 2 and 48),
  total_agorot    integer not null check (total_agorot > 0),
  audience        text not null default 'everyone' check (audience in ('everyone', 'club', 'payment', 'coupon', 'personal', 'restricted')),
  deposit_agorot  integer check (deposit_agorot between 0 and 5000),   -- per unit, when known
  deposit_included boolean,
  valid_from      timestamptz,
  valid_to        timestamptz,
  observed_at     timestamptz not null,
  status          text not null default 'live' check (status in ('live', 'held', 'superseded', 'rejected')),
  raw             jsonb,
  content_hash    text,
  created_at      timestamptz not null default now(),
  constraint promotion_groups_window check (valid_to is null or valid_from is null or valid_to > valid_from)
);

create unique index promotion_groups_idempotent on public.promotion_groups (source_id, content_hash) where content_hash is not null;
create index promotion_groups_live on public.promotion_groups (store_id, natural_key) where status = 'live';

create table public.promotion_group_items (
  group_id bigint not null references public.promotion_groups (id) on delete cascade,
  sku_id   uuid not null references public.skus (id) on delete restrict,
  primary key (group_id, sku_id)
);

alter table public.promotion_groups enable row level security;
alter table public.promotion_group_items enable row level security;
grant select on public.promotion_groups, public.promotion_group_items to anon, authenticated, service_role;
create policy promotion_groups_read_live on public.promotion_groups for select to anon, authenticated using (status = 'live');
create policy promotion_groups_read_admin on public.promotion_groups for select to authenticated using (public.is_admin());
create policy promotion_group_items_read on public.promotion_group_items for select to anon, authenticated using (true);

-- The only way in (like record_price for single-SKU prices). A new live group supersedes the
-- previous live one with the same chain promotion at the same branch.
create or replace function public.record_promotion_group(
  p_source_slug text,
  p_group       jsonb,
  p_run_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.sources;
  v_id     bigint;
  v_skus   uuid[];
  v_status text := coalesce(p_group ->> 'status', 'live');
  v_aud    text := coalesce(p_group ->> 'audience', 'everyone');
begin
  perform public.require_price_writer();

  select * into v_source from public.sources where slug = p_source_slug;
  if not found then
    raise exception 'unknown source %', p_source_slug using errcode = 'P0002';
  end if;
  if v_status not in ('live', 'held') then
    raise exception 'status must be live or held' using errcode = '22023';
  end if;
  -- A restricted offer is kept for the record, never published.
  if v_aud <> 'everyone' then
    v_status := 'held';
  end if;

  select array_agg(distinct s::uuid) into v_skus from jsonb_array_elements_text(p_group -> 'sku_ids') s;
  if v_skus is null or array_length(v_skus, 1) < 2 then
    raise exception 'a group promotion needs at least two different SKUs (one SKU is a multi_buy price)' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_skus) s where not exists (select 1 from public.skus k where k.id = s and k.is_active)) then
    raise exception 'unknown or inactive sku in the group' using errcode = 'P0002';
  end if;

  if p_group ? 'content_hash' then
    select id into v_id from public.promotion_groups where source_id = v_source.id and content_hash = p_group ->> 'content_hash';
    if found then
      return jsonb_build_object('id', v_id, 'replayed', true);
    end if;
  end if;

  insert into public.promotion_groups (
    store_id, branch_id, source_id, run_id, natural_key, description_he, required_qty, total_agorot,
    audience, deposit_agorot, deposit_included, valid_from, valid_to, observed_at, status, raw, content_hash
  ) values (
    (p_group ->> 'store_id')::uuid, (p_group ->> 'branch_id')::uuid, v_source.id, p_run_id,
    p_group ->> 'natural_key', p_group ->> 'description_he',
    (p_group ->> 'required_qty')::integer, (p_group ->> 'total_agorot')::integer,
    v_aud, (p_group ->> 'deposit_agorot')::integer, (p_group ->> 'deposit_included')::boolean,
    (p_group ->> 'valid_from')::timestamptz, (p_group ->> 'valid_to')::timestamptz,
    (p_group ->> 'observed_at')::timestamptz, v_status, p_group -> 'raw', p_group ->> 'content_hash'
  )
  returning id into v_id;

  insert into public.promotion_group_items (group_id, sku_id) select v_id, s from unnest(v_skus) s;

  if v_status = 'live' then
    update public.promotion_groups g set status = 'superseded'
     where g.store_id = (p_group ->> 'store_id')::uuid
       and g.branch_id is not distinct from (p_group ->> 'branch_id')::uuid
       and g.natural_key = p_group ->> 'natural_key'
       and g.status = 'live'
       and g.id <> v_id
       and g.observed_at <= (p_group ->> 'observed_at')::timestamptz;
  end if;

  return jsonb_build_object('id', v_id, 'replayed', false, 'status', v_status);
end;
$$;

revoke all on function public.record_promotion_group(text, jsonb, uuid) from public, anon;
grant execute on function public.record_promotion_group(text, jsonb, uuid) to authenticated, service_role;

-- 8. The read model -----------------------------------------------------------
-- Rebuilt so that everything the app reads is: in scope, redeemable by everyone, one row per
-- pack × chain, with the deposit alongside.

drop view if exists public.offers_feed;
drop view if exists public.offers_ranked;
drop view if exists public.regular_prices_feed;

-- Live promotions in force now, redeemable by everyone.
create or replace view public.promotions_current
with (security_invoker = on)
as
select o.*
  from public.price_observations o
 where o.kind = 'promotion'
   and o.status = 'live'
   and public.is_universal_offer(o.promo_type, o.conditions)
   and (o.valid_from is null or o.valid_from <= now())
   and (
     (o.valid_to is not null and o.valid_to > now())
     or (o.valid_to is null and o.observed_at > now() - interval '7 days')
   );

create view public.offers_ranked
with (security_invoker = on)
as
select
  o.id                                   as observation_id,
  o.sku_id,
  s.beer_id,
  be.slug                                as beer_slug,
  be.name_he                             as beer_name,
  be.name_en                             as beer_name_en,
  s.variant,
  s.category,
  br.slug                                as brand_slug,
  s.container,
  s.volume_ml,
  s.pack_quantity,
  s.total_volume_ml,
  s.display_he                           as sku_name,
  o.store_id,
  st.slug                                as store_slug,
  st.name_he                             as store_name,
  o.branch_id,
  o.identity_key,
  o.promo_type,
  o.conditions,
  o.deposit_agorot,
  o.deposit_included,
  o.valid_from,
  o.valid_to,
  o.observed_at,
  (psrc.slug = 'sample-data')            as is_sample,
  o.price_agorot                         as effective_agorot,
  round(o.price_agorot::numeric * 1000 / s.total_volume_ml)::integer as unit_price_per_liter_agorot,
  ref.price_agorot                       as reference_agorot,
  ref.observed_at                        as reference_observed_at,
  ref.trust                              as reference_trust,
  case when pct.raw between 1 and 70 then pct.raw end as value_pct,
  coalesce(pct.raw > 70, false)          as needs_review,
  mk.median_agorot                       as market_reference_agorot,
  mk.chains                              as market_chains,
  case when mk.median_agorot > o.price_agorot
       then round((mk.median_agorot - o.price_agorot) * 100.0 / mk.median_agorot)::integer
  end                                    as market_value_pct
from public.promotions_current o
join public.skus   s  on s.id  = o.sku_id
join public.product_categories pc on pc.slug = s.category and pc.in_scope
join public.beers  be on be.id = s.beer_id
join public.brands br on br.id = be.brand_id
join public.stores st on st.id = o.store_id
join public.sources psrc on psrc.id = o.source_id
left join lateral (
  -- The reference is the same pack at the same chain (same branch first), with the deposit
  -- treated the same way on both sides: a deposit difference is never a "saving".
  select r.price_agorot
         + case when coalesce(r.deposit_included, false) = coalesce(o.deposit_included, false) then 0
                when coalesce(r.deposit_included, false) then -coalesce(r.deposit_agorot, 0)
                else coalesce(r.deposit_agorot, 0) end as price_agorot,
         r.observed_at,
         case src.kind when 'chain_feed' then 'feed' when 'admin' then 'moderated' else 'unverified' end as trust
    from public.price_observations r
    join public.sources src on src.id = r.source_id
   where r.kind = 'regular' and r.status = 'live'
     and r.sku_id = o.sku_id
     and r.store_id = o.store_id
     and (r.branch_id is null or r.branch_id is not distinct from o.branch_id)
     and r.observed_at >= now() - interval '14 days'
   order by (r.branch_id is not distinct from o.branch_id) desc, r.observed_at desc, r.id desc
   limit 1
) ref on true
left join lateral (
  select round((ref.price_agorot - o.price_agorot) * 100.0 / ref.price_agorot)::integer as raw
   where ref.trust in ('feed', 'moderated') and ref.price_agorot > o.price_agorot
) pct on true
left join lateral (
  select (percentile_cont(0.5) within group (order by m.price_agorot))::integer as median_agorot,
         count(*)::integer as chains
    from (
      -- one number per other chain: its lowest current regular price for this pack
      select min(r.price_agorot) as price_agorot
        from public.regular_prices_current r
        join public.sources src on src.id = r.source_id and src.kind in ('chain_feed', 'admin')
       where r.sku_id = o.sku_id
         and r.store_id <> o.store_id
         and r.observed_at >= now() - interval '14 days'
       group by r.store_id
    ) m
  having count(*) >= 2
) mk on true;

-- One row per offer per chain: the same chain promotion at several branches is ONE offer
-- (the cheapest branch's terms), with the number of branches it was seen at.
create view public.offers_feed
with (security_invoker = on)
as
select
  'obs:' || o.observation_id::text          as offer_key,
  'catalog'::text                           as origin,
  o.sku_id,
  o.beer_id, o.beer_slug, o.beer_name,
  o.store_id, o.store_slug, o.store_name,
  o.sku_name                                as pack_label,
  o.container, o.volume_ml, o.pack_quantity,
  o.effective_agorot,
  o.unit_price_per_liter_agorot,
  o.reference_agorot,
  o.reference_trust,
  o.value_pct,
  o.needs_review,
  o.market_reference_agorot,
  o.market_value_pct,
  o.promo_type,
  o.conditions,
  o.valid_from, o.valid_to,
  o.observed_at,
  o.is_sample,
  o.conditions ->> 'note_he'                as notes,
  o.variant,
  o.category,
  o.deposit_agorot,
  o.deposit_included,
  o.branch_count
from (
  select distinct on (r.sku_id, r.store_id, r.identity_key)
         r.*,
         count(*) over (partition by r.sku_id, r.store_id, r.identity_key)::integer as branch_count
    from public.offers_ranked r
   order by r.sku_id, r.store_id, r.identity_key, r.effective_agorot, r.value_pct desc nulls last, r.observed_at desc
) o

union all

select
  'deal:' || d.id::text,
  'legacy',
  null::uuid,
  d.beer_id, d.beer_slug, d.beer_name,
  d.store_id, d.store_slug, d.store_name,
  case d.category when 'sixpack' then 'שישייה' when 'case' then 'ארגז' else 'בודד' end,
  null::public.container_type, null::integer, null::integer,
  d.deal_price_agorot,
  null::integer,
  d.regular_price_agorot,
  'moderated',
  case when d.discount_percent between 1 and 70 then d.discount_percent end,
  d.discount_percent > 70,
  null::integer, null::integer,
  null::public.promo_type,
  '{}'::jsonb,
  null::timestamptz, null::timestamptz,
  d.approved_at,
  coalesce(d.notes = 'מבצע לדוגמה', false),
  d.notes,
  '',
  'beer',
  null::integer,
  null::boolean,
  1
from public.deals_public d;

-- Regular prices, one row per pack × chain. Branches are not averaged or invented into a
-- "chain price": the row carries the LOWEST current price among the chain's branches, the
-- highest, and how many branches were seen — the app says "החל מ־" when they differ.
create view public.regular_prices_feed
with (security_invoker = on)
as
with latest as (
  select r.*, s.beer_id, s.container, s.volume_ml, s.pack_quantity, s.total_volume_ml,
         s.display_he, s.variant, s.category, o.deposit_agorot, o.deposit_included,
         case src.kind when 'chain_feed' then 'feed' when 'admin' then 'moderated' else 'unverified' end as trust
    from public.regular_prices_current r
    join public.price_observations o on o.id = r.id
    join public.skus s on s.id = r.sku_id
    join public.product_categories pc on pc.slug = s.category and pc.in_scope
    join public.sources src on src.id = r.source_id
)
select distinct on (l.sku_id, l.store_id)
  l.id                        as observation_id,
  l.sku_id,
  l.beer_id,
  be.slug                     as beer_slug,
  be.name_he                  as beer_name,
  l.container,
  l.volume_ml,
  l.pack_quantity,
  l.display_he                as pack_label,
  l.store_id,
  st.slug                     as store_slug,
  st.name_he                  as store_name,
  l.branch_id,
  l.price_agorot,
  round(l.price_agorot::numeric * 1000 / l.total_volume_ml)::integer as unit_price_per_liter_agorot,
  l.observed_at,
  l.is_sample,
  l.trust,
  (l.observed_at < now() - interval '14 days') as is_stale,
  l.variant,
  l.category,
  l.deposit_agorot,
  l.deposit_included,
  count(*) over w::integer                     as branch_count,
  (max(l.price_agorot) over w)::integer        as max_price_agorot
from latest l
join public.beers  be on be.id = l.beer_id
join public.stores st on st.id = l.store_id
window w as (partition by l.sku_id, l.store_id)
-- fresh prices first, then the cheapest branch
order by l.sku_id, l.store_id, (l.observed_at < now() - interval '14 days'), l.price_agorot, l.observed_at desc;

-- Group promotions in force, redeemable by everyone, one row per chain promotion (cheapest
-- branch), with the eligible packs.
create view public.group_offers_feed
with (security_invoker = on)
as
select distinct on (g.store_id, g.natural_key)
  'grp:' || g.id::text                       as offer_key,
  g.id                                       as group_id,
  g.store_id,
  st.slug                                    as store_slug,
  st.name_he                                 as store_name,
  g.description_he,
  g.required_qty,
  g.total_agorot,
  ceil(g.total_agorot::numeric / g.required_qty)::integer as per_unit_agorot,
  g.deposit_agorot,
  g.deposit_included,
  g.valid_from,
  g.valid_to,
  g.observed_at,
  (src.slug = 'sample-data')                 as is_sample,
  items.beer_ids,
  items.beer_slugs,
  items.packs,
  count(*) over (partition by g.store_id, g.natural_key)::integer as branch_count
from public.promotion_groups g
join public.stores  st  on st.id  = g.store_id
join public.sources src on src.id = g.source_id
cross join lateral (
  select array_agg(distinct k.beer_id)  as beer_ids,
         array_agg(distinct be.slug)    as beer_slugs,
         jsonb_agg(jsonb_build_object('sku_id', k.id, 'beer_slug', be.slug, 'beer_name', be.name_he, 'label', k.display_he,
                                      'container', k.container, 'volume_ml', k.volume_ml, 'pack_quantity', k.pack_quantity)
                   order by be.slug, k.volume_ml, k.pack_quantity) as packs
    from public.promotion_group_items gi
    join public.skus k on k.id = gi.sku_id
    join public.product_categories pc on pc.slug = k.category and pc.in_scope
    join public.beers be on be.id = k.beer_id
   where gi.group_id = g.id
) items
where g.status = 'live'
  and g.audience = 'everyone'
  and items.packs is not null
  and (g.valid_from is null or g.valid_from <= now())
  and ((g.valid_to is not null and g.valid_to > now()) or (g.valid_to is null and g.observed_at > now() - interval '7 days'))
order by g.store_id, g.natural_key, g.total_agorot, g.observed_at desc;

grant select on public.promotions_current, public.offers_ranked, public.offers_feed, public.regular_prices_feed,
  public.group_offers_feed, public.product_categories to anon, authenticated, service_role;

alter table public.product_categories enable row level security;
create policy product_categories_read on public.product_categories for select to anon, authenticated using (true);

-- 9. Notifications: only offers everyone can use, and only packs in scope ---------

create or replace function public.enqueue_promotion_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'promotion' or new.status <> 'live' then
    return new;
  end if;
  if new.raw ? 'restored_from' then
    return new;
  end if;
  if not public.is_universal_offer(new.promo_type, new.conditions) then
    return new;
  end if;
  if exists (select 1 from public.sources s where s.id = new.source_id and s.slug = 'sample-data') then
    return new;
  end if;

  insert into public.notification_events (dedupe_key, offer_key, beer_id, expires_at)
  select 'promo:' || new.sku_id || ':' || new.store_id || ':' || new.identity_key || ':' || new.price_agorot
                   || ':' || coalesce(new.valid_from::date::text, ''),
         'obs:' || new.id,
         k.beer_id,
         coalesce(new.valid_to, now() + interval '24 hours')
    from public.skus k
    join public.product_categories pc on pc.slug = k.category and pc.in_scope
   where k.id = new.sku_id
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

-- 10. Rollback covers group promotions too ------------------------------------

create or replace function public.rollback_ingestion_run(p_run_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run      public.ingestion_runs;
  v_bad      public.price_observations;
  v_cur      public.price_observations;
  v_prev     public.price_observations;
  v_rejected integer := 0;
  v_restored integer := 0;
  v_groups   integer := 0;
begin
  if not (public.is_super_admin() or current_setting('role', true) = 'service_role') then
    raise exception 'super admin or service privileges required' using errcode = '42501';
  end if;

  select * into v_run from public.ingestion_runs where id = p_run_id for update;
  if not found then
    raise exception 'unknown ingestion run %', p_run_id using errcode = 'P0002';
  end if;
  if v_run.status = 'rolled_back' then
    return v_run.stats -> 'rollback';
  end if;

  for v_bad in
    select * from public.price_observations
     where run_id = p_run_id and status in ('live', 'held')
     order by id
  loop
    perform pg_advisory_xact_lock(hashtext(v_bad.sku_id::text || v_bad.store_id::text));
    update public.price_observations set status = 'rejected' where id = v_bad.id;
    v_rejected := v_rejected + 1;

    if v_bad.status = 'live' then
      v_cur := v_bad;
      loop
        select * into v_prev from public.price_observations p
         where p.superseded_by = v_cur.id
         order by p.observed_at desc, p.id desc limit 1;
        exit when not found;
        exit when v_prev.run_id is distinct from p_run_id;
        v_cur := v_prev;
      end loop;

      if found and v_prev.status = 'superseded' then
        insert into public.price_observations (
          sku_id, store_id, branch_id, kind, price_agorot, observed_at, valid_from, valid_to,
          promo_type, conditions, identity_key, source_id, run_id, natural_key, content_hash,
          raw, status, created_by
        ) values (
          v_prev.sku_id, v_prev.store_id, v_prev.branch_id, v_prev.kind, v_prev.price_agorot,
          v_prev.observed_at, v_prev.valid_from, v_prev.valid_to,
          v_prev.promo_type, v_prev.conditions, v_prev.identity_key, v_prev.source_id, null, v_prev.natural_key, null,
          jsonb_build_object('restored_from', v_prev.id, 'rollback_of_run', p_run_id),
          'live', auth.uid()
        );
        v_restored := v_restored + 1;
      end if;
    end if;
  end loop;

  -- Group promotions of the run: rejected. (A group superseded by this run is not restored: the
  -- next import re-records the chain's current promotions, and a group's window is short.)
  update public.promotion_groups set status = 'rejected'
   where run_id = p_run_id and status in ('live', 'held');
  get diagnostics v_groups = row_count;

  update public.notification_events e set status = 'done', outcome = 'rolled_back', processed_at = now()
   where e.status = 'pending'
     and e.offer_key in (select 'obs:' || o.id from public.price_observations o where o.run_id = p_run_id);

  update public.ingestion_runs set status = 'rolled_back',
         finished_at = coalesce(finished_at, now()),
         stats = stats || jsonb_build_object(
           'rollback', jsonb_build_object('rejected', v_rejected, 'restored', v_restored, 'groups_rejected', v_groups,
                                          'reason', p_reason, 'at', now())
         )
   where id = p_run_id;

  return jsonb_build_object('rejected', v_rejected, 'restored', v_restored, 'groups_rejected', v_groups, 'reason', p_reason);
end;
$$;

-- The service role manages its own run's branches, SKUs and review queue (0008 granted insert and
-- update on skus and branches already).
grant select on public.product_categories to service_role;

-- ======================== 0015_reimport_and_branch_names.sql ========================

-- ---------------------------------------------------------------------------
-- 0015 · Re-import after rollback; branch names in the read model
--
-- Found by the first real ingestion into STAGING (docs/INGESTION-STAGING-REPORT.md, 2026-09-29):
--
-- 1. A rolled-back file could not be imported again. Idempotency matched the content hash of the
--    rows the rollback had REJECTED, so the re-import silently wrote nothing and the shelf stayed
--    empty. A rejected row no longer counts: replay protection covers only rows still standing.
-- 2. Prices are per branch (0014). A price seen at one branch must say which, instead of standing
--    in for the chain: the read views now carry the branch's name and city.
--
-- Additive: an index is replaced by a narrower one, two functions and three views are replaced with
-- one line / three columns added each. Rollback: re-run the same statements from 0008 and 0014.
-- ---------------------------------------------------------------------------

-- 1. Idempotency ignores rejected rows.
drop index if exists public.price_obs_idempotent;
create unique index price_obs_idempotent on public.price_observations (source_id, content_hash)
  where content_hash is not null and status <> 'rejected';

drop index if exists public.promotion_groups_idempotent;
create unique index promotion_groups_idempotent on public.promotion_groups (source_id, content_hash)
  where content_hash is not null and status <> 'rejected';

create or replace function public.record_price(
  p_sku_id       uuid,
  p_store_id     uuid,
  p_kind         public.price_kind,
  p_price_agorot integer,
  p_observed_at  timestamptz,
  p_source_slug  text,
  p_branch_id    uuid                 default null,
  p_valid_from   timestamptz          default null,
  p_valid_to     timestamptz          default null,
  p_promo_type   public.promo_type    default null,
  p_conditions   jsonb                default '{}'::jsonb,
  p_natural_key  text                 default null,
  p_content_hash text                 default null,
  p_raw          jsonb                default null,
  p_run_id       uuid                 default null,
  p_status       text                 default 'live'
)
returns public.price_observations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source   public.sources;
  v_existing public.price_observations;
  v_row      public.price_observations;
  v_price    integer := p_price_agorot;
  v_identity text;
  v_qty      integer;
  v_total    integer;
  v_newer    bigint;
begin
  perform public.require_price_writer();

  select * into v_source from public.sources where slug = p_source_slug;
  if not found then
    raise exception 'unknown source %', p_source_slug using errcode = 'P0002';
  end if;

  if p_status not in ('live', 'held') then
    raise exception 'status must be live or held' using errcode = '22023';
  end if;
  if not exists (select 1 from public.skus where id = p_sku_id and is_active) then
    raise exception 'unknown or inactive sku' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.stores where id = p_store_id) then
    raise exception 'unknown store' using errcode = 'P0002';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and store_id = p_store_id
  ) then
    raise exception 'the branch does not belong to that store' using errcode = '22023';
  end if;

  -- Replay: nothing to do.
  if p_content_hash is not null then
    select * into v_existing
      from public.price_observations
     where source_id = v_source.id and content_hash = p_content_hash and status <> 'rejected';
    if found then
      return v_existing;
    end if;
  end if;

  if p_kind = 'promotion' then
    if p_promo_type is null then
      raise exception 'a promotion needs a promo_type' using errcode = '22023';
    end if;

    if p_promo_type = 'multi_buy' then
      v_qty   := (p_conditions #>> '{multi_buy,qty}')::integer;
      v_total := (p_conditions #>> '{multi_buy,total_agorot}')::integer;
      if v_qty is null or v_qty < 2 or v_total is null or v_total <= 0 then
        raise exception 'a multi_buy needs conditions.multi_buy = {qty >= 2, total_agorot > 0}'
          using errcode = '22023';
      end if;
      if v_price is not null and v_price <> ceil(v_total::numeric / v_qty)::integer then
        raise exception 'price_agorot must equal ceil(total_agorot / qty) for a multi_buy'
          using errcode = '22023';
      end if;
      v_price := ceil(v_total::numeric / v_qty)::integer;
    end if;

    v_identity := coalesce(
      p_natural_key,
      md5(concat_ws('|', p_promo_type::text, p_valid_from::text, p_valid_to::text, p_conditions::text))
    );
  else
    if p_promo_type is not null or p_valid_to is not null then
      raise exception 'a regular price has no promo_type and no end date' using errcode = '22023';
    end if;
    v_identity := 'regular';
  end if;

  if v_price is null then
    raise exception 'a price is required' using errcode = '22023';
  end if;

  -- One writer at a time per SKU × chain, so two imports cannot both decide they
  -- are "the newest".
  perform pg_advisory_xact_lock(hashtext(p_sku_id::text || p_store_id::text));

  insert into public.price_observations (
    sku_id, store_id, branch_id, kind, price_agorot, observed_at, valid_from, valid_to,
    promo_type, conditions, identity_key, source_id, run_id, natural_key, content_hash,
    raw, status, created_by
  ) values (
    p_sku_id, p_store_id, p_branch_id, p_kind, v_price, p_observed_at, p_valid_from, p_valid_to,
    p_promo_type, coalesce(p_conditions, '{}'::jsonb), v_identity, v_source.id, p_run_id, p_natural_key, p_content_hash,
    p_raw, p_status, auth.uid()
  )
  returning * into v_row;

  if p_status = 'live' then
    select o.id into v_newer
      from public.price_observations o
     where o.sku_id = v_row.sku_id
       and o.store_id = v_row.store_id
       and o.branch_id is not distinct from v_row.branch_id
       and o.kind = v_row.kind
       and o.identity_key = v_row.identity_key
       and o.status = 'live'
       and o.id <> v_row.id
       and (o.observed_at > v_row.observed_at or (o.observed_at = v_row.observed_at and o.id > v_row.id))
     order by o.observed_at desc, o.id desc
     limit 1;

    if v_newer is not null then
      update public.price_observations set status = 'superseded', superseded_by = v_newer where id = v_row.id;
    else
      update public.price_observations o set status = 'superseded', superseded_by = v_row.id
       where o.sku_id = v_row.sku_id
         and o.store_id = v_row.store_id
         and o.branch_id is not distinct from v_row.branch_id
         and o.kind = v_row.kind
         and o.identity_key = v_row.identity_key
         and o.status = 'live'
         and o.id <> v_row.id;
    end if;

    select * into v_row from public.price_observations where id = v_row.id;
  end if;

  return v_row;
end;
$$;

create or replace function public.record_promotion_group(
  p_source_slug text,
  p_group       jsonb,
  p_run_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.sources;
  v_id     bigint;
  v_skus   uuid[];
  v_status text := coalesce(p_group ->> 'status', 'live');
  v_aud    text := coalesce(p_group ->> 'audience', 'everyone');
begin
  perform public.require_price_writer();

  select * into v_source from public.sources where slug = p_source_slug;
  if not found then
    raise exception 'unknown source %', p_source_slug using errcode = 'P0002';
  end if;
  if v_status not in ('live', 'held') then
    raise exception 'status must be live or held' using errcode = '22023';
  end if;
  -- A restricted offer is kept for the record, never published.
  if v_aud <> 'everyone' then
    v_status := 'held';
  end if;

  select array_agg(distinct s::uuid) into v_skus from jsonb_array_elements_text(p_group -> 'sku_ids') s;
  if v_skus is null or array_length(v_skus, 1) < 2 then
    raise exception 'a group promotion needs at least two different SKUs (one SKU is a multi_buy price)' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_skus) s where not exists (select 1 from public.skus k where k.id = s and k.is_active)) then
    raise exception 'unknown or inactive sku in the group' using errcode = 'P0002';
  end if;

  if p_group ? 'content_hash' then
    select id into v_id from public.promotion_groups where source_id = v_source.id and content_hash = p_group ->> 'content_hash' and status <> 'rejected';
    if found then
      return jsonb_build_object('id', v_id, 'replayed', true);
    end if;
  end if;

  insert into public.promotion_groups (
    store_id, branch_id, source_id, run_id, natural_key, description_he, required_qty, total_agorot,
    audience, deposit_agorot, deposit_included, valid_from, valid_to, observed_at, status, raw, content_hash
  ) values (
    (p_group ->> 'store_id')::uuid, (p_group ->> 'branch_id')::uuid, v_source.id, p_run_id,
    p_group ->> 'natural_key', p_group ->> 'description_he',
    (p_group ->> 'required_qty')::integer, (p_group ->> 'total_agorot')::integer,
    v_aud, (p_group ->> 'deposit_agorot')::integer, (p_group ->> 'deposit_included')::boolean,
    (p_group ->> 'valid_from')::timestamptz, (p_group ->> 'valid_to')::timestamptz,
    (p_group ->> 'observed_at')::timestamptz, v_status, p_group -> 'raw', p_group ->> 'content_hash'
  )
  returning id into v_id;

  insert into public.promotion_group_items (group_id, sku_id) select v_id, s from unnest(v_skus) s;

  if v_status = 'live' then
    update public.promotion_groups g set status = 'superseded'
     where g.store_id = (p_group ->> 'store_id')::uuid
       and g.branch_id is not distinct from (p_group ->> 'branch_id')::uuid
       and g.natural_key = p_group ->> 'natural_key'
       and g.status = 'live'
       and g.id <> v_id
       and g.observed_at <= (p_group ->> 'observed_at')::timestamptz;
  end if;

  return jsonb_build_object('id', v_id, 'replayed', false, 'status', v_status);
end;
$$;

-- 2. Branch name and city beside every price.
create or replace view public.offers_feed
with (security_invoker = on)
as
select
  'obs:' || o.observation_id::text          as offer_key,
  'catalog'::text                           as origin,
  o.sku_id,
  o.beer_id, o.beer_slug, o.beer_name,
  o.store_id, o.store_slug, o.store_name,
  o.sku_name                                as pack_label,
  o.container, o.volume_ml, o.pack_quantity,
  o.effective_agorot,
  o.unit_price_per_liter_agorot,
  o.reference_agorot,
  o.reference_trust,
  o.value_pct,
  o.needs_review,
  o.market_reference_agorot,
  o.market_value_pct,
  o.promo_type,
  o.conditions,
  o.valid_from, o.valid_to,
  o.observed_at,
  o.is_sample,
  o.conditions ->> 'note_he'                as notes,
  o.variant,
  o.category,
  o.deposit_agorot,
  o.deposit_included,
  o.branch_count,
  o.branch_id,
  bn.name_he                                as branch_name,
  bn.city                                   as branch_city
from (
  select distinct on (r.sku_id, r.store_id, r.identity_key)
         r.*,
         count(*) over (partition by r.sku_id, r.store_id, r.identity_key)::integer as branch_count
    from public.offers_ranked r
   order by r.sku_id, r.store_id, r.identity_key, r.effective_agorot, r.value_pct desc nulls last, r.observed_at desc
) o
left join public.branches bn on bn.id = o.branch_id

union all

select
  'deal:' || d.id::text,
  'legacy',
  null::uuid,
  d.beer_id, d.beer_slug, d.beer_name,
  d.store_id, d.store_slug, d.store_name,
  case d.category when 'sixpack' then 'שישייה' when 'case' then 'ארגז' else 'בודד' end,
  null::public.container_type, null::integer, null::integer,
  d.deal_price_agorot,
  null::integer,
  d.regular_price_agorot,
  'moderated',
  case when d.discount_percent between 1 and 70 then d.discount_percent end,
  d.discount_percent > 70,
  null::integer, null::integer,
  null::public.promo_type,
  '{}'::jsonb,
  null::timestamptz, null::timestamptz,
  d.approved_at,
  coalesce(d.notes = 'מבצע לדוגמה', false),
  d.notes,
  '',
  'beer',
  null::integer,
  null::boolean,
  1,
  null::uuid,
  null::text,
  null::text
from public.deals_public d;

create or replace view public.regular_prices_feed
with (security_invoker = on)
as
with latest as (
  select r.*, s.beer_id, s.container, s.volume_ml, s.pack_quantity, s.total_volume_ml,
         s.display_he, s.variant, s.category, o.deposit_agorot, o.deposit_included,
         case src.kind when 'chain_feed' then 'feed' when 'admin' then 'moderated' else 'unverified' end as trust
    from public.regular_prices_current r
    join public.price_observations o on o.id = r.id
    join public.skus s on s.id = r.sku_id
    join public.product_categories pc on pc.slug = s.category and pc.in_scope
    join public.sources src on src.id = r.source_id
)
select distinct on (l.sku_id, l.store_id)
  l.id                        as observation_id,
  l.sku_id,
  l.beer_id,
  be.slug                     as beer_slug,
  be.name_he                  as beer_name,
  l.container,
  l.volume_ml,
  l.pack_quantity,
  l.display_he                as pack_label,
  l.store_id,
  st.slug                     as store_slug,
  st.name_he                  as store_name,
  l.branch_id,
  l.price_agorot,
  round(l.price_agorot::numeric * 1000 / l.total_volume_ml)::integer as unit_price_per_liter_agorot,
  l.observed_at,
  l.is_sample,
  l.trust,
  (l.observed_at < now() - interval '14 days') as is_stale,
  l.variant,
  l.category,
  l.deposit_agorot,
  l.deposit_included,
  count(*) over w::integer                     as branch_count,
  (max(l.price_agorot) over w)::integer        as max_price_agorot,
  bn.name_he                                   as branch_name,
  bn.city                                      as branch_city
from latest l
join public.beers  be on be.id = l.beer_id
join public.stores st on st.id = l.store_id
left join public.branches bn on bn.id = l.branch_id
window w as (partition by l.sku_id, l.store_id)
-- fresh prices first, then the cheapest branch
order by l.sku_id, l.store_id, (l.observed_at < now() - interval '14 days'), l.price_agorot, l.observed_at desc;

create or replace view public.group_offers_feed
with (security_invoker = on)
as
select distinct on (g.store_id, g.natural_key)
  'grp:' || g.id::text                       as offer_key,
  g.id                                       as group_id,
  g.store_id,
  st.slug                                    as store_slug,
  st.name_he                                 as store_name,
  g.description_he,
  g.required_qty,
  g.total_agorot,
  ceil(g.total_agorot::numeric / g.required_qty)::integer as per_unit_agorot,
  g.deposit_agorot,
  g.deposit_included,
  g.valid_from,
  g.valid_to,
  g.observed_at,
  (src.slug = 'sample-data')                 as is_sample,
  items.beer_ids,
  items.beer_slugs,
  items.packs,
  count(*) over (partition by g.store_id, g.natural_key)::integer as branch_count,
  g.branch_id,
  bn.name_he                                 as branch_name,
  bn.city                                    as branch_city
from public.promotion_groups g
join public.stores  st  on st.id  = g.store_id
left join public.branches bn on bn.id = g.branch_id
join public.sources src on src.id = g.source_id
cross join lateral (
  select array_agg(distinct k.beer_id)  as beer_ids,
         array_agg(distinct be.slug)    as beer_slugs,
         jsonb_agg(jsonb_build_object('sku_id', k.id, 'beer_slug', be.slug, 'beer_name', be.name_he, 'label', k.display_he,
                                      'container', k.container, 'volume_ml', k.volume_ml, 'pack_quantity', k.pack_quantity)
                   order by be.slug, k.volume_ml, k.pack_quantity) as packs
    from public.promotion_group_items gi
    join public.skus k on k.id = gi.sku_id
    join public.product_categories pc on pc.slug = k.category and pc.in_scope
    join public.beers be on be.id = k.beer_id
   where gi.group_id = g.id
) items
where g.status = 'live'
  and g.audience = 'everyone'
  and items.packs is not null
  and (g.valid_from is null or g.valid_from <= now())
  and ((g.valid_to is not null and g.valid_to > now()) or (g.valid_to is null and g.observed_at > now() - interval '7 days'))
order by g.store_id, g.natural_key, g.total_agorot, g.observed_at desc;

-- ======================== 0016_more_beers_and_chains.sql ========================

-- 0016 — more beers and more chains (release 0.8.0). Additive only.
--
-- 1. Twelve beers the chains sell widely and the catalogue did not carry. Their rows were read and then
--    discarded as "a beer the app does not carry" — and with them every promotion that named them
--    (docs/RETAILER-COVERAGE.md has the before/after counts). Each is sold at four or more of the chains
--    we read, or carries public promotions at several.
-- 2. Four chains found on the same public price-transparency portal as Rami Levy and Yochananof
--    (Keshet Taamim, Fresh Market, Stop Market, Politzer), with their feed sources.
-- 3. Their sources for the ingestion runs.
--
-- The theme_* columns are the legacy per-beer colours (0001); the app's look comes from
-- src/design/themes.ts. Rollback: delete the rows by slug (nothing references them until an import).

-- 1. Brands, then beers (a beer belongs to a brand: 0007) ------------------------------------------

insert into public.brands (slug, name_he, name_en) values
  ('krombacher',   'קרומבכר',        'Krombacher'),
  ('eagle',        'איגל',           'Eagle'),
  ('kronenbourg',  '1664',           'Kronenbourg 1664'),
  ('miller',       'מילר',           'Miller'),
  ('staropramen',  'סטארופרמן',      'Staropramen'),
  ('chouffe',      'לה שוף',         'La Chouffe'),
  ('kasteel',      'קסטיל',          'Kasteel'),
  ('hoegaarden',   'הוגרדן',         'Hoegaarden'),
  ('franziskaner', 'פרנציסקאנר',     'Franziskaner'),
  ('estrella',     'אסטרייה דאם',    'Estrella Damm'),
  ('blue-moon',    'בלו מון',        'Blue Moon'),
  ('benediktiner', 'בנדיקטינר',      'Benediktiner')
on conflict (slug) do nothing;

insert into public.beers (slug, name_he, name_en, theme_base, theme_surface, theme_accent, theme_ink, sort_order, brand_id)
select v.slug, v.name_he, v.name_en, v.base, v.surface, v.accent, v.ink, v.sort_order, br.id
  from (values
    ('krombacher',   'קרומבכר',       'Krombacher',        '#07140c', '#0f2417', '#c9a64b', '#eef6f0', 23),
    ('eagle',        'איגל',          'Eagle',             '#170a07', '#27130e', '#d4a13a', '#fbefe9', 24),
    ('kronenbourg',  '1664 בלאנק',    'Kronenbourg 1664 Blanc', '#07101f', '#0f1c33', '#8fb6ea', '#eaf1fb', 25),
    ('miller',       'מילר',          'Miller',            '#0b0f1a', '#141a2b', '#d23b36', '#edf0f7', 26),
    ('staropramen',  'סטארופרמן',     'Staropramen',       '#0c140b', '#152415', '#cf3b32', '#eef5ec', 27),
    ('chouffe',      'לה שוף',        'La Chouffe',        '#0b1219', '#142030', '#d9423a', '#ecf2f8', 28),
    ('kasteel',      'קסטיל',         'Kasteel',           '#150a0d', '#261318', '#caa04c', '#f8ecef', 29),
    ('hoegaarden',   'הוגרדן',        'Hoegaarden',        '#0a111a', '#131e2c', '#9cc3e6', '#edf3f9', 30),
    ('franziskaner', 'פרנציסקאנר',    'Franziskaner',      '#0b0f16', '#151b26', '#d6ae52', '#eef1f6', 31),
    ('estrella',     'אסטרייה דאם',   'Estrella Damm',     '#160b07', '#26140d', '#e0b64a', '#fbefe8', 32),
    ('blue-moon',    'בלו מון',       'Blue Moon',         '#08101c', '#101c30', '#e98d3c', '#eaf0f9', 33),
    ('benediktiner', 'בנדיקטינר',     'Benediktiner',      '#0a0e18', '#131a2a', '#c9a54e', '#edf0f7', 34)
  ) as v(slug, name_he, name_en, base, surface, accent, ink, sort_order)
  join public.brands br on br.slug = v.slug
on conflict (slug) do nothing;

-- 2. Chains --------------------------------------------------------------------------------------

insert into public.stores (slug, name_he) values
  ('keshet-taamim', 'קשת טעמים'),
  ('fresh-market',  'פרשמרקט'),
  ('stop-market',   'סטופ מרקט'),
  ('politzer',      'פוליצר')
on conflict (slug) do nothing;

-- 3. Their feeds ---------------------------------------------------------------------------------

insert into public.sources (slug, name, kind, trust) values
  ('feed-keshet',      'Keshet Taamim price feed',  'chain_feed', 80),
  ('feed-freshmarket', 'Fresh Market price feed',   'chain_feed', 80),
  ('feed-stop-market', 'Stop Market price feed',    'chain_feed', 80),
  ('feed-politzer',    'Politzer price feed',       'chain_feed', 80)
on conflict (slug) do nothing;

-- ======================== 0017_branch_scope.sql ========================

-- ---------------------------------------------------------------------------
-- 0017 · Where a promotion is actually available (release 0.9.0)
--
-- Until 0.8.0 a promotion seen at one sampled branch was shown as the chain's. This migration keeps the
-- evidence needed to say, truthfully, where it is:
--
--   1. The branch INVENTORY: every branch the publisher's own Stores file lists (not only those we read).
--   2. BRANCH SCANS: for each scan, each known branch's outcome — read / unchanged / no promotions file /
--      not published / stale / failed — with the file names and times. "Not observed" is never "absent".
--   3. CANONICAL PROMOTIONS: one row per (chain, canonical key). The key is the ingestion's conservative
--      fingerprint (kind, the exact items, quantity, price, terms, start and end — never the price alone),
--      carried by each branch observation as its identity key.
--   4. OCCURRENCES: every branch whose current promotions file LISTS a public promotion on our beers — the
--      evidence of where it runs. Recorded whether or not that branch's copy passed our own price checks
--      (a check we could not complete at one branch is not evidence the chain does not run it there).
--   5. SCOPE: chainwide / participating_branches / single_branch / unknown, with the evidence and the
--      counts behind it (known, checked, matching, as of when). The rule lives in ONE function,
--      promotion_scope(); refresh_promotion_scope() applies it after every import.
--
-- Eligibility (who may redeem: audience, 0014) and scope (where) are independent: a universal promotion can
-- be single-branch, and scope is computed only for what is shown.
--
-- Additive: new columns, tables, functions and views; the three feed views are replaced with the same
-- columns plus the scope ones. Rollback: drop the new objects and re-run the views from 0015.
-- ---------------------------------------------------------------------------

-- 1. Branch inventory ------------------------------------------------------------------------------

alter table public.branches
  add column listed_in_stores_file boolean not null default false,
  add column source_listed_at      timestamptz;

-- 2. Branch scans -----------------------------------------------------------------------------------

create table public.branch_scans (
  id            bigint generated always as identity primary key,
  scan_id       text not null check (char_length(scan_id) between 1 and 80),
  store_id      uuid not null references public.stores (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  scanned_at    timestamptz not null,
  status        text not null check (status in ('ok', 'unchanged', 'no_promo_file', 'not_published', 'stale', 'failed')),
  price_file    text,
  promo_file    text,
  price_file_at timestamptz,
  promo_file_at timestamptz,
  reason        text check (reason is null or char_length(reason) <= 300),
  unique (scan_id, branch_id)
);
create index branch_scans_store on public.branch_scans (store_id, scanned_at desc);

alter table public.branch_scans enable row level security;
grant select on public.branch_scans to authenticated, service_role;
create policy branch_scans_read_admin on public.branch_scans for select to authenticated using (public.is_admin());

-- 3. Canonical promotions ----------------------------------------------------------------------------

create table public.promotions (
  id                    bigint generated always as identity primary key,
  store_id              uuid not null references public.stores (id) on delete cascade,
  canonical_key         text not null check (char_length(canonical_key) between 1 and 200),
  kind                  text not null check (kind in ('price', 'group')),
  description_he        text,
  valid_from            timestamptz,
  valid_to              timestamptz,
  -- Set only when the publisher itself states the promotion runs at every branch. No feed we read does
  -- today; the column exists so that evidence is used the day it appears, and never invented.
  source_declared_scope text check (source_declared_scope in ('chainwide')),
  scope                 text not null default 'unknown'
                        check (scope in ('chainwide', 'participating_branches', 'single_branch', 'unknown')),
  scope_evidence        text not null default 'insufficient_coverage'
                        check (scope_evidence in ('source_declared', 'observed_all_known_eligible_branches', 'observed_subset', 'insufficient_coverage')),
  branches_known        integer not null default 0 check (branches_known >= 0),
  branches_checked      integer not null default 0 check (branches_checked >= 0),
  branches_matching     integer not null default 0 check (branches_matching >= 0),
  coverage_ratio        numeric generated always as (case when branches_checked > 0 then round(branches_matching::numeric / branches_checked, 3) end) stored,
  coverage_as_of        timestamptz,
  only_branch_id        uuid references public.branches (id) on delete set null,
  first_seen_at         timestamptz not null default now(),
  refreshed_at          timestamptz not null default now(),
  unique (store_id, canonical_key),
  check (branches_checked <= branches_known or branches_known = 0)
);

alter table public.promotions enable row level security;
grant select on public.promotions to anon, authenticated, service_role;
create policy promotions_read on public.promotions for select to anon, authenticated using (true);

-- 4. The one rule -----------------------------------------------------------------------------------

/**
 * Where a promotion is, from what was checked. "בכל הרשת" (chainwide) needs either the publisher's own
 * statement, or the promotion at EVERY known branch with every known branch checked in the same scan.
 *   - a sample (checked < known), any source failure, or an incomplete inventory → never chainwide;
 *   - "only this branch" (single_branch) likewise needs EVERY known branch checked, and exactly one listing it;
 *   - seen at some, but not all, of several checked branches → participating_branches (it is certainly not
 *     chainwide, and certainly runs somewhere);
 *   - otherwise (one branch checked; or all checked have it but not all were checked) → unknown.
 */
create or replace function public.promotion_scope(
  p_source_declared text,
  p_known           integer,
  p_checked         integer,
  p_matching        integer,
  out scope          text,
  out scope_evidence text
)
language plpgsql
immutable
as $$
begin
  if p_source_declared = 'chainwide' then
    scope := 'chainwide'; scope_evidence := 'source_declared';
  elsif p_known > 0 and p_checked = p_known and p_matching = p_known then
    scope := 'chainwide'; scope_evidence := 'observed_all_known_eligible_branches';
  elsif p_known >= 2 and p_checked = p_known and p_matching = 1 then
    scope := 'single_branch'; scope_evidence := 'observed_subset';
  elsif p_checked >= 2 and p_matching >= 1 and p_matching < p_checked then
    scope := 'participating_branches'; scope_evidence := 'observed_subset';
  else
    scope := 'unknown'; scope_evidence := 'insufficient_coverage';
  end if;
end;
$$;

-- 5. Occurrences: a public promotion listed in a branch's promotions file ----------------------------------

create table public.promotion_occurrences (
  id                  bigint generated always as identity primary key,
  store_id            uuid not null references public.stores (id) on delete cascade,
  branch_id           uuid not null references public.branches (id) on delete cascade,
  canonical_key       text not null check (char_length(canonical_key) between 1 and 200),
  source_promotion_id text,
  source_file         text not null,               -- the branch's PromoFull file it was read from
  observed_at         timestamptz not null,
  valid_from          timestamptz,
  valid_to            timestamptz,
  kind                text not null check (kind in ('price', 'group')),
  price_agorot        integer,
  required_qty        integer,
  total_agorot        integer,
  conditions          jsonb not null default '{}'::jsonb, -- the terms as read (audience, basket, limit)
  published           boolean not null,           -- this branch's copy passed our checks and is shown
  reason              text check (reason is null or char_length(reason) <= 300),
  unique (branch_id, source_file, canonical_key, source_promotion_id)
);
create index promotion_occurrences_key on public.promotion_occurrences (store_id, canonical_key);

alter table public.promotion_occurrences enable row level security;
grant select on public.promotion_occurrences to anon, authenticated, service_role;
create policy promotion_occurrences_read on public.promotion_occurrences for select to anon, authenticated using (true);

-- 6. Scans and refresh (the import's write path; service role / admins only) ----------------------------

/**
 * Records one scan's outcome for every known branch of a chain, and the inventory itself.
 * p_branches: [{branch_id, status, price_file, promo_file, price_file_at, promo_file_at, reason}]
 */
create or replace function public.record_branch_scan(p_scan_id text, p_store_id uuid, p_scanned_at timestamptz, p_branches jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform public.require_price_writer();
  insert into public.branch_scans (scan_id, store_id, branch_id, scanned_at, status, price_file, promo_file, price_file_at, promo_file_at, reason)
  select p_scan_id, p_store_id, (b ->> 'branch_id')::uuid, p_scanned_at, b ->> 'status', b ->> 'price_file', b ->> 'promo_file',
         (b ->> 'price_file_at')::timestamptz, (b ->> 'promo_file_at')::timestamptz, left(b ->> 'reason', 300)
    from jsonb_array_elements(p_branches) b
    join public.branches br on br.id = (b ->> 'branch_id')::uuid and br.store_id = p_store_id
  on conflict (scan_id, branch_id) do update set status = excluded.status, price_file = excluded.price_file, promo_file = excluded.promo_file,
         price_file_at = excluded.price_file_at, promo_file_at = excluded.promo_file_at, reason = excluded.reason,
         scanned_at = excluded.scanned_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/** Records where public promotions were listed. p_rows: [{branch_id, canonical_key, source_promotion_id, source_file,
 *  observed_at, valid_from, valid_to, kind, price_agorot, required_qty, total_agorot, conditions, published, reason}] */
create or replace function public.record_promotion_occurrences(p_store_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform public.require_price_writer();
  insert into public.promotion_occurrences (store_id, branch_id, canonical_key, source_promotion_id, source_file, observed_at, valid_from, valid_to,
                                            kind, price_agorot, required_qty, total_agorot, conditions, published, reason)
  select p_store_id, (r ->> 'branch_id')::uuid, r ->> 'canonical_key', r ->> 'source_promotion_id', r ->> 'source_file',
         (r ->> 'observed_at')::timestamptz, (r ->> 'valid_from')::timestamptz, (r ->> 'valid_to')::timestamptz, r ->> 'kind',
         (r ->> 'price_agorot')::integer, (r ->> 'required_qty')::integer, (r ->> 'total_agorot')::integer,
         coalesce(r -> 'conditions', '{}'::jsonb), coalesce((r ->> 'published')::boolean, false), left(r ->> 'reason', 300)
    from jsonb_array_elements(p_rows) r
    join public.branches br on br.id = (r ->> 'branch_id')::uuid and br.store_id = p_store_id
  on conflict (branch_id, source_file, canonical_key, source_promotion_id) do update set published = excluded.published, reason = excluded.reason;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/**
 * The newest promotions file of a branch is its complete list of promotions: anything still standing
 * there from an older file, and not in this one, is over (superseded). Called once per branch read.
 */
create or replace function public.close_missing_promotions(p_branch_id uuid, p_observed_at timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prices integer;
  v_groups integer;
begin
  perform public.require_price_writer();
  update public.price_observations set status = 'superseded'
   where branch_id = p_branch_id and kind = 'promotion' and status = 'live' and observed_at < p_observed_at;
  get diagnostics v_prices = row_count;
  update public.promotion_groups set status = 'superseded'
   where branch_id = p_branch_id and status = 'live' and observed_at < p_observed_at;
  get diagnostics v_groups = row_count;
  return v_prices + v_groups;
end;
$$;

/**
 * Canonical promotions and their scope for one chain, from its latest scan: known = the branches that scan
 * accounted for (the whole inventory), checked = those whose current promotions file was read (re-read or
 * unchanged), matching = checked branches whose CURRENT file lists the promotion. Stale or failed branches
 * are not checked — never counted as having, or lacking, a promotion.
 */
create or replace function public.refresh_promotion_scope(p_store_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scan    text;
  v_as_of   timestamptz;
  v_known   integer;
  v_checked integer;
  v_count   integer;
begin
  perform public.require_price_writer();

  select s.scan_id, max(s.scanned_at) into v_scan, v_as_of
    from public.branch_scans s
   where s.store_id = p_store_id
   group by s.scan_id
   order by max(s.scanned_at) desc
   limit 1;

  select count(*), count(*) filter (where status in ('ok', 'unchanged'))
    into v_known, v_checked
    from public.branch_scans
   where store_id = p_store_id and scan_id = v_scan;

  -- One canonical row per promotion that is shown (a live, public observation), created on first sight.
  insert into public.promotions (store_id, canonical_key, kind, description_he, valid_from, valid_to)
  select distinct on (x.key) p_store_id, x.key, x.kind, x.description, x.valid_from, x.valid_to
    from (
      select o.identity_key as key, 'price' as kind, o.conditions ->> 'note_he' as description, o.valid_from, o.valid_to, o.observed_at
        from public.price_observations o
       where o.store_id = p_store_id and o.kind = 'promotion' and o.status = 'live' and o.audience = 'everyone'
      union all
      select g.natural_key, 'group', g.description_he, g.valid_from, g.valid_to, g.observed_at
        from public.promotion_groups g
       where g.store_id = p_store_id and g.status = 'live' and g.audience = 'everyone'
    ) x
   order by x.key, x.observed_at desc
  on conflict (store_id, canonical_key) do nothing;

  with current_listing as (
    -- each checked branch's current promotions file, and what it lists
    select occ.canonical_key, occ.branch_id
      from public.promotion_occurrences occ
      join public.branch_scans s on s.scan_id = v_scan and s.branch_id = occ.branch_id
                                and s.status in ('ok', 'unchanged') and s.promo_file = occ.source_file
     where occ.store_id = p_store_id
  ),
  matching as (
    select canonical_key, count(distinct branch_id)::integer as n, min(branch_id::text)::uuid as one_branch
      from current_listing
     group by canonical_key
  )
  update public.promotions p set branches_known    = coalesce(v_known, 0),
         branches_checked  = coalesce(v_checked, 0),
         branches_matching = coalesce(m.n, 0),
         scope             = sc.scope,
         scope_evidence    = sc.scope_evidence,
         coverage_as_of    = v_as_of,
         only_branch_id    = case when coalesce(m.n, 0) = 1 then m.one_branch end,
         refreshed_at      = now()
    from public.promotions p2
    left join matching m on m.canonical_key = p2.canonical_key
    cross join lateral public.promotion_scope(p2.source_declared_scope, coalesce(v_known, 0), coalesce(v_checked, 0), coalesce(m.n, 0)) sc
   where p.id = p2.id and p2.store_id = p_store_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.record_branch_scan(text, uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke execute on function public.close_missing_promotions(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.record_promotion_occurrences(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_promotion_occurrences(uuid, jsonb) to service_role, authenticated;
revoke execute on function public.refresh_promotion_scope(uuid) from public, anon, authenticated;
grant execute on function public.record_branch_scan(text, uuid, timestamptz, jsonb) to service_role, authenticated;
grant execute on function public.close_missing_promotions(uuid, timestamptz) to service_role, authenticated;
grant execute on function public.refresh_promotion_scope(uuid) to service_role, authenticated;
grant execute on function public.promotion_scope(text, integer, integer, integer) to anon, authenticated, service_role;

-- 7. The feeds carry the scope --------------------------------------------------------------------------

create or replace view public.offers_feed
with (security_invoker = on)
as
select
  'obs:' || o.observation_id::text          as offer_key,
  'catalog'::text                           as origin,
  o.sku_id,
  o.beer_id, o.beer_slug, o.beer_name,
  o.store_id, o.store_slug, o.store_name,
  o.sku_name                                as pack_label,
  o.container, o.volume_ml, o.pack_quantity,
  o.effective_agorot,
  o.unit_price_per_liter_agorot,
  o.reference_agorot,
  o.reference_trust,
  o.value_pct,
  o.needs_review,
  o.market_reference_agorot,
  o.market_value_pct,
  o.promo_type,
  o.conditions,
  o.valid_from, o.valid_to,
  o.observed_at,
  o.is_sample,
  o.conditions ->> 'note_he'                as notes,
  o.variant,
  o.category,
  o.deposit_agorot,
  o.deposit_included,
  o.branch_count,
  o.branch_id,
  bn.name_he                                as branch_name,
  bn.city                                   as branch_city,
  pr.id                                     as promotion_id,
  pr.scope,
  pr.scope_evidence,
  pr.branches_known,
  pr.branches_checked,
  pr.branches_matching,
  pr.coverage_as_of,
  ob.name_he                                as only_branch_name,
  ob.city                                   as only_branch_city
from (
  select distinct on (r.sku_id, r.store_id, r.identity_key)
         r.*,
         count(*) over (partition by r.sku_id, r.store_id, r.identity_key)::integer as branch_count
    from public.offers_ranked r
   order by r.sku_id, r.store_id, r.identity_key, r.effective_agorot, r.value_pct desc nulls last, r.observed_at desc
) o
left join public.branches bn on bn.id = o.branch_id
left join public.promotions pr on pr.store_id = o.store_id and pr.canonical_key = o.identity_key
left join public.branches ob on ob.id = pr.only_branch_id

union all

select
  'deal:' || d.id::text,
  'legacy',
  null::uuid,
  d.beer_id, d.beer_slug, d.beer_name,
  d.store_id, d.store_slug, d.store_name,
  case d.category when 'sixpack' then 'שישייה' when 'case' then 'ארגז' else 'בודד' end,
  null::public.container_type, null::integer, null::integer,
  d.deal_price_agorot,
  null::integer,
  d.regular_price_agorot,
  'moderated',
  case when d.discount_percent between 1 and 70 then d.discount_percent end,
  d.discount_percent > 70,
  null::integer, null::integer,
  null::public.promo_type,
  '{}'::jsonb,
  null::timestamptz, null::timestamptz,
  d.approved_at,
  coalesce(d.notes = 'מבצע לדוגמה', false),
  d.notes,
  '',
  'beer',
  null::integer,
  null::boolean,
  1,
  null::uuid,
  null::text,
  null::text,
  null::bigint,
  null::text,
  null::text,
  null::integer,
  null::integer,
  null::integer,
  null::timestamptz,
  null::text,
  null::text
from public.deals_public d;

create or replace view public.group_offers_feed
with (security_invoker = on)
as
select distinct on (g.store_id, g.natural_key)
  'grp:' || g.id::text                       as offer_key,
  g.id                                       as group_id,
  g.store_id,
  st.slug                                    as store_slug,
  st.name_he                                 as store_name,
  g.description_he,
  g.required_qty,
  g.total_agorot,
  ceil(g.total_agorot::numeric / g.required_qty)::integer as per_unit_agorot,
  g.deposit_agorot,
  g.deposit_included,
  g.valid_from,
  g.valid_to,
  g.observed_at,
  (src.slug = 'sample-data')                 as is_sample,
  items.beer_ids,
  items.beer_slugs,
  items.packs,
  count(*) over (partition by g.store_id, g.natural_key)::integer as branch_count,
  g.branch_id,
  bn.name_he                                 as branch_name,
  bn.city                                    as branch_city,
  pr.id                                      as promotion_id,
  pr.scope,
  pr.scope_evidence,
  pr.branches_known,
  pr.branches_checked,
  pr.branches_matching,
  pr.coverage_as_of,
  ob.name_he                                 as only_branch_name,
  ob.city                                    as only_branch_city
from public.promotion_groups g
join public.stores  st  on st.id  = g.store_id
left join public.branches bn on bn.id = g.branch_id
join public.sources src on src.id = g.source_id
left join public.promotions pr on pr.store_id = g.store_id and pr.canonical_key = g.natural_key
left join public.branches ob on ob.id = pr.only_branch_id
cross join lateral (
  select array_agg(distinct k.beer_id)  as beer_ids,
         array_agg(distinct be.slug)    as beer_slugs,
         jsonb_agg(jsonb_build_object('sku_id', k.id, 'beer_slug', be.slug, 'beer_name', be.name_he, 'label', k.display_he,
                                      'container', k.container, 'volume_ml', k.volume_ml, 'pack_quantity', k.pack_quantity)
                   order by be.slug, k.volume_ml, k.pack_quantity) as packs
    from public.promotion_group_items gi
    join public.skus k on k.id = gi.sku_id
    join public.product_categories pc on pc.slug = k.category and pc.in_scope
    join public.beers be on be.id = k.beer_id
   where gi.group_id = g.id
) items
where g.status = 'live'
  and g.audience = 'everyone'
  and items.packs is not null
  and (g.valid_from is null or g.valid_from <= now())
  and ((g.valid_to is not null and g.valid_to > now()) or (g.valid_to is null and g.observed_at > now() - interval '7 days'))
order by g.store_id, g.natural_key, g.total_agorot, g.observed_at desc;

-- The branches whose current promotions file lists a promotion, for the "where" sheet (names and cities).
-- Current = the file the chain's latest scan names for that branch (branch_scans is not public; this view
-- exposes only the promotion, the branch and when).
create or replace view public.promotion_branches
as
select distinct on (pr.id, occ.branch_id)
       pr.id           as promotion_id,
       occ.branch_id,
       bn.name_he      as branch_name,
       bn.city         as branch_city,
       occ.observed_at
  from public.promotion_occurrences occ
  join public.promotions pr on pr.store_id = occ.store_id and pr.canonical_key = occ.canonical_key
  join public.branches bn on bn.id = occ.branch_id
  join public.branch_scans s on s.branch_id = occ.branch_id and s.promo_file = occ.source_file and s.status in ('ok', 'unchanged')
   and s.scan_id = (select s2.scan_id from public.branch_scans s2 where s2.store_id = occ.store_id order by s2.scanned_at desc limit 1)
 order by pr.id, occ.branch_id, occ.observed_at desc;

grant select on public.promotion_branches to anon, authenticated, service_role;

-- ======================== 0018_read_model_at_scale.sql ========================

-- ---------------------------------------------------------------------------
-- 0018 · The read model at full-branch scale (release 0.9.0)
--
-- With every branch scanned, staging holds ~10,600 live promotions and ~32,000 regular prices (30× the
-- one-branch sample). offers_ranked computed the "other chains' median" once PER PROMOTION ROW, re-running
-- regular_prices_current (a DISTINCT ON over every regular price) 10,622 times — the feeds timed out.
--
-- Same columns, same meaning, computed once per query instead:
--   store_min  one number per chain and pack: its lowest current regular price (feed or admin, ≤ 14 days)
--   market     per pack and chain, the median of the OTHER chains' numbers (at least two of them)
-- and an index for reading one chain's live rows. The feeds' filters on store_id / sku_id reach the base
-- tables (they are the views' partition keys), so a chain's or a beer's page computes only its own rows.
--
-- Additive: one view replaced (identical columns), one index. Rollback: the 0014 definition of offers_ranked.
-- ---------------------------------------------------------------------------

create index if not exists price_obs_live_store on public.price_observations (store_id, kind, sku_id) where status = 'live';

create or replace view public.offers_ranked
with (security_invoker = on)
as
with store_min as materialized (
  -- one number per chain: its lowest current regular price for this pack
  select r.sku_id, r.store_id, min(r.price_agorot) as price_agorot
    from public.regular_prices_current r
    join public.sources src on src.id = r.source_id and src.kind in ('chain_feed', 'admin')
   where r.observed_at >= now() - interval '14 days'
   group by r.sku_id, r.store_id
),
market as materialized (
  -- for a pack at a chain: the median of the OTHER chains' numbers, when there are at least two
  select p.sku_id, p.store_id,
         (percentile_cont(0.5) within group (order by m.price_agorot))::integer as median_agorot,
         count(*)::integer as chains
    from (select distinct sku_id, store_id from public.promotions_current) p
    join store_min m on m.sku_id = p.sku_id and m.store_id <> p.store_id
   group by p.sku_id, p.store_id
  having count(*) >= 2
)
select
  o.id                                   as observation_id,
  o.sku_id,
  s.beer_id,
  be.slug                                as beer_slug,
  be.name_he                             as beer_name,
  be.name_en                             as beer_name_en,
  s.variant,
  s.category,
  br.slug                                as brand_slug,
  s.container,
  s.volume_ml,
  s.pack_quantity,
  s.total_volume_ml,
  s.display_he                           as sku_name,
  o.store_id,
  st.slug                                as store_slug,
  st.name_he                             as store_name,
  o.branch_id,
  o.identity_key,
  o.promo_type,
  o.conditions,
  o.deposit_agorot,
  o.deposit_included,
  o.valid_from,
  o.valid_to,
  o.observed_at,
  (psrc.slug = 'sample-data')            as is_sample,
  o.price_agorot                         as effective_agorot,
  round(o.price_agorot::numeric * 1000 / s.total_volume_ml)::integer as unit_price_per_liter_agorot,
  ref.price_agorot                       as reference_agorot,
  ref.observed_at                        as reference_observed_at,
  ref.trust                              as reference_trust,
  case when pct.raw between 1 and 70 then pct.raw end as value_pct,
  coalesce(pct.raw > 70, false)          as needs_review,
  mk.median_agorot                       as market_reference_agorot,
  mk.chains                              as market_chains,
  case when mk.median_agorot > o.price_agorot
       then round((mk.median_agorot - o.price_agorot) * 100.0 / mk.median_agorot)::integer
  end                                    as market_value_pct
from public.promotions_current o
join public.skus   s  on s.id  = o.sku_id
join public.product_categories pc on pc.slug = s.category and pc.in_scope
join public.beers  be on be.id = s.beer_id
join public.brands br on br.id = be.brand_id
join public.stores st on st.id = o.store_id
join public.sources psrc on psrc.id = o.source_id
left join lateral (
  -- The reference is the same pack at the same chain (same branch first), with the deposit
  -- treated the same way on both sides: a deposit difference is never a "saving".
  select r.price_agorot
         + case when coalesce(r.deposit_included, false) = coalesce(o.deposit_included, false) then 0
                when coalesce(r.deposit_included, false) then -coalesce(r.deposit_agorot, 0)
                else coalesce(r.deposit_agorot, 0) end as price_agorot,
         r.observed_at,
         case src.kind when 'chain_feed' then 'feed' when 'admin' then 'moderated' else 'unverified' end as trust
    from public.price_observations r
    join public.sources src on src.id = r.source_id
   where r.kind = 'regular' and r.status = 'live'
     and r.sku_id = o.sku_id
     and r.store_id = o.store_id
     and (r.branch_id is null or r.branch_id is not distinct from o.branch_id)
     and r.observed_at >= now() - interval '14 days'
   order by (r.branch_id is not distinct from o.branch_id) desc, r.observed_at desc, r.id desc
   limit 1
) ref on true
left join lateral (
  select round((ref.price_agorot - o.price_agorot) * 100.0 / ref.price_agorot)::integer as raw
   where ref.trust in ('feed', 'moderated') and ref.price_agorot > o.price_agorot
) pct on true
left join market mk on mk.sku_id = o.sku_id and mk.store_id = o.store_id;

-- ======================== 0019_batched_rollback.sql ========================

-- ---------------------------------------------------------------------------
-- Rolling back a whole-chain import, in bounded pieces.
--
-- `rollback_ingestion_run` walks every live or held observation of a run in one
-- transaction. For a small run that is fine. For Shufersal — 417 branches, tens
-- of thousands of observations — the call outlives the API gateway's timeout,
-- and the caller is left not knowing whether the work committed. That is the
-- worst state to be in while undoing a bad import.
--
-- So the work is made resumable instead of faster. Each call does at most
-- `p_limit` observations and returns how many are left. The driver loops until
-- `done` is true. Nothing depends on a single long transaction surviving.
--
-- The properties this relies on, in order of importance:
--
--   * IDEMPOTENT. A processed observation becomes 'rejected', and the next
--     batch selects only 'live' and 'held'. Re-running after a timeout, a
--     crash, or a double-click resumes; it does not redo.
--   * BOUNDED. One batch, one transaction. A batch that fails rolls back only
--     itself, and the batches before it stay done.
--   * SINGLE-RUN. Every statement is keyed on `run_id = p_run_id`. There is no
--     path here that can touch an observation belonging to another import.
--   * The run is marked 'rolled_back' only when nothing is left, so a half-
--     finished rollback never looks finished.
--
-- The original function is kept and still works. This is the one to use for
-- anything chain-sized.
-- ---------------------------------------------------------------------------

create or replace function public.rollback_ingestion_run_batch(
  p_run_id uuid,
  p_limit  integer default 500,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run       public.ingestion_runs;
  v_bad       public.price_observations;
  v_cur       public.price_observations;
  v_prev      public.price_observations;
  v_found     boolean;
  v_rejected  integer := 0;
  v_restored  integer := 0;
  v_remaining integer;
  v_prior     jsonb;
begin
  if not (public.is_super_admin() or current_setting('role', true) = 'service_role') then
    raise exception 'super admin or service privileges required' using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'p_limit must be between 1 and 5000' using errcode = '22023';
  end if;

  select * into v_run from public.ingestion_runs where id = p_run_id for update;
  if not found then
    raise exception 'unknown ingestion run %', p_run_id using errcode = 'P0002';
  end if;

  -- Already finished: say so rather than starting again.
  if v_run.status = 'rolled_back' then
    return coalesce(v_run.stats -> 'rollback', '{}'::jsonb) || jsonb_build_object('done', true, 'batch_rejected', 0);
  end if;

  for v_bad in
    select * from public.price_observations
     where run_id = p_run_id and status in ('live', 'held')
     order by id
     limit p_limit
  loop
    perform pg_advisory_xact_lock(hashtext(v_bad.sku_id::text || v_bad.store_id::text));
    update public.price_observations set status = 'rejected' where id = v_bad.id;
    v_rejected := v_rejected + 1;

    if v_bad.status = 'live' then
      v_cur := v_bad;
      v_found := false;
      loop
        select * into v_prev from public.price_observations p
         where p.superseded_by = v_cur.id
         order by p.observed_at desc, p.id desc
         limit 1;
        exit when not found;
        v_found := true;
        -- Stop at the first observation this run did not write: that is the
        -- state the shelf was in before the import, and the one to restore.
        exit when v_prev.run_id is distinct from p_run_id;
        v_cur := v_prev;
      end loop;

      if v_found and v_prev.status = 'superseded' and v_prev.run_id is distinct from p_run_id then
        insert into public.price_observations (
          sku_id, store_id, branch_id, kind, price_agorot, observed_at, valid_from, valid_to,
          promo_type, conditions, identity_key, source_id, run_id, natural_key, content_hash,
          raw, status, created_by
        ) values (
          v_prev.sku_id, v_prev.store_id, v_prev.branch_id, v_prev.kind, v_prev.price_agorot,
          v_prev.observed_at, v_prev.valid_from, v_prev.valid_to,
          v_prev.promo_type, v_prev.conditions, v_prev.identity_key, v_prev.source_id, null,
          v_prev.natural_key, null,
          jsonb_build_object('restored_from', v_prev.id, 'rollback_of_run', p_run_id),
          'live', auth.uid()
        );
        v_restored := v_restored + 1;
      end if;
    end if;
  end loop;

  select count(*) into v_remaining
    from public.price_observations
   where run_id = p_run_id and status in ('live', 'held');

  -- Totals accumulate across batches, so progress survives a resumed rollback.
  v_prior := coalesce(v_run.stats -> 'rollback', '{}'::jsonb);

  v_run.stats := coalesce(v_run.stats, '{}'::jsonb) || jsonb_build_object(
    'rollback', jsonb_build_object(
      'reason',        coalesce(p_reason, v_prior ->> 'reason'),
      'rejected',      coalesce((v_prior ->> 'rejected')::integer, 0) + v_rejected,
      'restored',      coalesce((v_prior ->> 'restored')::integer, 0) + v_restored,
      'batches',       coalesce((v_prior ->> 'batches')::integer, 0) + 1,
      'last_batch_at', now()
    )
  );

  update public.ingestion_runs set stats  = v_run.stats,
         -- Only when nothing is left. A half-finished rollback must never read
         -- as finished, or the next operator will stop too early.
         status = case when v_remaining = 0 then 'rolled_back' else status end
   where id = p_run_id;

  return jsonb_build_object(
    'run_id',         p_run_id,
    'batch_rejected', v_rejected,
    'batch_restored', v_restored,
    'remaining',      v_remaining,
    'done',           v_remaining = 0,
    'total',          v_run.stats -> 'rollback'
  );
end;
$$;

revoke all on function public.rollback_ingestion_run_batch(uuid, integer, text) from public, anon;
grant execute on function public.rollback_ingestion_run_batch(uuid, integer, text) to authenticated, service_role;

-- ======================== 0020_admin_overview_and_manual_deals.sql ========================

-- ---------------------------------------------------------------------------
-- What the admin home needs, and adding a deal by hand.
--
-- Two things an admin could not do until now: see the shape of the whole thing
-- at a glance, and put a deal up without waiting for somebody to submit it.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- The overview.
--
-- SECURITY DEFINER because most of these counts are over rows an admin
-- deliberately cannot read. `profiles` is readable only by its owner — moderating
-- deals is no reason to be able to read the list of people using the app — so
-- the only way to answer "how many people are there" without widening that is a
-- function that returns the NUMBER and never the rows.
--
-- Every figure is counted. Nothing here is estimated, and a number with no
-- events behind it comes back as 0 rather than as something invented.
-- --------------------------------------------------------------------------

create or replace function public.admin_overview(p_expiring_within_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - interval '7 days';
begin
  perform public.require_admin();

  if p_expiring_within_days < 1 or p_expiring_within_days > 60 then
    raise exception 'p_expiring_within_days must be between 1 and 60' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'people', jsonb_build_object(
      -- Everyone who has opened the app has a profile, because every visit gets
      -- an anonymous session. "Onboarded" is the honest headline: it counts the
      -- people who chose a name and four beers.
      'total',      (select count(*) from public.profiles),
      'onboarded',  (select count(*) from public.profiles where onboarded_at is not null),
      'this_week',  (select count(*) from public.profiles where created_at >= v_since),
      'notifiable', (select count(*) from public.profiles p
                      where p.notifications_enabled
                        and exists (select 1 from public.push_subscriptions s where s.user_id = p.id))
    ),
    'deals', jsonb_build_object(
      'live',            (select count(*) from public.deals where status = 'approved'),
      'pending',         (select count(*) from public.deals where status = 'pending'),
      'added_this_week', (select count(*) from public.deals
                           where status = 'approved' and approved_at >= v_since),
      'taken_down_this_week', (select count(*) from public.deals
                                where status in ('inactive', 'rejected') and updated_at >= v_since),
      'submitted_this_week',  (select count(*) from public.deals where created_at >= v_since)
    ),
    'reports', jsonb_build_object(
      'open', (select count(*) from public.deal_reports where status = 'open')
    ),
    'offers', jsonb_build_object(
      'live',     (select count(*) from public.offers_feed),
      'retailers',(select count(distinct store_slug) from public.offers_feed),
      -- Ending soon, so somebody can look before it disappears. A promotion
      -- with no end date is not "ending" and is not counted.
      'expiring', (select count(*) from public.offers_feed
                    where valid_to is not null
                      and valid_to >= current_date
                      and valid_to < current_date + make_interval(days => p_expiring_within_days))
    ),
    'notifications', jsonb_build_object(
      -- The same definition the ingestion baseline and inspect.sql use, so the
      -- number on this screen is the number in the operational checks.
      'pending',   (select count(*) from public.notification_events where status = 'pending'),
      'sent_ever', (select count(*) from public.notification_deliveries where status = 'sent')
    ),
    'expiring_within_days', p_expiring_within_days,
    'as_of', now()
  );
end;
$$;

revoke all on function public.admin_overview(integer) from public, anon;
grant execute on function public.admin_overview(integer) to authenticated;

-- --------------------------------------------------------------------------
-- Adding a deal by hand.
--
-- An admin typing a deal in is vouching for it, so it goes straight to
-- approved, attributed to them, with the same checks a submitted deal faces:
-- the price must be a real discount, and the shelf (this beer, this shop, this
-- pack) must be free. `notified_at` is set so a hand-entered deal does not ring
-- anyone's phone — the admin is already looking at it.
-- --------------------------------------------------------------------------

create or replace function public.admin_add_deal(
  p_beer_id              uuid,
  p_store_id             uuid,
  p_category             public.deal_category,
  p_deal_price_agorot    integer,
  p_regular_price_agorot integer,
  p_notes                text default null,
  p_notify               boolean default false
)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.deals;
begin
  perform public.require_admin();

  if exists (
    select 1 from public.deals d
     where d.status = 'approved'
       and d.beer_id = p_beer_id
       and d.store_id = p_store_id
       and d.category = p_category
  ) then
    raise exception
      'כבר יש מבצע מאושר על הבירה הזו, באותה חנות ובאותו מארז. צריך להסיר אותו קודם.'
      using errcode = '23505';
  end if;

  insert into public.deals (
    beer_id, store_id, category, deal_price_agorot, regular_price_agorot, notes,
    status, created_by, approved_by, approved_at, notified_at
  ) values (
    p_beer_id, p_store_id, p_category, p_deal_price_agorot, p_regular_price_agorot, p_notes,
    'approved', auth.uid(), auth.uid(), now(),
    case when p_notify then null else now() end
  )
  returning * into row;

  return row;
end;
$$;

revoke all on function public.admin_add_deal(uuid, uuid, public.deal_category, integer, integer, text, boolean)
  from public, anon;
grant execute on function public.admin_add_deal(uuid, uuid, public.deal_category, integer, integer, text, boolean)
  to authenticated;

-- --------------------------------------------------------------------------
-- Deleting a deal outright.
--
-- Taking a deal off the site (`inactive`) is the ordinary action and keeps the
-- record of who approved it. Deletion destroys that, so it stays a super-admin
-- act — and refuses while a report still points at the deal, because resolving
-- the report is what explains why it went.
-- --------------------------------------------------------------------------

create or replace function public.admin_delete_deal(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_super_admin();

  if exists (select 1 from public.deal_reports r where r.deal_id = p_deal_id and r.status = 'open') then
    raise exception 'יש דיווח פתוח על המבצע הזה. צריך לטפל בדיווח קודם.' using errcode = '22023';
  end if;

  update public.app_settings set weekly_deal_id = null where id and weekly_deal_id = p_deal_id;
  delete from public.deals where id = p_deal_id;
end;
$$;

revoke all on function public.admin_delete_deal(uuid) from public, anon;
grant execute on function public.admin_delete_deal(uuid) to authenticated;

-- ======================== 0021_sku_packaging.sql ========================

-- ---------------------------------------------------------------------------
-- 0021 · What kind of pack a SKU is: single, multipack or bottle crate
--
-- "ארגזים" meant "12 or more units" (src/lib/offer-logic.ts, 0.9.x), so a 24-can tray was listed as a crate.
-- A ארגז is a crate of BOTTLES, and calling something one takes positive evidence — never the count alone.
-- The pack's form is therefore stored, not guessed:
--
--   single        one unit
--   multipack     everything else: cans of any count, cartons and shrink-wrapped trays of bottles, and big
--                 packs whose container or form the chain did not state
--   bottle_crate  12+ bottles that the chain's own title calls a ארגז / crate (scripts/ingest/lib/
--                 normalize.mjs, packagingOf), or that an admin explicitly creates as one
--
-- A crate and a carton of the same 24 bottles are different products, so packaging joins the SKU identity.
-- A SKU written without a packaging gets single / multipack from its count (a trigger) — never a crate.
--
-- Backfill: every existing SKU becomes single or multipack, except bottles of 12+ whose source title (an
-- import's source_products row) says ארגז and not carton / shrink / tray — the same rule as the importer.
--
-- Additive (one column, one trigger, the identity widened by that column). The read views are unchanged:
-- the app looks packaging up by sku_id. Rollback: supabase/rollback/0021_sku_packaging.down.sql.
-- ---------------------------------------------------------------------------

alter table public.skus add column packaging text;

create or replace function public.skus_default_packaging()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.packaging is null or (tg_op = 'UPDATE' and new.pack_quantity is distinct from old.pack_quantity and new.packaging <> 'bottle_crate') then
    new.packaging := case when new.pack_quantity <= 1 then 'single' else 'multipack' end;
  end if;
  return new;
end;
$$;

create trigger skus_default_packaging
  before insert or update of pack_quantity, packaging on public.skus
  for each row execute function public.skus_default_packaging();

update public.skus s set packaging = case
     when s.pack_quantity <= 1 then 'single'
     when s.container = 'bottle' and s.pack_quantity >= 12 and exists (
       select 1 from public.source_products sp
        where sp.sku_id = s.id
          and sp.raw_name ~ '(^|[[:space:]\-(])ארגז($|[[:space:]\-)0-9])'
          and sp.raw_name !~ '(קרטון|שרינק|מגש)'
     ) then 'bottle_crate'
     else 'multipack'
   end;

alter table public.skus
  alter column packaging set not null,
  add constraint skus_packaging_known check (packaging in ('single', 'multipack', 'bottle_crate')),
  add constraint skus_packaging_matches_count check ((packaging = 'single') = (pack_quantity = 1)),
  add constraint skus_crate_is_bottles check (packaging <> 'bottle_crate' or (container = 'bottle' and pack_quantity >= 12));

alter table public.skus drop constraint skus_identity;
alter table public.skus add constraint skus_identity unique (beer_id, variant, container, volume_ml, pack_quantity, packaging);

-- ======================== 0022_offers_reference_probe.sql ========================

-- ---------------------------------------------------------------------------
-- 0022 · The deals read model: one index probe per offer instead of a scan of every branch
--
-- Measured 2026-10-06 (offers_feed for one chain, as the public): every promotion row of offers_ranked
-- looked up its reference regular price through price_obs_live_store (store_id, kind, sku_id), which
-- returns that pack's live regular price at EVERY branch of the chain; branch and age were then filtered
-- and sorted to keep one row. For Rami Levy that was 1,752 lookups and ~389k of the query's ~467k buffer
-- touches — the reason a cold cache cost seconds.
--
-- Same rows, same order of preference (this branch's newest regular price within 14 days, else the
-- chain-wide one), found by two one-row probes of a partial index on (sku, store, branch, newest first).
-- The index also carries price_agorot and source_id, so each chain's lowest regular price (store_min) is
-- read from the index rather than from 51k table rows. Staging (warm, as the public): Rami Levy 0.42 → 0.22 s,
-- Shufersal 1.7 → 0.46 s, a beer page 2.36 → 0.89 s; buffers per chain query 467k → 43k.
--
-- Proven on staging: the new view and 0018's return the identical multiset of rows (except all both
-- ways, all chains). Columns unchanged.
--
-- Additive: one index, one view replaced with identical columns. Rollback:
-- supabase/rollback/0022_offers_reference_probe.down.sql (0018's view; the index is harmless to keep).
-- ---------------------------------------------------------------------------

create index if not exists price_obs_live_regular
  on public.price_observations (sku_id, store_id, branch_id, observed_at desc, id desc)
  include (price_agorot, source_id)
  where kind = 'regular' and status = 'live';

create or replace view public.offers_ranked
with (security_invoker = on)
as
with store_min as materialized (
  -- one number per chain: its lowest current regular price for this pack
  select r.sku_id, r.store_id, min(r.price_agorot) as price_agorot
    from public.regular_prices_current r
    join public.sources src on src.id = r.source_id and src.kind in ('chain_feed', 'admin')
   where r.observed_at >= now() - interval '14 days'
   group by r.sku_id, r.store_id
),
market as materialized (
  -- for a pack at a chain: the median of the OTHER chains' numbers, when there are at least two
  select p.sku_id, p.store_id,
         (percentile_cont(0.5) within group (order by m.price_agorot))::integer as median_agorot,
         count(*)::integer as chains
    from (select distinct sku_id, store_id from public.promotions_current) p
    join store_min m on m.sku_id = p.sku_id and m.store_id <> p.store_id
   group by p.sku_id, p.store_id
  having count(*) >= 2
)
select
  o.id                                   as observation_id,
  o.sku_id,
  s.beer_id,
  be.slug                                as beer_slug,
  be.name_he                             as beer_name,
  be.name_en                             as beer_name_en,
  s.variant,
  s.category,
  br.slug                                as brand_slug,
  s.container,
  s.volume_ml,
  s.pack_quantity,
  s.total_volume_ml,
  s.display_he                           as sku_name,
  o.store_id,
  st.slug                                as store_slug,
  st.name_he                             as store_name,
  o.branch_id,
  o.identity_key,
  o.promo_type,
  o.conditions,
  o.deposit_agorot,
  o.deposit_included,
  o.valid_from,
  o.valid_to,
  o.observed_at,
  (psrc.slug = 'sample-data')            as is_sample,
  o.price_agorot                         as effective_agorot,
  round(o.price_agorot::numeric * 1000 / s.total_volume_ml)::integer as unit_price_per_liter_agorot,
  ref.price_agorot                       as reference_agorot,
  ref.observed_at                        as reference_observed_at,
  ref.trust                              as reference_trust,
  case when pct.raw between 1 and 70 then pct.raw end as value_pct,
  coalesce(pct.raw > 70, false)          as needs_review,
  mk.median_agorot                       as market_reference_agorot,
  mk.chains                              as market_chains,
  case when mk.median_agorot > o.price_agorot
       then round((mk.median_agorot - o.price_agorot) * 100.0 / mk.median_agorot)::integer
  end                                    as market_value_pct
from public.promotions_current o
join public.skus   s  on s.id  = o.sku_id
join public.product_categories pc on pc.slug = s.category and pc.in_scope
join public.beers  be on be.id = s.beer_id
join public.brands br on br.id = be.brand_id
join public.stores st on st.id = o.store_id
join public.sources psrc on psrc.id = o.source_id
left join lateral (
  -- The reference is the same pack at the same chain (same branch first), with the deposit
  -- treated the same way on both sides: a deposit difference is never a "saving".
  -- 0022: the same row as 0018's single query — this branch's newest regular price, else the chain-wide
  -- (branch-less) one — found by two one-row probes of price_obs_live_regular instead of reading every
  -- branch's price of the pack and sorting them.
  select r.price_agorot
         + case when coalesce(r.deposit_included, false) = coalesce(o.deposit_included, false) then 0
                when coalesce(r.deposit_included, false) then -coalesce(r.deposit_agorot, 0)
                else coalesce(r.deposit_agorot, 0) end as price_agorot,
         r.observed_at,
         case src.kind when 'chain_feed' then 'feed' when 'admin' then 'moderated' else 'unverified' end as trust
    from (
    (select r.id, 0 as prio
       from public.price_observations r
      where r.kind = 'regular' and r.status = 'live'
        and r.sku_id = o.sku_id and r.store_id = o.store_id and r.branch_id = o.branch_id
        and r.observed_at >= now() - interval '14 days'
      order by r.observed_at desc, r.id desc
      limit 1)
      union all
    (select r.id, 1 as prio
       from public.price_observations r
      where r.kind = 'regular' and r.status = 'live'
        and r.sku_id = o.sku_id and r.store_id = o.store_id and r.branch_id is null
        and r.observed_at >= now() - interval '14 days'
      order by r.observed_at desc, r.id desc
      limit 1)
      order by prio
      limit 1
    ) pick
    join public.price_observations r on r.id = pick.id
    join public.sources src on src.id = r.source_id
) ref on true
left join lateral (
  select round((ref.price_agorot - o.price_agorot) * 100.0 / ref.price_agorot)::integer as raw
   where ref.trust in ('feed', 'moderated') and ref.price_agorot > o.price_agorot
) pct on true
left join market mk on mk.sku_id = o.sku_id and mk.store_id = o.store_id;

-- ======================== 0023_no_public_execute_on_user_functions.sql ========================

-- ---------------------------------------------------------------------------
-- 0023 · The public (anon) role cannot execute the signed-in and admin functions at all
--
-- Postgres grants EXECUTE on every new function to PUBLIC. 0002 granted these to `authenticated` but never
-- took the PUBLIC grant back, so the anonymous REST role could call them. Each already refuses inside
-- (require_admin / require_super_admin / "not signed in"), so nothing was reachable — this removes the
-- door rather than relying on the lock (production audit, 2026-10-06).
--
-- `authenticated` keeps its grant: this app's visitors have an anonymous Supabase SESSION, which is the
-- authenticated role. Additive in effect (no behaviour a legitimate caller relies on changes).
-- Rollback: grant execute on the same functions to public.
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_update_deal(uuid, uuid, uuid, public.deal_category, integer, integer, text) from public, anon;
revoke execute on function public.approve_deal(uuid) from public, anon;
revoke execute on function public.grant_admin(text, public.admin_level) from public, anon;
revoke execute on function public.resolve_report(uuid, public.report_status) from public, anon;
revoke execute on function public.revoke_admin(uuid) from public, anon;
revoke execute on function public.save_preferences(text, uuid[]) from public, anon;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke execute on function public.set_deal_status(uuid, public.deal_status) from public, anon;
revoke execute on function public.set_weekly_deal(uuid) from public, anon;
revoke execute on function public.update_notification_settings(integer, integer, integer) from public, anon;

-- ======================== 0024_favourites_one_to_four.sql ========================

-- ---------------------------------------------------------------------------
-- 0024 — a person picks BETWEEN ONE AND FOUR beers, and onboarding can no
--        longer succeed without finishing.
--
-- Two changes to save_preferences(), both in one function because they are the
-- same statement's two bugs.
--
-- 1. One to four, not exactly four.
--
--    "Each person has four ranked favourite beers" came from the owner's brief
--    of 2026-09-29 and was enforced here with `array_length(p_beer_ids,1) <> 4`.
--    The owner's V2 brief changes it: a minimum of one, a maximum of four. Rank 1
--    still means what it has always meant -- it is the Primary Beer, it decides
--    the app's look, and `sync_primary_beer()` keeps `profiles.primary_beer_id`
--    true to it. Nothing about that rule changes; only the count does.
--
--    Note what does NOT need changing: `user_favorite_beers` already permits
--    this. `check (rank between 1 and 4)` with a primary key of
--    (profile_id, rank) has always allowed one, two or three rows -- the
--    four-row requirement lived entirely in this function and in the
--    application. See 0001_schema.sql:106-112.
--
-- 2. A missing profile row no longer reports success.
--
--    This UPDATE assumed a profile row exists, which is normally true: the
--    `on_auth_user_created` trigger writes one for every auth user, and
--    0003_rls.sql deliberately grants no INSERT policy so nobody else can.
--    But if that row is absent for any reason, the UPDATE touched zero rows,
--    the favourites were still inserted, the function returned without
--    complaint, and the action told the person "נשמר." -- while `onboarded_at`
--    stayed null. `getViewer().isOnboarded` then stayed false and `/` redirected
--    back to `/welcome`, forever, reporting a successful save every time.
--    Nothing anywhere recorded that this had happened.
--
--    The INSERT ... ON CONFLICT DO NOTHING closes the window, and the row-count
--    check turns a case we cannot explain into a loud error instead of a silent
--    loop. The function is SECURITY DEFINER, so it may write the row the RLS
--    policy withholds from the person -- and it writes it only for auth.uid().
--
-- Additive and reversible: this replaces one function body. To roll back,
-- restore the body from 0011_optional_name_and_regular_prices_feed.sql.
-- `create or replace` keeps the existing ACL, so 0023's revoke from `anon`
-- still stands.
-- ---------------------------------------------------------------------------

create or replace function public.save_preferences(
  p_first_name text,
  p_beer_ids   uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  n       integer;
  touched integer;
  i       integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  n := coalesce(array_length(p_beer_ids, 1), 0);

  if n < 1 or n > 4 then
    raise exception 'choose between one and four beers' using errcode = '22023';
  end if;

  if (select count(distinct b) from unnest(p_beer_ids) b) <> n then
    raise exception 'the beers must be different' using errcode = '22023';
  end if;

  if exists (select 1 from unnest(p_beer_ids) b where b is null) then
    raise exception 'the beers must be different' using errcode = '22023';
  end if;

  -- Normally already there (handle_new_user). Here so that a missing row cannot
  -- turn into a successful-looking save that never finishes onboarding.
  insert into public.profiles (id) values (uid) on conflict (id) do nothing;

  update public.profiles set first_name   = nullif(trim(p_first_name), ''),
         onboarded_at = coalesce(onboarded_at, now())
   where id = uid;

  get diagnostics touched = row_count;
  if touched = 0 then
    raise exception 'could not save your profile' using errcode = '23503';
  end if;

  delete from public.user_favorite_beers where profile_id = uid;

  for i in 1 .. n loop
    insert into public.user_favorite_beers (profile_id, beer_id, rank)
    values (uid, p_beer_ids[i], i::smallint);
  end loop;
end;
$$;

-- ======================== 0025_admin_metrics_and_roster.sql ========================

-- ---------------------------------------------------------------------------
-- 0025 — the admin dashboard tells the truth, the manual-deal notify checkbox
--        works, and the admin roster is no longer world-readable.
--
-- The V2 audit (docs/V2-AUDIT-2026-10-07.md) checked every number on the admin
-- home against its SQL. Four were provably wrong and one feature was inert.
--
-- (a) "מבצעים באוויר" DOUBLE-COUNTED. The page added `deals.live` to
--     `offers.live`, but offers_feed is `catalog UNION ALL deals_public`, and
--     deals_public IS `deals where status='approved'`. Every approved manual
--     deal was counted twice, and the hint "N מהרשתות" named a number that
--     already contained the manual ones. offers_feed now reports `live` and
--     `from_chains` separately, so the page has no reason to add anything.
--
-- (b) "הורדו" counted edits. It keyed on `updated_at`, which the deals_touch
--     trigger bumps on ANY update — so fixing a typo in a deal rejected six
--     months ago counted as a takedown this week. There was no takedown
--     timestamp to key on, so this adds one: `deals.deactivated_at`, written by
--     set_deal_status. Rows that went inactive before this migration have a null
--     there and are simply not counted; the number is honest from here on,
--     rather than wrong forever.
--
-- (c) "נשלחו ע״י משתמשים" counted the admins' own typing. It was
--     `count(*) from deals where created_at >= …` with no filter at all, and
--     admin_add_deal inserts straight into `deals`. Deciding it by "is the
--     creator in the admins table today" would be wrong the moment somebody
--     gains or loses the role, so it is recorded at insert time instead:
--     `deals.entered_by_admin`.
--
-- (d) "נשלחו אי פעם" counted test pushes. notification_deliveries.kind is
--     'offer' or 'test', and sendTestPush writes 'test' rows. Now filtered.
--
-- (e) The "send a notification" checkbox on manual deal creation did NOTHING.
--     admin_add_deal INSERTs with status='approved', but the enqueue trigger is
--     `after update of status` — an INSERT never fires it. The admin was told
--     "המבצע נוסף ופורסם" and nobody was ever told. admin_add_deal now enqueues
--     the event itself, with the same dedupe key and expiry the trigger uses, so
--     the two paths cannot diverge.
--
-- Also: the three offers_feed counts ran as three separate whole-feed
-- computations inside one STABLE call — three times the cost of the heaviest
-- query in the system, on the admin home. They are one pass now.
--
-- And the expiring window used the database's `current_date`, which is UTC on
-- Supabase: between Israeli midnight and 02:00/03:00 it was anchored to
-- yesterday. The notification pipeline has always used Asia/Jerusalem; the
-- dashboard never did. It does now.
--
-- SECURITY (M-3). `admins_read` was `for select to authenticated using (true)`,
-- and middleware gives every visitor an authenticated anonymous session — so
-- `GET /rest/v1/admins` with the public anon key returned every admin's user_id,
-- their level, and who added whom. That is a target list naming the one account
-- whose compromise yields grant_admin. Neither caller needs it: session.ts reads
-- only its own row, and the roster page runs as an admin. is_admin() and
-- is_super_admin() remain granted to anon for the "am I an admin?" question.
--
-- Additive and reversible. New columns are nullable / defaulted; the functions
-- are replaced in place (so 0023's ACL stands); the policy can be restored from
-- 0003_rls.sql:114.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- 1. The two facts the dashboard had no way to know
-- --------------------------------------------------------------------------

alter table public.deals
  add column if not exists deactivated_at   timestamptz,
  add column if not exists entered_by_admin boolean not null default false;

comment on column public.deals.deactivated_at is
  'When this deal was last moved to inactive/rejected. Null for a deal that has never been taken down, and for rows that went inactive before migration 0025.';
comment on column public.deals.entered_by_admin is
  'True when an admin typed this deal in (admin_add_deal) rather than a person submitting it. Recorded at insert because role membership changes.';

-- Counting takedowns in a week, and listing the week's submissions.
create index if not exists deals_deactivated_idx on public.deals (deactivated_at desc) where deactivated_at is not null;
create index if not exists deals_submitted_idx   on public.deals (created_at desc) where not entered_by_admin;

-- --------------------------------------------------------------------------
-- 2. set_deal_status stamps the takedown
-- --------------------------------------------------------------------------

create or replace function public.set_deal_status(p_deal_id uuid, p_status public.deal_status)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.deals;
begin
  perform public.require_admin();

  if p_status = 'approved' then
    -- Approval carries an audit trail, so it has its own entry point.
    return public.approve_deal(p_deal_id);
  end if;

  update public.deals set status = p_status,
         -- Leaving approved_by/at set on a deal that is no longer approved
         -- would misreport who stands behind it now.
         approved_by = null,
         approved_at = null,
         -- When it came down. updated_at cannot answer this: deals_touch bumps
         -- it on every edit (0025).
         deactivated_at = now()
   where id = p_deal_id
  returning * into row;

  if row.id is null then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;

  -- A deal that is no longer public cannot remain the Weekly Deal.
  update public.app_settings set weekly_deal_id = null
   where id and weekly_deal_id = p_deal_id;

  return row;
end;
$$;

-- --------------------------------------------------------------------------
-- 3. admin_add_deal records who typed it, and actually sends the notification
-- --------------------------------------------------------------------------

create or replace function public.admin_add_deal(
  p_beer_id              uuid,
  p_store_id             uuid,
  p_category             public.deal_category,
  p_deal_price_agorot    integer,
  p_regular_price_agorot integer,
  p_notes                text default null,
  p_notify               boolean default false
)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.deals;
begin
  perform public.require_admin();

  if exists (
    select 1 from public.deals d
     where d.status = 'approved'
       and d.beer_id = p_beer_id
       and d.store_id = p_store_id
       and d.category = p_category
  ) then
    raise exception
      'כבר יש מבצע מאושר על הבירה הזו, באותה חנות ובאותו מארז. צריך להסיר אותו קודם.'
      using errcode = '23505';
  end if;

  insert into public.deals (
    beer_id, store_id, category, deal_price_agorot, regular_price_agorot, notes,
    status, created_by, approved_by, approved_at, notified_at, entered_by_admin
  ) values (
    p_beer_id, p_store_id, p_category, p_deal_price_agorot, p_regular_price_agorot, p_notes,
    'approved', auth.uid(), auth.uid(), now(),
    case when p_notify then null else now() end,
    true
  )
  returning * into row;

  -- The enqueue trigger is `after update of status`, so an INSERT never fired it
  -- and this checkbox did nothing at all. Same dedupe key and expiry as
  -- enqueue_deal_notification (0012), so the two paths cannot drift apart.
  if p_notify and row.notes is distinct from 'מבצע לדוגמה' then
    insert into public.notification_events (dedupe_key, offer_key, beer_id, expires_at)
    values ('deal:' || row.id, 'deal:' || row.id, row.beer_id, now() + interval '24 hours')
    on conflict (dedupe_key) do nothing;
  end if;

  return row;
end;
$$;

-- --------------------------------------------------------------------------
-- 4. The dashboard
-- --------------------------------------------------------------------------

create or replace function public.admin_overview(p_expiring_within_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since      timestamptz := now() - interval '7 days';
  -- The Israeli calendar day, as the notification pipeline has always used.
  -- current_date is UTC on Supabase and rolls over at 02:00/03:00 local.
  v_today      date := (now() at time zone 'Asia/Jerusalem')::date;
  v_live       bigint;
  v_chains     bigint;
  v_retailers  bigint;
  v_expiring   bigint;
begin
  perform public.require_admin();

  if p_expiring_within_days < 1 or p_expiring_within_days > 60 then
    raise exception 'p_expiring_within_days must be between 1 and 60' using errcode = '22023';
  end if;

  -- One pass. These were three separate whole-feed computations in one call.
  select count(*),
         count(*) filter (where f.origin = 'catalog'),
         count(distinct f.store_slug),
         count(*) filter (
           where f.valid_to is not null
             and f.valid_to >= v_today
             and f.valid_to < v_today + make_interval(days => p_expiring_within_days)
         )
    into v_live, v_chains, v_retailers, v_expiring
    from public.offers_feed f;

  return jsonb_build_object(
    'people', jsonb_build_object(
      -- A profile is one per anonymous browser session, so these count DEVICES,
      -- not people: one person with a phone, a laptop and the installed PWA is
      -- three. There is no account identity in this schema to do better, so the
      -- screen says "מכשירים" rather than implying something it cannot know.
      'total',      (select count(*) from public.profiles),
      'onboarded',  (select count(*) from public.profiles where onboarded_at is not null),
      'this_week',  (select count(*) from public.profiles where created_at >= v_since),
      'notifiable', (select count(*) from public.profiles p
                      where p.notifications_enabled
                        and exists (select 1 from public.push_subscriptions s where s.user_id = p.id))
    ),
    'deals', jsonb_build_object(
      'live',            (select count(*) from public.deals where status = 'approved'),
      'pending',         (select count(*) from public.deals where status = 'pending'),
      'added_this_week', (select count(*) from public.deals
                           where status = 'approved' and approved_at >= v_since),
      -- By when it actually came down (0025), not by when the row was last touched.
      'taken_down_this_week', (select count(*) from public.deals
                                where status in ('inactive', 'rejected') and deactivated_at >= v_since),
      -- Sent by people. An admin typing a deal in is not a submission.
      'submitted_this_week',  (select count(*) from public.deals
                                where created_at >= v_since and not entered_by_admin)
    ),
    'reports', jsonb_build_object(
      'open', (select count(*) from public.deal_reports where status = 'open')
    ),
    'offers', jsonb_build_object(
      -- `live` already includes the approved manual deals: offers_feed is
      -- catalog UNION ALL deals_public. `from_chains` is the catalogue half.
      -- Nothing may add these two together.
      'live',        v_live,
      'from_chains', v_chains,
      'retailers',   v_retailers,
      'expiring',    v_expiring
    ),
    'notifications', jsonb_build_object(
      -- "pending" means the worker has not closed this event yet, NOT that it
      -- will be sent: it includes events that resolve to expired, below_threshold,
      -- no_recipients and the rest. The screen words it accordingly.
      'pending',   (select count(*) from public.notification_events where status = 'pending'),
      -- Real notifications only; kind='test' is an admin pushing to their own phone.
      'sent_ever', (select count(*) from public.notification_deliveries
                     where status = 'sent' and kind = 'offer')
    ),
    'expiring_within_days', p_expiring_within_days,
    'as_of', now()
  );
end;
$$;

-- --------------------------------------------------------------------------
-- 5. M-3 — the roster is for admins and for your own row
-- --------------------------------------------------------------------------

drop policy if exists admins_read on public.admins;

create policy admins_read on public.admins
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- ======================== 0026_geo_foundation.sql ========================

-- ---------------------------------------------------------------------------
-- 0026 — where the branches are, and where the person is.
--
-- V2's core question is "where should I buy the beer I want RIGHT NOW", and the
-- answer depends on how far they are willing to go. Until now the schema could
-- not express any of it: `branches` carried `name_he`, `city` and `address` and
-- NO coordinates at all, `profiles` had no location and no radius, and nothing
-- anywhere could measure a distance. This lays the foundation; the screens come
-- after it.
--
-- WHAT THIS DOES NOT DO: it does not invent a single coordinate.
--
-- The price-transparency Stores file gives a branch's name, address and city —
-- never a latitude or longitude. Real branch coordinates therefore require
-- geocoding through an external provider, which needs a credential this
-- repository does not have and must not guess. So the columns ship empty, the
-- provenance of every future fill is recorded beside it, and the app is written
-- to treat "we do not know where this branch is" as a first-class state rather
-- than as zero. A branch with no coordinates is never silently placed anywhere.
--
-- WHY PLAIN SQL AND NOT POSTGIS. The test suite runs the real migrations on
-- PGlite, which is what makes the RLS and behaviour tests trustworthy; depending
-- on postgis/earthdistance would put this schema beyond what those tests can
-- build. At Israeli scale — about 1,100 branches — a bounding-box prefilter on a
-- plain btree index followed by haversine is comfortably fast, and it is exact
-- enough for a radius a person chooses in 5 km steps. If the branch count ever
-- grows by an order of magnitude, swapping the index for a spatial one is a
-- local change: every caller goes through branches_within_km().
--
-- Additive and reversible: new nullable columns, two functions, one index.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- 1. Branch coordinates, and how we came by them
-- --------------------------------------------------------------------------

alter table public.branches
  add column if not exists latitude          double precision,
  add column if not exists longitude         double precision,
  add column if not exists geocoded_at       timestamptz,
  add column if not exists geocode_source    text,
  add column if not exists geocode_precision text;

comment on column public.branches.latitude is
  'WGS84. Null means we do not know where this branch is -- which is shown as not knowing, never as a position.';
comment on column public.branches.geocode_source is
  'Which provider or dataset produced the coordinates. Part of the record, like a price''s source.';
comment on column public.branches.geocode_precision is
  'How exact the fix is: rooftop | street | locality. A locality fix is the CITY centre, not the shop, and the app says so rather than implying a doorstep.';

do $$
begin
  -- Both or neither: half a coordinate is not a location.
  if not exists (select 1 from pg_constraint where conname = 'branches_geo_pair') then
    alter table public.branches add constraint branches_geo_pair
      check ((latitude is null) = (longitude is null));
  end if;

  -- Israel, generously bounded. This is a typo and unit-confusion guard (a swapped
  -- pair, degrees-vs-radians, a 0/0 "null island" fix), not a political boundary:
  -- a coordinate outside it is a mistake we would rather refuse than draw on a map.
  if not exists (select 1 from pg_constraint where conname = 'branches_geo_bounds') then
    alter table public.branches add constraint branches_geo_bounds
      check (
        latitude is null
        or (latitude between 29.3 and 33.5 and longitude between 34.0 and 36.0)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'branches_geocode_precision') then
    alter table public.branches add constraint branches_geocode_precision
      check (geocode_precision is null or geocode_precision in ('rooftop', 'street', 'locality'));
  end if;

  -- A coordinate without a recorded source is a coordinate we cannot defend.
  if not exists (select 1 from pg_constraint where conname = 'branches_geo_provenance') then
    alter table public.branches add constraint branches_geo_provenance
      check (latitude is null or (geocoded_at is not null and geocode_source is not null));
  end if;
end
$$;

-- The bounding-box prefilter. Partial, because a branch with no fix is never a candidate.
create index if not exists branches_geo_idx
  on public.branches (latitude, longitude)
  where latitude is not null and is_active;

-- --------------------------------------------------------------------------
-- 2. Where the person is, and how far they will go
-- --------------------------------------------------------------------------

alter table public.profiles
  add column if not exists home_city       text,
  add column if not exists home_lat        double precision,
  add column if not exists home_lon        double precision,
  add column if not exists search_radius_km integer;

comment on column public.profiles.home_city is
  'The settlement the person named. The minimum we need: V2 asks "where do you live", never for a street address.';
comment on column public.profiles.search_radius_km is
  'How far they said they are willing to travel. Null = not set. 0 means nationwide (no distance limit).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_home_pair') then
    alter table public.profiles add constraint profiles_home_pair
      check ((home_lat is null) = (home_lon is null));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_home_bounds') then
    alter table public.profiles add constraint profiles_home_bounds
      check (
        home_lat is null
        or (home_lat between 29.3 and 33.5 and home_lon between 34.0 and 36.0)
      );
  end if;

  -- The radii the app offers, plus 0 for nationwide. A number outside this set
  -- is a bug in a caller, not a preference.
  if not exists (select 1 from pg_constraint where conname = 'profiles_radius') then
    alter table public.profiles add constraint profiles_radius
      check (search_radius_km is null or search_radius_km in (0, 5, 10, 15, 20, 25, 50));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_home_city_length') then
    alter table public.profiles add constraint profiles_home_city_length
      check (home_city is null or char_length(trim(home_city)) between 1 and 60);
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- 3. Saving it
--
-- Through a function, not a column grant, for the same reason save_preferences
-- exists: 0010 revoked table-wide UPDATE on `profiles` and re-granted it column
-- by column, so the columns that decide what a person is shown are written in
-- one audited place that can only ever touch auth.uid()'s own row.
-- --------------------------------------------------------------------------

create or replace function public.save_location(
  p_city      text,
  p_lat       double precision,
  p_lon       double precision,
  p_radius_km integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if (p_lat is null) <> (p_lon is null) then
    raise exception 'a latitude without a longitude is not a place' using errcode = '22023';
  end if;

  if p_radius_km is not null and p_radius_km not in (0, 5, 10, 15, 20, 25, 50) then
    raise exception 'that is not one of the distances on offer' using errcode = '22023';
  end if;

  -- Same reason as 0024: a missing profile row must not turn into a save that
  -- reports success and changes nothing.
  insert into public.profiles (id) values (uid) on conflict (id) do nothing;

  update public.profiles set home_city        = nullif(trim(p_city), ''),
         home_lat         = p_lat,
         home_lon         = p_lon,
         search_radius_km = p_radius_km
   where id = uid;

  if not found then
    raise exception 'could not save your location' using errcode = '23503';
  end if;
end;
$$;

revoke execute on function public.save_location(text, double precision, double precision, integer) from public, anon;
grant execute on function public.save_location(text, double precision, double precision, integer) to authenticated;

-- --------------------------------------------------------------------------
-- 4. Distance
--
-- Haversine on a sphere of radius 6371 km. Good to a few metres per kilometre
-- against the ellipsoid, which is far below the precision of a city centroid or
-- of a radius chosen in 5 km steps.
-- --------------------------------------------------------------------------

create or replace function public.km_between(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
)
returns double precision
language sql
immutable
parallel safe
as $$
  select case
    when lat1 is null or lon1 is null or lat2 is null or lon2 is null then null
    else 6371 * 2 * asin(
      sqrt(
        power(sin(radians(lat2 - lat1) / 2), 2)
        + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
      )
    )
  end;
$$;

grant execute on function public.km_between(double precision, double precision, double precision, double precision)
  to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- 5. The branches near a point
--
-- One place that knows how "near" is computed, so swapping the index for a
-- spatial one later is a change here and nowhere else.
--
-- p_radius_km = 0 means nationwide: no distance limit, still ordered by distance.
-- A branch with no coordinates is never returned: we do not know that it is near,
-- and claiming it is would be the same class of mistake as an invented price.
-- --------------------------------------------------------------------------

create or replace function public.branches_within_km(
  p_lat       double precision,
  p_lon       double precision,
  p_radius_km integer default 0,
  p_limit     integer default 200
)
returns table (
  branch_id uuid,
  store_id  uuid,
  name_he   text,
  city      text,
  latitude  double precision,
  longitude double precision,
  km        double precision
)
language sql
stable
parallel safe
set search_path = public
as $$
  with box as (
    select
      -- A degree of latitude is ~111 km anywhere; a degree of longitude shrinks
      -- with the cosine of the latitude. Generous by 10%: the prefilter must never
      -- exclude a branch the exact distance would have kept.
      case when p_radius_km > 0 then p_radius_km / 111.0 * 1.1 else 999 end as dlat,
      case when p_radius_km > 0
           then p_radius_km / (111.0 * greatest(cos(radians(p_lat)), 0.2)) * 1.1
           else 999 end as dlon
  )
  select b.id, b.store_id, b.name_he, b.city, b.latitude, b.longitude,
         public.km_between(p_lat, p_lon, b.latitude, b.longitude) as km
    from public.branches b, box
   where b.is_active
     and b.latitude is not null
     and p_lat is not null and p_lon is not null
     and b.latitude  between p_lat - box.dlat and p_lat + box.dlat
     and b.longitude between p_lon - box.dlon and p_lon + box.dlon
     and (p_radius_km = 0 or public.km_between(p_lat, p_lon, b.latitude, b.longitude) <= p_radius_km)
   order by km
   limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

grant execute on function public.branches_within_km(double precision, double precision, integer, integer)
  to anon, authenticated, service_role;

-- ======================== 0027_deal_score.sql ========================

-- ---------------------------------------------------------------------------
-- 0027 — the Deal Score: how good this deal really is, on one number we can
--        defend line by line.
--
-- WHAT IT IS NOT. It is not a number invented to put a badge on a card. Every
-- point comes from a measurement already on record, the weights are fixed and
-- written down (docs/DEAL-SCORE.md), and the same offer always scores the same.
-- A person who asks "why 94?" can be answered from the `basis` column.
--
-- NO VERIFIED REFERENCE, NO SCORE. An offer whose `value_pct` is null has no
-- trusted regular price to be measured against -- 0017 emits it only when the
-- reference is a chain feed or an admin, from the same branch or chain-wide,
-- seen within 14 days, and only when the raw discount lands between 1% and 70%.
-- Such an offer gets NO ROW here, not a guessed one. The UI shows the deal
-- without a score, the way it already shows a price without a percentage. This
-- is the same rule CLAUDE.md sets for discounts, applied one level up.
--
-- WHY A TABLE AND NOT A VIEW. 0018's header records what happened the last time
-- something recomputed over the ledger per request: the feeds timed out at
-- ~10,600 live promotions and ~32,000 regular prices. The historical component
-- here reads 180 days of the price ledger, which is far heavier still. It is
-- computed once per import and stored. Nothing on a page ever computes a score.
--
-- WHY offers_feed IS NOT TOUCHED. Joining this in would mean replacing the view
-- the whole app reads, whose cost 0018 and 0022 spent two migrations getting
-- down. The app reads scores separately -- one indexed read, keyed by the same
-- offer_key the feed already emits -- and merges them.
-- ---------------------------------------------------------------------------

create table if not exists public.offer_scores (
  -- 'obs:<observation_id>' or 'deal:<uuid>': exactly the key offers_feed emits.
  offer_key   text primary key,
  score       smallint not null check (score between 0 and 100),
  band        text not null check (band in ('amazing', 'very_good', 'fair', 'weak')),
  -- What the number was built from: each component's input and contribution, plus
  -- the weights used. This is the audit trail that makes the score explainable.
  basis       jsonb not null,
  computed_at timestamptz not null default now()
);

comment on table public.offer_scores is
  'How good each scorable offer is, 0-100, recomputed by the import. An offer with no trusted reference price is absent, never zero.';

create index if not exists offer_scores_rank_idx on public.offer_scores (score desc);

alter table public.offer_scores enable row level security;

grant select on public.offer_scores to anon, authenticated, service_role;

-- The same shape as every other read-model table: the world may read it, and only
-- the definer function below writes it.
create policy offer_scores_read on public.offer_scores
  for select to anon, authenticated using (true);

-- --------------------------------------------------------------------------
-- The formula, in one place.
--
-- Three components, each 0-100, each from a measurement already on record:
--
--   CHAIN (weight 0.25) -- offers_feed.value_pct: how far below this chain's own
--     trusted regular price the offer is. 50% off or better scores 100. It is the
--     weakest signal of the three: it is measured against a price the same chain
--     set, so a chain that raises its shelf price makes its own discount look
--     deeper.
--
--   MARKET (weight 0.45) -- offers_feed.market_value_pct: how far below the MEDIAN
--     of at least two OTHER chains' lowest current regular prices it is (0022). No
--     chain can inflate this one, which is why it carries the most weight. Negative
--     (dearer than the market) contributes nothing rather than going below zero.
--
--   HISTORY (weight 0.30) -- where this price sits against every price we have
--     recorded for this exact pack in the last 180 days, promotional and regular
--     alike. At or below the lowest we have ever seen: 100. At or above the median:
--     0. Linear between. This is the "is this actually a good price, or just a
--     good-looking discount" component, and it needs at least four observations
--     before it is allowed to speak.
--
-- Components that are not available are left out and the remaining weights are
-- renormalised, so an offer is never punished for data we do not hold. But an
-- offer with ONLY the chain's own claim is capped at 80: one self-reported signal
-- is not enough to call something exceptional.
--
-- Bands: 85+ amazing, 70+ very good, 45+ fair, below that weak.
-- --------------------------------------------------------------------------

create or replace function public.refresh_offer_scores()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  written integer;
begin
  -- Written by the import, or by an admin after a manual change. The same guard the
  -- price write path uses (0008): a score is part of the price picture, and whoever
  -- may write a price may write what we think of it.
  perform public.require_price_writer();

  with history as (
    -- Every price we hold for this pack, recently enough to still mean something.
    -- Both kinds: a promotion is only remarkable against what the pack usually costs
    -- AND against the best it has ever been.
    select p.sku_id,
           min(p.price_agorot)                                                  as lowest_agorot,
           (percentile_cont(0.5) within group (order by p.price_agorot))::integer as typical_agorot,
           count(*)::integer                                                    as samples
      from public.price_observations p
     where p.observed_at >= now() - interval '180 days'
       and p.status in ('live', 'superseded')
     group by p.sku_id
    having count(*) >= 4
  ),
  scored as (
    select
      f.offer_key,
      f.value_pct,
      f.market_value_pct,
      f.effective_agorot,
      h.lowest_agorot,
      h.typical_agorot,
      h.samples,
      -- CHAIN: 50% off or better is full marks.
      least(100.0, greatest(0.0, f.value_pct::numeric / 50.0 * 100.0)) as chain_points,
      case
        when f.market_value_pct is null then null
        else least(100.0, greatest(0.0, f.market_value_pct::numeric / 50.0 * 100.0))
      end as market_points,
      case
        when h.typical_agorot is null or h.typical_agorot <= h.lowest_agorot then null
        when f.effective_agorot <= h.lowest_agorot then 100.0
        when f.effective_agorot >= h.typical_agorot then 0.0
        else (h.typical_agorot - f.effective_agorot)::numeric
             / (h.typical_agorot - h.lowest_agorot)::numeric * 100.0
      end as history_points
      from public.offers_feed f
      left join history h on h.sku_id = f.sku_id
      -- The gate: a score needs a reference we trust, and an offer flagged for
      -- review is exactly the one we must not put a confident number on.
     where f.value_pct is not null
       and not f.needs_review
       and not f.is_sample
  ),
  weighted as (
    select
      s.*,
      (0.25
        + coalesce(case when s.market_points is null then 0 else 0.45 end, 0)
        + coalesce(case when s.history_points is null then 0 else 0.30 end, 0)) as total_weight,
      (s.chain_points * 0.25
        + coalesce(s.market_points * 0.45, 0)
        + coalesce(s.history_points * 0.30, 0)) as weighted_points
      from scored s
  ),
  final as (
    select
      w.offer_key,
      -- Renormalise over the components we actually had...
      least(
        100,
        greatest(
          0,
          round(
            case
              -- ...and cap a chain-only score: one self-reported signal cannot
              -- make something exceptional.
              when w.market_points is null and w.history_points is null
                then least(80.0, w.weighted_points / w.total_weight)
              else w.weighted_points / w.total_weight
            end
          )::integer
        )
      ) as score,
      jsonb_strip_nulls(jsonb_build_object(
        'chain',   jsonb_build_object('value_pct', w.value_pct, 'points', round(w.chain_points), 'weight', 0.25),
        'market',  case when w.market_points is null then null else
                     jsonb_build_object('value_pct', w.market_value_pct, 'points', round(w.market_points), 'weight', 0.45) end,
        'history', case when w.history_points is null then null else
                     jsonb_build_object('lowest_agorot', w.lowest_agorot, 'typical_agorot', w.typical_agorot,
                                        'samples', w.samples, 'points', round(w.history_points), 'weight', 0.30) end,
        'capped',  (w.market_points is null and w.history_points is null)
      )) as basis
      from weighted w
  )
  insert into public.offer_scores (offer_key, score, band, basis, computed_at)
  select f.offer_key,
         f.score,
         case
           when f.score >= 85 then 'amazing'
           when f.score >= 70 then 'very_good'
           when f.score >= 45 then 'fair'
           else 'weak'
         end,
         f.basis,
         now()
    from final f
  on conflict (offer_key) do update set score = excluded.score,
         band = excluded.band,
         basis = excluded.basis,
         computed_at = excluded.computed_at;

  get diagnostics written = row_count;

  -- An offer that has ended, or whose reference has gone stale, must not keep a
  -- score it can no longer justify.
  delete from public.offer_scores s
   where not exists (
     select 1 from public.offers_feed f
      where f.offer_key = s.offer_key and f.value_pct is not null and not f.needs_review
   );

  return written;
end;
$$;

revoke execute on function public.refresh_offer_scores() from public, anon;
grant execute on function public.refresh_offer_scores() to authenticated, service_role;

-- ======================== 0028_branch_coverage.sql ========================

-- ---------------------------------------------------------------------------
-- 0028 — how many branches we can actually find.
--
-- "Closest to me" only works for a branch whose position we know, and migration
-- 0026 left every one of them empty on purpose (the Stores file carries an
-- address and never a coordinate). That gap is currently invisible to the people
-- running the app: the screen tells a VISITOR we do not know where the branches
-- are, but nothing tells the owner how far from fixed that is, or whether a
-- geocoding run actually helped.
--
-- So the admin overview reports it. This is also the seed of the coverage view
-- the V2 brief asks for: where there are users but no deals, and where there are
-- branches we cannot place.
--
-- Additive: one more key in an existing function's answer.
-- ---------------------------------------------------------------------------

create or replace function public.admin_overview(p_expiring_within_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since      timestamptz := now() - interval '7 days';
  -- The Israeli calendar day, as the notification pipeline has always used.
  -- current_date is UTC on Supabase and rolls over at 02:00/03:00 local.
  v_today      date := (now() at time zone 'Asia/Jerusalem')::date;
  v_live       bigint;
  v_chains     bigint;
  v_retailers  bigint;
  v_expiring   bigint;
  v_branches   bigint;
  v_located    bigint;
  v_geocodable bigint;
begin
  perform public.require_admin();

  if p_expiring_within_days < 1 or p_expiring_within_days > 60 then
    raise exception 'p_expiring_within_days must be between 1 and 60' using errcode = '22023';
  end if;

  -- One pass. These were three separate whole-feed computations in one call.
  select count(*),
         count(*) filter (where f.origin = 'catalog'),
         count(distinct f.store_slug),
         count(*) filter (
           where f.valid_to is not null
             and f.valid_to >= v_today
             and f.valid_to < v_today + make_interval(days => p_expiring_within_days)
         )
    into v_live, v_chains, v_retailers, v_expiring
    from public.offers_feed f;

  -- And one over the branches: how many there are, how many we can place, and how
  -- many of the rest a geocoder could even try (one with neither an address nor a
  -- city cannot be placed by anybody, and is a data problem, not a geocoding one).
  select count(*),
         count(*) filter (where b.latitude is not null),
         count(*) filter (where b.latitude is null and (b.address is not null or b.city is not null))
    into v_branches, v_located, v_geocodable
    from public.branches b
   where b.is_active;

  return jsonb_build_object(
    'people', jsonb_build_object(
      -- A profile is one per anonymous browser session, so these count DEVICES,
      -- not people: one person with a phone, a laptop and the installed PWA is
      -- three. There is no account identity in this schema to do better, so the
      -- screen says "מכשירים" rather than implying something it cannot know.
      'total',      (select count(*) from public.profiles),
      'onboarded',  (select count(*) from public.profiles where onboarded_at is not null),
      'this_week',  (select count(*) from public.profiles where created_at >= v_since),
      'notifiable', (select count(*) from public.profiles p
                      where p.notifications_enabled
                        and exists (select 1 from public.push_subscriptions s where s.user_id = p.id))
    ),
    'deals', jsonb_build_object(
      'live',            (select count(*) from public.deals where status = 'approved'),
      'pending',         (select count(*) from public.deals where status = 'pending'),
      'added_this_week', (select count(*) from public.deals
                           where status = 'approved' and approved_at >= v_since),
      -- By when it actually came down (0025), not by when the row was last touched.
      'taken_down_this_week', (select count(*) from public.deals
                                where status in ('inactive', 'rejected') and deactivated_at >= v_since),
      -- Sent by people. An admin typing a deal in is not a submission.
      'submitted_this_week',  (select count(*) from public.deals
                                where created_at >= v_since and not entered_by_admin)
    ),
    'reports', jsonb_build_object(
      'open', (select count(*) from public.deal_reports where status = 'open')
    ),
    'offers', jsonb_build_object(
      -- `live` already includes the approved manual deals: offers_feed is
      -- catalog UNION ALL deals_public. `from_chains` is the catalogue half.
      -- Nothing may add these two together.
      'live',        v_live,
      'from_chains', v_chains,
      'retailers',   v_retailers,
      'expiring',    v_expiring
    ),
    -- What "closest to me" has to work with (0026, 0028).
    'branches', jsonb_build_object(
      'total',      v_branches,
      'located',    v_located,
      -- Unplaced but worth trying: they have an address or a city to look up.
      'geocodable', v_geocodable,
      -- Unplaced and unplaceable from what we hold: neither an address nor a city.
      'no_address', v_branches - v_located - v_geocodable
    ),
    'notifications', jsonb_build_object(
      -- "pending" means the worker has not closed this event yet, NOT that it
      -- will be sent: it includes events that resolve to expired, below_threshold,
      -- no_recipients and the rest. The screen words it accordingly.
      'pending',   (select count(*) from public.notification_events where status = 'pending'),
      -- Real notifications only; kind='test' is an admin pushing to their own phone.
      'sent_ever', (select count(*) from public.notification_deliveries
                     where status = 'sent' and kind = 'offer')
    ),
    'expiring_within_days', p_expiring_within_days,
    'as_of', now()
  );
end;
$$;

-- ======================== 0029_deal_image_url_is_a_photo.sql ========================

-- ---------------------------------------------------------------------------
-- 0029 — a deal's attached photo must be a photo.
--
-- `deals.image_url` is submitted by anyone (every visitor gets an anonymous
-- session) and is rendered to a MODERATOR as a clickable link. It was validated
-- as `z.string().optional()` — anything at all.
--
-- The exploit is short: submit a perfectly valid deal with
-- image_url = 'javascript:fetch(...)', wait for an admin to click "view the
-- attached photo". That scheme executes in the current document regardless of
-- target="_blank", which is script execution inside a super-admin's session —
-- and grant_admin is one server-action call from there. `data:text/html` and a
-- look-alike host are the quieter versions of the same thing.
--
-- Fixed in three places, because this one is worth belt and braces:
--   1. the submission schema now pins the value to this project's own public
--      bucket (src/lib/actions/deals.ts);
--   2. the admin panel renders the link only when it parses as https
--      (src/components/admin/DealActions.tsx);
--   3. here, so that no code path — a future import, a script, a hand-written
--      PostgREST call that satisfies the RLS policy — can store one either.
--
-- NOT VALID is deliberate: it applies to every INSERT and UPDATE from now on,
-- which is the whole point, without failing the migration on historical rows
-- nobody has audited. Those rows are still rendered safely by (2). To tighten it
-- later, review what is there and run
--   alter table public.deals validate constraint deals_image_url_is_https;
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deals_image_url_is_https') then
    alter table public.deals
      add constraint deals_image_url_is_https
      check (image_url is null or image_url like 'https://%')
      not valid;
  end if;
end
$$;

comment on column public.deals.image_url is
  'A photo of the shelf label, in this project''s own public bucket. Rendered to moderators as a link, so it is https-only at the table, in the submission schema and at the render (0029).';

-- ======================== 0030_contributors.sql ========================

-- ---------------------------------------------------------------------------
-- 0030 — who found the deal.
--
-- `deals.created_by` has been recorded since 0001 and shown nowhere: it is not in
-- the admin queue's column list, so even a MODERATOR could not see who submitted
-- the deal they were judging. And there was no way to fix that by reading harder,
-- because `profiles` is owner-only by RLS (0003 deliberately gives admins no
-- profile read access) — so no screen, admin or public, could render a name.
--
-- WHY A SEPARATE TABLE AND NOT A COLUMN ON profiles.
--
-- A name on a deal card is meant to be SEEN, by anyone. A profile is the opposite:
-- it holds what a person told us and nobody else may read it. Putting a public
-- name inside it would mean carving an exception into the policy that protects
-- everything else there — and the next person reading `profiles_read_own` would
-- have to know which columns the rule no longer covers.
--
-- So the public half of a person is its own table, with its own obvious policy:
-- `contributors` is world-readable and holds exactly one thing, a name somebody
-- chose to be known by. `profiles.first_name` stays private and stays what it was.
--
-- CONSENT IS THE DEFAULT, NOT AN OPT-OUT. A person has no row here until they
-- choose a name. Their deals then say nothing about who found them — not
-- "anonymous", which is itself a label. Clearing the name removes the row.
--
-- NO EMAIL, NO AUTH ID. Nothing here exposes either, and the standings function
-- returns a truncated reference in the style admin_recent_deliveries already uses.
-- ---------------------------------------------------------------------------

create table if not exists public.contributors (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  -- What they want to be called on a deal they found. Not their first name, which
  -- is private; this one is published.
  display_name text not null check (char_length(trim(display_name)) between 2 and 24),
  -- The tallies, kept by a trigger rather than recomputed per request.
  --
  -- Two reasons, and the second is the important one. Aggregating over `deals` on
  -- every page view is the same mistake 0018 recorded the cost of. But a view or a
  -- function over `deals` would also have to be SECURITY DEFINER to see rejected
  -- rows, and granting a definer function to `anon` is exactly the shape
  -- tests/function-grants.test.ts exists to forbid. Storing the answer means the
  -- public reads an ordinary table under an ordinary policy, and nothing bypasses
  -- RLS for an unauthenticated caller.
  approved integer not null default 0,
  weekly   integer not null default 0,
  -- The score has the rejection penalty inside it. The COUNT of somebody's
  -- rejections is deliberately not stored here, because this table is public and a
  -- person's failures do not belong beside their name.
  score    integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contributors_rank_idx on public.contributors (score desc) where score > 0;

comment on table public.contributors is
  'The public half of a person: a name they chose to be credited by. No row = they have not chosen one, and their deals say nothing about who found them.';

alter table public.contributors enable row level security;

grant select on public.contributors to anon, authenticated, service_role;

-- Readable by everyone, because that is the point of it.
create policy contributors_read on public.contributors
  for select to anon, authenticated using (true);

-- No write grant at all: the function below is the only way in, as with `admins`.

create or replace function public.set_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  clean text := nullif(trim(p_name), '');
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Clearing it is a real choice, and it takes the row away rather than leaving an
  -- empty name behind.
  if clean is null then
    delete from public.contributors where profile_id = uid;
    return;
  end if;

  if char_length(clean) < 2 or char_length(clean) > 24 then
    raise exception 'a name is between two and twenty-four characters' using errcode = '22023';
  end if;

  insert into public.profiles (id) values (uid) on conflict (id) do nothing;

  insert into public.contributors (profile_id, display_name)
  values (uid, clean)
  on conflict (profile_id) do update set display_name = excluded.display_name, updated_at = now();
end;
$$;

revoke execute on function public.set_display_name(text) from public, anon;
grant execute on function public.set_display_name(text) to authenticated;

-- --------------------------------------------------------------------------
-- Was this deal ever the editor's pick?
--
-- `app_settings.weekly_deal_id` is a single pointer with no history, so once it
-- moves on there is nothing left to say that a deal was ever chosen. The standings
-- below weigh that heavily, so it has to be recorded when it happens.
-- --------------------------------------------------------------------------

alter table public.deals add column if not exists was_weekly boolean not null default false;

comment on column public.deals.was_weekly is
  'True once this deal has been the Deal of the Week. app_settings.weekly_deal_id is a pointer with no history; this is the record.';

create or replace function public.set_weekly_deal(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  -- Unchanged from 0002, message and all: callers and tests depend on it.
  if p_deal_id is not null and not exists (
    select 1 from public.deals d where d.id = p_deal_id and d.status = 'approved'
  ) then
    raise exception 'the weekly deal must be an approved deal' using errcode = '22023';
  end if;

  -- The one addition: remember that this deal was chosen. app_settings holds a
  -- pointer with no history, so once it moves on nothing would say this deal was
  -- ever the pick — and the contributor's credit for it would quietly disappear.
  if p_deal_id is not null then
    update public.deals set was_weekly = true where id = p_deal_id;
  end if;

  update public.app_settings set weekly_deal_id     = p_deal_id,
         weekly_deal_set_by = auth.uid(),
         weekly_deal_set_at = now(),
         updated_by         = auth.uid()
   where id;
end;
$$;

-- --------------------------------------------------------------------------
-- The tallies, and what they are worth.
--
-- QUALITY, NOT VOLUME. The brief is explicit that spam must not pay, so:
--
--   an approved deal          +10
--   one that became the pick  +25   (on top of the +10 it already earned)
--   a rejected submission      -5
--
-- and the total is floored at zero, so somebody who submitted badly and stopped is
-- at nothing rather than in debt. Submitting a hundred deals and having two
-- accepted scores worse than submitting two and having both accepted, which is the
-- whole point. `pending` counts nothing: a submission is worth something once
-- somebody has judged it, not when it is made. A deal an admin typed in credits
-- nobody.
-- --------------------------------------------------------------------------

create or replace function public.recount_contributor(p_profile uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.contributors c set approved   = t.approved,
         weekly     = t.weekly,
         score      = t.score,
         updated_at = now()
    from (
      select count(*) filter (where d.status = 'approved')::integer as approved,
             count(*) filter (where d.was_weekly)::integer          as weekly,
             greatest(
               0,
               count(*) filter (where d.status = 'approved')::integer * 10
               + count(*) filter (where d.was_weekly)::integer * 25
               - count(*) filter (where d.status = 'rejected')::integer * 5
             )::integer                                             as score
        from public.deals d
       where d.created_by = p_profile and not d.entered_by_admin
    ) t
   where c.profile_id = p_profile;
$$;

revoke execute on function public.recount_contributor(uuid) from public, anon, authenticated;

create or replace function public.deals_recount_contributor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Whoever is affected, on either side of the change.
  if tg_op <> 'INSERT' and old.created_by is not null then
    perform public.recount_contributor(old.created_by);
  end if;
  if tg_op <> 'DELETE' and new.created_by is not null then
    perform public.recount_contributor(new.created_by);
  end if;
  return null;
end;
$$;

drop trigger if exists deals_recount_contributor on public.deals;
create trigger deals_recount_contributor
  after insert or update or delete on public.deals
  for each row execute function public.deals_recount_contributor();

-- Naming yourself for the first time has to pick up the deals you already submitted.
create or replace function public.set_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  clean text := nullif(trim(p_name), '');
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if clean is null then
    delete from public.contributors where profile_id = uid;
    return;
  end if;

  if char_length(clean) < 2 or char_length(clean) > 24 then
    raise exception 'a name is between two and twenty-four characters' using errcode = '22023';
  end if;

  insert into public.profiles (id) values (uid) on conflict (id) do nothing;

  insert into public.contributors (profile_id, display_name)
  values (uid, clean)
  on conflict (profile_id) do update set display_name = excluded.display_name, updated_at = now();

  perform public.recount_contributor(uid);
end;
$$;

revoke execute on function public.set_display_name(text) from public, anon;
grant execute on function public.set_display_name(text) to authenticated;

-- ======================== 0031_offer_feedback.sql ========================

-- ---------------------------------------------------------------------------
-- 0031 — "המבצע עדיין קיים" / "המבצע נגמר", on any offer.
--
-- THE GAP THIS CLOSES. Until now only a user-submitted deal could be reported:
-- the button renders for `origin = 'legacy'` alone, and `deal_reports.deal_id` is
-- a foreign key to `deals` whose RLS predicate requires an approved `deals` row.
-- The chain feed is the bulk of what anybody sees, and none of it had a report
-- path at all — not in the UI, and not in the schema. A person standing in front
-- of an empty shelf had nowhere to say so.
--
-- So feedback is keyed by `offer_key` — the same 'obs:…' / 'deal:…' / 'grp:…'
-- string the feed already emits, and that offer_scores (0027) and the contributor
-- map are already keyed by. It is not a foreign key, deliberately: an offer is a
-- row of a VIEW over two different tables, and a promotion that ends stops being
-- in the view at all. Feedback about something that has since vanished is still
-- evidence about what happened, so it must not disappear with it.
--
-- BOTH DIRECTIONS. A deal can be confirmed as well as reported gone, which is what
-- makes it possible to disagree with somebody rather than only to escalate.
--
-- ONE STANDING OPINION PER PERSON PER OFFER. Saying it again replaces what you
-- said before — including changing your mind, which is the normal case when a
-- deal comes back. No "one open report" state machine: the latest thing a person
-- believes is the only thing worth counting.
--
-- NOTHING IS EXPIRED BY A TAP. See `offer_standing` below: the decision weighs
-- both directions, how recent each is, and who said it. Where it is genuinely
-- unclear it says so and an admin looks — it does not guess, and it never deletes
-- anything. A deal is taken down by a person, as it always was.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'offer_verdict') then
    create type public.offer_verdict as enum ('still_there', 'ended');
  end if;
end
$$;

create table if not exists public.offer_feedback (
  id          bigint generated always as identity primary key,
  -- 'obs:<observation_id>' | 'deal:<uuid>' | 'grp:<id>'. Not a foreign key: see above.
  offer_key   text not null check (offer_key ~ '^(obs|deal|grp):[0-9a-zA-Z-]{1,64}$'),
  verdict     public.offer_verdict not null,
  reported_by uuid not null references auth.users (id) on delete cascade,
  -- Optional, and reachable: the old flow had a 280-character column the UI could
  -- never write to, because it always sent an empty string.
  note        text check (note is null or char_length(trim(note)) between 1 and 280),
  -- What the screen was showing when they tapped. A report against a price that has
  -- since changed is about a different deal, and this is how that is told apart.
  seen_price_agorot integer check (seen_price_agorot is null or seen_price_agorot > 0),
  created_at  timestamptz not null default now(),
  unique (offer_key, reported_by)
);

comment on table public.offer_feedback is
  'What people say about an offer that is on the screen: still there, or gone. One standing opinion per person per offer; saying it again replaces it.';

create index if not exists offer_feedback_key_idx on public.offer_feedback (offer_key, created_at desc);

alter table public.offer_feedback enable row level security;

grant select on public.offer_feedback to anon, authenticated, service_role;

-- Everyone may see the tally — it is shown on the line. Nobody writes directly.
create policy offer_feedback_read on public.offer_feedback
  for select to anon, authenticated using (true);

create or replace function public.report_offer(
  p_offer_key   text,
  p_verdict     public.offer_verdict,
  p_note        text default null,
  p_seen_price  integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_offer_key !~ '^(obs|deal|grp):[0-9a-zA-Z-]{1,64}$' then
    raise exception 'that is not an offer' using errcode = '22023';
  end if;

  insert into public.offer_feedback (offer_key, verdict, reported_by, note, seen_price_agorot)
  values (p_offer_key, p_verdict, uid, nullif(trim(p_note), ''), p_seen_price)
  on conflict (offer_key, reported_by) do update set verdict = excluded.verdict,
         note = excluded.note,
         seen_price_agorot = excluded.seen_price_agorot,
         created_at = now();
end;
$$;

revoke execute on function public.report_offer(text, public.offer_verdict, text, integer) from public, anon;
grant execute on function public.report_offer(text, public.offer_verdict, text, integer) to authenticated;

-- --------------------------------------------------------------------------
-- The same standing, for every offer at once — what a SCREEN needs.
--
-- Feedback that only an admin can see is the system that was already here
-- (`deal_reports`). The point of asking people is that the answer reaches the
-- next person who is deciding whether to drive somewhere, so the line itself has
-- to be able to say "people report this one is gone". Per-offer calls cannot do
-- that: a Home render touches dozens of offers.
--
-- So: one read, keyed by offer_key, for every offer anybody has said anything
-- about in the last thirty days. Offers nobody has spoken about are simply absent
-- — the screen says nothing, which is the honest default.
--
-- The rules that decide a standing live here and nowhere else; `offer_standing`
-- (below) is the single-offer view of this one.
--
-- A tap is not a verdict. Three things decide how much one counts:
--
--   WHO SAID IT. Somebody whose finds have been accepted has earned more weight
--     than somebody with no record: 1 normally, 2 from 50 points, 3 from 100
--     (contributors, 0030). It is capped there on purpose — this is a tie-breaker
--     between neighbours in a shop, not a reputation system that lets one person
--     decide alone.
--
--   HOW RECENT. Full weight for a week, half for a fortnight, nothing after
--     thirty days. A shelf a month ago says nothing about a shelf today.
--
--   WHICH WAY. Both directions are counted, so a confirmation can answer a report
--     instead of only an admin being able to.
--
-- And the result is one of four words, never an action:
--
--   'ended'        enough people, recently, say it is gone, and nobody credible
--                  disagrees. The app LABELS it; it does not delete it.
--   'still_there'  somebody checked and it was there.
--   'unclear'      both sides have real weight. This is the case that goes to an
--                  admin, because it is exactly the case a rule should not decide.
--   'quiet'        not enough to say anything.
-- --------------------------------------------------------------------------

create or replace function public.offer_standings()
returns table (
  offer_key    text,
  ended_weight numeric,
  still_weight numeric,
  voices       integer,
  newest_at    timestamptz,
  standing     text
)
language sql
stable
set search_path = public
as $$
  with weighted as (
    select f.offer_key,
           f.verdict,
           f.created_at,
           case
             when f.created_at >= now() - interval '7 days'  then 1.0
             when f.created_at >= now() - interval '14 days' then 0.5
             else 0
           end
           * (1 + least(2, coalesce(c.score, 0) / 50))::numeric as weight
      from public.offer_feedback f
      left join public.contributors c on c.profile_id = f.reported_by
     where f.created_at >= now() - interval '30 days'
  ),
  totals as (
    select w.offer_key,
           coalesce(sum(w.weight) filter (where w.verdict = 'ended'), 0)       as ended_weight,
           coalesce(sum(w.weight) filter (where w.verdict = 'still_there'), 0) as still_weight,
           count(*)::integer                                                  as voices,
           max(w.created_at)                                                  as newest_at
      from weighted w
     group by w.offer_key
  )
  select t.offer_key,
         t.ended_weight,
         t.still_weight,
         t.voices,
         t.newest_at,
         case
           when t.ended_weight >= 2 and t.still_weight >= 2 then 'unclear'
           when t.ended_weight >= 3 and t.ended_weight >= t.still_weight * 2 then 'ended'
           when t.still_weight >= 2 and t.still_weight > t.ended_weight then 'still_there'
           else 'quiet'
         end as standing
    from totals t
   where t.offer_key is not null;
$$;

grant execute on function public.offer_standings() to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- What the feedback adds up to, for ONE offer.
--
-- The same rules as `offer_standings()`, applied to one key.
-- --------------------------------------------------------------------------

create or replace function public.offer_standing(p_offer_key text)
returns table (
  ended_weight numeric,
  still_weight numeric,
  voices       integer,
  newest_at    timestamptz,
  standing     text
)
language sql
stable
set search_path = public
as $$
  -- One place for the rules: this is the single-offer view of `offer_standings()`
  -- above. An offer nobody has spoken about still gets an answer here -- zeros and
  -- 'quiet' -- because a caller asking about one offer is asking a question and
  -- deserves a row, where a caller asking about a screenful wants only the offers
  -- that have something to say.
  select coalesce(s.ended_weight, 0),
         coalesce(s.still_weight, 0),
         coalesce(s.voices, 0),
         s.newest_at,
         coalesce(s.standing, 'quiet')
    from (select 1) one
    left join public.offer_standings() s on s.offer_key = p_offer_key;
$$;

grant execute on function public.offer_standing(text) to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- What an admin needs to look at: every offer whose feedback says something, with
-- the weight behind it, worst first.
-- --------------------------------------------------------------------------

create or replace function public.admin_offer_feedback(p_limit integer default 50)
returns table (
  offer_key    text,
  ended_weight numeric,
  still_weight numeric,
  voices       integer,
  newest_at    timestamptz,
  standing     text,
  notes        text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- A definer function that reads what people wrote has to say who may call it.
  perform public.require_admin();

  return query
  select k.offer_key,
         s.ended_weight,
         s.still_weight,
         s.voices,
         s.newest_at,
         s.standing,
         coalesce(
           array_agg(f.note order by f.created_at desc) filter (where f.note is not null),
           '{}'
         ) as notes
    -- Qualified below as `k.offer_key`: an unqualified `offer_key` would be read as
    -- this function's own OUT parameter of the same name, which plpgsql reports as
    -- ambiguous.
    from public.offer_standings() k
    cross join lateral (select k.ended_weight, k.still_weight, k.voices, k.newest_at, k.standing) s
    left join public.offer_feedback f on f.offer_key = k.offer_key and f.note is not null
   where s.standing <> 'quiet'
   group by k.offer_key, s.ended_weight, s.still_weight, s.voices, s.newest_at, s.standing
   order by (s.standing = 'unclear') desc, s.ended_weight desc, s.newest_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke execute on function public.admin_offer_feedback(integer) from public, anon;
grant execute on function public.admin_offer_feedback(integer) to authenticated;

-- ======================== 0032_admin_audit.sql ========================

-- ---------------------------------------------------------------------------
-- 0032 — the admin audit log.
--
-- THE GAP THIS CLOSES. Nothing in this database records what an administrator
-- did. Each table keeps at most the LATEST actor on a column -- `approved_by`,
-- `resolved_by`, `weekly_deal_set_by`, `updated_by` -- and every one of them is
-- overwritten by the next action and erased by some of them. `set_deal_status`
-- is the plainest case: taking a deal off the site deliberately nulls
-- `approved_by` and `approved_at`, because leaving them would misreport who
-- stands behind a deal that is no longer public. Correct, and it means that
-- after one click there is no record anywhere that the deal was ever approved,
-- by whom, or who removed it. `admin_delete_deal` destroys the row outright.
--
-- So: one append-only table that says who did what, when, to which thing, with
-- just enough of the before-and-after to answer the question a person actually
-- asks -- "who took this down, and can we put it back?"
--
-- WHAT MAKES IT AN AUDIT LOG RATHER THAN A TABLE OF NOTES:
--
--   APPEND-ONLY, ENFORCED. A trigger refuses UPDATE and DELETE. The thing being
--     audited cannot rewrite its own record, and neither can a super admin from
--     the app -- there is no path in the schema that edits a row here.
--
--   NO WRITE GRANT TO ANYBODY. Entries are written only from inside the
--     SECURITY DEFINER functions that perform the actions, in the SAME
--     transaction. An action that fails leaves no entry, because it did not
--     happen; an action that succeeds cannot leave none.
--
--   IT DOES NOT MOVE WHEN THE WORLD DOES. `actor` is a plain uuid with no
--     foreign key, beside the email as it stood at the time. A deleted or
--     renamed account must not be able to blank out who did something -- which
--     is exactly what `on delete set null` would do.
--
-- It is not a change-data-capture log and does not try to be: it records the
-- decisions a person made through the admin panel, not every write.
-- ---------------------------------------------------------------------------

create table if not exists public.admin_actions (
  id           bigint generated always as identity primary key,
  -- Deliberately not a foreign key: see above.
  actor        uuid not null,
  -- Who that was, in words, at the time. Resolved once, here, so reading the log
  -- never depends on an account still existing.
  actor_email  text,
  -- 'deal.approve', 'deal.remove', 'admin.grant', … Dotted, so a screen can group
  -- by the part before the dot without a second column to keep in step.
  action       text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  -- What it was done to. 'deal' | 'report' | 'admin' | 'settings'.
  subject_kind text not null check (subject_kind ~ '^[a-z_]+$'),
  -- The id as text, because the subjects are uuids, bigints and one singleton row.
  subject_id   text,
  -- Enough to answer "what changed, and can it be undone?" -- never the whole row.
  details      jsonb not null default '{}'::jsonb,
  at           timestamptz not null default now()
);

comment on table public.admin_actions is
  'Append-only record of what administrators did. Written only from inside the definer functions that do the work; a trigger refuses UPDATE and DELETE.';

create index if not exists admin_actions_at_idx on public.admin_actions (at desc);
create index if not exists admin_actions_subject_idx on public.admin_actions (subject_kind, subject_id, at desc);

alter table public.admin_actions enable row level security;

-- No policy and no grant, for anybody. Reading goes through admin_audit() below,
-- which checks the caller is an administrator; writing goes through the definer
-- functions. There is no direct path in or out.

create or replace function public.admin_actions_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'the admin audit log is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists admin_actions_no_update on public.admin_actions;
create trigger admin_actions_no_update
  before update or delete on public.admin_actions
  for each row execute function public.admin_actions_append_only();

-- --------------------------------------------------------------------------
-- The one way in.
--
-- Called from inside the functions that already checked the caller's role, so it
-- does NOT check again: it is not an entry point, and a second require_admin()
-- here would be a second place to get that check wrong. It is not granted to
-- anybody, so the only callers are the definer functions themselves.
-- --------------------------------------------------------------------------

create or replace function public.record_admin_action(
  p_action       text,
  p_subject_kind text,
  p_subject_id   text,
  p_details      jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    -- Every caller is behind require_admin()/require_super_admin(), so this cannot
    -- happen through the app. If it ever does, the action has no author and the
    -- entry would be a lie.
    raise exception 'an admin action must have an author' using errcode = '42501';
  end if;

  insert into public.admin_actions (actor, actor_email, action, subject_kind, subject_id, details)
  values (
    uid,
    (select u.email from auth.users u where u.id = uid),
    p_action,
    p_subject_kind,
    p_subject_id,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke execute on function public.record_admin_action(text, text, text, jsonb) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- Every administrator action, now recorded.
--
-- Each function below is its previous definition with ONE statement added. The
-- bodies are otherwise unchanged, down to the Hebrew error messages: callers and
-- tests depend on them, and a rewrite that "tidied" one of these would be a
-- behaviour change hidden inside an audit feature.
--
-- The entry is written AFTER the work, inside the same transaction: an action
-- that raises leaves no entry because it did not happen, and one that commits
-- cannot leave none.
-- --------------------------------------------------------------------------

create or replace function public.approve_deal(p_deal_id uuid)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  row      public.deals;
  incoming public.deals;
begin
  perform public.require_admin();

  select * into incoming from public.deals where id = p_deal_id;

  if incoming.id is null then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
      from public.deals d
     where d.status = 'approved'
       and d.id <> p_deal_id
       and d.beer_id = incoming.beer_id
       and d.store_id = incoming.store_id
       and d.category = incoming.category
  ) then
    raise exception
      'כבר יש מבצע מאושר על הבירה הזו, באותה חנות ובאותו מארז. צריך להסיר אותו קודם.'
      using errcode = '23505';
  end if;

  update public.deals set status      = 'approved',
         approved_by = auth.uid(),
         approved_at = now()
   where id = p_deal_id
  returning * into row;

  perform public.record_admin_action('deal.approve', 'deal', p_deal_id::text, jsonb_build_object(
    'from_status', incoming.status,
    'beer_id', row.beer_id,
    'store_id', row.store_id,
    'deal_price_agorot', row.deal_price_agorot,
    'submitted_by', incoming.created_by
  ));

  return row;
end;
$$;

create or replace function public.set_deal_status(p_deal_id uuid, p_status public.deal_status)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  row    public.deals;
  before public.deals;
begin
  perform public.require_admin();

  if p_status = 'approved' then
    -- Approval carries an audit trail, so it has its own entry point.
    return public.approve_deal(p_deal_id);
  end if;

  -- Read first, because the update below deliberately erases approved_by/at --
  -- and that is precisely what nothing used to record anywhere.
  select * into before from public.deals where id = p_deal_id;

  update public.deals set status = p_status,
         -- Leaving approved_by/at set on a deal that is no longer approved
         -- would misreport who stands behind it now.
         approved_by = null,
         approved_at = null,
         -- When it came down. updated_at cannot answer this: deals_touch bumps
         -- it on every edit (0025).
         deactivated_at = now()
   where id = p_deal_id
  returning * into row;

  if row.id is null then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;

  -- A deal that is no longer public cannot remain the Weekly Deal.
  update public.app_settings set weekly_deal_id = null
   where id and weekly_deal_id = p_deal_id;

  perform public.record_admin_action(
    case p_status when 'rejected' then 'deal.reject' else 'deal.remove' end,
    'deal', p_deal_id::text,
    jsonb_build_object(
      'from_status', before.status,
      'to_status', p_status,
      -- The two columns the update above just cleared. Without this the record of
      -- who stood behind the deal is gone for good.
      'was_approved_by', before.approved_by,
      'was_approved_at', before.approved_at,
      'beer_id', row.beer_id,
      'store_id', row.store_id
    )
  );

  return row;
end;
$$;

create or replace function public.admin_update_deal(
  p_deal_id              uuid,
  p_beer_id              uuid,
  p_store_id             uuid,
  p_category             public.deal_category,
  p_deal_price_agorot    integer,
  p_regular_price_agorot integer,
  p_notes                text
)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  row    public.deals;
  before public.deals;
begin
  perform public.require_admin();

  select * into before from public.deals where id = p_deal_id;

  update public.deals set beer_id              = p_beer_id,
         store_id             = p_store_id,
         category             = p_category,
         deal_price_agorot    = p_deal_price_agorot,
         regular_price_agorot = p_regular_price_agorot,
         notes                = p_notes
   where id = p_deal_id
  returning * into row;

  if row.id is null then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;

  -- Only what actually moved. An entry saying "edited" with no before-and-after
  -- answers nothing, and one carrying the whole row twice is unreadable.
  perform public.record_admin_action('deal.edit', 'deal', p_deal_id::text, jsonb_strip_nulls(jsonb_build_object(
    'beer_id', case when before.beer_id is distinct from row.beer_id
                    then jsonb_build_array(before.beer_id, row.beer_id) end,
    'store_id', case when before.store_id is distinct from row.store_id
                     then jsonb_build_array(before.store_id, row.store_id) end,
    'category', case when before.category is distinct from row.category
                     then jsonb_build_array(before.category, row.category) end,
    'deal_price_agorot', case when before.deal_price_agorot is distinct from row.deal_price_agorot
                              then jsonb_build_array(before.deal_price_agorot, row.deal_price_agorot) end,
    'regular_price_agorot', case when before.regular_price_agorot is distinct from row.regular_price_agorot
                                 then jsonb_build_array(before.regular_price_agorot, row.regular_price_agorot) end,
    'notes', case when before.notes is distinct from row.notes
                  then jsonb_build_array(before.notes, row.notes) end
  )));

  return row;
end;
$$;

create or replace function public.resolve_report(
  p_report_id uuid,
  p_status    public.report_status
)
returns public.deal_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.deal_reports;
begin
  perform public.require_admin();

  if p_status = 'open' then
    raise exception 'a report is resolved or dismissed, not reopened' using errcode = '22023';
  end if;

  update public.deal_reports set status = p_status, resolved_by = auth.uid(), resolved_at = now()
   where id = p_report_id
  returning * into row;

  if row.id is null then
    raise exception 'report not found' using errcode = 'P0002';
  end if;

  perform public.record_admin_action('report.close', 'report', p_report_id::text, jsonb_build_object(
    'to_status', p_status,
    -- Closing a report says nothing about the deal (0002); the log keeps the two
    -- apart in the same way, and names the deal so the pair can be read together.
    'deal_id', row.deal_id
  ));

  return row;
end;
$$;

create or replace function public.set_weekly_deal(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  previous uuid;
begin
  perform public.require_admin();

  -- Unchanged from 0002, message and all: callers and tests depend on it.
  if p_deal_id is not null and not exists (
    select 1 from public.deals d where d.id = p_deal_id and d.status = 'approved'
  ) then
    raise exception 'the weekly deal must be an approved deal' using errcode = '22023';
  end if;

  select s.weekly_deal_id into previous from public.app_settings s where s.id;

  -- Remember that this deal was chosen (0030). app_settings holds a pointer with
  -- no history, so once it moves on nothing would say this deal was ever the pick
  -- — and the contributor's credit for it would quietly disappear.
  if p_deal_id is not null then
    update public.deals set was_weekly = true where id = p_deal_id;
  end if;

  update public.app_settings set weekly_deal_id     = p_deal_id,
         weekly_deal_set_by = auth.uid(),
         weekly_deal_set_at = now(),
         updated_by         = auth.uid()
   where id;

  perform public.record_admin_action(
    case when p_deal_id is null then 'weekly.clear' else 'weekly.set' end,
    'deal', coalesce(p_deal_id::text, previous::text),
    jsonb_build_object('from_deal_id', previous, 'to_deal_id', p_deal_id)
  );
end;
$$;

create or replace function public.grant_admin(p_email text, p_level public.admin_level)
returns public.admins
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  before public.admin_level;
  row    public.admins;
begin
  perform public.require_super_admin();

  select u.id into target
    from auth.users u
   where lower(u.email) = lower(trim(p_email))
   limit 1;

  if target is null then
    raise exception 'no user has signed in with that email yet' using errcode = 'P0002';
  end if;

  select a.level into before from public.admins a where a.user_id = target;

  insert into public.admins (user_id, level, added_by)
  values (target, p_level, auth.uid())
  on conflict (user_id) do update set level = excluded.level
  returning * into row;

  -- Who was given what. The single most consequential action in this system, and
  -- until now the only trace of it was `added_by`, overwritten on the next change
  -- of level and gone entirely once the row is revoked.
  perform public.record_admin_action(
    case when before is null then 'admin.grant' else 'admin.change_level' end,
    'admin', target::text,
    jsonb_strip_nulls(jsonb_build_object('email', lower(trim(p_email)), 'from_level', before, 'to_level', p_level))
  );

  return row;
end;
$$;

create or replace function public.revoke_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  before public.admin_level;
begin
  perform public.require_super_admin();

  if p_user_id = auth.uid() then
    -- Guards against the one irreversible mistake in this system: an admin
    -- table with nobody left who can write to it.
    raise exception 'you cannot remove yourself' using errcode = '22023';
  end if;

  select a.level into before from public.admins a where a.user_id = p_user_id;

  delete from public.admins where user_id = p_user_id;

  perform public.record_admin_action('admin.revoke', 'admin', p_user_id::text,
    jsonb_strip_nulls(jsonb_build_object('from_level', before)));
end;
$$;

create or replace function public.admin_add_deal(
  p_beer_id              uuid,
  p_store_id             uuid,
  p_category             public.deal_category,
  p_deal_price_agorot    integer,
  p_regular_price_agorot integer,
  p_notes                text default null,
  p_notify               boolean default false
)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.deals;
begin
  perform public.require_admin();

  if exists (
    select 1 from public.deals d
     where d.status = 'approved'
       and d.beer_id = p_beer_id
       and d.store_id = p_store_id
       and d.category = p_category
  ) then
    raise exception
      'כבר יש מבצע מאושר על הבירה הזו, באותה חנות ובאותו מארז. צריך להסיר אותו קודם.'
      using errcode = '23505';
  end if;

  insert into public.deals (
    beer_id, store_id, category, deal_price_agorot, regular_price_agorot, notes,
    status, created_by, approved_by, approved_at, notified_at, entered_by_admin
  ) values (
    p_beer_id, p_store_id, p_category, p_deal_price_agorot, p_regular_price_agorot, p_notes,
    'approved', auth.uid(), auth.uid(), now(),
    case when p_notify then null else now() end,
    true
  )
  returning * into row;

  -- The enqueue trigger is `after update of status`, so an INSERT never fired it
  -- and this checkbox did nothing at all. Same dedupe key and expiry as
  -- enqueue_deal_notification (0012), so the two paths cannot drift apart.
  if p_notify and row.notes is distinct from 'מבצע לדוגמה' then
    insert into public.notification_events (dedupe_key, offer_key, beer_id, expires_at)
    values ('deal:' || row.id, 'deal:' || row.id, row.beer_id, now() + interval '24 hours')
    on conflict (dedupe_key) do nothing;
  end if;

  perform public.record_admin_action('deal.add', 'deal', row.id::text, jsonb_build_object(
    'beer_id', row.beer_id,
    'store_id', row.store_id,
    'category', row.category,
    'deal_price_agorot', row.deal_price_agorot,
    'regular_price_agorot', row.regular_price_agorot,
    -- An admin typing a deal in is vouching for it, and asking to ring phones is a
    -- separate decision worth its own record.
    'notify', p_notify
  ));

  return row;
end;
$$;

create or replace function public.admin_delete_deal(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  before public.deals;
begin
  perform public.require_super_admin();

  if exists (select 1 from public.deal_reports r where r.deal_id = p_deal_id and r.status = 'open') then
    raise exception 'יש דיווח פתוח על המבצע הזה. צריך לטפל בדיווח קודם.' using errcode = '22023';
  end if;

  -- The only action here that destroys a row. Everything the entry will ever be
  -- able to say has to be read before the delete, not after it.
  select * into before from public.deals where id = p_deal_id;

  update public.app_settings set weekly_deal_id = null where id and weekly_deal_id = p_deal_id;
  delete from public.deals where id = p_deal_id;

  perform public.record_admin_action('deal.delete', 'deal', p_deal_id::text, jsonb_strip_nulls(jsonb_build_object(
    'status', before.status,
    'beer_id', before.beer_id,
    'store_id', before.store_id,
    'category', before.category,
    'deal_price_agorot', before.deal_price_agorot,
    'regular_price_agorot', before.regular_price_agorot,
    'was_approved_by', before.approved_by,
    'submitted_by', before.created_by,
    'entered_by_admin', before.entered_by_admin
  )));
end;
$$;

create or replace function public.update_notification_rules(
  p_min_discount_percent integer,
  p_max_price_agorot     integer,
  p_cooldown_hours       integer,
  p_daily_cap            integer,
  p_quiet_start          integer,
  p_quiet_end            integer
)
returns public.app_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  row    public.app_settings;
  before public.app_settings;
begin
  perform public.require_super_admin();

  select * into before from public.app_settings where id;

  update public.app_settings set notify_min_discount_percent = p_min_discount_percent,
         notify_max_price_agorot     = p_max_price_agorot,
         notify_cooldown_hours       = p_cooldown_hours,
         notify_daily_cap            = p_daily_cap,
         notify_quiet_start          = p_quiet_start,
         notify_quiet_end            = p_quiet_end,
         updated_by                  = auth.uid()
   where id
  returning * into row;

  -- These six numbers decide whose phone rings, so a change to them is exactly
  -- the kind of thing somebody will want to look back at. Only what moved.
  perform public.record_admin_action('settings.notifications', 'settings', 'app_settings',
    jsonb_strip_nulls(jsonb_build_object(
      'min_discount_percent', case when before.notify_min_discount_percent is distinct from row.notify_min_discount_percent
        then jsonb_build_array(before.notify_min_discount_percent, row.notify_min_discount_percent) end,
      'max_price_agorot', case when before.notify_max_price_agorot is distinct from row.notify_max_price_agorot
        then jsonb_build_array(before.notify_max_price_agorot, row.notify_max_price_agorot) end,
      'cooldown_hours', case when before.notify_cooldown_hours is distinct from row.notify_cooldown_hours
        then jsonb_build_array(before.notify_cooldown_hours, row.notify_cooldown_hours) end,
      'daily_cap', case when before.notify_daily_cap is distinct from row.notify_daily_cap
        then jsonb_build_array(before.notify_daily_cap, row.notify_daily_cap) end,
      'quiet_start', case when before.notify_quiet_start is distinct from row.notify_quiet_start
        then jsonb_build_array(before.notify_quiet_start, row.notify_quiet_start) end,
      'quiet_end', case when before.notify_quiet_end is distinct from row.notify_quiet_end
        then jsonb_build_array(before.notify_quiet_end, row.notify_quiet_end) end
    )));

  return row;
end;
$$;

-- --------------------------------------------------------------------------
-- Reading it.
--
-- Definer, because the table has no read grant for anybody -- and guarded, like
-- every other definer entry point here.
-- --------------------------------------------------------------------------

create or replace function public.admin_audit(p_limit integer default 100, p_before_id bigint default null)
returns table (
  id           bigint,
  actor        uuid,
  actor_email  text,
  action       text,
  subject_kind text,
  subject_id   text,
  details      jsonb,
  at           timestamptz,
  is_me        boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select a.id, a.actor, a.actor_email, a.action, a.subject_kind, a.subject_id, a.details, a.at,
         a.actor = auth.uid() as is_me
    from public.admin_actions a
   where p_before_id is null or a.id < p_before_id
   order by a.id desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke execute on function public.admin_audit(integer, bigint) from public, anon;
grant execute on function public.admin_audit(integer, bigint) to authenticated;

-- ======================== 0033_rate_limits.sql ========================

-- ---------------------------------------------------------------------------
-- 0033 — rate limits on what a stranger can write (security finding M-2).
--
-- WHAT WAS OPEN. Every visitor gets an anonymous session automatically, and an
-- anonymous session can write three things:
--
--   * a deal, straight into the moderation queue. `deals_submit` (0003) checks
--     that it is theirs and pending -- it does not check HOW MANY. A loop over
--     the PostgREST endpoint can put ten thousand rows in front of the
--     moderators and make the queue useless, which is the cheapest way to take
--     this product down. No server action is involved, so nothing in the app
--     could have stopped it.
--   * feedback on an offer (0031). `unique (offer_key, reported_by)` stops
--     stuffing ONE offer, and stops nothing at all across the feed: one session
--     can file a verdict on every offer there is.
--   * a public display name (0030), which is cheap to write and shows up on
--     other people's screens.
--
-- WHERE THE LIMIT LIVES. In Postgres, for the same reason authorization does:
-- the deal path is a direct table insert under RLS, so a limit in a server
-- action would be a limit on the polite route only. A trigger and the two
-- definer functions cover every caller -- the app, a script, a hand-written
-- PostgREST request.
--
-- HOW IT COUNTS. By counting the rows themselves, in a window, rather than
-- keeping a separate ledger of attempts. A counter table would be one more
-- thing that can drift from the truth it is supposed to describe, and would
-- itself need a write path and a cleanup job. The rows are already there,
-- already timestamped, already indexed by author.
--
-- WHAT IT IS NOT. It is not a defence against a botnet: a thousand anonymous
-- sessions are a thousand quotas. It raises the cost of the one-session flood
-- from a shell loop to real work, and it bounds what any single account can do.
-- Supabase's own limit on anonymous sign-ins (~30/hour/IP) is the layer above
-- this one, and it belongs to the hosted project rather than to the schema.
--
-- The messages are Hebrew on purpose: describeDbError passes an unrecognised
-- code's message straight to the person, so these are read by the person who
-- hit the limit, not only by a log.
-- ---------------------------------------------------------------------------

/**
 * One refusal, worded once.
 *
 * SQLSTATE 54000 is program_limit_exceeded -- deliberately NOT 42501, which
 * `describeDbError` turns into "you have no permission for this". Hitting a
 * limit is not the same as not being allowed, and telling somebody who found
 * four deals tonight that they have no permission would be a lie.
 */
create or replace function public.rate_limited(p_message text)
returns void
language plpgsql
immutable
as $$
begin
  raise exception '%', p_message using errcode = '54000';
end;
$$;

-- --------------------------------------------------------------------------
-- Deals: the queue is the thing worth protecting.
--
-- Eight in an hour and twenty-five in a day, counted over everything this person
-- has ever submitted in the window -- including the rejected ones, deliberately.
-- Somebody whose submissions keep being rejected is exactly who should be slowed
-- down, and resetting their quota on rejection would reward it.
--
-- A moderator's own entry is exempt: it arrives through admin_add_deal, which is
-- behind require_admin(), and an administrator vouching for a deal is not a
-- stranger filling a queue.
-- --------------------------------------------------------------------------

create or replace function public.deals_submission_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
  today  integer;
begin
  -- Admin-entered and feed rows are not submissions.
  if new.entered_by_admin or new.created_by is null then
    return new;
  end if;

  select count(*) filter (where d.created_at >= now() - interval '1 hour'),
         count(*) filter (where d.created_at >= now() - interval '24 hours')
    into recent, today
    from public.deals d
   where d.created_by = new.created_by;

  if recent >= 8 then
    perform public.rate_limited('שלחתם הרבה מבצעים בזמן קצר. נסו שוב בעוד שעה — הם לא הולכים לאיבוד.');
  end if;
  if today >= 25 then
    perform public.rate_limited('הגעתם למספר המבצעים שאפשר לשלוח ביום. נסו שוב מחר.');
  end if;

  return new;
end;
$$;

drop trigger if exists deals_submission_rate on public.deals;
create trigger deals_submission_rate
  before insert on public.deals
  for each row execute function public.deals_submission_rate();

-- --------------------------------------------------------------------------
-- Feedback: sixty an hour.
--
-- High on purpose. Somebody walking an aisle and answering "still there" on a
-- dozen offers is the behaviour this feature was built for, and a limit that
-- punishes the most useful person in the system would be the wrong trade. Sixty
-- an hour is well past anything a person does and well short of a script.
--
-- Counted over this person's rows in the window, and changing your mind rewrites
-- `created_at` (0031), so a verdict you revise counts once again rather than
-- twice. That is the intended reading: it is a write either way.
-- --------------------------------------------------------------------------

create or replace function public.report_offer(
  p_offer_key   text,
  p_verdict     public.offer_verdict,
  p_note        text default null,
  p_seen_price  integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  recent integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_offer_key !~ '^(obs|deal|grp):[0-9a-zA-Z-]{1,64}$' then
    raise exception 'that is not an offer' using errcode = '22023';
  end if;

  select count(*) into recent
    from public.offer_feedback f
   where f.reported_by = uid
     and f.created_at >= now() - interval '1 hour';

  if recent >= 60 then
    perform public.rate_limited('רשמנו הרבה דיווחים מכם בשעה האחרונה. נסו שוב בעוד זמן מה.');
  end if;

  insert into public.offer_feedback (offer_key, verdict, reported_by, note, seen_price_agorot)
  values (p_offer_key, p_verdict, uid, nullif(trim(p_note), ''), p_seen_price)
  on conflict (offer_key, reported_by) do update set verdict = excluded.verdict,
         note = excluded.note,
         seen_price_agorot = excluded.seen_price_agorot,
         created_at = now();
end;
$$;

-- --------------------------------------------------------------------------
-- The public name: ten changes an hour.
--
-- Not about load -- the row is tiny -- but about what it is FOR. The name is
-- shown on other people's screens beside a price, and a name that changes every
-- few seconds is not a credit, it is a billboard. Ten an hour leaves plenty of
-- room to settle on a spelling.
-- --------------------------------------------------------------------------

create table if not exists public.display_name_changes (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  at         timestamptz not null default now()
);

comment on table public.display_name_changes is
  'When somebody set or cleared their public display name. The only reason it exists: contributors holds the CURRENT name and nothing counts changes (0033).';

create index if not exists display_name_changes_idx on public.display_name_changes (profile_id, at desc);

alter table public.display_name_changes enable row level security;
-- No grant and no policy: written by set_display_name (definer) and read by
-- nothing else. Unlike the two above there is no row to count, because the point
-- of the table being rewritten is that the old value is gone.

create or replace function public.set_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  clean  text := nullif(trim(p_name), '');
  recent integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select count(*) into recent
    from public.display_name_changes c
   where c.profile_id = uid
     and c.at >= now() - interval '1 hour';

  if recent >= 10 then
    perform public.rate_limited('שיניתם את השם הרבה פעמים בשעה האחרונה. נסו שוב בעוד זמן מה.');
  end if;

  -- Clearing it is a real choice, and it takes the row away rather than leaving an
  -- empty name behind.
  if clean is null then
    delete from public.contributors where profile_id = uid;
    -- Recorded before the early return: clearing the name is a change, and a loop
    -- that alternates between a name and nothing is the obvious way around a limit
    -- that only counted the setting of one.
    insert into public.display_name_changes (profile_id) values (uid);
    return;
  end if;

  if char_length(clean) < 2 or char_length(clean) > 24 then
    raise exception 'a name is between two and twenty-four characters' using errcode = '22023';
  end if;

  insert into public.profiles (id) values (uid) on conflict (id) do nothing;

  insert into public.contributors (profile_id, display_name)
  values (uid, clean)
  on conflict (profile_id) do update set display_name = excluded.display_name, updated_at = now();

  -- Naming yourself for the first time has to pick up the deals you already
  -- submitted (0030). This line went missing in the first draft of this migration,
  -- because 0030 defines set_display_name TWICE -- once before recount_contributor
  -- exists and once after -- and the earlier one was the one copied. The e2e caught
  -- it: a person named themselves and the leaderboard stayed empty.
  perform public.recount_contributor(uid);

  insert into public.display_name_changes (profile_id) values (uid);
end;
$$;

revoke execute on function public.set_display_name(text) from public, anon;
grant execute on function public.set_display_name(text) to authenticated;

revoke execute on function public.rate_limited(text) from public, anon, authenticated;

-- ======================== 0034_admin_beers.sql ========================

-- ---------------------------------------------------------------------------
-- 0034 — managing the beers, from the panel.
--
-- WHAT WAS THERE. `beers_admin_write` (0003) is `for all` with `is_admin()`, so
-- an administrator has always been able to INSERT, UPDATE and DELETE a beer by
-- hand through PostgREST. There was no screen, no audit entry, and no guard
-- against the two edits that quietly break things:
--
--   DELETING A BEER. `user_favorite_beers` and `deals` reference it, so a delete
--     either fails on a foreign key or takes somebody's favourite with it. The
--     rest of this system deactivates instead and keeps the record (deals,
--     admins, the weekly pick). Beers now do the same: the DELETE policy is
--     gone, and `is_active = false` is the way out.
--
--   CHANGING A SLUG. The slug is the URL of /beer/<slug>, the key of the beer's
--     visual identity in src/design/themes.ts, and the filename of its bottle
--     photo. Changing it in the database alone silently takes away the beer's
--     whole appearance and breaks every link anybody shared. It is refused here
--     rather than merely discouraged.
--
-- WHAT AN ADMIN CANNOT DO FROM HERE, deliberately: give a beer its look. A
-- beer's identity (its palette and its bottle) is CODE -- `BEER_IDENTITIES` in
-- src/design/themes.ts -- and a photo is a reviewed asset with provenance
-- (CLAUDE.md). A colour picker in the panel would be a second source of truth
-- for the one thing this product is built around, and a photo field would be an
-- invitation to paste a hotlink. So the screen REPORTS which beers have neither,
-- and that is a list of work for a deploy, not a form.
--
-- DEACTIVATING IS NOT REMOVING. A beer that is switched off disappears from the
-- lists people choose from and from new prices -- and anybody who already picked
-- it keeps it, including as favourite #1, with its own look. That is the rule
-- 0014 set when Somersby turned out to be a cider, and it is why getBeerBySlug
-- reads every row rather than the list offered for choosing.
-- ---------------------------------------------------------------------------

-- The delete goes. Everything else about the old policy stays, split so the
-- missing verb is visible rather than implied.
drop policy if exists beers_admin_write on public.beers;

create policy beers_admin_insert on public.beers
  for insert to authenticated with check (public.is_admin());

create policy beers_admin_update on public.beers
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- No delete policy, for anybody. A beer is deactivated, never destroyed: deals
-- and other people's favourites point at it.
revoke delete on public.beers from authenticated;

-- --------------------------------------------------------------------------
-- What the screen needs to show, and what it needs to WARN about.
--
-- The counts are the whole point. "Switch this beer off" is a different decision
-- when four hundred people have it as their number one than when nobody has
-- chosen it, and the panel has never been able to tell the difference.
-- --------------------------------------------------------------------------

create or replace function public.admin_beers()
returns table (
  id            uuid,
  slug          text,
  name_he       text,
  name_en       text,
  category      text,
  sort_order    integer,
  is_active     boolean,
  brand_name_he text,
  variant       text,
  -- How many people chose it at all, and how many put it first. Favourite #1 is
  -- the app (PRODUCT.md), so those are not the same number.
  chosen_by     integer,
  first_for     integer,
  -- What would stop being reachable through it.
  live_offers   integer,
  packs         integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select b.id, b.slug, b.name_he, b.name_en, b.category, b.sort_order, b.is_active,
         br.name_he as brand_name_he,
         b.variant,
         (select count(*)::integer from public.user_favorite_beers f where f.beer_id = b.id),
         (select count(*)::integer from public.user_favorite_beers f where f.beer_id = b.id and f.rank = 1),
         (select count(*)::integer from public.offers_feed o where o.beer_id = b.id),
         (select count(*)::integer from public.skus k where k.beer_id = b.id and k.is_active)
    from public.beers b
    join public.brands br on br.id = b.brand_id
   order by b.is_active desc, b.sort_order, b.name_he;
end;
$$;

revoke execute on function public.admin_beers() from public, anon;
grant execute on function public.admin_beers() to authenticated;

-- --------------------------------------------------------------------------
-- Switching one off, and on again.
-- --------------------------------------------------------------------------

create or replace function public.admin_set_beer_active(p_beer_id uuid, p_active boolean)
returns public.beers
language plpgsql
security definer
set search_path = public
as $$
declare
  row    public.beers;
  before boolean;
  first_for integer;
begin
  perform public.require_admin();

  select b.is_active into before from public.beers b where b.id = p_beer_id;
  if before is null then
    raise exception 'beer not found' using errcode = 'P0002';
  end if;

  select count(*)::integer into first_for
    from public.user_favorite_beers f
   where f.beer_id = p_beer_id and f.rank = 1;

  update public.beers set is_active = p_active where id = p_beer_id returning * into row;

  -- How many people this was the app FOR, recorded at the moment it was switched
  -- off. The number changes afterwards, and the question "how many did this
  -- affect?" can only be answered from here.
  perform public.record_admin_action(
    case when p_active then 'beer.activate' else 'beer.deactivate' end,
    'beer', p_beer_id::text,
    jsonb_build_object('slug', row.slug, 'name_he', row.name_he, 'first_for', first_for)
  );

  return row;
end;
$$;

revoke execute on function public.admin_set_beer_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_beer_active(uuid, boolean) to authenticated;

-- --------------------------------------------------------------------------
-- Editing the things that are safe to edit.
--
-- The slug is not among them: see the header. Nor is the identity, which is code.
-- --------------------------------------------------------------------------

create or replace function public.admin_update_beer(
  p_beer_id    uuid,
  p_name_he    text,
  p_name_en    text,
  p_category   text,
  p_sort_order integer
)
returns public.beers
language plpgsql
security definer
set search_path = public
as $$
declare
  row    public.beers;
  before public.beers;
begin
  perform public.require_admin();

  select * into before from public.beers where id = p_beer_id;
  if before.id is null then
    raise exception 'beer not found' using errcode = 'P0002';
  end if;

  if nullif(trim(p_name_he), '') is null or nullif(trim(p_name_en), '') is null then
    raise exception 'שם הבירה בעברית ובאנגלית לא יכול להיות ריק.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.product_categories c where c.slug = p_category) then
    raise exception 'קטגוריה לא מוכרת.' using errcode = '22023';
  end if;

  update public.beers set name_he    = trim(p_name_he),
         name_en    = trim(p_name_en),
         category   = p_category,
         sort_order = p_sort_order
   where id = p_beer_id
  returning * into row;

  perform public.record_admin_action('beer.edit', 'beer', p_beer_id::text, jsonb_strip_nulls(jsonb_build_object(
    'slug', row.slug,
    'name_he', case when before.name_he is distinct from row.name_he
                    then jsonb_build_array(before.name_he, row.name_he) end,
    'name_en', case when before.name_en is distinct from row.name_en
                    then jsonb_build_array(before.name_en, row.name_en) end,
    'category', case when before.category is distinct from row.category
                     then jsonb_build_array(before.category, row.category) end,
    'sort_order', case when before.sort_order is distinct from row.sort_order
                       then jsonb_build_array(before.sort_order, row.sort_order) end
  )));

  return row;
end;
$$;

revoke execute on function public.admin_update_beer(uuid, text, text, text, integer) from public, anon;
grant execute on function public.admin_update_beer(uuid, text, text, text, integer) to authenticated;

-- A slug change is refused by the database, not only by the form: a script, a
-- hand-written PostgREST call and a future migration all go through here.
create or replace function public.beers_slug_is_forever()
returns trigger
language plpgsql
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception
      'אי אפשר לשנות מזהה (slug) של בירה — הוא הכתובת של הדף, המפתח של העיצוב שלה ושם קובץ התמונה.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists beers_slug_is_forever on public.beers;
create trigger beers_slug_is_forever
  before update of slug on public.beers
  for each row execute function public.beers_slug_is_forever();

-- --------------------------------------------------------------------------
-- Adding one.
--
-- A new beer arrives with no identity and no bottle photo, and that is a complete,
-- working state: it gets the house look and an unlabelled bottle, which is already
-- what the app does for a beer it does not know (tests/e2e/favourite-one.spec.ts).
-- Giving it its own look is a change to src/design/themes.ts and a reviewed photo --
-- a deploy, not a form field.
-- --------------------------------------------------------------------------

create or replace function public.admin_add_beer(
  p_slug       text,
  p_name_he    text,
  p_name_en    text,
  p_brand_slug text,
  p_category   text default 'beer',
  p_variant    text default null
)
returns public.beers
language plpgsql
security definer
set search_path = public
as $$
declare
  brand uuid;
  row   public.beers;
begin
  perform public.require_admin();

  if p_slug !~ '^[a-z0-9-]+$' then
    raise exception 'מזהה הבירה (slug) יכול להכיל אותיות אנגליות קטנות, ספרות ומקפים בלבד.' using errcode = '22023';
  end if;
  if nullif(trim(p_name_he), '') is null or nullif(trim(p_name_en), '') is null then
    raise exception 'שם הבירה בעברית ובאנגלית לא יכול להיות ריק.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.product_categories c where c.slug = p_category) then
    raise exception 'קטגוריה לא מוכרת.' using errcode = '22023';
  end if;

  select id into brand from public.brands where slug = p_brand_slug;
  if brand is null then
    raise exception 'מותג לא מוכר. צריך להוסיף אותו קודם.' using errcode = 'P0002';
  end if;

  -- A brand has at most one beer per variant, and one "plain" beer (0007). Adding a
  -- second plain beer to a brand is almost always somebody meaning a variant --
  -- "Tuborg Red" is a variant of Tuborg, not a brand -- so the refusal says that
  -- rather than quoting an index name at them.
  if exists (
    select 1 from public.beers b
     where b.brand_id = brand
       and coalesce(b.variant, '') = coalesce(nullif(trim(p_variant), ''), '')
  ) then
    raise exception
      'למותג הזה כבר יש בירה כזאת. אם זו גרסה אחרת (למשל ״אדום״ או ״ללא אלכוהול״), הוסיפו שם לגרסה.'
      using errcode = '23505';
  end if;

  insert into public.beers (slug, name_he, name_en, brand_id, variant, category, sort_order)
  values (p_slug, trim(p_name_he), trim(p_name_en), brand, nullif(trim(p_variant), ''), p_category,
          -- At the end of the list. Where it actually belongs is a judgement, made
          -- by editing it afterwards, and defaulting to "last" never reorders
          -- somebody else's beers behind their back.
          coalesce((select max(b.sort_order) + 10 from public.beers b), 100))
  returning * into row;

  perform public.record_admin_action('beer.add', 'beer', row.id::text, jsonb_strip_nulls(jsonb_build_object(
    'slug', row.slug, 'name_he', row.name_he, 'name_en', row.name_en,
    'category', row.category, 'variant', row.variant
  )));

  return row;
end;
$$;

revoke execute on function public.admin_add_beer(text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_add_beer(text, text, text, text, text, text) to authenticated;

-- The brands an admin can attach a beer to.
create or replace function public.admin_brands()
returns table (slug text, name_he text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return query select b.slug, b.name_he from public.brands b order by b.name_he;
end;
$$;

revoke execute on function public.admin_brands() from public, anon;
grant execute on function public.admin_brands() to authenticated;

-- The categories a beer can be in, by name.
--
-- Read through a function rather than from the table: `product_categories` has a
-- read POLICY for anon and authenticated (0014) and no table GRANT, so that policy
-- has never actually let anybody read it. Widening the grant to serve one admin
-- form would be the wrong way round -- the panel needs the names, not the public.
create or replace function public.admin_product_categories()
returns table (slug text, name_he text, in_scope boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return query
  select c.slug, c.name_he, c.in_scope from public.product_categories c order by c.sort_order, c.slug;
end;
$$;

revoke execute on function public.admin_product_categories() from public, anon;
grant execute on function public.admin_product_categories() to authenticated;

-- ======================== 0035_submitter_moderation.sql ========================

-- ---------------------------------------------------------------------------
-- 0035 — moderating the people who submit, without a directory of people.
--
-- THE CONSTRAINT THIS IS BUILT INSIDE. "Admins are deliberately NOT given read
-- access to every profile. Moderating deals does not require knowing who else
-- uses the app" (0003). That is still true, and a "users" screen that listed
-- names, emails, cities and favourite beers would be a straight reversal of it
-- for no moderation benefit.
--
-- So this is not a people directory. It is the one tool the panel was actually
-- missing: when somebody keeps submitting rubbish, a moderator can stop THAT
-- ACCOUNT from submitting, and nothing else. What the screen shows about a person
-- is only what they chose to publish (their display name, if any) and what they
-- did TO US: how many of their submissions were approved, rejected or are still
-- waiting, and when they last sent one. No email, no first name, no favourites,
-- no location.
--
-- WHY THIS AND NOT A HARDER LIMIT. 0033 bounds what any single session can write
-- -- eight deals an hour. That stops a flood and does nothing about a person who
-- sends four bad deals a day for a fortnight. A limit is arithmetic; this is a
-- judgement, so it is made by a person, recorded with a reason, and reversible.
--
-- WHAT IT IS NOT: a ban. A blocked person keeps their account, their favourites,
-- their notifications and everything they have already had approved, including
-- the credit for it on the leaderboard. They cannot put new deals in the queue.
-- Taking somebody's beers away because they filed bad prices would be a
-- punishment out of all proportion to the thing being prevented.
-- ---------------------------------------------------------------------------

create table if not exists public.submission_blocks (
  -- One row per blocked account, or none. Current state, not a history: the
  -- history of blocking and unblocking is in admin_actions (0032), which cannot
  -- be edited, where this row can be lifted.
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- Why, in the moderator's own words. Required: a block nobody can explain is a
  -- block nobody can review.
  reason     text not null check (char_length(trim(reason)) between 3 and 280),
  blocked_by uuid references auth.users (id) on delete set null,
  blocked_at timestamptz not null default now()
);

comment on table public.submission_blocks is
  'Accounts that may not put new deals in the moderation queue. Not a ban: everything else about the account is untouched.';

alter table public.submission_blocks enable row level security;

-- No grant and no policy for anybody: written by the two functions below and read
-- by admin_submitters() and the trigger, all of them SECURITY DEFINER.

-- --------------------------------------------------------------------------
-- The block, where it has to be: on the insert.
--
-- Same reasoning as 0033. `deals_submit` is a direct table insert under RLS, so a
-- check in a server action would be a check on the polite route only.
-- --------------------------------------------------------------------------

create or replace function public.deals_submission_allowed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.entered_by_admin or new.created_by is null then
    return new;
  end if;

  if exists (select 1 from public.submission_blocks b where b.user_id = new.created_by) then
    -- Deliberately does not quote the moderator's reason back at them: it is written
    -- for another moderator to review, not as a message to the person.
    --
    -- P0001 (the plain raise_exception code), NOT 42501. This is an authorization
    -- refusal in the dictionary sense, but describeDbError turns 42501 into the
    -- fixed sentence "you have no permission for this" -- which is what you want
    -- for a request that should never have been made, and is exactly wrong here:
    -- the person made an ordinary request and deserves the sentence written for
    -- them. Same reasoning as the rate limits in 0033.
    raise exception
      'החשבון הזה לא יכול לשלוח מבצעים חדשים כרגע. אם זו טעות, כתבו לנו.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists deals_submission_allowed on public.deals;
create trigger deals_submission_allowed
  before insert on public.deals
  for each row execute function public.deals_submission_allowed();

-- --------------------------------------------------------------------------
-- Who has been submitting, and how it has gone.
--
-- Everything here is either what the person chose to publish or what they sent
-- us. `display_name` comes from contributors (0030) and is null for somebody who
-- never chose one -- the row then says nothing about who they are, which is the
-- whole point and is why the identifier is only there to act on.
-- --------------------------------------------------------------------------

create or replace function public.admin_submitters(p_limit integer default 50)
returns table (
  user_id      uuid,
  display_name text,
  approved     integer,
  rejected     integer,
  pending      integer,
  last_at      timestamptz,
  is_blocked   boolean,
  block_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select d.created_by,
         c.display_name,
         count(*) filter (where d.status = 'approved')::integer,
         count(*) filter (where d.status = 'rejected')::integer,
         count(*) filter (where d.status = 'pending')::integer,
         max(d.created_at),
         (b.user_id is not null),
         b.reason
    from public.deals d
    left join public.contributors c on c.profile_id = d.created_by
    left join public.submission_blocks b on b.user_id = d.created_by
   where d.created_by is not null
     and not d.entered_by_admin
   group by d.created_by, c.display_name, b.user_id, b.reason
   -- The ones worth looking at first: blocked, then whoever has the most rejected.
   order by (b.user_id is not null) desc,
            count(*) filter (where d.status = 'rejected') desc,
            max(d.created_at) desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke execute on function public.admin_submitters(integer) from public, anon;
grant execute on function public.admin_submitters(integer) to authenticated;

-- --------------------------------------------------------------------------
-- Blocking, and lifting it.
-- --------------------------------------------------------------------------

create or replace function public.admin_block_submitter(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := nullif(trim(p_reason), '');
  stats record;
begin
  perform public.require_admin();

  if clean is null or char_length(clean) < 3 then
    raise exception 'צריך לכתוב למה. בלי סיבה אי אפשר לבדוק את ההחלטה אחר כך.' using errcode = '22023';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'אי אפשר לחסום את עצמכם.' using errcode = '22023';
  end if;

  -- An administrator's own submissions go up approved and attributed to them; a
  -- block on one would do nothing except confuse the next moderator.
  if exists (select 1 from public.admins a where a.user_id = p_user_id) then
    raise exception 'אי אפשר לחסום מנהל. קודם מסירים את ההרשאה.' using errcode = '22023';
  end if;

  select count(*) filter (where status = 'approved') as approved,
         count(*) filter (where status = 'rejected') as rejected
    into stats
    from public.deals where created_by = p_user_id;

  insert into public.submission_blocks (user_id, reason, blocked_by)
  values (p_user_id, clean, auth.uid())
  on conflict (user_id) do update set reason = excluded.reason, blocked_by = excluded.blocked_by, blocked_at = now();

  -- The reason AND the record that justified it, together. A block reviewed six
  -- months later needs both, and the counts will have moved by then.
  perform public.record_admin_action('submitter.block', 'submitter', p_user_id::text,
    jsonb_build_object('reason', clean, 'approved', stats.approved, 'rejected', stats.rejected));
end;
$$;

revoke execute on function public.admin_block_submitter(uuid, text) from public, anon;
grant execute on function public.admin_block_submitter(uuid, text) to authenticated;

create or replace function public.admin_unblock_submitter(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  before text;
begin
  perform public.require_admin();

  select b.reason into before from public.submission_blocks b where b.user_id = p_user_id;
  if before is null then
    raise exception 'החשבון הזה לא חסום.' using errcode = 'P0002';
  end if;

  delete from public.submission_blocks where user_id = p_user_id;

  perform public.record_admin_action('submitter.unblock', 'submitter', p_user_id::text,
    jsonb_build_object('was_reason', before));
end;
$$;

revoke execute on function public.admin_unblock_submitter(uuid) from public, anon;
grant execute on function public.admin_unblock_submitter(uuid) to authenticated;

-- ======================== 0036_admin_coverage.sql ========================

-- ---------------------------------------------------------------------------
-- 0036 — what the database knows about each retailer's coverage.
--
-- WHY A SCREEN AT ALL. docs/RETAILER-COVERAGE.md is generated by
-- scripts/ingest/coverage.mjs on the machine that ran a scan. It is the fuller
-- picture -- it knows why Super Yuda is BLOCKED, because that lives in the
-- publisher metadata, not in any table -- and it is a snapshot of one run on
-- somebody's laptop. Nothing in the app could say what the database holds NOW.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. It does not reproduce coverage.mjs's
-- status model. That model reads the scan plan (`blocked`, `sourcePartial`, a
-- publisher's note) which no table contains, so a SQL copy of it would be
-- guessing at the half it cannot see -- and the first time a publisher's
-- situation changed, the panel and the document would disagree while both
-- looked authoritative. The screen reports the evidence in `branch_scans` and
-- says, in words, where the rest lives.
--
-- So the vocabulary here is about OUR RECORD, not about the retailer: "every
-- branch was checked in the last scan" is a fact about branch_scans. Whether
-- the retailer's own files were complete is coverage.mjs's question.
--
-- It also carries the one number the geo work had no surface for at all: how
-- many of a chain's branches we can actually place on a map (0026). That was
-- invisible everywhere, which is how "we have no locations" stayed true for a
-- fortnight without anybody seeing it.
-- ---------------------------------------------------------------------------

create or replace function public.admin_coverage()
returns table (
  store_id        uuid,
  store_slug      text,
  store_name      text,
  -- Branches we hold for this chain, and how many of them we could put on a map.
  branches        integer,
  located         integer,
  -- The latest scan that touched this chain, and what it found.
  last_scan_id    text,
  last_scan_at    timestamptz,
  checked         integer,
  promo_checked   integer,
  no_promo_file   integer,
  not_published   integer,
  stale           integer,
  failed          integer,
  -- What we currently publish from them, which is the point of the whole pipeline.
  live_offers     integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  with latest as (
    -- The most recent SCAN ID per chain, not the most recent scan overall: a scan
    -- is incremental and need not have touched every retailer, and showing one
    -- chain's numbers from a run that skipped it would be the worst kind of wrong
    -- -- confidently stale.
    --
    -- By scan_id, and not by matching `scanned_at`. Every branch of a scan carries
    -- its own timestamp (a real run takes a minute and a half), so an equality on
    -- the maximum would count exactly one branch per chain. The first draft did
    -- that and a test caught it.
    select distinct on (s.store_id) s.store_id, s.scan_id
      from public.branch_scans s
     order by s.store_id, s.scanned_at desc
  ),
  scan as (
    select bs.store_id,
           l.scan_id,
           max(bs.scanned_at) as scanned_at,
           count(*) filter (where bs.status in ('ok', 'unchanged'))::integer as checked,
           count(*) filter (where bs.promo_file is not null)::integer        as promo_checked,
           count(*) filter (where bs.status = 'no_promo_file')::integer      as no_promo_file,
           count(*) filter (where bs.status = 'not_published')::integer      as not_published,
           count(*) filter (where bs.status = 'stale')::integer              as stale,
           count(*) filter (where bs.status = 'failed')::integer             as failed
      from public.branch_scans bs
      join latest l on l.store_id = bs.store_id and bs.scan_id = l.scan_id
     group by bs.store_id, l.scan_id
  )
  select st.id, st.slug, st.name_he,
         (select count(*)::integer from public.branches b where b.store_id = st.id and b.is_active),
         (select count(*)::integer from public.branches b
           where b.store_id = st.id and b.is_active and b.latitude is not null),
         sc.scan_id, sc.scanned_at,
         coalesce(sc.checked, 0), coalesce(sc.promo_checked, 0), coalesce(sc.no_promo_file, 0),
         coalesce(sc.not_published, 0), coalesce(sc.stale, 0), coalesce(sc.failed, 0),
         (select count(*)::integer from public.offers_feed o where o.store_id = st.id)
    from public.stores st
    left join scan sc on sc.store_id = st.id
   where st.is_active
   -- The chains with the least evidence first: that is the work.
   order by (sc.scanned_at is null) desc, sc.failed desc nulls last, st.name_he;
end;
$$;

revoke execute on function public.admin_coverage() from public, anon;
grant execute on function public.admin_coverage() to authenticated;

-- ======================== 0037_watchlist.sql ========================

-- ---------------------------------------------------------------------------
-- 0037 — the watchlist: "tell me when this one is under ₪25".
--
-- WHAT THE APP COULD DO BEFORE. Exactly one beer could reach a phone: favourite
-- #1, and only on a deal that passed the administrator's global thresholds (25 %
-- off, under ₪30). Favourites #2–#4 shape the app and never the phone, on purpose
-- (PRODUCT.md). So somebody who wanted to be told about a SIXTH beer, or about
-- their own price rather than an admin's percentage, had nowhere to say it.
--
-- WHAT THIS ADDS, AND WHAT IT DOES NOT REPLACE. The pipeline (0012) is untouched
-- in shape: the same outbox, the same worker, the same per-person protections.
-- This adds a second reason a person may be told, beside "it is your number one",
-- and lets that person name their own ceiling.
--
-- THE PROTECTIONS STAY, ALL OF THEM. Cooldown per beer, the daily cap and quiet
-- hours are not thresholds for an offer -- they are protections for a person --
-- and a watch is not permission to ignore them. Somebody who watches eight beers
-- gets the same two notifications a day as everybody else. That is the point: a
-- watchlist is a statement about what matters, not a subscription to noise.
--
-- WHAT A WATCH DOES RELAX, deliberately: the verified-SAVING requirement. "Never
-- announce an unverified saving" exists because the message claims a percentage,
-- and for a watch hit the message does not -- it states the price, which is the
-- fact the person asked to be told. A trusted saving and a trusted price are
-- different things, and conflating them would make the feature impossible for
-- every chain whose reference price we cannot vouch for.
--
-- TEN AT A TIME. A watchlist of two hundred beers is a notification firehose
-- wearing a feature's clothes, and the daily cap would then decide which of them
-- a person hears about -- arbitrarily. Ten is more than anybody's shopping list
-- and small enough that each entry is a choice.
-- ---------------------------------------------------------------------------

create table if not exists public.watchlist (
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  beer_id           uuid not null references public.beers (id) on delete cascade,
  -- Null = "treat it like my number one": the administrator's thresholds decide.
  -- A number = "tell me at this price or below", whatever the percentage says.
  max_price_agorot  integer check (max_price_agorot is null or max_price_agorot between 100 and 100000),
  created_at        timestamptz not null default now(),
  primary key (profile_id, beer_id)
);

comment on table public.watchlist is
  'Beers a person wants to hear about beyond favourite #1, each with an optional price ceiling of their own (0037).';

create index if not exists watchlist_beer_idx on public.watchlist (beer_id);

alter table public.watchlist enable row level security;

grant select, insert, update, delete on public.watchlist to authenticated;
-- The notification worker reads it (src/lib/push/worker.ts) with the service role,
-- which is the one caller that is not a person. Read only: a watch is set by the
-- person whose watch it is, never on their behalf.
grant select on public.watchlist to service_role;

-- Yours, and nobody else's -- the same shape as user_favorite_beers (0003).
create policy watchlist_read_own on public.watchlist
  for select to authenticated using (profile_id = auth.uid());

create policy watchlist_write_own on public.watchlist
  for insert to authenticated with check (profile_id = auth.uid());

create policy watchlist_update_own on public.watchlist
  for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy watchlist_delete_own on public.watchlist
  for delete to authenticated using (profile_id = auth.uid());

-- The cap, in the database rather than in the form: the form is a courtesy.
create or replace function public.watchlist_at_most_ten()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Counting the OTHER beers, not all of them. A BEFORE INSERT trigger fires before
  -- Postgres has detected the conflict, so `insert … on conflict do update` reaches
  -- here even when it is about to update — and somebody at the limit would not have
  -- been able to change a price they had already set. A test caught it.
  if (select count(*) from public.watchlist w
       where w.profile_id = new.profile_id and w.beer_id <> new.beer_id) >= 10 then
    raise exception 'אפשר לעקוב אחרי עשר בירות. הסירו אחת כדי להוסיף חדשה.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists watchlist_at_most_ten on public.watchlist;
create trigger watchlist_at_most_ten
  before insert on public.watchlist
  for each row execute function public.watchlist_at_most_ten();

-- --------------------------------------------------------------------------
-- Setting one, and taking it off.
--
-- A function rather than a bare insert so that "watch it" and "watch it at this
-- price" are one call that cannot half-succeed, and so the price is validated in
-- one place. The policies above still stand behind it.
-- --------------------------------------------------------------------------

create or replace function public.watch_beer(p_beer_id uuid, p_max_price_agorot integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_max_price_agorot is not null and p_max_price_agorot not between 100 and 100000 then
    raise exception 'המחיר צריך להיות בין ₪1 ל-₪1000.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.beers b where b.id = p_beer_id) then
    raise exception 'beer not found' using errcode = 'P0002';
  end if;

  -- A person whose profile row has not been created yet (they arrive before
  -- onboarding finishes) can still watch a beer. Same guard as set_display_name.
  insert into public.profiles (id) values (uid) on conflict (id) do nothing;

  insert into public.watchlist (profile_id, beer_id, max_price_agorot)
  values (uid, p_beer_id, p_max_price_agorot)
  on conflict (profile_id, beer_id) do update set max_price_agorot = excluded.max_price_agorot;
end;
$$;

revoke execute on function public.watch_beer(uuid, integer) from public, anon;
grant execute on function public.watch_beer(uuid, integer) to authenticated;

create or replace function public.unwatch_beer(p_beer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.watchlist where profile_id = uid and beer_id = p_beer_id;
end;
$$;

revoke execute on function public.unwatch_beer(uuid) from public, anon;
grant execute on function public.unwatch_beer(uuid) to authenticated;

-- ======================== 0038_trust.sql ========================

-- ---------------------------------------------------------------------------
-- 0038 — trust: one ladder, and what it is explicitly NOT for.
--
-- WHAT TRUST IS HERE. Context for a person's judgement, and weight in a tally.
-- That is the whole list.
--
-- WHAT IT IS NOT, AND WILL NOT BECOME. It is not a permission. A trusted
-- contributor cannot approve their own deal, cannot publish without moderation,
-- cannot read anything a stranger cannot, and cannot do one thing an
-- administrator can. Authorization lives in Postgres and is decided by
-- `require_admin()` and the RLS policies -- never by a score. The tests in
-- tests/trust.test.ts exist to make that difficult to change by accident: they
-- give somebody the highest standing in the system and then prove every door is
-- still shut.
--
-- The temptation this closes off deliberately: auto-approving a trusted person's
-- submission. It is the obvious "reward", it would save a moderator real time,
-- and it is exactly the thing the brief rules out -- a reputation number that
-- publishes prices is a reputation number that can be farmed into publishing a
-- wrong one. `deals_submit` (0003) pins every submission to `status = 'pending'`
-- at the storage layer, and nothing here touches that.
--
-- WHY A FUNCTION AND NOT AN EXPRESSION. The ladder was already in the schema,
-- written inline inside offer_standings (0031) as `least(2, score / 50)`. One
-- ladder in two places is two ladders waiting to disagree, and the second place
-- is always the one somebody forgets. Both now call these.
--
--   0–49    new       one voice, and no record yet to read
--   50–99   known     two voices: a few finds accepted
--   100+    trusted   three voices, and the cap
--
-- Capped at three ON PURPOSE. This is a tie-breaker between neighbours standing
-- in the same shop, not a system where one person's say-so settles a question
-- alone. Whatever the score reaches, three strangers still outweigh one expert.
-- ---------------------------------------------------------------------------

create or replace function public.contributor_weight(p_score integer)
returns integer
language sql
immutable
as $$
  select 1 + least(2, coalesce(p_score, 0) / 50);
$$;

comment on function public.contributor_weight(integer) is
  'How much one person''s report counts: 1, 2 from 50 points, 3 from 100. Capped at 3 deliberately (0038).';

create or replace function public.contributor_trust(p_score integer)
returns text
language sql
immutable
as $$
  select case
           when coalesce(p_score, 0) >= 100 then 'trusted'
           when coalesce(p_score, 0) >= 50  then 'known'
           else 'new'
         end;
$$;

comment on function public.contributor_trust(integer) is
  'The ladder in one word, for a moderator to read: new | known | trusted (0038). Context, never a permission.';

grant execute on function public.contributor_weight(integer) to anon, authenticated, service_role;
grant execute on function public.contributor_trust(integer) to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- The tally, now reading the shared ladder.
--
-- Byte-identical to 0031 apart from the weight expression, which is the whole
-- point: there is one ladder, and this is the first place that used it.
-- --------------------------------------------------------------------------

create or replace function public.offer_standings()
returns table (
  offer_key    text,
  ended_weight numeric,
  still_weight numeric,
  voices       integer,
  newest_at    timestamptz,
  standing     text
)
language sql
stable
set search_path = public
as $$
  with weighted as (
    select f.offer_key,
           f.verdict,
           f.created_at,
           case
             when f.created_at >= now() - interval '7 days'  then 1.0
             when f.created_at >= now() - interval '14 days' then 0.5
             else 0
           end
           * public.contributor_weight(c.score)::numeric as weight
      from public.offer_feedback f
      left join public.contributors c on c.profile_id = f.reported_by
     where f.created_at >= now() - interval '30 days'
  ),
  totals as (
    select w.offer_key,
           coalesce(sum(w.weight) filter (where w.verdict = 'ended'), 0)       as ended_weight,
           coalesce(sum(w.weight) filter (where w.verdict = 'still_there'), 0) as still_weight,
           count(*)::integer                                                  as voices,
           max(w.created_at)                                                  as newest_at
      from weighted w
     group by w.offer_key
  )
  select t.offer_key,
         t.ended_weight,
         t.still_weight,
         t.voices,
         t.newest_at,
         case
           when t.ended_weight >= 2 and t.still_weight >= 2 then 'unclear'
           when t.ended_weight >= 3 and t.ended_weight >= t.still_weight * 2 then 'ended'
           when t.still_weight >= 2 and t.still_weight > t.ended_weight then 'still_there'
           else 'quiet'
         end as standing
    from totals t
   where t.offer_key is not null;
$$;

grant execute on function public.offer_standings() to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- What a moderator sees about the person whose deal they are judging.
--
-- Context, in one word, beside the counts they already have. NOT an order: the
-- pending queue stays oldest-first, because a queue that serves trusted people
-- first makes a newcomer's FIRST submission wait behind everybody else's -- and
-- that first wait is what decides whether they ever send a second one. Trust
-- informs the judgement; it does not buy a place in the line.
-- --------------------------------------------------------------------------

create or replace function public.admin_submitter_trust(p_user_ids uuid[])
returns table (user_id uuid, display_name text, score integer, trust text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select c.profile_id, c.display_name, c.score, public.contributor_trust(c.score)
    from public.contributors c
   where c.profile_id = any(p_user_ids);
end;
$$;

revoke execute on function public.admin_submitter_trust(uuid[]) from public, anon;
grant execute on function public.admin_submitter_trust(uuid[]) to authenticated;

-- --------------------------------------------------------------------------
-- And what the person themselves can see about their own standing.
--
-- A ladder nobody can see is not an incentive, it is a secret. This says where
-- they are and what it does -- which is deliberately a short list, because
-- over-promising a reward that is only "your reports count double" would be
-- worse than saying nothing.
-- --------------------------------------------------------------------------

create or replace function public.my_standing()
returns table (display_name text, score integer, approved integer, weekly integer, trust text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  return query
  select c.display_name, c.score, c.approved, c.weekly, public.contributor_trust(c.score)
    from public.contributors c
   where c.profile_id = uid;
end;
$$;

revoke execute on function public.my_standing() from public, anon;
grant execute on function public.my_standing() to authenticated;

-- ======================== 0039_branches_near.sql ========================

-- ---------------------------------------------------------------------------
-- 0039 — the branches of a promotion, nearest first.
--
-- WHY THIS AND NOT A MAP. Phase H asked for a map. A map of this data today
-- would be an empty map: `branches.latitude` is deliberately null everywhere
-- (0026 shipped the columns with no provider configured, because inventing a
-- position is worse than admitting we have none), so there is nothing to draw.
-- It would also mean a tile provider -- an external service that sees every
-- viewer's IP and needs a key the owner has to obtain -- and a map library, on
-- an app whose loudest complaint was that it was slow. That is the same trade
-- Phase Q is gated on, and it fails the gate for the same reason.
--
-- What somebody actually wants from "a map" here is one sentence: WHICH BRANCH
-- NEAR ME HAS THIS. That is answerable from the data we hold the moment any
-- branch has a position, and it is answerable in text now -- including the
-- honest answer, which today is "we do not know where the branches are".
--
-- So: the branch list that already opens under a deal's "where" line, ordered by
-- distance and saying it, with no coordinates invented and no provider added.
-- The day `scripts/ingest/geocode.mjs` runs, this screen starts answering
-- properly with no further change. See docs/GEOCODING.md.
--
-- Not SECURITY DEFINER: `promotion_branches` (0017) and `branches` (0008) are
-- both world-readable by policy, and a branch's address is public information.
-- Passing a point in is not a privacy question either -- it is geography. What
-- would be a privacy question is storing where somebody asked from, and this
-- stores nothing.
-- ---------------------------------------------------------------------------

create or replace function public.promotion_branches_near(
  p_promotion_id bigint,
  p_lat          double precision default null,
  p_lon          double precision default null
)
returns table (
  branch_name text,
  branch_city text,
  observed_at timestamptz,
  -- Null means "we do not know where this branch is", which the screen says in
  -- words. It never means zero, and it is never filled in with a city centre
  -- pretending to be a shop.
  km            double precision,
  -- Named geo_precision and not `precision`: that is a reserved word in Postgres
  -- (as in `double precision`), and an OUT column called it will not parse.
  geo_precision text
)
language sql
stable
set search_path = public
as $$
  select pb.branch_name,
         pb.branch_city,
         pb.observed_at,
         public.km_between(p_lat, p_lon, b.latitude, b.longitude),
         b.geocode_precision
    from public.promotion_branches pb
    join public.branches b on b.id = pb.branch_id
   where pb.promotion_id = p_promotion_id
   -- Nearest first where there is a distance; everything we cannot place keeps its
   -- alphabetical order AFTER them, rather than being dropped. A branch we cannot
   -- locate is still a branch the deal is at.
   order by public.km_between(p_lat, p_lon, b.latitude, b.longitude) asc nulls last,
            pb.branch_name
   limit 1000;
$$;

grant execute on function public.promotion_branches_near(bigint, double precision, double precision)
  to anon, authenticated, service_role;

-- ======================== 0040_moderator_role.sql ========================

-- ---------------------------------------------------------------------------
-- 0040 — a Moderator tier: Owner, Admin, Moderator, User.
--
-- WHAT WAS HERE. Two levels, `admin` and `super_admin`, and `is_admin()` meaning
-- "has a row in `admins`". Everybody who could review a deal could also manage
-- the catalogue, read the whole moderation history and reach every admin screen.
-- The brief asks for four roles with the moderation job separated out, and it is
-- the right separation: reviewing prices is the job you want to hand to somebody
-- else, and managing beers and granting privileges is the job you do not.
--
--   User        no row in `admins`
--   Moderator   reviews deals and reports. Nothing else.
--   Admin       the catalogue, the weekly pick, coverage, the dashboard.
--   Owner       `super_admin`: grants and revokes, deletes, notification rules.
--
-- `is_admin()` IS TIGHTENED, NOT WIDENED. It now means admin-or-owner, and a
-- moderator is no longer one. Every policy and every `require_admin()` that
-- exists today therefore CLOSES to moderators by default, and this migration
-- re-opens exactly the ones the job needs, by name. That direction matters: the
-- mistake you cannot recover from is a new role silently inheriting a permission
-- nobody listed, and the only way to be sure is to make the default "no".
--
-- NOTHING IS ENFORCED IN THE INTERFACE. The nav hides what a moderator cannot
-- use, as a courtesy; the database refuses it, which is the part that counts
-- (CLAUDE.md). tests/roles.test.ts walks every door for each of the four.
-- ---------------------------------------------------------------------------

-- Postgres cannot add an enum value inside a transaction that then USES it, and
-- this file is applied as one. So the value goes in first, on its own.
alter type public.admin_level add value if not exists 'moderator' before 'admin';

-- --------------------------------------------------------------------------
-- Who is what.
-- --------------------------------------------------------------------------

/**
 * May this person moderate? True for every level, including the two that
 * already existed — an administrator does not lose the job by gaining others.
 */
create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

/**
 * May this person manage? Admin or owner, and from 0040 NOT a moderator.
 *
 * This is the one semantic change in the migration, and it is a tightening: every
 * caller of is_admin() that is not re-opened below now refuses a moderator.
 */
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a
     where a.user_id = auth.uid() and a.level in ('admin', 'super_admin')
  );
$$;

revoke execute on function public.is_moderator() from public;
grant execute on function public.is_moderator() to authenticated, anon;

create or replace function public.require_moderator()
returns void
language plpgsql
stable
as $$
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- What a moderator may SEE: the queue, the reports, and nothing else new.
--
-- Named one by one. `price_observations`, `ingestion_runs`, `branch_scans`,
-- `promotion_groups`, the catalogue tables and the deal-image bucket are all
-- left on is_admin(), which now excludes a moderator — that is the default-closed
-- half of this migration doing its work.
-- --------------------------------------------------------------------------

drop policy if exists deals_read_admin on public.deals;
create policy deals_read_moderator on public.deals
  for select to authenticated using (public.is_moderator());

drop policy if exists reports_read_admin on public.deal_reports;
create policy reports_read_moderator on public.deal_reports
  for select to authenticated using (public.is_moderator());

drop policy if exists reports_admin_update on public.deal_reports;
create policy reports_moderator_update on public.deal_reports
  for update to authenticated using (public.is_moderator()) with check (public.is_moderator());

-- Editing a deal goes through admin_update_deal(), but the UPDATE policy is what
-- lets the definer function's row be seen on the way back out.
drop policy if exists deals_admin_update on public.deals;
create policy deals_moderator_update on public.deals
  for update to authenticated using (public.is_moderator()) with check (public.is_moderator());

-- The roster: a moderator sees who the administrators are, as everybody in the
-- panel does, and still cannot change it.
drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_moderator());

-- --------------------------------------------------------------------------
-- What a moderator may DO.
--
-- Only the review itself. Each function below is its current definition with
-- require_admin() replaced by require_moderator() and nothing else changed.
-- --------------------------------------------------------------------------

create or replace function public.approve_deal(p_deal_id uuid)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  row      public.deals;
  incoming public.deals;
begin
  perform public.require_moderator();

  select * into incoming from public.deals where id = p_deal_id;

  if incoming.id is null then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
      from public.deals d
     where d.status = 'approved'
       and d.id <> p_deal_id
       and d.beer_id = incoming.beer_id
       and d.store_id = incoming.store_id
       and d.category = incoming.category
  ) then
    raise exception
      'כבר יש מבצע מאושר על הבירה הזו, באותה חנות ובאותו מארז. צריך להסיר אותו קודם.'
      using errcode = '23505';
  end if;

  update public.deals set status      = 'approved',
         approved_by = auth.uid(),
         approved_at = now()
   where id = p_deal_id
  returning * into row;

  perform public.record_admin_action('deal.approve', 'deal', p_deal_id::text, jsonb_build_object(
    'from_status', incoming.status,
    'beer_id', row.beer_id,
    'store_id', row.store_id,
    'deal_price_agorot', row.deal_price_agorot,
    'submitted_by', incoming.created_by
  ));

  return row;
end;
$$;

create or replace function public.set_deal_status(p_deal_id uuid, p_status public.deal_status)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  row    public.deals;
  before public.deals;
begin
  perform public.require_moderator();

  if p_status = 'approved' then
    return public.approve_deal(p_deal_id);
  end if;

  select * into before from public.deals where id = p_deal_id;

  update public.deals set status = p_status,
         approved_by = null,
         approved_at = null,
         deactivated_at = now()
   where id = p_deal_id
  returning * into row;

  if row.id is null then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;

  update public.app_settings set weekly_deal_id = null
   where id and weekly_deal_id = p_deal_id;

  perform public.record_admin_action(
    case p_status when 'rejected' then 'deal.reject' else 'deal.remove' end,
    'deal', p_deal_id::text,
    jsonb_build_object(
      'from_status', before.status,
      'to_status', p_status,
      'was_approved_by', before.approved_by,
      'was_approved_at', before.approved_at,
      'beer_id', row.beer_id,
      'store_id', row.store_id
    )
  );

  return row;
end;
$$;

create or replace function public.resolve_report(
  p_report_id uuid,
  p_status    public.report_status
)
returns public.deal_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.deal_reports;
begin
  perform public.require_moderator();

  if p_status = 'open' then
    raise exception 'a report is resolved or dismissed, not reopened' using errcode = '22023';
  end if;

  update public.deal_reports set status = p_status, resolved_by = auth.uid(), resolved_at = now()
   where id = p_report_id
  returning * into row;

  if row.id is null then
    raise exception 'report not found' using errcode = 'P0002';
  end if;

  perform public.record_admin_action('report.close', 'report', p_report_id::text, jsonb_build_object(
    'to_status', p_status,
    'deal_id', row.deal_id
  ));

  return row;
end;
$$;

-- The moderation reading screens follow the job, not the rank.
create or replace function public.admin_offer_feedback(p_limit integer default 50)
returns table (
  offer_key    text,
  ended_weight numeric,
  still_weight numeric,
  voices       integer,
  newest_at    timestamptz,
  standing     text,
  notes        text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_moderator();

  return query
  select k.offer_key,
         s.ended_weight,
         s.still_weight,
         s.voices,
         s.newest_at,
         s.standing,
         coalesce(
           array_agg(f.note order by f.created_at desc) filter (where f.note is not null),
           '{}'
         ) as notes
    from public.offer_standings() k
    cross join lateral (select k.ended_weight, k.still_weight, k.voices, k.newest_at, k.standing) s
    left join public.offer_feedback f on f.offer_key = k.offer_key and f.note is not null
   where s.standing <> 'quiet'
   group by k.offer_key, s.ended_weight, s.still_weight, s.voices, s.newest_at, s.standing
   order by (s.standing = 'unclear') desc, s.ended_weight desc, s.newest_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

-- Who is sending us rubbish, and stopping them, is moderation.
create or replace function public.admin_submitters(p_limit integer default 50)
returns table (
  user_id      uuid,
  display_name text,
  approved     integer,
  rejected     integer,
  pending      integer,
  last_at      timestamptz,
  is_blocked   boolean,
  block_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_moderator();

  return query
  select d.created_by,
         c.display_name,
         count(*) filter (where d.status = 'approved')::integer,
         count(*) filter (where d.status = 'rejected')::integer,
         count(*) filter (where d.status = 'pending')::integer,
         max(d.created_at),
         (b.user_id is not null),
         b.reason
    from public.deals d
    left join public.contributors c on c.profile_id = d.created_by
    left join public.submission_blocks b on b.user_id = d.created_by
   where d.created_by is not null
     and not d.entered_by_admin
   group by d.created_by, c.display_name, b.user_id, b.reason
   order by (b.user_id is not null) desc,
            count(*) filter (where d.status = 'rejected') desc,
            max(d.created_at) desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

/**
 * The audit log, readable by everybody who can act in the panel.
 *
 * Including a moderator, deliberately: a log only the most powerful person can
 * see is not accountability, it is a privilege — and a moderator's own actions
 * are in it.
 */
create or replace function public.admin_audit(p_limit integer default 100, p_before_id bigint default null)
returns table (
  id           bigint,
  actor        uuid,
  actor_email  text,
  action       text,
  subject_kind text,
  subject_id   text,
  details      jsonb,
  at           timestamptz,
  is_me        boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_moderator();

  return query
  select a.id, a.actor, a.actor_email, a.action, a.subject_kind, a.subject_id, a.details, a.at,
         a.actor = auth.uid() as is_me
    from public.admin_actions a
   where p_before_id is null or a.id < p_before_id
   order by a.id desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

-- --------------------------------------------------------------------------
-- And one refusal that has to be written down rather than inherited.
--
-- A moderator must not be able to block somebody who can out-rank them, and an
-- administrator must not be able to block an owner. The old rule ("you cannot
-- block an admin") is now "you cannot block somebody at your level or above",
-- which is the same rule once there are three levels instead of two.
-- --------------------------------------------------------------------------

create or replace function public.admin_block_submitter(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean  text := nullif(trim(p_reason), '');
  mine   public.admin_level;
  theirs public.admin_level;
  stats  record;
begin
  perform public.require_moderator();

  if clean is null or char_length(clean) < 3 then
    raise exception 'צריך לכתוב למה. בלי סיבה אי אפשר לבדוק את ההחלטה אחר כך.' using errcode = '22023';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'אי אפשר לחסום את עצמכם.' using errcode = '22023';
  end if;

  select a.level into mine   from public.admins a where a.user_id = auth.uid();
  select a.level into theirs from public.admins a where a.user_id = p_user_id;

  -- An enum compares by its declared order: moderator < admin < super_admin.
  if theirs is not null and theirs >= mine then
    raise exception 'אי אפשר לחסום מישהו בדרגה שלכם או מעליה.' using errcode = '42501';
  end if;

  select count(*) filter (where status = 'approved') as approved,
         count(*) filter (where status = 'rejected') as rejected
    into stats
    from public.deals where created_by = p_user_id;

  insert into public.submission_blocks (user_id, reason, blocked_by)
  values (p_user_id, clean, auth.uid())
  on conflict (user_id) do update set reason = excluded.reason, blocked_by = excluded.blocked_by, blocked_at = now();

  perform public.record_admin_action('submitter.block', 'submitter', p_user_id::text,
    jsonb_build_object('reason', clean, 'approved', stats.approved, 'rejected', stats.rejected));
end;
$$;

create or replace function public.admin_unblock_submitter(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  before text;
begin
  perform public.require_moderator();

  select b.reason into before from public.submission_blocks b where b.user_id = p_user_id;
  if before is null then
    raise exception 'החשבון הזה לא חסום.' using errcode = 'P0002';
  end if;

  delete from public.submission_blocks where user_id = p_user_id;

  perform public.record_admin_action('submitter.unblock', 'submitter', p_user_id::text,
    jsonb_build_object('was_reason', before));
end;
$$;

grant execute on function public.require_moderator() to authenticated, anon;

-- --------------------------------------------------------------------------
-- Adding a deal by hand is moderation, not management.
--
-- It publishes a deal approved and attributed to whoever typed it — which is
-- exactly the authority approving somebody else's submission already carries.
-- Withholding it from a moderator would not withhold the power, only the short
-- way to it, and the audit log records both the same.
--
-- Lifted from 0032, not 0025. Both define this function and the earlier one has
-- no audit entry: re-issuing that body would have silently stopped recording
-- hand-entered deals. The third time this file pattern has cost something, and
-- the third time a test caught it.
-- --------------------------------------------------------------------------

create or replace function public.admin_add_deal(
  p_beer_id              uuid,
  p_store_id             uuid,
  p_category             public.deal_category,
  p_deal_price_agorot    integer,
  p_regular_price_agorot integer,
  p_notes                text default null,
  p_notify               boolean default false
)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.deals;
begin
  perform public.require_moderator();

  if exists (
    select 1 from public.deals d
     where d.status = 'approved'
       and d.beer_id = p_beer_id
       and d.store_id = p_store_id
       and d.category = p_category
  ) then
    raise exception
      'כבר יש מבצע מאושר על הבירה הזו, באותה חנות ובאותו מארז. צריך להסיר אותו קודם.'
      using errcode = '23505';
  end if;

  insert into public.deals (
    beer_id, store_id, category, deal_price_agorot, regular_price_agorot, notes,
    status, created_by, approved_by, approved_at, notified_at, entered_by_admin
  ) values (
    p_beer_id, p_store_id, p_category, p_deal_price_agorot, p_regular_price_agorot, p_notes,
    'approved', auth.uid(), auth.uid(), now(),
    case when p_notify then null else now() end,
    true
  )
  returning * into row;

  -- The enqueue trigger is `after update of status`, so an INSERT never fired it
  -- and this checkbox did nothing at all. Same dedupe key and expiry as
  -- enqueue_deal_notification (0012), so the two paths cannot drift apart.
  if p_notify and row.notes is distinct from 'מבצע לדוגמה' then
    insert into public.notification_events (dedupe_key, offer_key, beer_id, expires_at)
    values ('deal:' || row.id, 'deal:' || row.id, row.beer_id, now() + interval '24 hours')
    on conflict (dedupe_key) do nothing;
  end if;

  perform public.record_admin_action('deal.add', 'deal', row.id::text, jsonb_build_object(
    'beer_id', row.beer_id,
    'store_id', row.store_id,
    'category', row.category,
    'deal_price_agorot', row.deal_price_agorot,
    'regular_price_agorot', row.regular_price_agorot,
    -- An admin typing a deal in is vouching for it, and asking to ring phones is a
    -- separate decision worth its own record.
    'notify', p_notify
  ));

  return row;
end;
$$;

-- ======================== 0041_admin_people.sql ========================

-- ---------------------------------------------------------------------------
-- 0041 — the fields the owner asked for on the people screen.
--
-- 0035 built a deliberately narrow screen: the public name somebody chose, and
-- what they sent us. It left out city, search radius, favourite beers and the
-- registration date, on the strength of a comment in 0003 saying administrators
-- are not given profile reads. The owner asked for those four by name and called
-- them non-sensitive, which is the call that is theirs to make. This is that
-- change, made narrowly rather than by opening `profiles`.
--
-- WHAT IS STILL NOT HERE, and will not be without being asked for again:
--   · first_name          — the private name. The PUBLIC one (contributors,
--                           0030) is a different field somebody chose to publish.
--   · home_lat/home_lon   — a coordinate is a doorstep. The TOWN answers every
--                           question this screen exists for.
--   · email               — reachable to an owner through grant_admin by address;
--                           it has no job on a moderation screen.
--   · notification state, push endpoints, watchlist, feedback they filed.
--
-- `profiles` KEEPS its owner-only policy. Nothing here grants a table read: the
-- function below is SECURITY DEFINER and returns four columns, so widening it
-- later is an edit somebody has to make on purpose rather than a door left open.
-- ---------------------------------------------------------------------------

create or replace function public.admin_people(p_limit integer default 100)
returns table (
  user_id        uuid,
  display_name   text,
  home_city      text,
  search_radius_km integer,
  registered_at  timestamptz,
  favourites     text[],
  approved       integer,
  rejected       integer,
  pending        integer,
  score          integer,
  trust          text,
  is_blocked     boolean,
  block_reason   text,
  admin_level    text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Moderation, not management: the people here are the ones sending us prices.
  perform public.require_moderator();

  return query
  select p.id,
         c.display_name,
         p.home_city,
         p.search_radius_km,
         p.created_at,
         coalesce(
           (select array_agg(b.name_he order by f.rank)
              from public.user_favorite_beers f
              join public.beers b on b.id = f.beer_id
             where f.profile_id = p.id),
           '{}'
         ),
         coalesce(c.approved, 0),
         -- Rejections are counted here and deliberately NOT stored on
         -- `contributors` (0030), which is world-readable: how often somebody was
         -- turned down is a fact for a moderator, not for a leaderboard.
         (select count(*)::integer from public.deals d
           where d.created_by = p.id and d.status = 'rejected'),
         (select count(*)::integer from public.deals d
           where d.created_by = p.id and d.status = 'pending'),
         coalesce(c.score, 0),
         public.contributor_trust(c.score),
         (b.user_id is not null),
         b.reason,
         a.level::text
    from public.profiles p
    left join public.contributors c on c.profile_id = p.id
    left join public.submission_blocks b on b.user_id = p.id
    left join public.admins a on a.user_id = p.id
   -- People who have done something, newest first. Somebody who opened the app
   -- once and chose nothing is not a person this screen is about.
   where p.onboarded_at is not null
   order by p.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke execute on function public.admin_people(integer) from public, anon;
grant execute on function public.admin_people(integer) to authenticated;

-- --------------------------------------------------------------------------
-- Where the people are, and where the deals are not (Phase T).
--
-- The question this answers is the only one that changes what gets built next:
-- WHICH TOWNS HAVE PEOPLE AND NO DEALS. Everything else on the coverage screen
-- describes the pipeline; this describes the gap.
--
-- Counted by the town somebody typed, not by a coordinate — the town is what
-- they told us, and it is enough to decide where to go looking for prices.
-- --------------------------------------------------------------------------

create or replace function public.admin_people_by_city(p_limit integer default 50)
returns table (
  city            text,
  people          integer,
  with_radius     integer,
  -- How many live offers somebody in this town could actually reach, within the
  -- radius they themselves set. Null while no branch has a position (0026) —
  -- which is "we do not know", not zero.
  deals_nearby    integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  located boolean;
begin
  perform public.require_admin();

  select exists (select 1 from public.branches b where b.latitude is not null) into located;

  return query
  select p.home_city,
         count(*)::integer,
         count(*) filter (where p.search_radius_km is not null)::integer,
         case when located then count(distinct reach.offer_key)::integer end
    from public.profiles p
    -- Per PERSON, not per town: two people in the same place may have set
    -- different radii, and one of them having said "nationwide" does not mean
    -- the town is covered. Measuring from a town centre would also quietly
    -- discard the precise position of anybody who tapped "use my location".
    left join lateral (
      select o.offer_key
        from public.offers_feed o
        join public.branches br
          on br.store_id = o.store_id
         and br.latitude is not null
         and (
           -- 0 means nationwide (RADIUS_CHOICES); null means they never said, and
           -- 25 km is what the app assumes for them elsewhere.
           coalesce(p.search_radius_km, 25) = 0
           or public.km_between(p.home_lat, p.home_lon, br.latitude, br.longitude)
              <= coalesce(nullif(p.search_radius_km, 0), 25)
         )
       where located and p.home_lat is not null
    ) reach on true
   where p.home_city is not null and p.onboarded_at is not null
   group by p.home_city
   -- Most people first, and within that the emptiest: that ordering IS the
   -- question this screen exists to answer.
   order by count(*) desc, count(distinct reach.offer_key), p.home_city
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke execute on function public.admin_people_by_city(integer) from public, anon;
grant execute on function public.admin_people_by_city(integer) to authenticated;

-- ======================== 0042_dashboard_highlights.sql ========================

-- ---------------------------------------------------------------------------
-- 0042 — the dashboard answers the questions it was asked to answer.
--
-- The brief lists what the admin dashboard should show, and ends with a rule
-- that decides the shape of this migration: "Do not add vanity metrics that
-- cannot be correctly calculated."
--
-- So, item by item, what the data can and cannot support:
--
--   CAN     most popular beer      — by how many people have it as favourite #1,
--                                    which is the only sense in which this app has
--                                    a popular beer: #1 is the app (PRODUCT.md).
--   CAN     most popular chain     — by live offers people can actually use.
--   CAN     most active town       — by people who said where they live.
--   CAN     highest Deal Score     — straight from offer_scores (0027).
--   CAN     strongest contributors — contributors, already ranked (0030).
--   CAN     new registrations, new/approved/rejected/removed deals, reports,
--           notifications sent — all already counted in admin_overview (0025).
--
--   CANNOT  "active users today" / "this week". Nothing records a visit. There is
--           no session table, no page-view log, and the app deliberately collects
--           none. Counting people who DID something (submitted, reported, set a
--           name) and calling it "active users" would be a different number
--           wearing that label, and the dashboard's whole problem in 0.11.1 was
--           four numbers that did not mean what they said. It is left out, and
--           the screen says why rather than leaving a gap somebody fills in with
--           an assumption.
--
-- Every figure here is a count over rows that exist, with its window stated.
-- ---------------------------------------------------------------------------

create or replace function public.admin_highlights()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  perform public.require_admin();

  select jsonb_build_object(
    'top_beer', (
      -- Favourite #1 only. #2–#4 shape the app and are a different question; mixing
      -- them would make "popular" mean two things at once.
      select jsonb_build_object('name', b.name_he, 'slug', b.slug, 'people', count(*))
        from public.user_favorite_beers f
        join public.beers b on b.id = f.beer_id
       where f.rank = 1
       group by b.name_he, b.slug
       order by count(*) desc, b.name_he
       limit 1
    ),
    'top_store', (
      -- By what somebody could actually buy today, not by how much we have stored.
      select jsonb_build_object('name', s.name_he, 'slug', s.slug, 'offers', count(*))
        from public.offers_feed o
        join public.stores s on s.id = o.store_id
       group by s.name_he, s.slug
       order by count(*) desc, s.name_he
       limit 1
    ),
    'top_city', (
      select jsonb_build_object('city', p.home_city, 'people', count(*))
        from public.profiles p
       where p.home_city is not null and p.onboarded_at is not null
       group by p.home_city
       order by count(*) desc, p.home_city
       limit 1
    ),
    'best_score', (
      select jsonb_build_object(
               'score', sc.score,
               'band', sc.band,
               'beer', o.beer_name,
               'store', o.store_name,
               'offer_key', sc.offer_key
             )
        from public.offer_scores sc
        join public.offers_feed o on o.offer_key = sc.offer_key
       order by sc.score desc
       limit 1
    ),
    'top_contributors', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.display_name, 'score', c.score, 'approved', c.approved)
                       order by c.score desc, c.approved desc)
        from (select * from public.contributors where score > 0 order by score desc, approved desc limit 3) c
    ), '[]'::jsonb),
    -- Said in the payload rather than assumed by the screen: there is no visit
    -- log, so "active users" is a number this system cannot produce honestly.
    'activity_measurable', false,
    'as_of', now()
  ) into result;

  return result;
end;
$$;

revoke execute on function public.admin_highlights() from public, anon;
grant execute on function public.admin_highlights() to authenticated;

-- ======================== 0043_platform_default_privileges.sql ========================

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

-- ======================== 0044_offers_catalog.sql ========================

-- ---------------------------------------------------------------------------
-- 0044 — the chain half of the feed is computed once per import, not per request
--
-- MEASURED, production, 2026-10-12:
--
--   explain analyze select store_slug, value_pct from public.offers_feed;
--   Execution Time: 15306.545 ms
--
-- Past Supabase's 8-second cancellation for anon and authenticated, on the app
-- real people use. The chain listing threw; every page touching the feed waited.
-- This is older than the V2 branch — the read model is 0009's — and was found
-- only when somebody walked through the app against a database with real volume.
--
-- WHERE THE TIME GOES. Production holds 18,627 live promotion rows and shows 526
-- offers. offers_ranked (0022) finds each row's reference price with two one-row
-- index probes, which is the right trade on a warm instance and the wrong one on
-- a cold free-tier disk: 18,627 random probes at roughly 0.8 ms each is the 15
-- seconds observed. scripts/bench/feed-at-scale.mjs reproduces the shape — at
-- production's promotion volume the same query is 575 ms here (in memory, warm),
-- and 49 ms when read from a table instead. Twelve times less work per request,
-- and more than that where a probe costs a seek.
--
-- WHAT CHANGES. Nothing about what the feed SAYS. The view is a UNION ALL of two
-- halves, and only the expensive one is stored:
--
--   * the chain half (offers_ranked, the DISTINCT ON, the branch and promotion
--     joins) becomes `offers_catalog`, a table filled by refresh_offers_catalog()
--     at the end of an ingestion run — the same shape offer_scores has used since
--     0027, for the same reason;
--   * the manual half (deals_public) stays LIVE in the view, so a deal an admin
--     approves still appears the moment they approve it. Freezing that half would
--     have traded a performance win for a moderation bug.
--
-- A TABLE, NOT A MATERIALIZED VIEW. `refresh materialized view concurrently`
-- cannot run inside a transaction, so it cannot be called from a function; the
-- non-concurrent form takes an ACCESS EXCLUSIVE lock and would stall every reader
-- for the length of the rebuild. A delete-and-insert inside one transaction takes
-- ordinary row locks, and readers see the previous rows until it commits.
--
-- STALENESS, SAID PLAINLY. Between imports the chain half is as old as the last
-- refresh. That is already true of every price in it — they are observations with
-- an `observed_at`, not live quotes — and `refreshed_at` records when the table
-- was last built so a screen can say so if it ever needs to.
--
-- Additive and reversible: one table, one function, one view redefined with the
-- same columns in the same order. Rolling back is restoring 0017's view.
-- ---------------------------------------------------------------------------

-- The chain half, by itself, so the refresh has something to select from and the
-- definition stays in one place rather than being duplicated into the function.
create or replace view public.offers_catalog_source
with (security_invoker = on)
as
select
  'obs:' || o.observation_id::text          as offer_key,
  'catalog'::text                           as origin,
  o.sku_id,
  o.beer_id, o.beer_slug, o.beer_name,
  o.store_id, o.store_slug, o.store_name,
  o.sku_name                                as pack_label,
  o.container, o.volume_ml, o.pack_quantity,
  o.effective_agorot,
  o.unit_price_per_liter_agorot,
  o.reference_agorot,
  o.reference_trust,
  o.value_pct,
  o.needs_review,
  o.market_reference_agorot,
  o.market_value_pct,
  o.promo_type,
  o.conditions,
  o.valid_from, o.valid_to,
  o.observed_at,
  o.is_sample,
  o.conditions ->> 'note_he'                as notes,
  o.variant,
  o.category,
  o.deposit_agorot,
  o.deposit_included,
  o.branch_count,
  o.branch_id,
  bn.name_he                                as branch_name,
  bn.city                                   as branch_city,
  pr.id                                     as promotion_id,
  pr.scope,
  pr.scope_evidence,
  pr.branches_known,
  pr.branches_checked,
  pr.branches_matching,
  pr.coverage_as_of,
  ob.name_he                                as only_branch_name,
  ob.city                                   as only_branch_city
from (
  select distinct on (r.sku_id, r.store_id, r.identity_key)
         r.*,
         count(*) over (partition by r.sku_id, r.store_id, r.identity_key)::integer as branch_count
    from public.offers_ranked r
   order by r.sku_id, r.store_id, r.identity_key, r.effective_agorot, r.value_pct desc nulls last, r.observed_at desc
) o
left join public.branches bn on bn.id = o.branch_id
left join public.promotions pr on pr.store_id = o.store_id and pr.canonical_key = o.identity_key
left join public.branches ob on ob.id = pr.only_branch_id
;

-- Same columns, same order, by construction.
create table if not exists public.offers_catalog as
  select * from public.offers_catalog_source with no data;

alter table public.offers_catalog
  add column if not exists refreshed_at timestamptz not null default now();

create unique index if not exists offers_catalog_key on public.offers_catalog (offer_key);
create index if not exists offers_catalog_store on public.offers_catalog (store_slug);
create index if not exists offers_catalog_beer on public.offers_catalog (beer_slug);

-- Public, like the view it replaces: every row here comes from tables whose own
-- policy is `select … using (true)`. Nothing becomes visible that was not.
grant select on public.offers_catalog to anon, authenticated, service_role;

-- RLS on, and a READ policy — not a deny-all. Every row here is derived from
-- tables whose own policy is `select … using (true)`, and the view over it is
-- security_invoker, so without this the feed would return no chain offers to
-- anybody. (It did: tests/security-sweep.test.ts caught a sixth table sitting
-- policy-less among the five deliberate deny-alls, which is exactly the finding
-- that test exists to make.)
--
-- There is no write policy and no write grant, so the only way in is the
-- function below, which runs as the owner.
alter table public.offers_catalog enable row level security;

create policy offers_catalog_read on public.offers_catalog
  for select to anon, authenticated using (true);

comment on table public.offers_catalog is
  'The chain half of offers_feed, computed once per import by refresh_offers_catalog(). '
  'Never written by hand: it is derived from offers_catalog_source.';

-- ---------------------------------------------------------------------------
-- Rebuild it. Guarded by the same rule as the prices it is derived from (0008):
-- whoever may write a price may write what we computed from it.
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
  delete from public.offers_catalog;
  insert into public.offers_catalog
  select s.*, now() from public.offers_catalog_source s;
  get diagnostics written = row_count;

  return written;
end;
$$;

revoke execute on function public.refresh_offers_catalog() from public, anon;
grant execute on function public.refresh_offers_catalog() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The feed itself: the stored chain half, and the manual half still live.
-- ---------------------------------------------------------------------------
create or replace view public.offers_feed
with (security_invoker = on)
as
select
  offer_key, origin, sku_id,
  beer_id, beer_slug, beer_name,
  store_id, store_slug, store_name,
  pack_label,
  container, volume_ml, pack_quantity,
  effective_agorot,
  unit_price_per_liter_agorot,
  reference_agorot,
  reference_trust,
  value_pct,
  needs_review,
  market_reference_agorot,
  market_value_pct,
  promo_type,
  conditions,
  valid_from, valid_to,
  observed_at,
  is_sample,
  notes,
  variant,
  category,
  deposit_agorot,
  deposit_included,
  branch_count,
  branch_id,
  branch_name,
  branch_city,
  promotion_id,
  scope,
  scope_evidence,
  branches_known,
  branches_checked,
  branches_matching,
  coverage_as_of,
  only_branch_name,
  only_branch_city
from public.offers_catalog

union all


select
  'deal:' || d.id::text,
  'legacy',
  null::uuid,
  d.beer_id, d.beer_slug, d.beer_name,
  d.store_id, d.store_slug, d.store_name,
  case d.category when 'sixpack' then 'שישייה' when 'case' then 'ארגז' else 'בודד' end,
  null::public.container_type, null::integer, null::integer,
  d.deal_price_agorot,
  null::integer,
  d.regular_price_agorot,
  'moderated',
  case when d.discount_percent between 1 and 70 then d.discount_percent end,
  d.discount_percent > 70,
  null::integer, null::integer,
  null::public.promo_type,
  '{}'::jsonb,
  null::timestamptz, null::timestamptz,
  d.approved_at,
  coalesce(d.notes = 'מבצע לדוגמה', false),
  d.notes,
  '',
  'beer',
  null::integer,
  null::boolean,
  1,
  null::uuid,
  null::text,
  null::text,
  null::bigint,
  null::text,
  null::text,
  null::integer,
  null::integer,
  null::integer,
  null::timestamptz,
  null::text,
  null::text
from public.deals_public d;
-- ---------------------------------------------------------------------------
-- Fill it now.
--
-- Without this the feed's chain half is EMPTY between applying this migration
-- and the next import — every chain offer gone from every screen, for hours,
-- with nothing on fire to explain it. The migration pays the cost once (about
-- fifteen seconds on production, which is the very number that justified the
-- change) so that nobody else does.
--
-- Not through refresh_offers_catalog(): that guards on require_price_writer(),
-- and a migration runs as the owner with no auth.uid() to check.
-- ---------------------------------------------------------------------------
insert into public.offers_catalog
select s.*, now() from public.offers_catalog_source s
on conflict (offer_key) do nothing;

-- ---------------------------------------------------------------------------
-- WHAT GOES STALE, AND FOR HOW LONG
--
-- The stored half carries names as well as prices — beer_name, store_name,
-- branch_name — so renaming a beer in the admin panel now shows on the chain
-- offers at the next import rather than at once. Prices themselves were already
-- only as fresh as the last import (they are observations with an observed_at,
-- not live quotes), so nothing about a PRICE got staler here.
--
-- That is a real regression in one narrow place, accepted knowingly: a rename is
-- rare, /admin/beers always shows the truth, and the alternative — rebuilding
-- fifteen seconds of table inside an admin's click — is worse than a name that
-- catches up overnight. The cleaner answer is to store ids here and join the
-- names live in the view; it is a bigger change than this one and belongs on its
-- own, with its own measurement.
-- ---------------------------------------------------------------------------

-- ======================== 0045_town_centres.sql ========================

-- ---------------------------------------------------------------------------
-- 0045 — putting the branches on the map, honestly.
--
-- THE PROBLEM THIS SOLVES. Migration 0026 shipped `branches.latitude` and
-- `branches.longitude` deliberately empty, because the price-transparency Stores
-- file carries a branch's name, address and city and never a coordinate. The
-- consequence, visible to every person who opens the app: "הכי קרוב אליי" has
-- never worked. 0 of ~1,160 branches has a position, so the screen correctly says
-- it does not know where the shops are — and correctly saying nothing is still
-- nothing.
--
-- WHAT THIS DOES. It places each branch at the CENTRE OF ITS TOWN, and records
-- that this is what it did: geocode_precision = 'locality', which 0026 defines as
-- "the CITY centre, not the shop", which ScopeLine already words as "(מרכז העיר)"
-- next to the distance. Nothing here claims a doorstep.
--
-- WHY THAT IS NOT THE INVENTED COORDINATE THE PIPELINE REFUSES. The thing
-- scripts/ingest/lib/geocode/null.mjs exists to prevent is a plausible, wrong,
-- UNDETECTABLE position — a pin on a building that is not the shop, indistinguishable
-- from a real fix once it is in the table. A town centre is a different object: it is
-- labelled as a town centre in the row, in the API and on the screen, and it answers
-- the question the app actually asks, which is "is there a Rami Levy in my town or do
-- I have to drive to the next one". At 5 km radius steps a town centre is the right
-- resolution; for the shop's own door it is openly not, and the app says so.
--
-- A real street-level geocode (docs/GEOCODING.md, GEOCODER="nominatim") remains the
-- better answer and still works: `place_branches_by_town()` only ever fills a branch
-- that has NO position, so a later rooftop fix is never overwritten by a town centre,
-- and this migration is a floor rather than a ceiling.
--
-- Additive and reversible: one reference table, two functions, one backfill that
-- touches only rows whose latitude is null.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- 1. Comparing two spellings of one place
--
-- The Stores files, the person typing their town, and src/data/israel-cities.ts
-- disagree about maqaf vs hyphen ("תל אביב-יפו" / "תל אביב יפו"), about geresh,
-- and about קרית vs קריית. None of that is a different town. This is the whole
-- of the latitude we take: no transliteration, no edit distance, no guessing.
-- --------------------------------------------------------------------------
create or replace function public.norm_place(raw text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    lower(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(coalesce(raw, ''), '[־‐‑‒–—―-]', ' ', 'g'),
              '[׳״''’"״׳.,]', '', 'g'
            ),
            'קרית', 'קריית', 'g'
          ),
          '\s+', ' ', 'g'
        )
      )
    ),
    ''
  );
$$;

comment on function public.norm_place(text) is
  'One spelling key for a place name. Mechanical only: hyphens and maqaf to space, '
  'geresh and punctuation dropped, קרית unified with קריית, whitespace collapsed.';

-- --------------------------------------------------------------------------
-- 2. Where each town is
--
-- One row per SPELLING, each carrying the town's display name and its approximate
-- centre, so a lookup is a primary-key hit. Generated from src/data/israel-cities.ts
-- by scripts/build-town-centres-sql.mjs — tests/town-centres.test.ts fails if the two
-- copies drift. `source` is the same weaker claim that file makes out loud: these are
-- hand-compiled approximate centres, good to a kilometre or two, not an official
-- dataset. data.gov.il's רשימת יישובים is the upgrade, and it would arrive here as a
-- new migration with source = 'data.gov.il'.
-- --------------------------------------------------------------------------
create table if not exists public.town_centres (
  norm_name text primary key,
  name      text not null,
  lat       double precision not null,
  lon       double precision not null,
  source    text not null default 'compiled',
  constraint town_centres_bounds check (lat between 29.3 and 33.5 and lon between 34.0 and 36.0)
);

comment on table public.town_centres is
  'Approximate town centres, one row per spelling. Reference geography, not user data.';

-- Published geography with nothing personal in it, and the app already ships the
-- same list to the browser in src/data/israel-cities.ts. Read-only to everybody:
-- there is no write grant and no write policy, so the only way a row changes is a
-- migration or the service role.
grant select on public.town_centres to anon, authenticated, service_role;

alter table public.town_centres enable row level security;

create policy town_centres_read on public.town_centres
  for select to anon, authenticated using (true);

insert into public.town_centres (norm_name, name, lat, lon, source) values
  ('קריית שמונה', 'קריית שמונה', 33.207, 35.572, 'compiled'),
  ('מטולה', 'מטולה', 33.279, 35.578, 'compiled'),
  ('צפת', 'צפת', 32.965, 35.498, 'compiled'),
  ('חצור הגלילית', 'חצור הגלילית', 32.98, 35.545, 'compiled'),
  ('ראש פינה', 'ראש פינה', 32.969, 35.542, 'compiled'),
  ('מעלות תרשיחא', 'מעלות־תרשיחא', 33.016, 35.272, 'compiled'),
  ('מעלות', 'מעלות־תרשיחא', 33.016, 35.272, 'compiled'),
  ('תרשיחא', 'מעלות־תרשיחא', 33.016, 35.272, 'compiled'),
  ('נהריה', 'נהריה', 33.006, 35.095, 'compiled'),
  ('שלומי', 'שלומי', 33.072, 35.145, 'compiled'),
  ('עכו', 'עכו', 32.928, 35.082, 'compiled'),
  ('כרמיאל', 'כרמיאל', 32.916, 35.296, 'compiled'),
  ('סחנין', 'סחנין', 32.865, 35.3, 'compiled'),
  ('טמרה', 'טמרה', 32.853, 35.198, 'compiled'),
  ('שפרעם', 'שפרעם', 32.806, 35.172, 'compiled'),
  ('נצרת', 'נצרת', 32.702, 35.303, 'compiled'),
  ('נוף הגליל', 'נוף הגליל', 32.713, 35.32, 'compiled'),
  ('נצרת עילית', 'נוף הגליל', 32.713, 35.32, 'compiled'),
  ('טבריה', 'טבריה', 32.79, 35.531, 'compiled'),
  ('מגדל העמק', 'מגדל העמק', 32.675, 35.245, 'compiled'),
  ('עפולה', 'עפולה', 32.607, 35.289, 'compiled'),
  ('בית שאן', 'בית שאן', 32.497, 35.5, 'compiled'),
  ('יקנעם עילית', 'יקנעם עילית', 32.661, 35.11, 'compiled'),
  ('יקנעם', 'יקנעם עילית', 32.661, 35.11, 'compiled'),
  ('קריית טבעון', 'קריית טבעון', 32.721, 35.127, 'compiled'),
  ('חיפה', 'חיפה', 32.794, 34.99, 'compiled'),
  ('קריית ביאליק', 'קריית ביאליק', 32.831, 35.081, 'compiled'),
  ('קריית מוצקין', 'קריית מוצקין', 32.839, 35.077, 'compiled'),
  ('קריית ים', 'קריית ים', 32.845, 35.069, 'compiled'),
  ('קריית אתא', 'קריית אתא', 32.804, 35.106, 'compiled'),
  ('נשר', 'נשר', 32.767, 35.043, 'compiled'),
  ('טירת כרמל', 'טירת כרמל', 32.76, 34.972, 'compiled'),
  ('חדרה', 'חדרה', 32.434, 34.92, 'compiled'),
  ('אור עקיבא', 'אור עקיבא', 32.509, 34.918, 'compiled'),
  ('זכרון יעקב', 'זכרון יעקב', 32.573, 34.952, 'compiled'),
  ('פרדס חנה כרכור', 'פרדס חנה־כרכור', 32.474, 34.975, 'compiled'),
  ('פרדס חנה', 'פרדס חנה־כרכור', 32.474, 34.975, 'compiled'),
  ('כרכור', 'פרדס חנה־כרכור', 32.474, 34.975, 'compiled'),
  ('בנימינה', 'בנימינה', 32.515, 34.949, 'compiled'),
  ('נתניה', 'נתניה', 32.321, 34.853, 'compiled'),
  ('אבן יהודה', 'אבן יהודה', 32.271, 34.888, 'compiled'),
  ('כפר יונה', 'כפר יונה', 32.317, 34.937, 'compiled'),
  ('טירה', 'טירה', 32.234, 34.951, 'compiled'),
  ('טייבה', 'טייבה', 32.267, 35.01, 'compiled'),
  ('קלנסווה', 'קלנסווה', 32.285, 34.981, 'compiled'),
  ('רעננה', 'רעננה', 32.185, 34.871, 'compiled'),
  ('כפר סבא', 'כפר סבא', 32.175, 34.907, 'compiled'),
  ('הוד השרון', 'הוד השרון', 32.15, 34.889, 'compiled'),
  ('הרצליה', 'הרצליה', 32.166, 34.843, 'compiled'),
  ('רמת השרון', 'רמת השרון', 32.146, 34.839, 'compiled'),
  ('תל אביב יפו', 'תל אביב-יפו', 32.085, 34.782, 'compiled'),
  ('תל אביב', 'תל אביב-יפו', 32.085, 34.782, 'compiled'),
  ('יפו', 'תל אביב-יפו', 32.085, 34.782, 'compiled'),
  ('תא', 'תל אביב-יפו', 32.085, 34.782, 'compiled'),
  ('בני ברק', 'בני ברק', 32.084, 34.833, 'compiled'),
  ('גבעתיים', 'גבעתיים', 32.072, 34.81, 'compiled'),
  ('רמת גן', 'רמת גן', 32.082, 34.814, 'compiled'),
  ('פתח תקווה', 'פתח תקווה', 32.088, 34.887, 'compiled'),
  ('קריית אונו', 'קריית אונו', 32.056, 34.855, 'compiled'),
  ('אור יהודה', 'אור יהודה', 32.03, 34.853, 'compiled'),
  ('יהוד מונוסון', 'יהוד־מונוסון', 32.033, 34.889, 'compiled'),
  ('יהוד', 'יהוד־מונוסון', 32.033, 34.889, 'compiled'),
  ('חולון', 'חולון', 32.015, 34.774, 'compiled'),
  ('בת ים', 'בת ים', 32.017, 34.75, 'compiled'),
  ('ראשון לציון', 'ראשון לציון', 31.964, 34.805, 'compiled'),
  ('נס ציונה', 'נס ציונה', 31.929, 34.799, 'compiled'),
  ('רחובות', 'רחובות', 31.894, 34.809, 'compiled'),
  ('רמלה', 'רמלה', 31.928, 34.866, 'compiled'),
  ('לוד', 'לוד', 31.952, 34.896, 'compiled'),
  ('שוהם', 'שוהם', 31.999, 34.948, 'compiled'),
  ('מודיעין מכבים רעות', 'מודיעין־מכבים־רעות', 31.899, 35.01, 'compiled'),
  ('מודיעין', 'מודיעין־מכבים־רעות', 31.899, 35.01, 'compiled'),
  ('אלעד', 'אלעד', 32.051, 34.951, 'compiled'),
  ('ראש העין', 'ראש העין', 32.096, 34.956, 'compiled'),
  ('ירושלים', 'ירושלים', 31.769, 35.217, 'compiled'),
  ('י ם', 'ירושלים', 31.769, 35.217, 'compiled'),
  ('ירושלם', 'ירושלים', 31.769, 35.217, 'compiled'),
  ('בית שמש', 'בית שמש', 31.747, 34.988, 'compiled'),
  ('מבשרת ציון', 'מבשרת ציון', 31.797, 35.148, 'compiled'),
  ('ביתר עילית', 'ביתר עילית', 31.698, 35.113, 'compiled'),
  ('מעלה אדומים', 'מעלה אדומים', 31.773, 35.298, 'compiled'),
  ('גבעת זאב', 'גבעת זאב', 31.86, 35.168, 'compiled'),
  ('יבנה', 'יבנה', 31.878, 34.739, 'compiled'),
  ('גדרה', 'גדרה', 31.813, 34.778, 'compiled'),
  ('אשדוד', 'אשדוד', 31.802, 34.655, 'compiled'),
  ('אשקלון', 'אשקלון', 31.669, 34.574, 'compiled'),
  ('קריית מלאכי', 'קריית מלאכי', 31.728, 34.747, 'compiled'),
  ('קריית גת', 'קריית גת', 31.61, 34.764, 'compiled'),
  ('שדרות', 'שדרות', 31.525, 34.596, 'compiled'),
  ('נתיבות', 'נתיבות', 31.422, 34.589, 'compiled'),
  ('אופקים', 'אופקים', 31.311, 34.62, 'compiled'),
  ('באר שבע', 'באר שבע', 31.252, 34.791, 'compiled'),
  ('רהט', 'רהט', 31.393, 34.754, 'compiled'),
  ('עומר', 'עומר', 31.267, 34.846, 'compiled'),
  ('מיתר', 'מיתר', 31.322, 34.933, 'compiled'),
  ('להבים', 'להבים', 31.371, 34.816, 'compiled'),
  ('דימונה', 'דימונה', 31.07, 35.033, 'compiled'),
  ('ערד', 'ערד', 31.259, 35.212, 'compiled'),
  ('ירוחם', 'ירוחם', 30.988, 34.929, 'compiled'),
  ('מצפה רמון', 'מצפה רמון', 30.61, 34.801, 'compiled'),
  ('אילת', 'אילת', 29.557, 34.952, 'compiled'),
  ('אריאל', 'אריאל', 32.106, 35.187, 'compiled'),
  ('מעלה אפרים', 'מעלה אפרים', 32.07, 35.333, 'compiled')
on conflict (norm_name) do update set name = excluded.name, lat = excluded.lat, lon = excluded.lon, source = excluded.source;

-- --------------------------------------------------------------------------
-- 3. Placing the branches
--
-- Two passes, in this order:
--
--   a. the branch's city, matched exactly on the spelling key.
--   b. the branch's city with something appended — "ירושלים תלפיות",
--      "פתח תקווה (סגולה)" — matched on the longest town name that is a whole-word
--      prefix of it. A neighbourhood inside a town is still that town.
--
-- No fuzzy third pass. A branch whose city we do not recognise keeps no position,
-- stays out of "closest to me", and is counted on the admin coverage screen, which
-- is the behaviour the feature was built around from the start.
--
-- ONLY FILLS WHAT IS EMPTY. A branch that already has a position — a real street
-- fix from a geocoder, or a correction — is never touched.
--
-- Guarded by require_price_writer(), on 0008's rule: whoever may write a price for a
-- branch may say which town that branch is in.
-- --------------------------------------------------------------------------
create or replace function public.place_branches_by_town()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  placed integer;
begin
  perform public.require_price_writer();

  with candidate as (
    select b.id,
           t.lat,
           t.lon
      from public.branches b
      join lateral (
        select tc.lat, tc.lon
          from public.town_centres tc
         where tc.norm_name = public.norm_place(b.city)
            or public.norm_place(b.city) like tc.norm_name || ' %'
         order by length(tc.norm_name) desc
         limit 1
      ) t on true
     where b.latitude is null
       and b.city is not null
  )
  update public.branches b set latitude          = c.lat,
         longitude         = c.lon,
         geocoded_at       = now(),
         geocode_source    = 'israel-cities (town centre)',
         geocode_precision = 'locality'
    from candidate c
   where c.id = b.id;

  get diagnostics placed = row_count;
  return placed;
end;
$$;

comment on function public.place_branches_by_town() is
  'Gives every unplaced branch the centre of its town, recorded as precision=locality. '
  'Never overwrites a position that is already there.';

revoke execute on function public.place_branches_by_town() from public, anon;
grant execute on function public.place_branches_by_town() to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 4. And the person's own town
--
-- The same gap existed at the other end of the measurement. PlacePicker sends a
-- point when the town is PICKED from the list, and sends none when the town is
-- TYPED — so somebody who typed "חולון" had told us exactly where they live and
-- still got "we have your town but not the positions". 0.32.4 fixed the wording;
-- this fixes the thing the wording was about.
--
-- Only when the caller has no point of its own: a shared GPS position always wins
-- over a town centre, and this never overwrites one.
-- --------------------------------------------------------------------------
create or replace function public.save_location(
  p_city      text,
  p_lat       double precision,
  p_lon       double precision,
  p_radius_km integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  city  text := nullif(btrim(p_city), '');
  lat   double precision := p_lat;
  lon   double precision := p_lon;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if (p_lat is null) <> (p_lon is null) then
    raise exception 'a latitude without a longitude is not a place' using errcode = '22023';
  end if;

  if p_radius_km is not null and p_radius_km not in (0, 5, 10, 15, 20, 25, 50) then
    raise exception 'that is not one of the distances on offer' using errcode = '22023';
  end if;

  -- A town we know, with no point supplied: measure from its centre.
  if lat is null and city is not null then
    select tc.lat, tc.lon into lat, lon
      from public.town_centres tc
     where tc.norm_name = public.norm_place(city)
     limit 1;
  end if;

  -- Same reason as 0024: a missing profile row must not turn into a save that
  -- reports success and changes nothing.
  insert into public.profiles (id) values (uid) on conflict (id) do nothing;

  update public.profiles set home_city        = city,
         home_lat         = lat,
         home_lon         = lon,
         search_radius_km = p_radius_km
   where id = uid;

  if not found then
    raise exception 'could not save your location' using errcode = '23503';
  end if;
end;
$$;

revoke execute on function public.save_location(text, double precision, double precision, integer) from public, anon;
grant execute on function public.save_location(text, double precision, double precision, integer) to authenticated;

-- --------------------------------------------------------------------------
-- 5. The backfill, now.
--
-- Applying this migration is what makes "הכי קרוב אליי" work for the branches
-- already in the table. It is the same call the import makes from now on
-- (scripts/ingest/run.mjs), so a new branch is placed the day it appears.
-- --------------------------------------------------------------------------
do $$
declare
  placed integer;
begin
  -- The function's own guard is for callers; applying a migration is already the owner.
  with candidate as (
    select b.id, t.lat, t.lon
      from public.branches b
      join lateral (
        select tc.lat, tc.lon
          from public.town_centres tc
         where tc.norm_name = public.norm_place(b.city)
            or public.norm_place(b.city) like tc.norm_name || ' %'
         order by length(tc.norm_name) desc
         limit 1
      ) t on true
     where b.latitude is null
       and b.city is not null
  )
  update public.branches b set latitude          = c.lat,
         longitude         = c.lon,
         geocoded_at       = now(),
         geocode_source    = 'israel-cities (town centre)',
         geocode_precision = 'locality'
    from candidate c
   where c.id = b.id;

  get diagnostics placed = row_count;
  raise notice '0045: placed % branches at their town centre', placed;
end
$$;

-- Profiles that already hold a town and no point get the same treatment, once.
update public.profiles p set home_lat = tc.lat,
       home_lon = tc.lon
  from public.town_centres tc
 where p.home_lat is null
   and p.home_city is not null
   and tc.norm_name = public.norm_place(p.home_city);

-- ======================== 0046_every_settlement.sql ========================

-- ---------------------------------------------------------------------------
-- 0046 — every settlement in the country, not ninety towns.
--
-- 0045 shipped `town_centres` with the 90 towns this project had compiled by hand.
-- That covers cities and misses the kibbutz, the moshav and the village — so the
-- people who most need "where is the nearest branch" were exactly the ones told,
-- correctly and uselessly, that we could not measure. The owner hit it on his own
-- settlement the first time he tried it.
--
-- This replaces that list with 1,155 settlements: every one the government's list
-- holds and that could be placed. Generated from src/data/israel-cities.ts by
-- scripts/build-town-centres-sql.mjs, which generates that file too
-- (scripts/build-settlements.mjs) — one list, two copies, and
-- tests/town-centres.test.ts fails if they drift.
--
-- WHERE THE DATA COMES FROM, AND WHAT WAS THROWN OUT.
--
-- data-sources/israel-geolocation-1.0.1/, vendored with its licence: the official
-- settlement list from data.gov.il keyed by CBS settlement symbol, with coordinates
-- from OpenStreetMap (© OpenStreetMap contributors, ODbL) and from Google's geocoder.
--
-- The upstream package did not check its own geocoding, and 115 of its 1,264 rows are
-- demonstrably not places. Every one is refused by the rule that a coordinate two
-- settlements share is not a place, it is a geocoder giving up:
--
--   * 85 settlements all sitting on ONE point in the Negev (31.0461, 34.8516), which
--     is how מעלה אדומים, ביתר עילית and טירה "ended up" a hundred kilometres from
--     where they are;
--   * four military camps on Jerusalem's exact point;
--   * and, hiding among the innocent-looking PAIRS: קרית ארבע at KIRYAT SHMONA's
--     coordinates 190 km away, sharing them with קרית שלמה; עופרה sitting on עופר
--     near Haifa; קרני שומרון near Jenin; טייבה (בעמק) on the Triangle Taybe's point;
--   * עטרת, placed in Los Angeles (34.0551, −118.3892).
--
-- The rule costs about two dozen genuine neighbours their position too — עין חרוד
-- (איחוד) and (מאוחד) really do share a point. Each of those is a place a person can
-- still type and still be known by, with no distances, which the app already says out
-- loud. The alternative is a confident pin on the wrong end of the country.
--
-- The import refuses every one of them, because a wrong coordinate is the single
-- failure this product cannot absorb: it looks exactly like a right one. What it
-- cannot place keeps NO position, which the app already handles — a settlement you
-- can type and be known by, with no distances, rather than a confident lie.
--
-- Cross-checked against the 90 hand-compiled towns: median disagreement 350 metres.
-- Where the dataset put a town more than 5 km from the hand-compiled value it is a
-- different place (תמרה came back at the other Tamra, 31 km away) and the
-- hand-compiled value stands; under that the two are the same settlement with
-- different ideas of its centre, and the dataset's systematic choice stands.
--
-- Additive: one UPSERT into a reference table, then the same two backfills 0045 ran,
-- which now match far more rows.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- 1. Parentheses are not part of a name
--
-- The dataset distinguishes טמרה (יזרעאל) from טמרה and בן שמן (מושב) from
-- בן שמן (כפר נוער). People do not type the brackets, and 0045's norm_place()
-- did not know about them. Same mechanical rule as the rest: a bracket is a
-- separator, like a maqaf.
-- --------------------------------------------------------------------------
create or replace function public.norm_place(raw text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    lower(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(coalesce(raw, ''), '[־‐‑‒–—―()-]', ' ', 'g'),
              '[׳״''’"״׳.,]', '', 'g'
            ),
            'קרית', 'קריית', 'g'
          ),
          '\s+', ' ', 'g'
        )
      )
    ),
    ''
  );
$$;

comment on function public.norm_place(text) is
  'One spelling key for a place name. Mechanical only: hyphens, maqaf and brackets to '
  'space, geresh and punctuation dropped, קרית unified with קריית, whitespace collapsed.';

-- --------------------------------------------------------------------------
-- 2. The settlements
-- --------------------------------------------------------------------------
insert into public.town_centres (norm_name, name, lat, lon, source) values
  ('אבו גוש', 'אבו גוש', 31.806353, 35.1088651, 'data.gov.il+osm'),
  ('אבו סנאן', 'אבו סנאן', 32.958648, 35.1716603, 'data.gov.il+osm'),
  ('אבו קרינאת יישוב', 'אבו קרינאת (יישוב)', 31.213852, 35.084855, 'data.gov.il+osm'),
  ('אבו תלול', 'אבו תלול', 31.142612, 34.913514, 'data.gov.il+osm'),
  ('אבטין', 'אבטין', 32.7607812, 35.1131894, 'data.gov.il+osm'),
  ('אבטליון', 'אבטליון', 32.8361797, 35.3502704, 'data.gov.il+osm'),
  ('אביאל', 'אביאל', 32.5325097, 34.9933907, 'data.gov.il+osm'),
  ('אביבים', 'אביבים', 33.0886777, 35.4729375, 'data.gov.il+osm'),
  ('אביגדור', 'אביגדור', 31.7109457, 34.7435754, 'data.gov.il+osm'),
  ('אביחיל', 'אביחיל', 32.3502322, 34.8717347, 'data.gov.il+osm'),
  ('אביטל', 'אביטל', 32.5578557, 35.3063551, 'data.gov.il+osm'),
  ('אביעזר', 'אביעזר', 31.6811888, 35.0177211, 'data.gov.il+osm'),
  ('אבירים', 'אבירים', 33.0386467, 35.2871399, 'data.gov.il+osm'),
  ('אבן יהודה', 'אבן יהודה', 32.2724852, 34.886767, 'data.gov.il+osm'),
  ('אבן מנחם', 'אבן מנחם', 33.0736105, 35.2941382, 'data.gov.il+osm'),
  ('אבן ספיר', 'אבן ספיר', 31.7629815, 35.1351189, 'data.gov.il+osm'),
  ('אבן שמואל', 'אבן שמואל', 31.5748942, 34.7643312, 'data.gov.il+osm'),
  ('אבני איתן', 'אבני איתן', 32.8246384, 35.7667337, 'data.gov.il+osm'),
  ('אבשלום', 'אבשלום', 31.1950932, 34.3307877, 'data.gov.il+osm'),
  ('אדירים', 'אדירים', 32.5490732, 35.2711676, 'data.gov.il+osm'),
  ('אדמית', 'אדמית', 33.0795856, 35.2102543, 'data.gov.il+osm'),
  ('אדרת', 'אדרת', 31.6597433, 34.9956875, 'data.gov.il+osm'),
  ('אודים', 'אודים', 32.2647709, 34.8469332, 'data.gov.il+osm'),
  ('אודם', 'אודם', 33.1943741, 35.7483145, 'data.gov.il+osm'),
  ('אוהד', 'אוהד', 31.2377429, 34.4304539, 'data.gov.il+osm'),
  ('אום אל פחם', 'אום אל-פחם', 32.5158385, 35.152491, 'data.gov.il+osm'),
  ('אום אל קוטוף', 'אום אל-קוטוף', 32.468056, 35.058889, 'data.gov.il+osm'),
  ('אום בטין', 'אום בטין', 31.27674369999999, 34.8829215, 'data.gov.il+osm'),
  ('אומן', 'אומן', 32.5641159, 35.2422454, 'data.gov.il+osm'),
  ('אומץ', 'אומץ', 32.3715218, 34.9961912, 'data.gov.il+osm'),
  ('אופקים', 'אופקים', 31.3125831, 34.6208537, 'data.gov.il+osm'),
  ('אור הגנוז', 'אור הגנוז', 33.005079, 35.4475065, 'data.gov.il+osm'),
  ('אור הנר', 'אור הנר', 31.5575591, 34.6000531, 'data.gov.il+osm'),
  ('אור יהודה', 'אור יהודה', 32.0270045, 34.8629898, 'data.gov.il+osm'),
  ('אור עקיבא', 'אור עקיבא', 32.5090151, 34.9195677, 'data.gov.il+osm'),
  ('אורה', 'אורה', 31.7527467, 35.1534987, 'data.gov.il+osm'),
  ('אורות', 'אורות', 31.7407214, 34.734914, 'data.gov.il+osm'),
  ('אורטל', 'אורטל', 33.0852392, 35.7594308, 'data.gov.il+osm'),
  ('אורים', 'אורים', 31.3041665, 34.521977, 'data.gov.il+osm'),
  ('אורנים', 'אורנים', 32.7116768, 35.1079584, 'data.gov.il+osm'),
  ('אורנית', 'אורנית', 32.131924, 34.99081, 'data.gov.il+osm'),
  ('אושה', 'אושה', 32.7955189, 35.1144019, 'data.gov.il+osm'),
  ('אזור', 'אזור', 32.0282087, 34.802593, 'data.gov.il+osm'),
  ('אחוזם', 'אחוזם', 31.5522246, 34.7706958, 'data.gov.il+osm'),
  ('אחוזת ברק', 'אחוזת ברק', 32.6418437, 35.3387534, 'data.gov.il+osm'),
  ('אחיהוד', 'אחיהוד', 32.908312, 35.1723837, 'data.gov.il+osm'),
  ('אחיטוב', 'אחיטוב', 32.3873272, 34.9914108, 'data.gov.il+osm'),
  ('אחיסמך', 'אחיסמך', 31.935556, 34.908056, 'data.gov.il+osm'),
  ('אחיעזר', 'אחיעזר', 31.9811076, 34.8716734, 'data.gov.il+osm'),
  ('אטרש שבט', 'אטרש (שבט)', 31.2540525, 34.9684377, 'data.gov.il+osm'),
  ('איבי הנחל', 'איבי הנחל', 32.0994421, 34.8997538, 'data.gov.il+osm'),
  ('איבים', 'איבים', 31.5332929, 34.6100744, 'data.gov.il+osm'),
  ('אייל', 'אייל', 32.2113762, 34.9789972, 'data.gov.il+osm'),
  ('איילת השחר', 'איילת השחר', 33.0215976, 35.5759521, 'data.gov.il+osm'),
  ('אילון', 'אילון', 33.0633456, 35.2197473, 'data.gov.il+osm'),
  ('אילות', 'אילות', 29.5812438, 34.962663, 'data.gov.il+osm'),
  ('אילניה', 'אילניה', 32.754961, 35.4074724, 'data.gov.il+osm'),
  ('אילת', 'אילת', 29.5569348, 34.9497949, 'data.gov.il+osm'),
  ('אירוס', 'אירוס', 31.928452, 34.7759097, 'data.gov.il+osm'),
  ('איתמר', 'איתמר', 32.1747098, 35.309129, 'data.gov.il+osm'),
  ('איתן', 'איתן', 31.5728416, 34.7487221, 'data.gov.il+osm'),
  ('איתנים', 'איתנים', 31.7789, 35.095169, 'data.gov.il+osm'),
  ('אכסאל', 'אכסאל', 32.6815837, 35.3239769, 'data.gov.il+osm'),
  ('אל סייד', 'אל סייד', 31.281719, 34.916298, 'data.gov.il+osm'),
  ('אל עזי', 'אל-עזי', 31.71886799999999, 34.814254, 'data.gov.il+osm'),
  ('אל עריאן', 'אל-עריאן', 32.498076, 35.125094, 'data.gov.il+osm'),
  ('אל רום', 'אל-רום', 33.1796457, 35.7721224, 'data.gov.il+osm'),
  ('אלומה', 'אלומה', 31.652036, 34.7426718, 'data.gov.il+osm'),
  ('אלומות', 'אלומות', 32.7069863, 35.5462845, 'data.gov.il+osm'),
  ('אלון הגליל', 'אלון הגליל', 32.7571188, 35.2199802, 'data.gov.il+osm'),
  ('אלוני אבא', 'אלוני אבא', 32.7310157, 35.1713637, 'data.gov.il+osm'),
  ('אלוני הבשן', 'אלוני הבשן', 33.0441337, 35.83924, 'data.gov.il+osm'),
  ('אלוני יצחק', 'אלוני יצחק', 32.5106111, 35.003597, 'data.gov.il+osm'),
  ('אלונים', 'אלונים', 32.7199093, 35.1446939, 'data.gov.il+osm'),
  ('אלי עד', 'אלי-עד', 32.806583, 35.73657499999999, 'data.gov.il+osm'),
  ('אליאב', 'אליאב', 31.529931, 34.9314799, 'data.gov.il+osm'),
  ('אליכין', 'אליכין', 32.4079533, 34.9248732, 'data.gov.il+osm'),
  ('אליפז', 'אליפז', 29.7964294, 35.0119398, 'data.gov.il+osm'),
  ('אליפלט', 'אליפלט', 32.9480271, 35.547389, 'data.gov.il+osm'),
  ('אליקים', 'אליקים', 32.6327376, 35.0670512, 'data.gov.il+osm'),
  ('אלישיב', 'אלישיב', 32.3802538, 34.9092219, 'data.gov.il+osm'),
  ('אלישמע', 'אלישמע', 32.1519602, 34.9279083, 'data.gov.il+osm'),
  ('אלמגור', 'אלמגור', 32.9139417, 35.603248, 'data.gov.il+osm'),
  ('אלמוג', 'אלמוג', 31.790034, 35.461968, 'data.gov.il+osm'),
  ('אלעד', 'אלעד', 32.0500659, 34.9521522, 'data.gov.il+osm'),
  ('אלעזר', 'אלעזר', 31.659676, 35.143074, 'data.gov.il+osm'),
  ('אלפי מנשה', 'אלפי מנשה', 32.170631, 35.014858, 'data.gov.il+osm'),
  ('אלקוש', 'אלקוש', 33.0341637, 35.3241745, 'data.gov.il+osm'),
  ('אמונים', 'אמונים', 31.7453369, 34.676988, 'data.gov.il+osm'),
  ('אמירים', 'אמירים', 32.9374962, 35.4499969, 'data.gov.il+osm'),
  ('אמנון', 'אמנון', 32.9043478, 35.5705088, 'data.gov.il+osm'),
  ('אמציה', 'אמציה', 31.5324669, 34.9143066, 'data.gov.il+osm'),
  ('אניעם', 'אניעם', 32.9568708, 35.7397621, 'data.gov.il+osm'),
  ('אעבלין', 'אעבלין', 32.8213416, 35.195795, 'data.gov.il+osm'),
  ('אפיק', 'אפיק', 32.7788419, 35.7013296, 'data.gov.il+osm'),
  ('אפיקים', 'אפיקים', 32.681369, 35.5783318, 'data.gov.il+osm'),
  ('אפק', 'אפק', 32.8401655, 35.1278912, 'data.gov.il+osm'),
  ('ארבל', 'ארבל', 32.8120793, 35.4839284, 'data.gov.il+osm'),
  ('ארגמן', 'ארגמן', 32.681884, 34.93943, 'data.gov.il+osm'),
  ('ארז', 'ארז', 31.5605003, 34.5666313, 'data.gov.il+osm'),
  ('אריאל', 'אריאל', 32.1046376, 35.1745145, 'data.gov.il+osm'),
  ('ארסוף', 'ארסוף', 32.2141274, 34.8168147, 'data.gov.il+osm'),
  ('אשבול', 'אשבול', 31.4475021, 34.6664352, 'data.gov.il+osm'),
  ('אשבל', 'אשבל', 32.876801, 35.3049739, 'data.gov.il+osm'),
  ('אשדוד', 'אשדוד', 31.7977314, 34.6529922, 'data.gov.il+osm'),
  ('אשחר', 'אשחר', 32.8851173, 35.3001894, 'data.gov.il+osm'),
  ('אשכולות', 'אשכולות', 31.391171, 34.904856, 'data.gov.il+osm'),
  ('אשל הנשיא', 'אשל הנשיא', 31.3253413, 34.6977854, 'data.gov.il+osm'),
  ('אשלים', 'אשלים', 30.9638905, 34.7002742, 'data.gov.il+osm'),
  ('אשקלון', 'אשקלון', 31.6653191, 34.565044, 'data.gov.il+osm'),
  ('אשרת', 'אשרת', 32.9717328, 35.1564958, 'data.gov.il+osm'),
  ('אשתאול', 'אשתאול', 31.7801952, 35.0097885, 'data.gov.il+osm'),
  ('אתגר', 'אתגר', 32.859351, 35.256072, 'data.gov.il+osm'),
  ('באקה אל גרביה', 'באקה אל-גרביה', 32.419305, 35.035289, 'data.gov.il+osm'),
  ('באר אורה', 'באר אורה', 29.7101748, 34.986604, 'data.gov.il+osm'),
  ('באר גנים', 'באר גנים', 31.7000465, 34.610653, 'data.gov.il+osm'),
  ('באר טוביה', 'באר טוביה', 31.7338758, 34.7262903, 'data.gov.il+osm'),
  ('באר יעקב', 'באר יעקב', 31.9443532, 34.8398648, 'data.gov.il+osm'),
  ('באר מילכה', 'באר מילכה', 30.9328457, 34.4070405, 'data.gov.il+osm'),
  ('באר שבע', 'באר שבע', 31.2457442, 34.7925181, 'data.gov.il+osm'),
  ('בארות יצחק', 'בארות יצחק', 32.0393656, 34.9109112, 'data.gov.il+osm'),
  ('בארותיים', 'בארותיים', 32.3218886, 34.9828907, 'data.gov.il+osm'),
  ('בארי', 'בארי', 31.4241619, 34.4911156, 'data.gov.il+osm'),
  ('בוסתן הגליל', 'בוסתן הגליל', 32.9505232, 35.0817793, 'data.gov.il+osm'),
  ('בועיינה נוגידאת', 'בועיינה-נוג''ידאת', 32.8044208, 35.3650625, 'data.gov.il+osm'),
  ('בוקעאתא', 'בוקעאתא', 33.2026572, 35.7767723, 'data.gov.il+osm'),
  ('בורגתה', 'בורגתה', 32.3264732, 34.9629135, 'data.gov.il+osm'),
  ('בחן', 'בחן', 32.3510073, 35.019131, 'data.gov.il+osm'),
  ('בטחה', 'בטחה', 31.3342804, 34.6344922, 'data.gov.il+osm'),
  ('ביצרון', 'ביצרון', 31.7950527, 34.7392791, 'data.gov.il+osm'),
  ('ביר אל מכסור', 'ביר אל-מכסור', 32.7781997, 35.2216895, 'data.gov.il+osm'),
  ('ביריה', 'ביריה', 32.9775883, 35.5006493, 'data.gov.il+osm'),
  ('בית אורן', 'בית אורן', 32.730556, 35.005556, 'data.gov.il+osm'),
  ('בית אל', 'בית אל', 31.94159999999999, 35.222734, 'data.gov.il+osm'),
  ('בית אלעזרי', 'בית אלעזרי', 31.8460836, 34.8030534, 'data.gov.il+osm'),
  ('בית אלפא', 'בית אלפא', 32.5160003, 35.4312857, 'data.gov.il+osm'),
  ('בית ברל', 'בית ברל', 32.1997359, 34.9260732, 'data.gov.il+osm'),
  ('בית גן', 'בית ג''ן', 32.9644737, 35.3781433, 'data.gov.il+osm'),
  ('בית גוברין', 'בית גוברין', 31.6123189, 34.8964162, 'data.gov.il+osm'),
  ('בית גמליאל', 'בית גמליאל', 31.8553605, 34.7626358, 'data.gov.il+osm'),
  ('בית דגן', 'בית דגן', 32.001945, 34.8301626, 'data.gov.il+osm'),
  ('בית הגדי', 'בית הגדי', 31.4239086, 34.606739, 'data.gov.il+osm'),
  ('בית הלוי', 'בית הלוי', 32.3535046, 34.9312543, 'data.gov.il+osm'),
  ('בית הלל', 'בית הלל', 33.2083012, 35.6069281, 'data.gov.il+osm'),
  ('בית העמק', 'בית העמק', 32.9704922, 35.1461366, 'data.gov.il+osm'),
  ('בית השיטה', 'בית השיטה', 32.5510774, 35.4382178, 'data.gov.il+osm'),
  ('בית זית', 'בית זית', 31.7825806, 35.1593248, 'data.gov.il+osm'),
  ('בית זרע', 'בית זרע', 32.6882909, 35.5733669, 'data.gov.il+osm'),
  ('בית חוגלה', 'בית חוגלה', 32.38907, 34.924252, 'data.gov.il+osm'),
  ('בית חורון', 'בית חורון', 31.87989, 35.124097, 'data.gov.il+osm'),
  ('בית חירות', 'בית חירות', 32.376223, 34.873765, 'data.gov.il+osm'),
  ('בית חלקיה', 'בית חלקיה', 31.7926752, 34.8108048, 'data.gov.il+osm'),
  ('בית חנן', 'בית חנן', 31.9337581, 34.7740084, 'data.gov.il+osm'),
  ('בית חנניה', 'בית חנניה', 32.5282617, 34.92503, 'data.gov.il+osm'),
  ('בית חשמונאי', 'בית חשמונאי', 31.8880132, 34.919009, 'data.gov.il+osm'),
  ('בית יהושע', 'בית יהושע', 32.2592916, 34.8660021, 'data.gov.il+osm'),
  ('בית יוסף', 'בית יוסף', 32.5588132, 35.5523146, 'data.gov.il+osm'),
  ('בית ינאי', 'בית ינאי', 32.3775275, 34.8629629, 'data.gov.il+osm'),
  ('בית יצחק שער חפר', 'בית יצחק-שער חפר', 32.3345648, 34.8905446, 'data.gov.il+osm'),
  ('בית יתיר', 'בית יתיר', 31.365586, 35.11134, 'data.gov.il+osm'),
  ('בית לחם הגלילית', 'בית לחם הגלילית', 32.7345558, 35.1890555, 'data.gov.il+osm'),
  ('בית מאיר', 'בית מאיר', 31.7938835, 35.0360826, 'data.gov.il+osm'),
  ('בית נחמיה', 'בית נחמיה', 31.975811, 34.9550835, 'data.gov.il+osm'),
  ('בית ניר', 'בית ניר', 31.6472934, 34.874131, 'data.gov.il+osm'),
  ('בית נקופה', 'בית נקופה', 31.8028567, 35.1252694, 'data.gov.il+osm'),
  ('בית עובד', 'בית עובד', 31.921288, 34.7737889, 'data.gov.il+osm'),
  ('בית עוזיאל', 'בית עוזיאל', 31.8693965, 34.9051703, 'data.gov.il+osm'),
  ('בית עזרא', 'בית עזרא', 31.7366309, 34.6563769, 'data.gov.il+osm'),
  ('בית עריף', 'בית עריף', 31.9916349, 34.933807, 'data.gov.il+osm'),
  ('בית צבי', 'בית צבי', 32.0784145, 34.8217109, 'data.gov.il+osm'),
  ('בית קמה', 'בית קמה', 31.4475406, 34.7622872, 'data.gov.il+osm'),
  ('בית קשת', 'בית קשת', 32.7184192, 35.3954738, 'data.gov.il+osm'),
  ('בית רימון', 'בית רימון', 32.7819472, 35.3277836, 'data.gov.il+osm'),
  ('בית שאן', 'בית שאן', 32.4967519, 35.4973022, 'data.gov.il+osm'),
  ('בית שמש', 'בית שמש', 31.746214, 34.9886825, 'data.gov.il+osm'),
  ('בית שערים', 'בית שערים', 32.6961671, 35.1794979, 'data.gov.il+osm'),
  ('בית שקמה', 'בית שקמה', 31.637735, 34.610074, 'data.gov.il+osm'),
  ('ביתן אהרן', 'ביתן אהרן', 32.3660377, 34.8693, 'data.gov.il+osm'),
  ('ביתר עילית', 'ביתר עילית', 31.698, 35.113, 'compiled'),
  ('בלפוריה', 'בלפוריה', 32.6302897, 35.2970682, 'data.gov.il+osm'),
  ('בן זכאי', 'בן זכאי', 31.8568839, 34.729583, 'data.gov.il+osm'),
  ('בן עמי', 'בן עמי', 33.0042191, 35.1241783, 'data.gov.il+osm'),
  ('בני ברק', 'בני ברק', 32.0873899, 34.8324376, 'data.gov.il+osm'),
  ('בני דקלים', 'בני דקלים', 31.5174853, 34.9199141, 'data.gov.il+osm'),
  ('בני דרום', 'בני דרום', 31.8206628, 34.6915762, 'data.gov.il+osm'),
  ('בני דרור', 'בני דרור', 32.2618622, 34.900238, 'data.gov.il+osm'),
  ('בני יהודה', 'בני יהודה', 32.7984155, 35.6902145, 'data.gov.il+osm'),
  ('בני נצרים', 'בני נצרים', 31.140986, 34.3147298, 'data.gov.il+osm'),
  ('בני עטרות', 'בני עטרות', 32.0235637, 34.9118719, 'data.gov.il+osm'),
  ('בני עיש', 'בני עיש', 31.789097, 34.7599195, 'data.gov.il+osm'),
  ('בני ציון', 'בני ציון', 32.2203585, 34.8686714, 'data.gov.il+osm'),
  ('בני ראם', 'בני ראם', 31.7697849, 34.79065, 'data.gov.il+osm'),
  ('בניה', 'בניה', 31.8434985, 34.753611, 'data.gov.il+osm'),
  ('בנימינה', 'בנימינה', 32.515, 34.949, 'compiled'),
  ('בנימינה גבעת עדה', 'בנימינה-גבעת עדה', 32.5202891, 34.9435862, 'data.gov.il+osm'),
  ('בסמה', 'בסמה', 32.52940100000001, 35.103199, 'data.gov.il+osm'),
  ('בסמת טבעון', 'בסמת טבעון', 32.7362276, 35.1546502, 'data.gov.il+osm'),
  ('בענה', 'בענה', 32.929538, 35.27191699999999, 'data.gov.il+osm'),
  ('בצרה', 'בצרה', 32.2143238, 34.8779919, 'data.gov.il+osm'),
  ('בצת', 'בצת', 33.0708449, 35.136107, 'data.gov.il+osm'),
  ('בקוע', 'בקוע', 31.8294277, 34.9270405, 'data.gov.il+osm'),
  ('בר גיורא', 'בר גיורא', 31.7298209, 35.0726527, 'data.gov.il+osm'),
  ('בר יוחאי', 'בר יוחאי', 32.9970032, 35.4481169, 'data.gov.il+osm'),
  ('בר כוכבא', 'בר כוכבא', 31.6831332, 34.5690895, 'data.gov.il+osm'),
  ('ברוכין', 'ברוכין', 32.082231, 35.094113, 'data.gov.il+osm'),
  ('ברור חיל', 'ברור חיל', 31.5597901, 34.6491564, 'data.gov.il+osm'),
  ('ברוש', 'ברוש', 31.3706542, 34.6350858, 'data.gov.il+osm'),
  ('ברכיה', 'ברכיה', 31.6678257, 34.6268196, 'data.gov.il+osm'),
  ('ברעם', 'ברעם', 33.0586061, 35.4338884, 'data.gov.il+osm'),
  ('ברק', 'ברק', 32.5424671, 35.2653811, 'data.gov.il+osm'),
  ('ברקאי', 'ברקאי', 32.475134, 35.0300253, 'data.gov.il+osm'),
  ('ברקן', 'ברקן', 32.109487, 35.106008, 'data.gov.il+osm'),
  ('ברקת', 'ברקת', 32.0188526, 34.943779, 'data.gov.il+osm'),
  ('בת הדר', 'בת הדר', 31.646519, 34.5960329, 'data.gov.il+osm'),
  ('בת חן', 'בת חן', 32.3602692, 34.8723281, 'data.gov.il+osm'),
  ('בת חפר', 'בת חפר', 32.3345015, 35.012351, 'data.gov.il+osm'),
  ('בת ים', 'בת ים', 32.0154565, 34.7505283, 'data.gov.il+osm'),
  ('בת שלמה', 'בת שלמה', 32.5994386, 35.0029516, 'data.gov.il+osm'),
  ('גדיידה מכר', 'ג''דיידה-מכר', 32.928656, 35.150573, 'data.gov.il+osm'),
  ('גולס', 'ג''ולס', 32.9430618, 35.1869431, 'data.gov.il+osm'),
  ('גלגוליה', 'ג''לג''וליה', 32.1524568, 34.9539749, 'data.gov.il+osm'),
  ('גסר א זרקא', 'ג''סר א-זרקא', 32.536262, 34.911569, 'data.gov.il+osm'),
  ('גש גוש חלב', 'ג''ש (גוש חלב)', 33.021266, 35.447949, 'data.gov.il+osm'),
  ('גת', 'ג''ת', 32.397285, 35.034889, 'data.gov.il+osm'),
  ('גאולי תימן', 'גאולי תימן', 32.3920841, 34.9012083, 'data.gov.il+osm'),
  ('גאולים', 'גאולים', 32.2962452, 34.9474014, 'data.gov.il+osm'),
  ('גאליה', 'גאליה', 31.8846855, 34.764843, 'data.gov.il+osm'),
  ('גבולות', 'גבולות', 31.2111135, 34.4652467, 'data.gov.il+osm'),
  ('גבים', 'גבים', 31.5067391, 34.5991766, 'data.gov.il+osm'),
  ('גבע', 'גבע', 32.5663362, 35.3715486, 'data.gov.il+osm'),
  ('גבע בנימין', 'גבע בנימין', 31.849999, 35.273853, 'data.gov.il+osm'),
  ('גבע כרמל', 'גבע כרמל', 32.6636235, 34.9549687, 'data.gov.il+osm'),
  ('גבעולים', 'גבעולים', 31.3963714, 34.5915141, 'data.gov.il+osm'),
  ('גבעון החדשה', 'גבעון החדשה', 31.848896, 35.159029, 'data.gov.il+osm'),
  ('גבעות בר', 'גבעות בר', 31.3556259, 34.7592233, 'data.gov.il+osm'),
  ('גבעות עדן', 'גבעות עדן', 31.6605794, 35.0157215, 'data.gov.il+osm'),
  ('גבעת אבני', 'גבעת אבני', 32.774457, 35.4383706, 'data.gov.il+osm'),
  ('גבעת אלה', 'גבעת אלה', 32.7208483, 35.2448953, 'data.gov.il+osm'),
  ('גבעת ברנר', 'גבעת ברנר', 31.8675206, 34.8004909, 'data.gov.il+osm'),
  ('גבעת השלושה', 'גבעת השלושה', 32.0980886, 34.9211469, 'data.gov.il+osm'),
  ('גבעת זאב', 'גבעת זאב', 31.861189, 35.167252, 'data.gov.il+osm'),
  ('גבעת חיים איחוד', 'גבעת חיים (איחוד)', 32.4002771, 34.9330496, 'data.gov.il+osm'),
  ('גבעת חיים מאוחד', 'גבעת חיים (מאוחד)', 32.3918515, 34.931902, 'data.gov.il+osm'),
  ('גבעת חן', 'גבעת חן', 32.16758, 34.875514, 'data.gov.il+osm'),
  ('גבעת יואב', 'גבעת יואב', 32.7967624, 35.681303, 'data.gov.il+osm'),
  ('גבעת יערים', 'גבעת יערים', 31.7859942, 35.092569, 'data.gov.il+osm'),
  ('גבעת ישעיהו', 'גבעת ישעיהו', 31.6702146, 34.9462929, 'data.gov.il+osm'),
  ('גבעת כח', 'גבעת כח', 32.0302781, 34.936667, 'data.gov.il+osm'),
  ('גבעת נילי', 'גבעת נילי', 32.549043, 35.041194, 'data.gov.il+osm'),
  ('גבעת עוז', 'גבעת עוז', 32.5558926, 35.1986272, 'data.gov.il+osm'),
  ('גבעת שמואל', 'גבעת שמואל', 32.0769463, 34.8524656, 'data.gov.il+osm'),
  ('גבעת שמש', 'גבעת שמש', 31.774189, 34.95055, 'data.gov.il+osm'),
  ('גבעת שפירא', 'גבעת שפירא', 32.3578622, 34.8762757, 'data.gov.il+osm'),
  ('גבעתי', 'גבעתי', 31.7340046, 34.6793054, 'data.gov.il+osm'),
  ('גבעתיים', 'גבעתיים', 32.0729606, 34.8113279, 'data.gov.il+osm'),
  ('גברעם', 'גברעם', 31.5909454, 34.6115031, 'data.gov.il+osm'),
  ('גבת', 'גבת', 32.6747246, 35.2107773, 'data.gov.il+osm'),
  ('גדות', 'גדות', 33.0180702, 35.6189207, 'data.gov.il+osm'),
  ('גדיש', 'גדיש', 32.5588503, 35.2448954, 'data.gov.il+osm'),
  ('גדעונה', 'גדעונה', 32.5487479, 35.359246, 'data.gov.il+osm'),
  ('גדרה', 'גדרה', 31.8117747, 34.7803882, 'data.gov.il+osm'),
  ('גונן', 'גונן', 33.1238763, 35.6462866, 'data.gov.il+osm'),
  ('גורן', 'גורן', 33.0563927, 35.2369919, 'data.gov.il+osm'),
  ('גורנות הגליל', 'גורנות הגליל', 33.0593304, 35.2496612, 'data.gov.il+osm'),
  ('גזית', 'גזית', 32.6382136, 35.446739, 'data.gov.il+osm'),
  ('גזר', 'גזר', 31.8770069, 34.9208529, 'data.gov.il+osm'),
  ('גיאה', 'גיאה', 31.6275573, 34.6024158, 'data.gov.il+osm'),
  ('גיבתון', 'גיבתון', 31.8888206, 34.7994843, 'data.gov.il+osm'),
  ('גיזו', 'גיזו', 31.8041199, 34.9380852, 'data.gov.il+osm'),
  ('גילון', 'גילון', 32.9029028, 35.2354622, 'data.gov.il+osm'),
  ('גילת', 'גילת', 31.329171, 34.6516508, 'data.gov.il+osm'),
  ('גינוסר', 'גינוסר', 32.8476404, 35.5236258, 'data.gov.il+osm'),
  ('גיניגר', 'גיניגר', 32.663419, 35.259861, 'data.gov.il+osm'),
  ('גינתון', 'גינתון', 31.9623127, 34.9139386, 'data.gov.il+osm'),
  ('גיתה', 'גיתה', 32.9672482, 35.249074, 'data.gov.il+osm'),
  ('גיתית', 'גיתית', 32.10027300000001, 35.395443, 'data.gov.il+osm'),
  ('גלאון', 'גלאון', 31.6340593, 34.8490324, 'data.gov.il+osm'),
  ('גליל ים', 'גליל ים', 32.1568799, 34.8299871, 'data.gov.il+osm'),
  ('גלעד אבן יצחק', 'גלעד (אבן יצחק)', 32.558075, 35.076559, 'data.gov.il+osm'),
  ('גמזו', 'גמזו', 31.9276731, 34.9418915, 'data.gov.il+osm'),
  ('גן הדרום', 'גן הדרום', 31.803614, 34.6997994, 'data.gov.il+osm'),
  ('גן השומרון', 'גן השומרון', 32.4639095, 34.9984491, 'data.gov.il+osm'),
  ('גן חיים', 'גן חיים', 32.1950979, 34.9054806, 'data.gov.il+osm'),
  ('גן יאשיה', 'גן יאשיה', 32.3506691, 34.9954017, 'data.gov.il+osm'),
  ('גן יבנה', 'גן יבנה', 31.787109, 34.7096635, 'data.gov.il+osm'),
  ('גן נר', 'גן נר', 32.5308688, 35.3391118, 'data.gov.il+osm'),
  ('גן שורק', 'גן שורק', 31.9447315, 34.7599212, 'data.gov.il+osm'),
  ('גן שלמה', 'גן שלמה', 31.878777, 34.798901, 'data.gov.il+osm'),
  ('גן שמואל', 'גן שמואל', 32.451832, 34.9498546, 'data.gov.il+osm'),
  ('גנות', 'גנות', 32.0189905, 34.8267021, 'data.gov.il+osm'),
  ('גנות הדר', 'גנות הדר', 32.3195061, 34.9001402, 'data.gov.il+osm'),
  ('גני הדר', 'גני הדר', 31.8792591, 34.8530401, 'data.gov.il+osm'),
  ('גני טל', 'גני טל', 31.7886881, 34.791191, 'data.gov.il+osm'),
  ('גני יוחנן', 'גני יוחנן', 31.86029, 34.8407361, 'data.gov.il+osm'),
  ('גני מודיעין', 'גני מודיעין', 31.9297927, 35.0176666, 'data.gov.il+osm'),
  ('גני עם', 'גני עם', 32.151417, 34.9017297, 'data.gov.il+osm'),
  ('גני תקווה', 'גני תקווה', 32.0604256, 34.8760954, 'data.gov.il+osm'),
  ('געש', 'געש', 32.2288879, 34.8234798, 'data.gov.il+osm'),
  ('געתון', 'געתון', 33.0057124, 35.2137501, 'data.gov.il+osm'),
  ('גפן', 'גפן', 31.7404809, 34.8792303, 'data.gov.il+osm'),
  ('גרופית', 'גרופית', 29.941716, 35.0642049, 'data.gov.il+osm'),
  ('גשור', 'גשור', 32.8191803, 35.716008, 'data.gov.il+osm'),
  ('גשר', 'גשר', 32.6206515, 35.5520809, 'data.gov.il+osm'),
  ('גשר הזיו', 'גשר הזיו', 33.0394679, 35.1109814, 'data.gov.il+osm'),
  ('גת קיבוץ', 'גת (קיבוץ)', 31.627796, 34.794112, 'data.gov.il+osm'),
  ('גת רימון', 'גת רימון', 32.0674422, 34.8805118, 'data.gov.il+osm'),
  ('דאלית אל כרמל', 'דאלית אל-כרמל', 32.6922393, 35.0482785, 'data.gov.il+osm'),
  ('דבורה', 'דבורה', 32.553108, 35.2635109, 'data.gov.il+osm'),
  ('דבוריה', 'דבוריה', 32.6909133, 35.371153, 'data.gov.il+osm'),
  ('דביר', 'דביר', 31.4134736, 34.8232634, 'data.gov.il+osm'),
  ('דברת', 'דברת', 32.6479447, 35.3505185, 'data.gov.il+osm'),
  ('דגניה א', 'דגניה א''', 32.7084791, 35.5748582, 'data.gov.il+osm'),
  ('דגניה ב', 'דגניה ב''', 32.6999198, 35.5747095, 'data.gov.il+osm'),
  ('דובב', 'דובב', 33.0524574, 35.4074874, 'data.gov.il+osm'),
  ('דור', 'דור', 32.6075668, 34.9230461, 'data.gov.il+osm'),
  ('דורות', 'דורות', 31.506606, 34.645993, 'data.gov.il+osm'),
  ('דחי', 'דחי', 32.6203995, 35.3449947, 'data.gov.il+osm'),
  ('דייר אל אסד', 'דייר אל-אסד', 32.93445, 35.268394, 'data.gov.il+osm'),
  ('דייר חנא', 'דייר חנא', 32.8625037, 35.3666613, 'data.gov.il+osm'),
  ('דייר ראפאת', 'דייר ראפאת', 31.77652999999999, 34.947439, 'data.gov.il+osm'),
  ('דימונה', 'דימונה', 31.0686612, 35.0366482, 'data.gov.il+osm'),
  ('דישון', 'דישון', 33.0813243, 35.5175202, 'data.gov.il+osm'),
  ('דליה', 'דליה', 32.589315, 35.0758253, 'data.gov.il+osm'),
  ('דלתון', 'דלתון', 33.0166712, 35.4891906, 'data.gov.il+osm'),
  ('דמיידה', 'דמיידה', 32.8149647, 35.2265642, 'data.gov.il+osm'),
  ('דן', 'דן', 33.2400913, 35.6530878, 'data.gov.il+osm'),
  ('דפנה', 'דפנה', 33.2303715, 35.6392634, 'data.gov.il+osm'),
  ('דקל', 'דקל', 31.194067, 34.3478622, 'data.gov.il+osm'),
  ('דריגאת', 'דריג''את', 31.301885, 35.076793, 'data.gov.il+osm'),
  ('האון', 'האון', 32.7269806, 35.6236405, 'data.gov.il+osm'),
  ('הבונים', 'הבונים', 32.6371881, 34.9327996, 'data.gov.il+osm'),
  ('הגושרים', 'הגושרים', 33.2211258, 35.6230745, 'data.gov.il+osm'),
  ('הדר עם', 'הדר עם', 32.3490842, 34.9005646, 'data.gov.il+osm'),
  ('הוד השרון', 'הוד השרון', 32.1561974, 34.8930354, 'data.gov.il+osm'),
  ('הודיה', 'הודיה', 31.6756487, 34.6398404, 'data.gov.il+osm'),
  ('הודיות', 'הודיות', 32.788611, 35.435, 'data.gov.il+osm'),
  ('הושעיה', 'הושעיה', 32.7585699, 35.2932906, 'data.gov.il+osm'),
  ('הזורע', 'הזורע', 32.6437923, 35.1206465, 'data.gov.il+osm'),
  ('הזורעים', 'הזורעים', 32.7457141, 35.5031884, 'data.gov.il+osm'),
  ('החותרים', 'החותרים', 32.7514976, 34.9567795, 'data.gov.il+osm'),
  ('היוגב', 'היוגב', 32.6114253, 35.2056603, 'data.gov.il+osm'),
  ('המעפיל', 'המעפיל', 32.3783322, 34.9839792, 'data.gov.il+osm'),
  ('הסוללים', 'הסוללים', 32.751099, 35.238324, 'data.gov.il+osm'),
  ('העוגן', 'העוגן', 32.3619422, 34.9231606, 'data.gov.il+osm'),
  ('הר אדר', 'הר אדר', 31.824501, 35.12966, 'data.gov.il+osm'),
  ('הר גילה', 'הר גילה', 31.722058, 35.171491, 'data.gov.il+osm'),
  ('הר עמשא', 'הר עמשא', 31.3426169, 35.1021887, 'data.gov.il+osm'),
  ('הראל', 'הראל', 31.8093796, 34.9490776, 'data.gov.il+osm'),
  ('הרדוף', 'הרדוף', 32.7641117, 35.1728315, 'data.gov.il+osm'),
  ('הרצליה', 'הרצליה', 32.1656255, 34.8469023, 'data.gov.il+osm'),
  ('הררית', 'הררית', 32.8457853, 35.369171, 'data.gov.il+osm'),
  ('ורדון', 'ורדון', 31.6635292, 34.7821917, 'data.gov.il+osm'),
  ('זבדיאל', 'זבדיאל', 31.6584287, 34.759748, 'data.gov.il+osm'),
  ('זוהר', 'זוהר', 31.5956483, 34.6937036, 'data.gov.il+osm'),
  ('זיקים', 'זיקים', 31.609373, 34.5221474, 'data.gov.il+osm'),
  ('זיתן', 'זיתן', 31.9753923, 34.891423, 'data.gov.il+osm'),
  ('זכרון יעקב', 'זכרון יעקב', 32.5711587, 34.9529966, 'data.gov.il+osm'),
  ('זכריה', 'זכריה', 31.7097914, 34.944079, 'data.gov.il+osm'),
  ('זמר', 'זמר', 32.3675163, 35.0329957, 'data.gov.il+osm'),
  ('זמרת', 'זמרת', 31.4472752, 34.55233, 'data.gov.il+osm'),
  ('זנוח', 'זנוח', 31.7315665, 35.0007321, 'data.gov.il+osm'),
  ('זרועה', 'זרועה', 31.4593766, 34.6235081, 'data.gov.il+osm'),
  ('זרזיר', 'זרזיר', 32.7274275, 35.2133545, 'data.gov.il+osm'),
  ('זרחיה', 'זרחיה', 31.6806835, 34.7455072, 'data.gov.il+osm'),
  ('חבצלת השרון', 'חבצלת השרון', 32.3610498, 34.8616896, 'data.gov.il+osm'),
  ('חבר', 'חבר', 32.5487129, 35.2643296, 'data.gov.il+osm'),
  ('חברון', 'חברון', 32.232209, 34.945701, 'data.gov.il+osm'),
  ('חגור', 'חגור', 32.1375681, 34.9481658, 'data.gov.il+osm'),
  ('חגי', 'חגי', 31.49253, 35.07953699999999, 'data.gov.il+osm'),
  ('חגלה', 'חגלה', 32.3875165, 34.9257315, 'data.gov.il+osm'),
  ('חד נס', 'חד-נס', 32.927514, 35.641408, 'data.gov.il+osm'),
  ('חדיד', 'חדיד', 31.9682459, 34.9337333, 'data.gov.il+osm'),
  ('חדרה', 'חדרה', 32.43699, 34.9198258, 'data.gov.il+osm'),
  ('חוגייראת דהרה', 'חוג''ייראת (ד''הרה)', 32.835166, 35.289241, 'data.gov.il+osm'),
  ('חולדה', 'חולדה', 31.8311138, 34.8828125, 'data.gov.il+osm'),
  ('חולון', 'חולון', 32.0193121, 34.7804076, 'data.gov.il+osm'),
  ('חולית', 'חולית', 31.2318728, 34.3265102, 'data.gov.il+osm'),
  ('חולתה', 'חולתה', 33.0511117, 35.6091616, 'data.gov.il+osm'),
  ('חוסן', 'חוסן', 32.9975754, 35.2979856, 'data.gov.il+osm'),
  ('חוסנייה', 'חוסנייה', 32.8993807, 35.3215263, 'data.gov.il+osm'),
  ('חופית', 'חופית', 32.3856586, 34.8755505, 'data.gov.il+osm'),
  ('חוקוק', 'חוקוק', 32.8800375, 35.4944564, 'data.gov.il+osm'),
  ('חורה', 'חורה', 31.2972468, 34.9379061, 'data.gov.il+osm'),
  ('חורפיש', 'חורפיש', 33.01737, 35.3469551, 'data.gov.il+osm'),
  ('חורשים', 'חורשים', 32.1372148, 34.9706974, 'data.gov.il+osm'),
  ('חזון', 'חזון', 32.9067724, 35.394977, 'data.gov.il+osm'),
  ('חיבת ציון', 'חיבת ציון', 32.3987871, 34.9120169, 'data.gov.il+osm'),
  ('חיננית', 'חיננית', 32.480891, 35.173181, 'data.gov.il+osm'),
  ('חיפה', 'חיפה', 32.8191218, 34.9983856, 'data.gov.il+osm'),
  ('חירות', 'חירות', 32.2402969, 34.9150051, 'data.gov.il+osm'),
  ('חלוץ', 'חלוץ', 32.95055, 35.312278, 'data.gov.il+osm'),
  ('חלץ', 'חלץ', 31.5774293, 34.6575334, 'data.gov.il+osm'),
  ('חמאם', 'חמאם', 32.8295555, 35.4903983, 'data.gov.il+osm'),
  ('חמד', 'חמד', 32.0190455, 34.8412271, 'data.gov.il+osm'),
  ('חמדיה', 'חמדיה', 32.5201037, 35.5203765, 'data.gov.il+osm'),
  ('חניאל', 'חניאל', 32.3321351, 34.9485815, 'data.gov.il+osm'),
  ('חניתה', 'חניתה', 33.0874108, 35.1733471, 'data.gov.il+osm'),
  ('חנתון', 'חנתון', 32.7826077, 35.2458555, 'data.gov.il+osm'),
  ('חספין', 'חספין', 32.8456305, 35.7929907, 'data.gov.il+osm'),
  ('חפץ חיים', 'חפץ חיים', 31.788823, 34.8000445, 'data.gov.il+osm'),
  ('חפצי בה', 'חפצי-בה', 32.518729, 35.426247, 'data.gov.il+osm'),
  ('חצב', 'חצב', 31.7792702, 34.7693634, 'data.gov.il+osm'),
  ('חצבה', 'חצבה', 30.7677164, 35.2796246, 'data.gov.il+osm'),
  ('חצור הגלילית', 'חצור הגלילית', 32.9791697, 35.543327, 'data.gov.il+osm'),
  ('חצור אשדוד', 'חצור-אשדוד', 31.772744, 34.719366, 'data.gov.il+osm'),
  ('חצרים', 'חצרים', 31.24041, 34.7150744, 'data.gov.il+osm'),
  ('חרב לאת', 'חרב לאת', 32.4012716, 34.9170982, 'data.gov.il+osm'),
  ('חרוצים', 'חרוצים', 32.2275023, 34.8641079, 'data.gov.il+osm'),
  ('חריש', 'חריש', 32.45964, 35.0510843, 'data.gov.il+osm'),
  ('חרמש', 'חרמש', 32.423726, 35.118993, 'data.gov.il+osm'),
  ('חרשים', 'חרשים', 32.9569673, 35.3279785, 'data.gov.il+osm'),
  ('חשמונאים', 'חשמונאים', 31.93263099999999, 35.023269, 'data.gov.il+osm'),
  ('טבריה', 'טבריה', 32.7938522, 35.5328566, 'data.gov.il+osm'),
  ('טובא זנגריה', 'טובא-זנגריה', 32.96621, 35.592018, 'data.gov.il+osm'),
  ('טורעאן', 'טורעאן', 32.7772712, 35.3725219, 'data.gov.il+osm'),
  ('טייבה', 'טייבה', 32.267, 35.01, 'compiled'),
  ('טירה', 'טירה', 32.234, 34.951, 'compiled'),
  ('טירת יהודה', 'טירת יהודה', 32.0140654, 34.9333804, 'data.gov.il+osm'),
  ('טירת כרמל', 'טירת כרמל', 32.7613834, 34.9715506, 'data.gov.il+osm'),
  ('טירת צבי', 'טירת צבי', 32.4218582, 35.5279708, 'data.gov.il+osm'),
  ('טל מנשה', 'טל מנשה', 32.483124, 35.160699, 'data.gov.il+osm'),
  ('טל שחר', 'טל שחר', 31.80506, 34.9022119, 'data.gov.il+osm'),
  ('טל אל', 'טל-אל', 32.9272624, 35.1772552, 'data.gov.il+osm'),
  ('טללים', 'טללים', 30.9919058, 34.7700732, 'data.gov.il+osm'),
  ('טמרה', 'טמרה', 32.853, 35.198, 'compiled'),
  ('טמרה יזרעאל', 'טמרה (יזרעאל)', 32.634918, 35.402699, 'data.gov.il+osm'),
  ('טנא', 'טנא', 31.376132, 34.957383, 'data.gov.il+osm'),
  ('טפחות', 'טפחות', 32.8684279, 35.4238096, 'data.gov.il+osm'),
  ('יאנוח גת', 'יאנוח-ג''ת', 32.981568, 35.241169, 'data.gov.il+osm'),
  ('יבול', 'יבול', 31.1887802, 34.3203981, 'data.gov.il+osm'),
  ('יבנאל', 'יבנאל', 32.7054565, 35.5052619, 'data.gov.il+osm'),
  ('יבנה', 'יבנה', 31.8768863, 34.7382974, 'data.gov.il+osm'),
  ('יגור', 'יגור', 32.7428565, 35.0781325, 'data.gov.il+osm'),
  ('יגל', 'יגל', 31.9870408, 34.8806084, 'data.gov.il+osm'),
  ('יד בנימין', 'יד בנימין', 31.7978401, 34.8216119, 'data.gov.il+osm'),
  ('יד השמונה', 'יד השמונה', 31.8094724, 35.0901961, 'data.gov.il+osm'),
  ('יד חנה', 'יד חנה', 32.3255163, 35.0060999, 'data.gov.il+osm'),
  ('יד מרדכי', 'יד מרדכי', 31.5886771, 34.5589997, 'data.gov.il+osm'),
  ('יד נתן', 'יד נתן', 31.6528819, 34.7055051, 'data.gov.il+osm'),
  ('יד רמבם', 'יד רמבם', 31.8993715, 34.9007465, 'data.gov.il+osm'),
  ('ידידה', 'ידידה', 31.812281, 35.104639, 'data.gov.il+osm'),
  ('יהוד מונוסון', 'יהוד־מונוסון', 32.0331756, 34.8907527, 'data.gov.il+osm'),
  ('יהוד', 'יהוד־מונוסון', 32.0331756, 34.8907527, 'data.gov.il+osm'),
  ('יהל', 'יהל', 30.0819416, 35.1287689, 'data.gov.il+osm'),
  ('יובל', 'יובל', 33.246577, 35.597063, 'data.gov.il+osm'),
  ('יובלים', 'יובלים', 32.8775051, 35.2705626, 'data.gov.il+osm'),
  ('יודפת', 'יודפת', 32.8372367, 35.2715538, 'data.gov.il+osm'),
  ('יונתן', 'יונתן', 32.9384707, 35.794963, 'data.gov.il+osm'),
  ('יושיביה', 'יושיביה', 31.4435485, 34.6091452, 'data.gov.il+osm'),
  ('יזרעאל', 'יזרעאל', 32.5623514, 35.32134, 'data.gov.il+osm'),
  ('יחיעם', 'יחיעם', 32.9967146, 35.2204512, 'data.gov.il+osm'),
  ('יטבתה', 'יטבתה', 29.8959204, 35.0596217, 'data.gov.il+osm'),
  ('ייטב', 'ייטב', 31.947215, 35.422375, 'data.gov.il+osm'),
  ('יכיני', 'יכיני', 31.4832232, 34.6000858, 'data.gov.il+osm'),
  ('ינוב', 'ינוב', 32.3060551, 34.9504619, 'data.gov.il+osm'),
  ('ינון', 'ינון', 31.7429158, 34.7795177, 'data.gov.il+osm'),
  ('יסוד המעלה', 'יסוד המעלה', 33.0573811, 35.6030157, 'data.gov.il+osm'),
  ('יסודות', 'יסודות', 31.8149319, 34.8661654, 'data.gov.il+osm'),
  ('יסעור', 'יסעור', 32.9010935, 35.1663465, 'data.gov.il+osm'),
  ('יעד', 'יעד', 32.8782597, 35.2435683, 'data.gov.il+osm'),
  ('יעל', 'יעל', 32.5519235, 35.3079001, 'data.gov.il+osm'),
  ('יעף', 'יעף', 32.2683414, 34.9659156, 'data.gov.il+osm'),
  ('יערה', 'יערה', 33.0674207, 35.1858477, 'data.gov.il+osm'),
  ('יפיע', 'יפיע', 32.695002, 35.28201, 'data.gov.il+osm'),
  ('יפעת', 'יפעת', 32.6771965, 35.2238731, 'data.gov.il+osm'),
  ('יפתח', 'יפתח', 33.1286135, 35.5519473, 'data.gov.il+osm'),
  ('יציץ', 'יציץ', 31.8623432, 34.8629537, 'data.gov.il+osm'),
  ('יקום', 'יקום', 32.2485734, 34.842087, 'data.gov.il+osm'),
  ('יקיר', 'יקיר', 32.741532, 35.076826, 'data.gov.il+osm'),
  ('יקנעם מושבה', 'יקנעם (מושבה)', 32.654217, 35.116758, 'data.gov.il+osm'),
  ('יקנעם עילית', 'יקנעם עילית', 32.6480601, 35.0943545, 'data.gov.il+osm'),
  ('יקנעם', 'יקנעם עילית', 32.6480601, 35.0943545, 'data.gov.il+osm'),
  ('יראון', 'יראון', 33.0777838, 35.455753, 'data.gov.il+osm'),
  ('ירדנה', 'ירדנה', 32.5644389, 35.5645775, 'data.gov.il+osm'),
  ('ירוחם', 'ירוחם', 30.9888033, 34.9250975, 'data.gov.il+osm'),
  ('ירושלים', 'ירושלים', 31.7788472, 35.2257856, 'data.gov.il+osm'),
  ('י ם', 'ירושלים', 31.7788472, 35.2257856, 'data.gov.il+osm'),
  ('ירושלם', 'ירושלים', 31.7788472, 35.2257856, 'data.gov.il+osm'),
  ('ירחיב', 'ירחיב', 32.1531458, 34.9683081, 'data.gov.il+osm'),
  ('ירכא', 'ירכא', 32.953492, 35.21199, 'data.gov.il+osm'),
  ('ירקונה', 'ירקונה', 32.1459841, 34.8987981, 'data.gov.il+osm'),
  ('ישע', 'ישע', 31.246415, 34.4032541, 'data.gov.il+osm'),
  ('ישעי', 'ישעי', 31.7516368, 34.965419, 'data.gov.il+osm'),
  ('ישרש', 'ישרש', 31.915785, 34.8499267, 'data.gov.il+osm'),
  ('יתד', 'יתד', 31.2059601, 34.3274363, 'data.gov.il+osm'),
  ('כאבול', 'כאבול', 32.8677008, 35.2100551, 'data.gov.il+osm'),
  ('כאוכב אבו אל היגא', 'כאוכב אבו אל-היג''א', 32.831888, 35.248701, 'data.gov.il+osm'),
  ('כברי', 'כברי', 33.0214987, 35.1485013, 'data.gov.il+osm'),
  ('כדורי', 'כדורי', 32.703902, 35.4066677, 'data.gov.il+osm'),
  ('כדיתה', 'כדיתה', 33.0066179, 35.4667726, 'data.gov.il+osm'),
  ('כוכב השחר', 'כוכב השחר', 31.960264, 35.349421, 'data.gov.il+osm'),
  ('כוכב יאיר צור יגאל', 'כוכב יאיר-צור יגאל', 32.2187323, 34.9834782, 'data.gov.il+osm'),
  ('כוכב יעקב', 'כוכב יעקב', 31.880152, 35.242773, 'data.gov.il+osm'),
  ('כוכב מיכאל', 'כוכב מיכאל', 31.6274859, 34.6670889, 'data.gov.il+osm'),
  ('כורזים', 'כורזים', 32.9109804, 35.5526611, 'data.gov.il+osm'),
  ('כחל', 'כחל', 32.8913179, 35.5107113, 'data.gov.il+osm'),
  ('כחלה', 'כחלה', 31.287112, 35.048572, 'data.gov.il+osm'),
  ('כיסופים', 'כיסופים', 31.3741608, 34.3994488, 'data.gov.il+osm'),
  ('כישור', 'כישור', 32.945775, 35.2495375, 'data.gov.il+osm'),
  ('כליל', 'כליל', 32.9855303, 35.2004778, 'data.gov.il+osm'),
  ('כלנית', 'כלנית', 32.8749932, 35.4527711, 'data.gov.il+osm'),
  ('כמאנה', 'כמאנה', 32.909311, 35.336928, 'data.gov.il+osm'),
  ('כמהין', 'כמהין', 30.9100139, 34.4310272, 'data.gov.il+osm'),
  ('כמון', 'כמון', 32.9113891, 35.3612558, 'data.gov.il+osm'),
  ('כנות', 'כנות', 31.8026404, 34.752375, 'data.gov.il+osm'),
  ('כנף', 'כנף', 32.8700272, 35.6982707, 'data.gov.il+osm'),
  ('כסיפה', 'כסיפה', 31.2465374, 35.0930574, 'data.gov.il+osm'),
  ('כסלון', 'כסלון', 31.7740865, 35.0492326, 'data.gov.il+osm'),
  ('כסרא סמיע', 'כסרא-סמיע', 32.9646608, 35.3038834, 'data.gov.il+osm'),
  ('כעביה טבאש חגאגרה', 'כעביה-טבאש-חג''אג''רה', 32.748016, 35.171925, 'data.gov.il+osm'),
  ('כפר אביב', 'כפר אביב', 31.8318165, 34.7213367, 'data.gov.il+osm'),
  ('כפר אוריה', 'כפר אוריה', 31.7919952, 34.9465718, 'data.gov.il+osm'),
  ('כפר אחים', 'כפר אחים', 31.7448291, 34.7563983, 'data.gov.il+osm'),
  ('כפר ביאליק', 'כפר ביאליק', 32.8203929, 35.0869133, 'data.gov.il+osm'),
  ('כפר בילו', 'כפר בילו', 31.870475, 34.826734, 'data.gov.il+osm'),
  ('כפר בלום', 'כפר בלום', 33.1723656, 35.6101218, 'data.gov.il+osm'),
  ('כפר בן נון', 'כפר בן נון', 31.861679, 34.947191, 'data.gov.il+osm'),
  ('כפר ברא', 'כפר ברא', 32.130911, 34.970108, 'data.gov.il+osm'),
  ('כפר ברוך', 'כפר ברוך', 32.6460182, 35.1930067, 'data.gov.il+osm'),
  ('כפר גדעון', 'כפר גדעון', 32.6429826, 35.2915832, 'data.gov.il+osm'),
  ('כפר גלים', 'כפר גלים', 32.7665815, 34.9593308, 'data.gov.il+osm'),
  ('כפר גליקסון', 'כפר גליקסון', 32.504959, 35.004799, 'data.gov.il+osm'),
  ('כפר גלעדי', 'כפר גלעדי', 33.2417843, 35.5749608, 'data.gov.il+osm'),
  ('כפר דניאל', 'כפר דניאל', 31.9332996, 34.9326218, 'data.gov.il+osm'),
  ('כפר החורש', 'כפר החורש', 32.7013318, 35.2741896, 'data.gov.il+osm'),
  ('כפר המכבי', 'כפר המכבי', 32.7910628, 35.1149003, 'data.gov.il+osm'),
  ('כפר הנגיד', 'כפר הנגיד', 31.886691, 34.7495578, 'data.gov.il+osm'),
  ('כפר הנוער הדתי', 'כפר הנוער הדתי', 32.7426708, 35.1014038, 'data.gov.il+osm'),
  ('כפר הנשיא', 'כפר הנשיא', 32.9748875, 35.6038283, 'data.gov.il+osm'),
  ('כפר הס', 'כפר הס', 32.2457804, 34.9339746, 'data.gov.il+osm'),
  ('כפר הריף', 'כפר הריף', 31.747029, 34.790928, 'data.gov.il+osm'),
  ('כפר ויתקין', 'כפר ויתקין', 32.3809359, 34.8751918, 'data.gov.il+osm'),
  ('כפר ורבורג', 'כפר ורבורג', 31.7199638, 34.7241807, 'data.gov.il+osm'),
  ('כפר ורדים', 'כפר ורדים', 32.9972507, 35.2725342, 'data.gov.il+osm'),
  ('כפר זוהרים', 'כפר זוהרים', 31.622631, 34.925669, 'data.gov.il+osm'),
  ('כפר זיתים', 'כפר זיתים', 32.8106577, 35.4637873, 'data.gov.il+osm'),
  ('כפר חבד', 'כפר חבד', 31.990144, 34.849103, 'data.gov.il+osm'),
  ('כפר חושן', 'כפר חושן', 33.0108471, 35.4386655, 'data.gov.il+osm'),
  ('כפר חיטים', 'כפר חיטים', 32.7993441, 35.5010491, 'data.gov.il+osm'),
  ('כפר חיים', 'כפר חיים', 32.3539817, 34.9001418, 'data.gov.il+osm'),
  ('כפר חנניה', 'כפר חנניה', 32.9161093, 35.4241459, 'data.gov.il+osm'),
  ('כפר חסידים א', 'כפר חסידים א''', 32.752262, 35.094212, 'data.gov.il+osm'),
  ('כפר חסידים ב', 'כפר חסידים ב''', 32.750515, 35.08828099999999, 'data.gov.il+osm'),
  ('כפר חרוב', 'כפר חרוב', 32.7631804, 35.6640429, 'data.gov.il+osm'),
  ('כפר טרומן', 'כפר טרומן', 31.980556, 34.921667, 'data.gov.il+osm'),
  ('כפר יאסיף', 'כפר יאסיף', 32.9520318, 35.1599957, 'data.gov.il+osm'),
  ('כפר ידידיה', 'כפר ידידיה', 32.344942, 34.9000198, 'data.gov.il+osm'),
  ('כפר יהושע', 'כפר יהושע', 32.6820586, 35.1522509, 'data.gov.il+osm'),
  ('כפר יונה', 'כפר יונה', 32.314504, 34.9321169, 'data.gov.il+osm'),
  ('כפר יחזקאל', 'כפר יחזקאל', 32.5682864, 35.3624076, 'data.gov.il+osm'),
  ('כפר יעבץ', 'כפר יעבץ', 32.2738189, 34.966859, 'data.gov.il+osm'),
  ('כפר כמא', 'כפר כמא', 32.721473, 35.4394617, 'data.gov.il+osm'),
  ('כפר כנא', 'כפר כנא', 32.750474, 35.3400398, 'data.gov.il+osm'),
  ('כפר מונש', 'כפר מונש', 32.3475348, 34.9162242, 'data.gov.il+osm'),
  ('כפר מימון', 'כפר מימון', 31.4308052, 34.5363846, 'data.gov.il+osm'),
  ('כפר מלל', 'כפר מלל', 32.167567, 34.894744, 'data.gov.il+osm'),
  ('כפר מנדא', 'כפר מנדא', 32.809649, 35.2624051, 'data.gov.il+osm'),
  ('כפר מנחם', 'כפר מנחם', 31.7309768, 34.8352311, 'data.gov.il+osm'),
  ('כפר מסריק', 'כפר מסריק', 32.8910595, 35.1001125, 'data.gov.il+osm'),
  ('כפר מצר', 'כפר מצר', 32.6453528, 35.4223211, 'data.gov.il+osm'),
  ('כפר מרדכי', 'כפר מרדכי', 31.8310864, 34.7561791, 'data.gov.il+osm'),
  ('כפר נטר', 'כפר נטר', 32.279642, 34.8769601, 'data.gov.il+osm'),
  ('כפר סאלד', 'כפר סאלד', 33.1946879, 35.657851, 'data.gov.il+osm'),
  ('כפר סבא', 'כפר סבא', 32.1773471, 34.907459, 'data.gov.il+osm'),
  ('כפר סילבר', 'כפר סילבר', 31.675669, 34.612311, 'data.gov.il+osm'),
  ('כפר סירקין', 'כפר סירקין', 32.0777377, 34.9235073, 'data.gov.il+osm'),
  ('כפר עבודה', 'כפר עבודה', 32.2569466, 34.9420929, 'data.gov.il+osm'),
  ('כפר עזה', 'כפר עזה', 31.4833351, 34.5333225, 'data.gov.il+osm'),
  ('כפר פינס', 'כפר פינס', 32.4838889, 35.0034441, 'data.gov.il+osm'),
  ('כפר קאסם', 'כפר קאסם', 32.1173916, 34.968918, 'data.gov.il+osm'),
  ('כפר קיש', 'כפר קיש', 32.6663613, 35.4487944, 'data.gov.il+osm'),
  ('כפר קרע', 'כפר קרע', 32.505255, 35.048811, 'data.gov.il+osm'),
  ('כפר ראש הנקרה', 'כפר ראש הנקרה', 33.08609, 35.113455, 'data.gov.il+osm'),
  ('כפר רופין', 'כפר רופין', 32.4581631, 35.556773, 'data.gov.il+osm'),
  ('כפר רות', 'כפר רות', 31.9107467, 35.0357676, 'data.gov.il+osm'),
  ('כפר שמאי', 'כפר שמאי', 32.9574173, 35.4579027, 'data.gov.il+osm'),
  ('כפר שמואל', 'כפר שמואל', 31.8891357, 34.9328059, 'data.gov.il+osm'),
  ('כפר שמריהו', 'כפר שמריהו', 32.1853666, 34.8197755, 'data.gov.il+osm'),
  ('כפר תבור', 'כפר תבור', 32.6878053, 35.4204202, 'data.gov.il+osm'),
  ('כרכום', 'כרכום', 32.9293327, 35.6085627, 'data.gov.il+osm'),
  ('כרם ביבנה ישיבה', 'כרם ביבנה (ישיבה)', 31.8199341, 34.7226127, 'data.gov.il+osm'),
  ('כרם בן זמרה', 'כרם בן זמרה', 33.0388862, 35.468049, 'data.gov.il+osm'),
  ('כרם בן שמן', 'כרם בן שמן', 31.958896, 34.934104, 'data.gov.il+osm'),
  ('כרם מהרל', 'כרם מהרל', 32.6461207, 34.9899618, 'data.gov.il+osm'),
  ('כרם שלום', 'כרם שלום', 31.2277096, 34.2839544, 'data.gov.il+osm'),
  ('כרמי יוסף', 'כרמי יוסף', 31.8469647, 34.9204701, 'data.gov.il+osm'),
  ('כרמי קטיף', 'כרמי קטיף', 31.5372434, 34.9126772, 'data.gov.il+osm'),
  ('כרמיאל', 'כרמיאל', 32.9159104, 35.293429, 'data.gov.il+osm'),
  ('כרמיה', 'כרמיה', 31.6053505, 34.5430183, 'data.gov.il+osm'),
  ('כרמים', 'כרמים', 31.3356266, 34.9190091, 'data.gov.il+osm'),
  ('כרמל', 'כרמל', 32.7427316, 35.0483915, 'data.gov.il+osm'),
  ('לבון', 'לבון', 32.9424551, 35.2871026, 'data.gov.il+osm'),
  ('לביא', 'לביא', 32.7872253, 35.4416661, 'data.gov.il+osm'),
  ('לבנים', 'לבנים', 32.8639423, 35.4935744, 'data.gov.il+osm'),
  ('להב', 'להב', 31.3794212, 34.8701057, 'data.gov.il+osm'),
  ('להבות הבשן', 'להבות הבשן', 33.1406178, 35.646246, 'data.gov.il+osm'),
  ('להבות חביבה', 'להבות חביבה', 32.3958732, 35.0103906, 'data.gov.il+osm'),
  ('להבים', 'להבים', 31.3703233, 34.8136886, 'data.gov.il+osm'),
  ('לוד', 'לוד', 31.9489012, 34.8884857, 'data.gov.il+osm'),
  ('לוזית', 'לוזית', 31.6877948, 34.8877384, 'data.gov.il+osm'),
  ('לוחמי הגיטאות', 'לוחמי הגיטאות', 32.962661, 35.096741, 'data.gov.il+osm'),
  ('לוטם', 'לוטם', 32.8817394, 35.3584971, 'data.gov.il+osm'),
  ('לוטן', 'לוטן', 29.9867806, 35.0886439, 'data.gov.il+osm'),
  ('לימן', 'לימן', 33.0595032, 35.1130278, 'data.gov.il+osm'),
  ('לכיש', 'לכיש', 31.5608984, 34.8410694, 'data.gov.il+osm'),
  ('לפיד', 'לפיד', 31.9175529, 35.0319405, 'data.gov.il+osm'),
  ('לפידות', 'לפידות', 32.9592382, 35.2620596, 'data.gov.il+osm'),
  ('לקיה', 'לקיה', 31.324884, 34.866219, 'data.gov.il+osm'),
  ('מאור', 'מאור', 32.4239237, 35.006394, 'data.gov.il+osm'),
  ('מבוא ביתר', 'מבוא ביתר', 31.7227202, 35.1071186, 'data.gov.il+osm'),
  ('מבוא חורון', 'מבוא חורון', 31.849598, 35.034977, 'data.gov.il+osm'),
  ('מבוא חמה', 'מבוא חמה', 32.7363463, 35.6556132, 'data.gov.il+osm'),
  ('מבוא מודיעים', 'מבוא מודיעים', 31.9344938, 34.9871687, 'data.gov.il+osm'),
  ('מבואות ים', 'מבואות ים', 32.401697, 34.866797, 'data.gov.il+osm'),
  ('מבואות יריחו', 'מבואות יריחו', 31.9074488, 35.4155538, 'data.gov.il+osm'),
  ('מבועים', 'מבועים', 31.4492727, 34.6547505, 'data.gov.il+osm'),
  ('מבטחים', 'מבטחים', 31.2417561, 34.4072666, 'data.gov.il+osm'),
  ('מבקיעים', 'מבקיעים', 31.6221558, 34.5771198, 'data.gov.il+osm'),
  ('מבשרת ציון', 'מבשרת ציון', 31.8057198, 35.152731, 'data.gov.il+osm'),
  ('מגד אל כרום', 'מג''ד אל-כרום', 32.920132, 35.25665, 'data.gov.il+osm'),
  ('מגדל שמס', 'מג''דל שמס', 33.2684288, 35.769371, 'data.gov.il+osm'),
  ('מגאר', 'מגאר', 32.8872843, 35.4091765, 'data.gov.il+osm'),
  ('מגדים', 'מגדים', 32.7290313, 34.9619508, 'data.gov.il+osm'),
  ('מגדל', 'מגדל', 32.8387154, 35.4993634, 'data.gov.il+osm'),
  ('מגדל העמק', 'מגדל העמק', 32.6765744, 35.2413237, 'data.gov.il+osm'),
  ('מגידו', 'מגידו', 32.5786915, 35.1806937, 'data.gov.il+osm'),
  ('מגל', 'מגל', 32.38522, 35.0351579, 'data.gov.il+osm'),
  ('מגן', 'מגן', 31.2990681, 34.4289248, 'data.gov.il+osm'),
  ('מגן שאול', 'מגן שאול', 32.5206793, 35.3067307, 'data.gov.il+osm'),
  ('מגשימים', 'מגשימים', 32.0470353, 34.8993144, 'data.gov.il+osm'),
  ('מדרך עוז', 'מדרך עוז', 32.5954691, 35.1603051, 'data.gov.il+osm'),
  ('מדרשת בן גוריון', 'מדרשת בן גוריון', 30.8515927, 34.7825759, 'data.gov.il+osm'),
  ('מדרשת רופין', 'מדרשת רופין', 32.3423801, 34.9122632, 'data.gov.il+osm'),
  ('מודיעין עילית', 'מודיעין עילית', 31.932477, 35.042265, 'data.gov.il+osm'),
  ('מודיעין מכבים רעות', 'מודיעין־מכבים־רעות', 31.9085744, 35.0069297, 'data.gov.il+osm'),
  ('מודיעין', 'מודיעין־מכבים־רעות', 31.9085744, 35.0069297, 'data.gov.il+osm'),
  ('מולדת', 'מולדת', 32.5860767, 35.4401307, 'data.gov.il+osm'),
  ('מוצא עילית', 'מוצא עילית', 31.7934936, 35.1565626, 'data.gov.il+osm'),
  ('מוקייבלה', 'מוקייבלה', 32.5140208, 35.2976327, 'data.gov.il+osm'),
  ('מורן', 'מורן', 32.921571, 35.393461, 'data.gov.il+osm'),
  ('מורשת', 'מורשת', 32.8268051, 35.2328758, 'data.gov.il+osm'),
  ('מזור', 'מזור', 32.0523036, 34.923418, 'data.gov.il+osm'),
  ('מזכרת בתיה', 'מזכרת בתיה', 31.8514378, 34.8411635, 'data.gov.il+osm'),
  ('מזרע', 'מזרע', 32.6509756, 35.2861087, 'data.gov.il+osm'),
  ('מזרעה', 'מזרעה', 32.9833034, 35.098342, 'data.gov.il+osm'),
  ('מחולה', 'מחולה', 32.365285, 35.51602, 'data.gov.il+osm'),
  ('מחנה יתיר', 'מחנה יתיר', 31.347793, 35.060671, 'data.gov.il+osm'),
  ('מחניים', 'מחניים', 32.9886405, 35.570735, 'data.gov.il+osm'),
  ('מחסיה', 'מחסיה', 31.7481682, 35.0073522, 'data.gov.il+osm'),
  ('מטולה', 'מטולה', 33.2799815, 35.5779451, 'data.gov.il+osm'),
  ('מטע', 'מטע', 31.7169307, 35.0615698, 'data.gov.il+osm'),
  ('מי עמי', 'מי עמי', 32.5046656, 35.1465087, 'data.gov.il+osm'),
  ('מיטב', 'מיטב', 32.5457376, 35.301291, 'data.gov.il+osm'),
  ('מייסר', 'מייסר', 32.445246, 35.042131, 'data.gov.il+osm'),
  ('מיצר', 'מיצר', 32.7686851, 35.7369807, 'data.gov.il+osm'),
  ('מירב', 'מירב', 32.4533873, 35.4215378, 'data.gov.il+osm'),
  ('מירון', 'מירון', 32.9886409, 35.440278, 'data.gov.il+osm'),
  ('מישר', 'מישר', 31.8175349, 34.7531216, 'data.gov.il+osm'),
  ('מיתר', 'מיתר', 31.3270854, 34.9384389, 'data.gov.il+osm'),
  ('מכחול', 'מכחול', 31.2883138, 35.0753893, 'data.gov.il+osm'),
  ('מכמורת', 'מכמורת', 32.4062774, 34.8728998, 'data.gov.il+osm'),
  ('מכמנים', 'מכמנים', 32.9061108, 35.3287602, 'data.gov.il+osm'),
  ('מלאה', 'מלאה', 32.5634638, 35.2359604, 'data.gov.il+osm'),
  ('מלילות', 'מלילות', 31.3900104, 34.5959269, 'data.gov.il+osm'),
  ('מלכיה', 'מלכיה', 33.0992486, 35.5116985, 'data.gov.il+osm'),
  ('מנוחה', 'מנוחה', 31.6565157, 34.7766986, 'data.gov.il+osm'),
  ('מנוף', 'מנוף', 32.8541336, 35.2367706, 'data.gov.il+osm'),
  ('מנות', 'מנות', 33.0383637, 35.1946918, 'data.gov.il+osm'),
  ('מנחמיה', 'מנחמיה', 32.6670217, 35.5555869, 'data.gov.il+osm'),
  ('מנרה', 'מנרה', 33.195939, 35.5446083, 'data.gov.il+osm'),
  ('מנשית זבדה', 'מנשית זבדה', 32.706219, 35.192415, 'data.gov.il+osm'),
  ('מסד', 'מסד', 32.8433385, 35.4229425, 'data.gov.il+osm'),
  ('מסדה', 'מסדה', 32.683069, 35.5987945, 'data.gov.il+osm'),
  ('מסילות', 'מסילות', 32.495833, 35.4750001, 'data.gov.il+osm'),
  ('מסילת ציון', 'מסילת ציון', 31.8018055, 35.0115252, 'data.gov.il+osm'),
  ('מסלול', 'מסלול', 31.3253422, 34.5885811, 'data.gov.il+osm'),
  ('מסעדה', 'מסעדה', 33.2312137, 35.7574829, 'data.gov.il+osm'),
  ('מסעודין אל עזאזמה', 'מסעודין אל-עזאזמה', 31.153074, 34.807717, 'data.gov.il+osm'),
  ('מעברות', 'מעברות', 32.3639465, 34.9046905, 'data.gov.il+osm'),
  ('מעגלים', 'מעגלים', 31.3974042, 34.5983178, 'data.gov.il+osm'),
  ('מעגן', 'מעגן', 32.706731, 35.6010794, 'data.gov.il+osm'),
  ('מעגן מיכאל', 'מעגן מיכאל', 32.5553209, 34.9166572, 'data.gov.il+osm'),
  ('מעוז חיים', 'מעוז חיים', 32.4933804, 35.5512649, 'data.gov.il+osm'),
  ('מעון', 'מעון', 31.414592, 35.163893, 'data.gov.il+osm'),
  ('מעונה', 'מעונה', 33.0167071, 35.2597388, 'data.gov.il+osm'),
  ('מעיליא', 'מעיליא', 33.027194, 35.256304, 'data.gov.il+osm'),
  ('מעין ברוך', 'מעין ברוך', 33.239349, 35.609359, 'data.gov.il+osm'),
  ('מעין צבי', 'מעין צבי', 32.568484, 34.940623, 'data.gov.il+osm'),
  ('מעלה אדומים', 'מעלה אדומים', 31.773, 35.298, 'compiled'),
  ('מעלה אפרים', 'מעלה אפרים', 32.07, 35.333, 'compiled'),
  ('מעלה גלבוע', 'מעלה גלבוע', 32.4780173, 35.4174978, 'data.gov.il+osm'),
  ('מעלה גמלא', 'מעלה גמלא', 32.8899257, 35.684851, 'data.gov.il+osm'),
  ('מעלה החמישה', 'מעלה החמישה', 31.8174857, 35.1115939, 'data.gov.il+osm'),
  ('מעלה מכמש', 'מעלה מכמש', 31.87113, 35.277797, 'data.gov.il+osm'),
  ('מעלה עירון', 'מעלה עירון', 32.5508302, 35.1865314, 'data.gov.il+osm'),
  ('מעלה עמוס', 'מעלה עמוס', 31.596887, 35.22936500000001, 'data.gov.il+osm'),
  ('מעלות תרשיחא', 'מעלות־תרשיחא', 33.0157394, 35.2759666, 'data.gov.il+osm'),
  ('מעלות', 'מעלות־תרשיחא', 33.0157394, 35.2759666, 'data.gov.il+osm'),
  ('תרשיחא', 'מעלות־תרשיחא', 33.0157394, 35.2759666, 'data.gov.il+osm'),
  ('מענית', 'מענית', 32.4560127, 35.0280805, 'data.gov.il+osm'),
  ('מעש', 'מעש', 32.063511, 34.892639, 'data.gov.il+osm'),
  ('מפלסים', 'מפלסים', 31.5026787, 34.5621232, 'data.gov.il+osm'),
  ('מצובה', 'מצובה', 33.0629442, 35.1570974, 'data.gov.il+osm'),
  ('מצליח', 'מצליח', 31.9061802, 34.8717789, 'data.gov.il+osm'),
  ('מצפה', 'מצפה', 32.7902724, 35.5085407, 'data.gov.il+osm'),
  ('מצפה אביב', 'מצפה אביב', 32.8369091, 35.2020716, 'data.gov.il+osm'),
  ('מצפה אילן', 'מצפה אילן', 32.461529, 35.0691813, 'data.gov.il+osm'),
  ('מצפה יריחו', 'מצפה יריחו', 31.815688, 35.395409, 'data.gov.il+osm'),
  ('מצפה נטופה', 'מצפה נטופה', 32.8029167, 35.3846403, 'data.gov.il+osm'),
  ('מצפה רמון', 'מצפה רמון', 30.6119687, 34.8012169, 'data.gov.il+osm'),
  ('מצפה שלם', 'מצפה שלם', 31.568875, 35.400367, 'data.gov.il+osm'),
  ('מצר', 'מצר', 32.4404285, 35.0476791, 'data.gov.il+osm'),
  ('מרגליות', 'מרגליות', 33.2148047, 35.5444859, 'data.gov.il+osm'),
  ('מרום גולן', 'מרום גולן', 33.1321192, 35.7773161, 'data.gov.il+osm'),
  ('מרחב עם', 'מרחב עם', 30.8886192, 34.828885, 'data.gov.il+osm'),
  ('מרחביה מושב', 'מרחביה (מושב)', 32.6047, 35.3081, 'data.gov.il+osm'),
  ('מרחביה קיבוץ', 'מרחביה (קיבוץ)', 32.60585, 35.30725, 'data.gov.il+osm'),
  ('מרכז שפירא', 'מרכז שפירא', 31.6951844, 34.7071255, 'data.gov.il+osm'),
  ('משאבי שדה', 'משאבי שדה', 31.0032681, 34.7861244, 'data.gov.il+osm'),
  ('משגב דב', 'משגב דב', 31.819884, 34.7385694, 'data.gov.il+osm'),
  ('משגב עם', 'משגב עם', 33.2477885, 35.5486672, 'data.gov.il+osm'),
  ('משהד', 'משהד', 32.738912, 35.322494, 'data.gov.il+osm'),
  ('משואה', 'משואה', 32.111805, 35.490255, 'data.gov.il+osm'),
  ('משואות יצחק', 'משואות יצחק', 31.7023455, 34.6898673, 'data.gov.il+osm'),
  ('משמר איילון', 'משמר איילון', 31.8719461, 34.9447916, 'data.gov.il+osm'),
  ('משמר דוד', 'משמר דוד', 31.8224828, 34.9009264, 'data.gov.il+osm'),
  ('משמר הירדן', 'משמר הירדן', 33.0055656, 35.6002731, 'data.gov.il+osm'),
  ('משמר הנגב', 'משמר הנגב', 31.3641285, 34.7186798, 'data.gov.il+osm'),
  ('משמר העמק', 'משמר העמק', 32.6105821, 35.1421972, 'data.gov.il+osm'),
  ('משמר השבעה', 'משמר השבעה', 32.0091622, 34.8233846, 'data.gov.il+osm'),
  ('משמר השרון', 'משמר השרון', 32.3564792, 34.9033593, 'data.gov.il+osm'),
  ('משמר יהודה', 'משמר יהודה', 32.029748, 34.85617300000001, 'data.gov.il+osm'),
  ('משמרות', 'משמרות', 32.4874752, 34.9850386, 'data.gov.il+osm'),
  ('משמרת', 'משמרת', 32.2279787, 34.9220495, 'data.gov.il+osm'),
  ('משען', 'משען', 31.6576442, 34.6237776, 'data.gov.il+osm'),
  ('מתן', 'מתן', 32.1561435, 34.9742805, 'data.gov.il+osm'),
  ('מתת', 'מתת', 33.0415441, 35.3598303, 'data.gov.il+osm'),
  ('מתתיהו', 'מתתיהו', 31.929747, 35.034997, 'data.gov.il+osm'),
  ('נאות גולן', 'נאות גולן', 32.7867059, 35.6929699, 'data.gov.il+osm'),
  ('נאות הכיכר', 'נאות הכיכר', 30.9330032, 35.3772356, 'data.gov.il+osm'),
  ('נאות מרדכי', 'נאות מרדכי', 33.160576, 35.5965774, 'data.gov.il+osm'),
  ('נאות סמדר', 'נאות סמדר', 30.0486435, 35.0257351, 'data.gov.il+osm'),
  ('נאעורה', 'נאעורה', 32.6140155, 35.3903478, 'data.gov.il+osm'),
  ('נבטים', 'נבטים', 31.2225371, 34.8807983, 'data.gov.il+osm'),
  ('נגבה', 'נגבה', 31.6623288, 34.6827493, 'data.gov.il+osm'),
  ('נגוהות', 'נגוהות', 31.493077, 34.983347, 'data.gov.il+osm'),
  ('נהורה', 'נהורה', 31.6226942, 34.70469, 'data.gov.il+osm'),
  ('נהלל', 'נהלל', 32.6900631, 35.1968485, 'data.gov.il+osm'),
  ('נהריה', 'נהריה', 33.006306, 35.0945579, 'data.gov.il+osm'),
  ('נוב', 'נוב', 32.832269, 35.7831891, 'data.gov.il+osm'),
  ('נוגה', 'נוגה', 31.6252155, 34.6953049, 'data.gov.il+osm'),
  ('נוה צוף', 'נוה צוף', 32.008313, 35.128876, 'data.gov.il+osm'),
  ('נווה', 'נווה', 31.1620776, 34.3300605, 'data.gov.il+osm'),
  ('נווה אבות', 'נווה אבות', 32.4728028, 34.9742001, 'data.gov.il+osm'),
  ('נווה אור', 'נווה אור', 32.5886496, 35.5531494, 'data.gov.il+osm'),
  ('נווה אטיב', 'נווה אטיב', 33.26202, 35.740574, 'data.gov.il+osm'),
  ('נווה אילן', 'נווה אילן', 31.807585, 35.080922, 'data.gov.il+osm'),
  ('נווה איתן', 'נווה איתן', 32.4920626, 35.5327856, 'data.gov.il+osm'),
  ('נווה זוהר', 'נווה זוהר', 31.1529016, 35.365301, 'data.gov.il+osm'),
  ('נווה זיו', 'נווה זיו', 33.0275858, 35.1834948, 'data.gov.il+osm'),
  ('נווה חריף', 'נווה חריף', 30.0389533, 35.0358704, 'data.gov.il+osm'),
  ('נווה ים', 'נווה ים', 32.6791606, 34.9318092, 'data.gov.il+osm'),
  ('נווה ימין', 'נווה ימין', 32.171692, 34.939378, 'data.gov.il+osm'),
  ('נווה ירק', 'נווה ירק', 32.1333242, 34.9242354, 'data.gov.il+osm'),
  ('נווה מבטח', 'נווה מבטח', 31.8059239, 34.7410254, 'data.gov.il+osm'),
  ('נווה מיכאל', 'נווה מיכאל', 31.6729774, 35.0059119, 'data.gov.il+osm'),
  ('נועם', 'נועם', 31.5669098, 34.7890968, 'data.gov.il+osm'),
  ('נוף איילון', 'נוף איילון', 31.8705213, 34.9896581, 'data.gov.il+osm'),
  ('נוף הגליל', 'נוף הגליל', 32.7023065, 35.3183216, 'data.gov.il+osm'),
  ('נצרת עילית', 'נוף הגליל', 32.7023065, 35.3183216, 'data.gov.il+osm'),
  ('נופי פרת', 'נופי פרת', 31.82351899999999, 35.319875, 'data.gov.il+osm'),
  ('נופית', 'נופית', 32.7586157, 35.14735, 'data.gov.il+osm'),
  ('נופך', 'נופך', 32.0435572, 34.9207276, 'data.gov.il+osm'),
  ('נורדיה', 'נורדיה', 32.31478, 34.8961822, 'data.gov.il+osm'),
  ('נורית', 'נורית', 32.543238, 35.35575499999999, 'data.gov.il+osm'),
  ('נחושה', 'נחושה', 31.6287914, 34.9522836, 'data.gov.il+osm'),
  ('נחל עוז', 'נחל עוז', 31.4724074, 34.4982114, 'data.gov.il+osm'),
  ('נחלה', 'נחלה', 31.657961, 34.7949816, 'data.gov.il+osm'),
  ('נחלים', 'נחלים', 32.0589718, 34.9136499, 'data.gov.il+osm'),
  ('נחם', 'נחם', 31.7665744, 35.0039498, 'data.gov.il+osm'),
  ('נחף', 'נחף', 32.9350929, 35.3156595, 'data.gov.il+osm'),
  ('נחשולים', 'נחשולים', 32.6138484, 34.92063, 'data.gov.il+osm'),
  ('נחשון', 'נחשון', 31.830965, 34.9559212, 'data.gov.il+osm'),
  ('נחשונים', 'נחשונים', 32.0614545, 34.9492529, 'data.gov.il+osm'),
  ('נטועה', 'נטועה', 33.0649415, 35.3233116, 'data.gov.il+osm'),
  ('נטור', 'נטור', 32.8538055, 35.7514617, 'data.gov.il+osm'),
  ('נטע', 'נטע', 31.4778481, 34.9266422, 'data.gov.il+osm'),
  ('נטעים', 'נטעים', 31.9444441, 34.7744439, 'data.gov.il+osm'),
  ('נטף', 'נטף', 31.8320125, 35.0679987, 'data.gov.il+osm'),
  ('ניין', 'ניין', 32.6307267, 35.3488686, 'data.gov.il+osm'),
  ('ניצן', 'ניצן', 31.7399419, 34.6318163, 'data.gov.il+osm'),
  ('ניצן ב', 'ניצן ב''', 31.737089, 34.638235, 'data.gov.il+osm'),
  ('ניצנה קהילת חינוך', 'ניצנה (קהילת חינוך)', 30.885983, 34.4225689, 'data.gov.il+osm'),
  ('ניצני סיני', 'ניצני סיני', 30.903912, 34.3968932, 'data.gov.il+osm'),
  ('ניצני עוז', 'ניצני עוז', 32.3054855, 35.0048861, 'data.gov.il+osm'),
  ('ניצנים', 'ניצנים', 31.7168321, 34.634187, 'data.gov.il+osm'),
  ('ניר אליהו', 'ניר אליהו', 32.1973859, 34.9483587, 'data.gov.il+osm'),
  ('ניר בנים', 'ניר בנים', 31.6717215, 34.7542446, 'data.gov.il+osm'),
  ('ניר גלים', 'ניר גלים', 31.8244735, 34.6819467, 'data.gov.il+osm'),
  ('ניר דוד תל עמל', 'ניר דוד (תל עמל)', 32.504062, 35.457622, 'data.gov.il+osm'),
  ('ניר חן', 'ניר חן', 31.6084431, 34.7145081, 'data.gov.il+osm'),
  ('ניר יפה', 'ניר יפה', 32.5696288, 35.2452983, 'data.gov.il+osm'),
  ('ניר יצחק', 'ניר יצחק', 31.2378574, 34.3577888, 'data.gov.il+osm'),
  ('ניר ישראל', 'ניר ישראל', 31.6873424, 34.6364148, 'data.gov.il+osm'),
  ('ניר משה', 'ניר משה', 31.4772702, 34.6299737, 'data.gov.il+osm'),
  ('ניר עוז', 'ניר עוז', 31.3095982, 34.400815, 'data.gov.il+osm'),
  ('ניר עם', 'ניר עם', 31.5193144, 34.5807617, 'data.gov.il+osm'),
  ('ניר עציון', 'ניר עציון', 32.6975838, 34.9936059, 'data.gov.il+osm'),
  ('ניר עקיבא', 'ניר עקיבא', 31.4695439, 34.64547, 'data.gov.il+osm'),
  ('ניר צבי', 'ניר צבי', 31.951381, 34.8609717, 'data.gov.il+osm'),
  ('נירים', 'נירים', 31.335199, 34.395, 'data.gov.il+osm'),
  ('נירית', 'נירית', 32.1466075, 34.9843952, 'data.gov.il+osm'),
  ('נמרוד', 'נמרוד', 33.2452094, 35.7510271, 'data.gov.il+osm'),
  ('נס הרים', 'נס הרים', 31.7444618, 35.0579576, 'data.gov.il+osm'),
  ('נס עמים', 'נס עמים', 32.9656707, 35.1211467, 'data.gov.il+osm'),
  ('נס ציונה', 'נס ציונה', 31.9295577, 34.7990609, 'data.gov.il+osm'),
  ('נעורים', 'נעורים', 31.9739, 34.814382, 'data.gov.il+osm'),
  ('נעלה', 'נעלה', 31.962594, 35.065976, 'data.gov.il+osm'),
  ('נעמה', 'נעמה', 31.907541, 35.467713, 'data.gov.il+osm'),
  ('נען', 'נען', 31.8837553, 34.8570894, 'data.gov.il+osm'),
  ('נצאצרה שבט', 'נצאצרה (שבט)', 31.242973, 35.030224, 'data.gov.il+osm'),
  ('נצר חזני', 'נצר חזני', 31.8216134, 34.8624802, 'data.gov.il+osm'),
  ('נצר סרני', 'נצר סרני', 31.9230975, 34.8239981, 'data.gov.il+osm'),
  ('נצרת', 'נצרת', 32.7066301, 35.3048161, 'data.gov.il+osm'),
  ('נריה', 'נריה', 31.95370599999999, 35.127511, 'data.gov.il+osm'),
  ('נשר', 'נשר', 32.7708797, 35.0381249, 'data.gov.il+osm'),
  ('נתיב הלה', 'נתיב הלה', 31.687184, 34.982523, 'data.gov.il+osm'),
  ('נתיב העשרה', 'נתיב העשרה', 31.5716799, 34.5395488, 'data.gov.il+osm'),
  ('נתיב השיירה', 'נתיב השיירה', 32.9928246, 35.1355166, 'data.gov.il+osm'),
  ('נתיבות', 'נתיבות', 31.4213546, 34.5884252, 'data.gov.il+osm'),
  ('נתניה', 'נתניה', 32.3286181, 34.8566246, 'data.gov.il+osm'),
  ('סאגור', 'סאג''ור', 32.9419893, 35.3421983, 'data.gov.il+osm'),
  ('סאסא', 'סאסא', 33.026907, 35.39499, 'data.gov.il+osm'),
  ('סביון', 'סביון', 32.0475371, 34.8799172, 'data.gov.il+osm'),
  ('סגולה', 'סגולה', 31.6697258, 34.7791534, 'data.gov.il+osm'),
  ('סולם', 'סולם', 32.6061864, 35.3338887, 'data.gov.il+osm'),
  ('סופה', 'סופה', 31.2365143, 34.3426422, 'data.gov.il+osm'),
  ('סחנין', 'סחנין', 32.8638052, 35.3023184, 'data.gov.il+osm'),
  ('סייד שבט', 'סייד (שבט)', 31.2811911, 34.9317593, 'data.gov.il+osm'),
  ('סלמה', 'סלמה', 32.8936503, 35.3699046, 'data.gov.il+osm'),
  ('סלעית', 'סלעית', 32.242589, 35.051258, 'data.gov.il+osm'),
  ('סמר', 'סמר', 29.8333743, 35.022744, 'data.gov.il+osm'),
  ('סנסנה', 'סנסנה', 31.36176499999999, 34.901003, 'data.gov.il+osm'),
  ('סעד', 'סעד', 31.470029, 34.5355347, 'data.gov.il+osm'),
  ('סער', 'סער', 33.0293646, 35.1093238, 'data.gov.il+osm'),
  ('ספיר', 'ספיר', 30.6140945, 35.1846411, 'data.gov.il+osm'),
  ('סתריה', 'סתריה', 31.8918834, 34.844046, 'data.gov.il+osm'),
  ('עגר', 'ע''ג''ר', 33.2721727, 35.6239112, 'data.gov.il+osm'),
  ('עבדון', 'עבדון', 33.0479451, 35.1794373, 'data.gov.il+osm'),
  ('עברון', 'עברון', 32.9926009, 35.1002025, 'data.gov.il+osm'),
  ('עגור', 'עגור', 31.6971051, 34.9129214, 'data.gov.il+osm'),
  ('עדי', 'עדי', 32.781891, 35.1736274, 'data.gov.il+osm'),
  ('עדנים', 'עדנים', 32.1382948, 34.9082736, 'data.gov.il+osm'),
  ('עוזה', 'עוזה', 31.592477, 34.7649543, 'data.gov.il+osm'),
  ('עוזייר', 'עוזייר', 32.7900696, 35.3271751, 'data.gov.il+osm'),
  ('עולש', 'עולש', 32.3317108, 34.9862175, 'data.gov.il+osm'),
  ('עומר', 'עומר', 31.2659365, 34.847616, 'data.gov.il+osm'),
  ('עופר', 'עופר', 32.6220894, 34.9828033, 'data.gov.il+osm'),
  ('עופרה', 'עופרה', 32.621882, 34.983472, 'data.gov.il+osm'),
  ('עוצם', 'עוצם', 31.6366498, 34.7025584, 'data.gov.il+osm'),
  ('עוקבי בנו עוקבה', 'עוקבי (בנו עוקבה)', 31.283211, 34.930794, 'data.gov.il+osm'),
  ('עזוז', 'עזוז', 30.7916672, 34.4722219, 'data.gov.il+osm'),
  ('עזר', 'עזר', 31.736151, 34.671447, 'data.gov.il+osm'),
  ('עזריאל', 'עזריאל', 32.2629094, 34.9712077, 'data.gov.il+osm'),
  ('עזריה', 'עזריה', 31.8904994, 34.9115676, 'data.gov.il+osm'),
  ('עזריקם', 'עזריקם', 31.7537708, 34.6949023, 'data.gov.il+osm'),
  ('עידן', 'עידן', 30.8060345, 35.2994035, 'data.gov.il+osm'),
  ('עיילבון', 'עיילבון', 32.8348489, 35.4038304, 'data.gov.il+osm'),
  ('עיינות', 'עיינות', 31.9159502, 34.7677914, 'data.gov.il+osm'),
  ('עילוט', 'עילוט', 32.7163849, 35.2594337, 'data.gov.il+osm'),
  ('עין איילה', 'עין איילה', 32.6287327, 34.9454021, 'data.gov.il+osm'),
  ('עין אל אסד', 'עין אל-אסד', 32.9402935, 35.4010052, 'data.gov.il+osm'),
  ('עין גב', 'עין גב', 32.7811125, 35.6388846, 'data.gov.il+osm'),
  ('עין גדי', 'עין גדי', 31.4523959, 35.3848241, 'data.gov.il+osm'),
  ('עין דור', 'עין דור', 32.6562519, 35.417043, 'data.gov.il+osm'),
  ('עין הבשור', 'עין הבשור', 31.280566, 34.4437627, 'data.gov.il+osm'),
  ('עין החורש', 'עין החורש', 32.3863188, 34.9400265, 'data.gov.il+osm'),
  ('עין המפרץ', 'עין המפרץ', 32.9036151, 35.0961117, 'data.gov.il+osm'),
  ('עין הנציב', 'עין הנציב', 32.4697596, 35.5014843, 'data.gov.il+osm'),
  ('עין העמק', 'עין העמק', 32.6290135, 35.0853937, 'data.gov.il+osm'),
  ('עין השופט', 'עין השופט', 32.5957666, 35.1000352, 'data.gov.il+osm'),
  ('עין השלושה', 'עין השלושה', 31.3513501, 34.400966, 'data.gov.il+osm'),
  ('עין ורד', 'עין ורד', 32.2653177, 34.9317604, 'data.gov.il+osm'),
  ('עין זיוון', 'עין זיוון', 33.0962822, 35.7961971, 'data.gov.il+osm'),
  ('עין חצבה', 'עין חצבה', 30.7982828, 35.2463979, 'data.gov.il+osm'),
  ('עין יהב', 'עין יהב', 30.6569021, 35.2381753, 'data.gov.il+osm'),
  ('עין יעקב', 'עין יעקב', 33.0095478, 35.2292923, 'data.gov.il+osm'),
  ('עין כרם ביס חקלאי', 'עין כרם-ביס חקלאי', 31.778056, 35.153611, 'data.gov.il+osm'),
  ('עין כרמל', 'עין כרמל', 32.6770088, 34.9531216, 'data.gov.il+osm'),
  ('עין מאהל', 'עין מאהל', 32.7233235, 35.352732, 'data.gov.il+osm'),
  ('עין נקובא', 'עין נקובא', 31.79391, 35.11968299999999, 'data.gov.il+osm'),
  ('עין עירון', 'עין עירון', 32.4835067, 35.0098921, 'data.gov.il+osm'),
  ('עין צורים', 'עין צורים', 31.6940539, 34.7200879, 'data.gov.il+osm'),
  ('עין קנייא', 'עין קנייא', 33.2360284, 35.731055, 'data.gov.il+osm'),
  ('עין ראפה', 'עין ראפה', 31.7901732, 35.1162744, 'data.gov.il+osm'),
  ('עין שמר', 'עין שמר', 32.4629224, 35.0073711, 'data.gov.il+osm'),
  ('עין שריד', 'עין שריד', 32.2741205, 34.9353718, 'data.gov.il+osm'),
  ('עין תמר', 'עין תמר', 30.943309, 35.3747349, 'data.gov.il+osm'),
  ('עינת', 'עינת', 32.0827765, 34.9394305, 'data.gov.il+osm'),
  ('עיר אובות', 'עיר אובות', 30.808967, 35.244389, 'data.gov.il+osm'),
  ('עכו', 'עכו', 32.9281731, 35.0756378, 'data.gov.il+osm'),
  ('עלומים', 'עלומים', 31.4521295, 34.5137154, 'data.gov.il+osm'),
  ('עלי זהב', 'עלי זהב', 32.072227, 35.064135, 'data.gov.il+osm'),
  ('עלמה', 'עלמה', 33.0521283, 35.4988072, 'data.gov.il+osm'),
  ('עלמון', 'עלמון', 31.832068, 35.296764, 'data.gov.il+osm'),
  ('עמוקה', 'עמוקה', 32.9979671, 35.5242497, 'data.gov.il+osm'),
  ('עמינדב', 'עמינדב', 31.7511296, 35.1419938, 'data.gov.il+osm'),
  ('עמיעד', 'עמיעד', 32.9262991, 35.5412309, 'data.gov.il+osm'),
  ('עמיעוז', 'עמיעוז', 31.24831, 34.4139745, 'data.gov.il+osm'),
  ('עמיקם', 'עמיקם', 32.5638651, 35.020477, 'data.gov.il+osm'),
  ('עמיר', 'עמיר', 33.1787718, 35.620776, 'data.gov.il+osm'),
  ('עמקה', 'עמקה', 32.9792441, 35.1642671, 'data.gov.il+osm'),
  ('ענב', 'ענב', 32.283594, 35.125198, 'data.gov.il+osm'),
  ('עספיא', 'עספיא', 32.720737, 35.059087, 'data.gov.il+osm'),
  ('עפולה', 'עפולה', 32.6075587, 35.2890861, 'data.gov.il+osm'),
  ('עצמון שגב', 'עצמון שגב', 32.8659821, 35.2512054, 'data.gov.il+osm'),
  ('עראבה', 'עראבה', 32.8530087, 35.3361947, 'data.gov.il+osm'),
  ('עראמשה', 'עראמשה', 33.088834, 35.228839, 'data.gov.il+osm'),
  ('ערב אל נעים', 'ערב אל נעים', 32.888073, 35.290128, 'data.gov.il+osm'),
  ('ערד', 'ערד', 31.2612199, 35.214581, 'data.gov.il+osm'),
  ('ערוגות', 'ערוגות', 31.7346866, 34.7708779, 'data.gov.il+osm'),
  ('ערערה', 'ערערה', 32.4965507, 35.0955581, 'data.gov.il+osm'),
  ('ערערה בנגב', 'ערערה-בנגב', 31.1654944, 35.0333713, 'data.gov.il+osm'),
  ('עשרת', 'עשרת', 31.8247948, 34.7455804, 'data.gov.il+osm'),
  ('עתלית', 'עתלית', 32.690712, 34.9422744, 'data.gov.il+osm'),
  ('עתניאל', 'עתניאל', 31.438812, 35.028163, 'data.gov.il+osm'),
  ('פארן', 'פארן', 30.3626131, 35.1538972, 'data.gov.il+osm'),
  ('פדואל', 'פדואל', 32.062479, 35.052619, 'data.gov.il+osm'),
  ('פדויים', 'פדויים', 31.3277011, 34.612047, 'data.gov.il+osm'),
  ('פדיה', 'פדיה', 31.8580777, 34.8821097, 'data.gov.il+osm'),
  ('פוריה כפר עבודה', 'פוריה - כפר עבודה', 32.719846, 35.545563, 'data.gov.il+osm'),
  ('פוריה נווה עובד', 'פוריה - נווה עובד', 32.7436659, 35.5376169, 'data.gov.il+osm'),
  ('פוריה עילית', 'פוריה עילית', 32.7322318, 35.5457217, 'data.gov.il+osm'),
  ('פוריידיס', 'פוריידיס', 32.5988242, 34.9542319, 'data.gov.il+osm'),
  ('פורת', 'פורת', 32.2762739, 34.9494718, 'data.gov.il+osm'),
  ('פטיש', 'פטיש', 31.3273849, 34.5602722, 'data.gov.il+osm'),
  ('פלך', 'פלך', 32.9338767, 35.2335678, 'data.gov.il+osm'),
  ('פלמחים', 'פלמחים', 31.9334124, 34.7072589, 'data.gov.il+osm'),
  ('פני חבר', 'פני חבר', 31.487074, 35.1651, 'data.gov.il+osm'),
  ('פסוטה', 'פסוטה', 33.0484375, 35.3100248, 'data.gov.il+osm'),
  ('פעמי תשז', 'פעמי תשז', 31.4381567, 34.6930068, 'data.gov.il+osm'),
  ('פרדס חנה כרכור', 'פרדס חנה־כרכור', 32.4749962, 34.975139, 'data.gov.il+osm'),
  ('פרדס חנה', 'פרדס חנה־כרכור', 32.4749962, 34.975139, 'data.gov.il+osm'),
  ('כרכור', 'פרדס חנה־כרכור', 32.4749962, 34.975139, 'data.gov.il+osm'),
  ('פרדסיה', 'פרדסיה', 32.3070353, 34.9097723, 'data.gov.il+osm'),
  ('פרוד', 'פרוד', 32.9333327, 35.4333299, 'data.gov.il+osm'),
  ('פרזון', 'פרזון', 32.5454121, 35.3111616, 'data.gov.il+osm'),
  ('פרי גן', 'פרי גן', 31.2228545, 34.3528747, 'data.gov.il+osm'),
  ('פתח תקווה', 'פתח תקווה', 32.0877639, 34.8859985, 'data.gov.il+osm'),
  ('פתחיה', 'פתחיה', 31.8675842, 34.8862877, 'data.gov.il+osm'),
  ('צאלים', 'צאלים', 31.2036632, 34.5338387, 'data.gov.il+osm'),
  ('צביה', 'צביה', 32.8894, 35.3314, 'data.gov.il+osm'),
  ('צבעון', 'צבעון', 33.0259411, 35.4165978, 'data.gov.il+osm'),
  ('צובה', 'צובה', 31.7826765, 35.1206998, 'data.gov.il+osm'),
  ('צוחר', 'צוחר', 31.2360988, 34.4270729, 'data.gov.il+osm'),
  ('צופים', 'צופים', 32.197318, 35.008912, 'data.gov.il+osm'),
  ('צופית', 'צופית', 32.1918302, 34.923101, 'data.gov.il+osm'),
  ('צופר', 'צופר', 30.5586234, 35.1801426, 'data.gov.il+osm'),
  ('צוקי ים', 'צוקי ים', 32.3613476, 34.8586835, 'data.gov.il+osm'),
  ('צוקים', 'צוקים', 30.4910236, 35.1658635, 'data.gov.il+osm'),
  ('צור הדסה', 'צור הדסה', 31.7156945, 35.0948306, 'data.gov.il+osm'),
  ('צור יצחק', 'צור יצחק', 32.24124, 34.9983819, 'data.gov.il+osm'),
  ('צור משה', 'צור משה', 32.2978073, 34.9135462, 'data.gov.il+osm'),
  ('צור נתן', 'צור נתן', 32.2407088, 35.0138835, 'data.gov.il+osm'),
  ('צוריאל', 'צוריאל', 33.0059947, 35.3141186, 'data.gov.il+osm'),
  ('צורית', 'צורית', 32.9030676, 35.2523745, 'data.gov.il+osm'),
  ('ציפורי', 'ציפורי', 32.7443077, 35.2781186, 'data.gov.il+osm'),
  ('צלפון', 'צלפון', 31.8041263, 34.9327461, 'data.gov.il+osm'),
  ('צנדלה', 'צנדלה', 32.5231227, 35.3237725, 'data.gov.il+osm'),
  ('צפריה', 'צפריה', 32.0052557, 34.8550969, 'data.gov.il+osm'),
  ('צפרירים', 'צפרירים', 31.6600453, 34.9443771, 'data.gov.il+osm'),
  ('צפת', 'צפת', 32.9646301, 35.502451, 'data.gov.il+osm'),
  ('צרופה', 'צרופה', 32.6482373, 34.9480485, 'data.gov.il+osm'),
  ('צרעה', 'צרעה', 31.7627391, 34.9686245, 'data.gov.il+osm'),
  ('קבוצת יבנה', 'קבוצת יבנה', 31.8138222, 34.7190625, 'data.gov.il+osm'),
  ('קדימה צורן', 'קדימה-צורן', 32.2779191, 34.9112736, 'data.gov.il+osm'),
  ('קדמה', 'קדמה', 31.7007444, 34.7751348, 'data.gov.il+osm'),
  ('קדמת צבי', 'קדמת צבי', 33.0297367, 35.6970294, 'data.gov.il+osm'),
  ('קדר', 'קדר', 31.754384, 35.310732, 'data.gov.il+osm'),
  ('קדרון', 'קדרון', 31.8150988, 34.7976591, 'data.gov.il+osm'),
  ('קדרים', 'קדרים', 32.8984224, 35.4737461, 'data.gov.il+osm'),
  ('קוממיות', 'קוממיות', 31.6619651, 34.7297701, 'data.gov.il+osm'),
  ('קורנית', 'קורנית', 32.8436279, 35.2513199, 'data.gov.il+osm'),
  ('קטורה', 'קטורה', 29.9696388, 35.0610494, 'data.gov.il+osm'),
  ('קיסריה', 'קיסריה', 32.5114971, 34.9057861, 'data.gov.il+osm'),
  ('קלחים', 'קלחים', 31.4505907, 34.6780963, 'data.gov.il+osm'),
  ('קלנסווה', 'קלנסווה', 32.2854576, 34.9810942, 'data.gov.il+osm'),
  ('קלע', 'קלע', 33.131601, 35.69039, 'data.gov.il+osm'),
  ('קציר', 'קציר', 32.4886297, 35.1016891, 'data.gov.il+osm'),
  ('קצר א סר', 'קצר א-סר', 31.083329, 34.979579, 'data.gov.il+osm'),
  ('קצרין', 'קצרין', 32.9920262, 35.6877004, 'data.gov.il+osm'),
  ('קריית אונו', 'קריית אונו', 32.0591691, 34.8594303, 'data.gov.il+osm'),
  ('קריית אתא', 'קריית אתא', 32.8115853, 35.1163747, 'data.gov.il+osm'),
  ('קריית ביאליק', 'קריית ביאליק', 32.8285812, 35.0844915, 'data.gov.il+osm'),
  ('קריית גת', 'קריית גת', 31.6104718, 34.7722948, 'data.gov.il+osm'),
  ('קריית טבעון', 'קריית טבעון', 32.7332039, 35.1453385, 'data.gov.il+osm'),
  ('קריית ים', 'קריית ים', 32.851004, 35.070244, 'data.gov.il+osm'),
  ('קריית מוצקין', 'קריית מוצקין', 32.8390366, 35.0821062, 'data.gov.il+osm'),
  ('קריית מלאכי', 'קריית מלאכי', 31.7316015, 34.7446145, 'data.gov.il+osm'),
  ('קריית שמונה', 'קריית שמונה', 33.2074733, 35.5707828, 'data.gov.il+osm'),
  ('קריית יערים', 'קרית יערים', 31.8035128, 35.1012545, 'data.gov.il+osm'),
  ('קריית יערים מוסד', 'קרית יערים(מוסד)', 31.803758, 35.102508, 'data.gov.il+osm'),
  ('קריית נטפים', 'קרית נטפים', 32.117299, 35.112115, 'data.gov.il+osm'),
  ('קריית ענבים', 'קרית ענבים', 31.8100172, 35.1203388, 'data.gov.il+osm'),
  ('קריית עקרון', 'קרית עקרון', 31.8607858, 34.823337, 'data.gov.il+osm'),
  ('קשת', 'קשת', 32.980733, 35.8085857, 'data.gov.il+osm'),
  ('ראמה', 'ראמה', 32.9374389, 35.366515, 'data.gov.il+osm'),
  ('ראס אל עין', 'ראס אל-עין', 32.9158041, 35.3726649, 'data.gov.il+osm'),
  ('ראס עלי', 'ראס עלי', 32.7721199, 35.1542287, 'data.gov.il+osm'),
  ('ראש העין', 'ראש העין', 32.0952929, 34.9533225, 'data.gov.il+osm'),
  ('ראש פינה', 'ראש פינה', 32.968215, 35.5438245, 'data.gov.il+osm'),
  ('ראשון לציון', 'ראשון לציון', 31.9635712, 34.8101149, 'data.gov.il+osm'),
  ('רבדים', 'רבדים', 31.7730474, 34.8153077, 'data.gov.il+osm'),
  ('רביבים', 'רביבים', 31.0431631, 34.7207022, 'data.gov.il+osm'),
  ('רביד', 'רביד', 32.8515851, 35.4634262, 'data.gov.il+osm'),
  ('רגבה', 'רגבה', 32.9779642, 35.0996706, 'data.gov.il+osm'),
  ('רגבים', 'רגבים', 32.5240949, 35.0345429, 'data.gov.il+osm'),
  ('רהט', 'רהט', 31.3933637, 34.7546784, 'data.gov.il+osm'),
  ('רווחה', 'רווחה', 31.6495132, 34.7317085, 'data.gov.il+osm'),
  ('רוויה', 'רוויה', 32.4492455, 35.4727211, 'data.gov.il+osm'),
  ('רוח מדבר', 'רוח מדבר', 30.98153499999999, 34.733883, 'data.gov.il+osm'),
  ('רוחמה', 'רוחמה', 31.4971107, 34.7066969, 'data.gov.il+osm'),
  ('רומאנה', 'רומאנה', 32.526892, 35.208114, 'data.gov.il+osm'),
  ('רומת הייב', 'רומת הייב', 32.777591, 35.305683, 'data.gov.il+osm'),
  ('רותם', 'רותם', 32.3366, 35.518576, 'data.gov.il+osm'),
  ('רחוב', 'רחוב', 32.4497108, 35.4900246, 'data.gov.il+osm'),
  ('רחובות', 'רחובות', 31.8952532, 34.8105616, 'data.gov.il+osm'),
  ('ריינה', 'ריינה', 32.722061, 35.3155447, 'data.gov.il+osm'),
  ('רינתיה', 'רינתיה', 32.043333, 34.931667, 'data.gov.il+osm'),
  ('רכסים', 'רכסים', 32.7509558, 35.1013589, 'data.gov.il+osm'),
  ('רם און', 'רם-און', 32.528742, 35.258657, 'data.gov.il+osm'),
  ('רמות', 'רמות', 32.8498005, 35.6667474, 'data.gov.il+osm'),
  ('רמות השבים', 'רמות השבים', 32.1661738, 34.8860426, 'data.gov.il+osm'),
  ('רמות מאיר', 'רמות מאיר', 31.8745635, 34.8558152, 'data.gov.il+osm'),
  ('רמות מנשה', 'רמות מנשה', 32.5978839, 35.0576452, 'data.gov.il+osm'),
  ('רמות נפתלי', 'רמות נפתלי', 33.1022971, 35.5531168, 'data.gov.il+osm'),
  ('רמלה', 'רמלה', 31.9279988, 34.8623473, 'data.gov.il+osm'),
  ('רמת גן', 'רמת גן', 32.0686867, 34.8246812, 'data.gov.il+osm'),
  ('רמת דוד', 'רמת דוד', 32.6775703, 35.2039032, 'data.gov.il+osm'),
  ('רמת הכובש', 'רמת הכובש', 32.2152641, 34.9393308, 'data.gov.il+osm'),
  ('רמת השופט', 'רמת השופט', 32.6119762, 35.0949392, 'data.gov.il+osm'),
  ('רמת השרון', 'רמת השרון', 32.1431276, 34.8380853, 'data.gov.il+osm'),
  ('רמת יוחנן', 'רמת יוחנן', 32.7925038, 35.1213847, 'data.gov.il+osm'),
  ('רמת ישי', 'רמת ישי', 32.7024925, 35.1652427, 'data.gov.il+osm'),
  ('רמת מגשימים', 'רמת מגשימים', 32.8440285, 35.8073845, 'data.gov.il+osm'),
  ('רמת צבי', 'רמת צבי', 32.5915062, 35.4145248, 'data.gov.il+osm'),
  ('רמת רזיאל', 'רמת רזיאל', 31.7736589, 35.0737596, 'data.gov.il+osm'),
  ('רמת רחל', 'רמת רחל', 31.7387105, 35.2183447, 'data.gov.il+osm'),
  ('רנן', 'רנן', 31.3377917, 34.6004634, 'data.gov.il+osm'),
  ('רעים', 'רעים', 31.3848038, 34.4585901, 'data.gov.il+osm'),
  ('רעננה', 'רעננה', 32.1860244, 34.8678359, 'data.gov.il+osm'),
  ('רקפת', 'רקפת', 32.8547224, 35.2642924, 'data.gov.il+osm'),
  ('רשפון', 'רשפון', 32.1995547, 34.8244371, 'data.gov.il+osm'),
  ('רשפים', 'רשפים', 32.4818532, 35.4775438, 'data.gov.il+osm'),
  ('רתמים', 'רתמים', 31.0539263, 34.690428, 'data.gov.il+osm'),
  ('שאר ישוב', 'שאר ישוב', 33.2272088, 35.6463364, 'data.gov.il+osm'),
  ('שבי דרום', 'שבי דרום', 31.4655951, 34.6358264, 'data.gov.il+osm'),
  ('שבי ציון', 'שבי ציון', 32.980597, 35.0832938, 'data.gov.il+osm'),
  ('שבי שומרון', 'שבי שומרון', 32.26372, 35.183444, 'data.gov.il+osm'),
  ('שבלי אום אל גנם', 'שבלי - אום אל-גנם', 32.6937221, 35.3960008, 'data.gov.il+osm'),
  ('שגב שלום', 'שגב-שלום', 31.19711719999999, 34.8383843, 'data.gov.il+osm'),
  ('שדה אילן', 'שדה אילן', 32.7493317, 35.4226101, 'data.gov.il+osm'),
  ('שדה אליהו', 'שדה אליהו', 32.4405328, 35.5149917, 'data.gov.il+osm'),
  ('שדה אליעזר', 'שדה אליעזר', 33.0458869, 35.5641252, 'data.gov.il+osm'),
  ('שדה בוקר', 'שדה בוקר', 30.8737395, 34.7925947, 'data.gov.il+osm'),
  ('שדה דוד', 'שדה דוד', 31.5766262, 34.6846417, 'data.gov.il+osm'),
  ('שדה ורבורג', 'שדה ורבורג', 32.2093873, 34.9048077, 'data.gov.il+osm'),
  ('שדה יואב', 'שדה יואב', 31.6457313, 34.6769569, 'data.gov.il+osm'),
  ('שדה יעקב', 'שדה יעקב', 32.6974241, 35.1417499, 'data.gov.il+osm'),
  ('שדה יצחק', 'שדה יצחק', 32.4051186, 34.9938162, 'data.gov.il+osm'),
  ('שדה משה', 'שדה משה', 31.6101976, 34.8026633, 'data.gov.il+osm'),
  ('שדה נחום', 'שדה נחום', 32.5271296, 35.4816414, 'data.gov.il+osm'),
  ('שדה נחמיה', 'שדה נחמיה', 33.1869061, 35.6245075, 'data.gov.il+osm'),
  ('שדה ניצן', 'שדה ניצן', 31.2284956, 34.4174077, 'data.gov.il+osm'),
  ('שדה עוזיהו', 'שדה עוזיהו', 31.7575803, 34.6784685, 'data.gov.il+osm'),
  ('שדה צבי', 'שדה צבי', 31.4485403, 34.713287, 'data.gov.il+osm'),
  ('שדות ים', 'שדות ים', 32.4921593, 34.8933053, 'data.gov.il+osm'),
  ('שדות מיכה', 'שדות מיכה', 31.7214757, 34.9206369, 'data.gov.il+osm'),
  ('שדי אברהם', 'שדי אברהם', 31.2121265, 34.3358477, 'data.gov.il+osm'),
  ('שדי חמד', 'שדי חמד', 32.1598443, 34.9435452, 'data.gov.il+osm'),
  ('שדי תרומות', 'שדי תרומות', 32.441356, 35.4854373, 'data.gov.il+osm'),
  ('שדמה', 'שדמה', 31.8330746, 34.7403755, 'data.gov.il+osm'),
  ('שדמות דבורה', 'שדמות דבורה', 32.6954933, 35.4374472, 'data.gov.il+osm'),
  ('שדמות מחולה', 'שדמות מחולה', 32.347731, 35.530587, 'data.gov.il+osm'),
  ('שדרות', 'שדרות', 31.526474, 34.5969696, 'data.gov.il+osm'),
  ('שואבה', 'שואבה', 31.7991564, 35.0790886, 'data.gov.il+osm'),
  ('שובה', 'שובה', 31.4500142, 34.5454341, 'data.gov.il+osm'),
  ('שובל', 'שובל', 31.4143179, 34.7437672, 'data.gov.il+osm'),
  ('שוהם', 'שוהם', 32.0004845, 34.9465419, 'data.gov.il+osm'),
  ('שומרה', 'שומרה', 33.0818094, 35.2841818, 'data.gov.il+osm'),
  ('שומריה', 'שומריה', 31.4317698, 34.8857795, 'data.gov.il+osm'),
  ('שוקדה', 'שוקדה', 31.4216668, 34.5253818, 'data.gov.il+osm'),
  ('שורש', 'שורש', 31.7974834, 35.0651321, 'data.gov.il+osm'),
  ('שורשים', 'שורשים', 32.8927231, 35.2599068, 'data.gov.il+osm'),
  ('שושנת העמקים', 'שושנת העמקים', 32.3543061, 34.8567151, 'data.gov.il+osm'),
  ('שזור', 'שזור', 32.9327346, 35.3535015, 'data.gov.il+osm'),
  ('שחר', 'שחר', 31.6184063, 34.7240639, 'data.gov.il+osm'),
  ('שחרות', 'שחרות', 29.9036921, 34.9992198, 'data.gov.il+osm'),
  ('שיבולים', 'שיבולים', 31.3959804, 34.6089348, 'data.gov.il+osm'),
  ('שיזף', 'שיזף', 31.0016511, 34.7654842, 'data.gov.il+osm'),
  ('שיטים', 'שיטים', 30.176442, 35.016722, 'data.gov.il+osm'),
  ('שייח דנון', 'שייח'' דנון', 32.9943175, 35.1479211, 'data.gov.il+osm'),
  ('שילה', 'שילה', 32.054405, 35.29909, 'data.gov.il+osm'),
  ('שילת', 'שילת', 31.9205606, 35.0173195, 'data.gov.il+osm'),
  ('שכניה', 'שכניה', 32.8487331, 35.246984, 'data.gov.il+osm'),
  ('שלווה', 'שלווה', 31.5635204, 34.7680435, 'data.gov.il+osm'),
  ('שלווה במדבר', 'שלווה במדבר', 31.563697, 34.766832, 'data.gov.il+osm'),
  ('שלוחות', 'שלוחות', 32.4718472, 35.4819367, 'data.gov.il+osm'),
  ('שלומי', 'שלומי', 33.0760504, 35.1485842, 'data.gov.il+osm'),
  ('שלומית', 'שלומית', 31.1685255, 34.3035802, 'data.gov.il+osm'),
  ('שמיר', 'שמיר', 33.163887, 35.6591721, 'data.gov.il+osm'),
  ('שמרת', 'שמרת', 32.9504776, 35.0965233, 'data.gov.il+osm'),
  ('שמשית', 'שמשית', 32.7328247, 35.2472359, 'data.gov.il+osm'),
  ('שני', 'שני', 31.3562772, 35.0692807, 'data.gov.il+osm'),
  ('שניר', 'שניר', 33.2410034, 35.6781947, 'data.gov.il+osm'),
  ('שעב', 'שעב', 32.8905934, 35.2383757, 'data.gov.il+osm'),
  ('שעל', 'שעל', 33.1166371, 35.7187153, 'data.gov.il+osm'),
  ('שעלבים', 'שעלבים', 31.8699629, 34.9839023, 'data.gov.il+osm'),
  ('שער אפרים', 'שער אפרים', 32.2889798, 34.9974416, 'data.gov.il+osm'),
  ('שער הגולן', 'שער הגולן', 32.6858143, 35.6042877, 'data.gov.il+osm'),
  ('שער העמקים', 'שער העמקים', 32.7230505, 35.1131062, 'data.gov.il+osm'),
  ('שער מנשה', 'שער מנשה', 32.509997, 35.00519999999999, 'data.gov.il+osm'),
  ('שפיים', 'שפיים', 32.2169192, 34.8248191, 'data.gov.il+osm'),
  ('שפיר', 'שפיר', 31.6970563, 34.7284254, 'data.gov.il+osm'),
  ('שפר', 'שפר', 32.9433182, 35.4354282, 'data.gov.il+osm'),
  ('שפרעם', 'שפרעם', 32.8035805, 35.1732997, 'data.gov.il+osm'),
  ('שקד', 'שקד', 32.473745, 35.168448, 'data.gov.il+osm'),
  ('שקף', 'שקף', 31.5156708, 34.9377978, 'data.gov.il+osm'),
  ('שרונה', 'שרונה', 32.7254465, 35.4669505, 'data.gov.il+osm'),
  ('שריגים לי און', 'שריגים (לי-און)', 31.678567, 34.93509, 'data.gov.il+osm'),
  ('שריד', 'שריד', 32.6641744, 35.2249937, 'data.gov.il+osm'),
  ('שרשרת', 'שרשרת', 31.4046369, 34.6041162, 'data.gov.il+osm'),
  ('שתולה', 'שתולה', 33.084763, 35.3143141, 'data.gov.il+osm'),
  ('שתולים', 'שתולים', 31.7719562, 34.683597, 'data.gov.il+osm'),
  ('תאשור', 'תאשור', 31.3718709, 34.6437068, 'data.gov.il+osm'),
  ('תדהר', 'תדהר', 31.379004, 34.6284545, 'data.gov.il+osm'),
  ('תובל', 'תובל', 32.9290739, 35.2447876, 'data.gov.il+osm'),
  ('תושיה', 'תושיה', 31.4332368, 34.5411813, 'data.gov.il+osm'),
  ('תימורים', 'תימורים', 31.7160922, 34.7613397, 'data.gov.il+osm'),
  ('תירוש', 'תירוש', 31.750842, 34.8860998, 'data.gov.il+osm'),
  ('תל אביב יפו', 'תל אביב-יפו', 32.0852997, 34.7818064, 'data.gov.il+osm'),
  ('תל אביב', 'תל אביב-יפו', 32.0852997, 34.7818064, 'data.gov.il+osm'),
  ('יפו', 'תל אביב-יפו', 32.0852997, 34.7818064, 'data.gov.il+osm'),
  ('תא', 'תל אביב-יפו', 32.0852997, 34.7818064, 'data.gov.il+osm'),
  ('תל יוסף', 'תל יוסף', 32.5561076, 35.3996519, 'data.gov.il+osm'),
  ('תל יצחק', 'תל יצחק', 32.2527746, 34.8696976, 'data.gov.il+osm'),
  ('תל מונד', 'תל מונד', 32.2536471, 34.9185387, 'data.gov.il+osm'),
  ('תל עדשים', 'תל עדשים', 32.6562957, 35.3024078, 'data.gov.il+osm'),
  ('תל ציון', 'תל ציון', 31.880377, 35.239097, 'data.gov.il+osm'),
  ('תל קציר', 'תל קציר', 32.7051904, 35.6178217, 'data.gov.il+osm'),
  ('תל שבע', 'תל שבע', 31.2450731, 34.8603822, 'data.gov.il+osm'),
  ('תל תאומים', 'תל תאומים', 32.4424193, 35.4964482, 'data.gov.il+osm'),
  ('תלם', 'תלם', 31.563051, 35.03124, 'data.gov.il+osm'),
  ('תלמי אליהו', 'תלמי אליהו', 31.2300278, 34.4294776, 'data.gov.il+osm'),
  ('תלמי אלעזר', 'תלמי אלעזר', 32.4431655, 34.9737349, 'data.gov.il+osm'),
  ('תלמי בילו', 'תלמי בילו', 31.4377026, 34.6454808, 'data.gov.il+osm'),
  ('תלמי יוסף', 'תלמי יוסף', 31.2005275, 34.3638285, 'data.gov.il+osm'),
  ('תלמי יחיאל', 'תלמי יחיאל', 31.753729, 34.7639978, 'data.gov.il+osm'),
  ('תלמי יפה', 'תלמי יפה', 31.6168578, 34.6132893, 'data.gov.il+osm'),
  ('תלמים', 'תלמים', 31.5635578, 34.6720813, 'data.gov.il+osm'),
  ('תמרת', 'תמרת', 32.7038078, 35.2253075, 'data.gov.il+osm'),
  ('תנובות', 'תנובות', 32.305202, 34.9620671, 'data.gov.il+osm'),
  ('תעוז', 'תעוז', 31.8020367, 34.9744581, 'data.gov.il+osm'),
  ('תפרח', 'תפרח', 31.3265145, 34.677459, 'data.gov.il+osm'),
  ('תקומה', 'תקומה', 31.4485605, 34.5775724, 'data.gov.il+osm'),
  ('תקוע', 'תקוע', 31.639093, 35.21249, 'data.gov.il+osm'),
  ('תראבין א צאנע ישוב', 'תראבין א-צאנע(ישוב)', 31.345481, 34.739126, 'data.gov.il+osm'),
  ('תרום', 'תרום', 31.7825667, 34.9815088, 'data.gov.il+osm')
on conflict (norm_name) do update set name = excluded.name, lat = excluded.lat, lon = excluded.lon, source = excluded.source;

-- --------------------------------------------------------------------------
-- 3. Place what this makes placeable
--
-- The same two backfills 0045 ran, which now match a village as well as a city.
-- Both only ever touch a row that has NO position, so a branch already placed —
-- by 0045, or by a real street-level geocode — is never moved.
-- --------------------------------------------------------------------------
do $$
declare
  placed integer;
begin
  with candidate as (
    select b.id, t.lat, t.lon
      from public.branches b
      join lateral (
        select tc.lat, tc.lon
          from public.town_centres tc
         where tc.norm_name = public.norm_place(b.city)
            or public.norm_place(b.city) like tc.norm_name || ' %'
         order by length(tc.norm_name) desc
         limit 1
      ) t on true
     where b.latitude is null
       and b.city is not null
  )
  update public.branches b set latitude          = c.lat,
         longitude         = c.lon,
         geocoded_at       = now(),
         geocode_source    = 'israel-cities (town centre)',
         geocode_precision = 'locality'
    from candidate c
   where c.id = b.id;

  get diagnostics placed = row_count;
  raise notice '0046: placed % more branches at their town centre', placed;
end
$$;

update public.profiles p set home_lat = tc.lat,
       home_lon = tc.lon
  from public.town_centres tc
 where p.home_lat is null
   and p.home_city is not null
   and tc.norm_name = public.norm_place(p.home_city);

-- ======================== 0047_branch_city_codes.sql ========================

-- ---------------------------------------------------------------------------
-- 0047 — some chains write the settlement's NUMBER where its name goes.
--
-- Found on staging, 2026-10-12, by asking which towns we had failed to match. The
-- answer was not towns:
--
--   4000 — 50 branches        7600 — 6 branches        9500 — 6 branches
--   2660 —  6 branches        9400 — 6 branches        7800 — 6 branches
--
-- Those are CBS settlement symbols. 4000 is חיפה, 7600 עכו, 2660 יבנה, 9400
-- יהוד־מונוסון, 9500 קריית ביאליק, 7800 פרדס חנה־כרכור. Some publishers' Stores
-- files put the code in the city column, which is perfectly valid data that 0045's
-- name matching could never recognise — so those branches kept no position, and the
-- app told people, correctly, that it did not know where they were. Ninety-one
-- offers were being held back by it on staging alone.
--
-- The settlement list already carries the same symbol for every row (it is how the
-- government's list is keyed), so this is a lookup we already have and were not using.
--
--   1. town_centres gets the symbol.
--   2. place_branches_by_town() gets a third pass: a city that is all digits is
--      matched against it, with leading zeros ignored on both sides.
--   3. the backfill runs again.
--
-- Still only ever fills a branch that has NO position, so nothing already placed —
-- by 0045, 0046 or a real street-level geocode — is touched.
--
-- WHAT IT DOES NOT DO. It does not guess. A city that is neither a name we know nor
-- a symbol we know still leaves the branch unplaced and out of "closest to me", with
-- the count said out loud on the screen. That is the same rule as everywhere else
-- here: a missing position is visible, a wrong one is not.
-- ---------------------------------------------------------------------------

alter table public.town_centres
  add column if not exists code text;

comment on column public.town_centres.code is
  'The CBS settlement symbol (סמל יישוב). Some publishers'' Stores files carry this '
  'instead of the settlement''s name, so branches are matched on it as well.';

update public.town_centres tc set code = v.code
  from (values
  ('אבו גוש', '472'),
  ('אבו סנאן', '473'),
  ('אבו קרינאת יישוב', '1342'),
  ('אבו תלול', '1375'),
  ('אבטין', '652'),
  ('אבטליון', '1275'),
  ('אביאל', '679'),
  ('אביבים', '1115'),
  ('אביגדור', '819'),
  ('אביחיל', '175'),
  ('אביטל', '2052'),
  ('אביעזר', '1070'),
  ('אבירים', '1220'),
  ('אבן יהודה', '182'),
  ('אבן מנחם', '1081'),
  ('אבן ספיר', '783'),
  ('אבן שמואל', '400'),
  ('אבני איתן', '4011'),
  ('אבשלום', '1311'),
  ('אדירים', '113'),
  ('אדמית', '1068'),
  ('אדרת', '1123'),
  ('אודים', '446'),
  ('אודם', '4010'),
  ('אוהד', '1046'),
  ('אום אל פחם', '2710'),
  ('אום אל קוטוף', '2024'),
  ('אום בטין', '1358'),
  ('אומן', '1108'),
  ('אומץ', '680'),
  ('אופקים', '31'),
  ('אור הגנוז', '1294'),
  ('אור הנר', '67'),
  ('אור יהודה', '2400'),
  ('אור עקיבא', '1020'),
  ('אורה', '780'),
  ('אורות', '2012'),
  ('אורטל', '4013'),
  ('אורים', '403'),
  ('אורנים', '882'),
  ('אורנית', '3760'),
  ('אושה', '278'),
  ('אזור', '565'),
  ('אחוזם', '821'),
  ('אחוזת ברק', '1330'),
  ('אחיהוד', '785'),
  ('אחיטוב', '850'),
  ('אחיסמך', '804'),
  ('אחיעזר', '797'),
  ('אטרש שבט', '965'),
  ('איבי הנחל', '3891'),
  ('איבים', '338'),
  ('אייל', '716'),
  ('איילת השחר', '77'),
  ('אילון', '294'),
  ('אילות', '1126'),
  ('אילניה', '49'),
  ('אילת', '2600'),
  ('אירוס', '1336'),
  ('איתמר', '3762'),
  ('איתן', '37'),
  ('איתנים', '886'),
  ('אכסאל', '478'),
  ('אל סייד', '1359'),
  ('אל עזי', '1339'),
  ('אל עריאן', '1316'),
  ('אל רום', '4003'),
  ('אלומה', '1145'),
  ('אלומות', '330'),
  ('אלון הגליל', '1182'),
  ('אלוני אבא', '429'),
  ('אלוני הבשן', '4017'),
  ('אלוני יצחק', '868'),
  ('אלונים', '285'),
  ('אלי עד', '4002'),
  ('אליאב', '1365'),
  ('אליכין', '41'),
  ('אליפז', '1248'),
  ('אליפלט', '730'),
  ('אליקים', '682'),
  ('אלישיב', '204'),
  ('אלישמע', '841'),
  ('אלמגור', '1125'),
  ('אלמוג', '3556'),
  ('אלעד', '1309'),
  ('אלעזר', '3618'),
  ('אלפי מנשה', '3750'),
  ('אלקוש', '603'),
  ('אמונים', '772'),
  ('אמירים', '1064'),
  ('אמנון', '1253'),
  ('אמציה', '23'),
  ('אניעם', '4012'),
  ('אעבלין', '529'),
  ('אפיק', '4301'),
  ('אפיקים', '176'),
  ('אפק', '313'),
  ('ארבל', '701'),
  ('ארגמן', '3598'),
  ('ארז', '714'),
  ('אריאל', '3570'),
  ('ארסוף', '1324'),
  ('אשבול', '71'),
  ('אשבל', '1276'),
  ('אשדוד', '70'),
  ('אשחר', '1188'),
  ('אשכולות', '3722'),
  ('אשל הנשיא', '2021'),
  ('אשלים', '1152'),
  ('אשקלון', '7100'),
  ('אשרת', '1256'),
  ('אשתאול', '740'),
  ('אתגר', '1298'),
  ('באקה אל גרביה', '6000'),
  ('באר אורה', '21'),
  ('באר גנים', '1376'),
  ('באר טוביה', '155'),
  ('באר יעקב', '2530'),
  ('באר מילכה', '1278'),
  ('באר שבע', '9000'),
  ('בארות יצחק', '450'),
  ('בארותיים', '697'),
  ('בארי', '399'),
  ('בוסתן הגליל', '559'),
  ('בועיינה נוגידאת', '482'),
  ('בוקעאתא', '4001'),
  ('בורגתה', '698'),
  ('בחן', '2043'),
  ('בטחה', '762'),
  ('ביצרון', '234'),
  ('ביר אל מכסור', '998'),
  ('ביריה', '368'),
  ('בית אורן', '317'),
  ('בית אל', '3574'),
  ('בית אלעזרי', '562'),
  ('בית אלפא', '95'),
  ('בית ברל', '1076'),
  ('בית גן', '480'),
  ('בית גוברין', '619'),
  ('בית גמליאל', '571'),
  ('בית דגן', '466'),
  ('בית הגדי', '723'),
  ('בית הלוי', '373'),
  ('בית הלל', '322'),
  ('בית העמק', '572'),
  ('בית השיטה', '242'),
  ('בית זית', '710'),
  ('בית זרע', '143'),
  ('בית חוגלה', '3864'),
  ('בית חורון', '3575'),
  ('בית חירות', '877'),
  ('בית חלקיה', '2033'),
  ('בית חנן', '159'),
  ('בית חנניה', '800'),
  ('בית חשמונאי', '1050'),
  ('בית יהושע', '288'),
  ('בית יוסף', '265'),
  ('בית ינאי', '200'),
  ('בית יצחק שער חפר', '326'),
  ('בית יתיר', '3745'),
  ('בית לחם הגלילית', '430'),
  ('בית מאיר', '751'),
  ('בית נחמיה', '784'),
  ('בית ניר', '16'),
  ('בית נקופה', '672'),
  ('בית עובד', '202'),
  ('בית עוזיאל', '301'),
  ('בית עזרא', '756'),
  ('בית עריף', '604'),
  ('בית צבי', '212'),
  ('בית קמה', '598'),
  ('בית קשת', '365'),
  ('בית רימון', '1162'),
  ('בית שאן', '9200'),
  ('בית שמש', '2610'),
  ('בית שערים', '248'),
  ('בית שקמה', '747'),
  ('ביתן אהרן', '252'),
  ('בלפוריה', '94'),
  ('בן זכאי', '760'),
  ('בן עמי', '712'),
  ('בני ברק', '6100'),
  ('בני דקלים', '1368'),
  ('בני דרום', '592'),
  ('בני דרור', '386'),
  ('בני יהודה', '4015'),
  ('בני נצרים', '1363'),
  ('בני עטרות', '448'),
  ('בני עיש', '1066'),
  ('בני ציון', '418'),
  ('בני ראם', '588'),
  ('בניה', '685'),
  ('בנימינה גבעת עדה', '9800'),
  ('בסמה', '1326'),
  ('בסמת טבעון', '944'),
  ('בענה', '483'),
  ('בצרה', '389'),
  ('בצת', '589'),
  ('בקוע', '864'),
  ('בר גיורא', '823'),
  ('בר יוחאי', '1191'),
  ('בר כוכבא', '3499'),
  ('ברוכין', '3744'),
  ('ברור חיל', '428'),
  ('ברוש', '2060'),
  ('ברכיה', '746'),
  ('ברעם', '667'),
  ('ברק', '141'),
  ('ברקאי', '617'),
  ('ברקן', '3654'),
  ('ברקת', '2038'),
  ('בת הדר', '1323'),
  ('בת חן', '1361'),
  ('בת חפר', '1319'),
  ('בת ים', '6200'),
  ('בת שלמה', '33'),
  ('גדיידה מכר', '1292'),
  ('גולס', '485'),
  ('גלגוליה', '627'),
  ('גסר א זרקא', '541'),
  ('גש גוש חלב', '487'),
  ('גת', '628'),
  ('גאולי תימן', '872'),
  ('גאולים', '379'),
  ('גאליה', '853'),
  ('גבולות', '352'),
  ('גבים', '424'),
  ('גבע', '86'),
  ('גבע בנימין', '3763'),
  ('גבע כרמל', '683'),
  ('גבעולים', '2014'),
  ('גבעון החדשה', '3644'),
  ('גבעות בר', '1344'),
  ('גבעות עדן', '1362'),
  ('גבעת אבני', '1293'),
  ('גבעת אלה', '1288'),
  ('גבעת ברנר', '147'),
  ('גבעת השלושה', '870'),
  ('גבעת זאב', '3730'),
  ('גבעת חיים איחוד', '2018'),
  ('גבעת חיים מאוחד', '173'),
  ('גבעת חן', '207'),
  ('גבעת יואב', '4021'),
  ('גבעת יערים', '787'),
  ('גבעת ישעיהו', '919'),
  ('גבעת כח', '802'),
  ('גבעת נילי', '360'),
  ('גבעת עוז', '703'),
  ('גבעת שמואל', '681'),
  ('גבעת שמש', '566'),
  ('גבעת שפירא', '1077'),
  ('גבעתי', '793'),
  ('גבעתיים', '6300'),
  ('גברעם', '342'),
  ('גבת', '133'),
  ('גדות', '35'),
  ('גדיש', '145'),
  ('גדעונה', '442'),
  ('גדרה', '2550'),
  ('גונן', '852'),
  ('גורן', '755'),
  ('גורנות הגליל', '1219'),
  ('גזית', '457'),
  ('גזר', '370'),
  ('גיאה', '706'),
  ('גיבתון', '196'),
  ('גיזו', '1043'),
  ('גילון', '1204'),
  ('גילת', '736'),
  ('גינוסר', '262'),
  ('גיניגר', '92'),
  ('גינתון', '863'),
  ('גיתה', '1206'),
  ('גיתית', '3613'),
  ('גלאון', '393'),
  ('גליל ים', '346'),
  ('גלעד אבן יצחק', '369'),
  ('גמזו', '745'),
  ('גן הדרום', '1072'),
  ('גן השומרון', '225'),
  ('גן חיים', '239'),
  ('גן יאשיה', '734'),
  ('גן יבנה', '166'),
  ('גן נר', '1274'),
  ('גן שורק', '311'),
  ('גן שלמה', '144'),
  ('גן שמואל', '72'),
  ('גנות', '836'),
  ('גנות הדר', '549'),
  ('גני הדר', '1103'),
  ('גני טל', '1371'),
  ('גני יוחנן', '862'),
  ('גני מודיעין', '3823'),
  ('גני עם', '218'),
  ('גני תקווה', '229'),
  ('געש', '842'),
  ('געתון', '463'),
  ('גפן', '39'),
  ('גרופית', '1129'),
  ('גשור', '4022'),
  ('גשר', '305'),
  ('גשר הזיו', '574'),
  ('גת קיבוץ', '340'),
  ('גת רימון', '128'),
  ('דאלית אל כרמל', '494'),
  ('דבורה', '146'),
  ('דבוריה', '489'),
  ('דביר', '849'),
  ('דברת', '407'),
  ('דגניה א', '62'),
  ('דגניה ב', '79'),
  ('דובב', '1067'),
  ('דור', '738'),
  ('דורות', '336'),
  ('דחי', '475'),
  ('דייר אל אסד', '490'),
  ('דייר חנא', '492'),
  ('דייר ראפאת', '493'),
  ('דימונה', '2200'),
  ('דישון', '2063'),
  ('דליה', '300'),
  ('דלתון', '431'),
  ('דמיידה', '1317'),
  ('דן', '303'),
  ('דפנה', '302'),
  ('דקל', '1241'),
  ('דריגאת', '1349'),
  ('האון', '702'),
  ('הבונים', '675'),
  ('הגושרים', '356'),
  ('הדר עם', '191'),
  ('הוד השרון', '9700'),
  ('הודיה', '726'),
  ('הודיות', '1322'),
  ('הושעיה', '1186'),
  ('הזורע', '250'),
  ('הזורעים', '307'),
  ('החותרים', '434'),
  ('היוגב', '684'),
  ('המעפיל', '377'),
  ('הסוללים', '677'),
  ('העוגן', '423'),
  ('הר אדר', '3769'),
  ('הר גילה', '3603'),
  ('הר עמשא', '1261'),
  ('הראל', '464'),
  ('הרדוף', '1249'),
  ('הרצליה', '6400'),
  ('הררית', '1203'),
  ('ורדון', '1133'),
  ('זבדיאל', '815'),
  ('זוהר', '44'),
  ('זיקים', '584'),
  ('זיתן', '788'),
  ('זכרון יעקב', '9300'),
  ('זכריה', '799'),
  ('זמר', '1290'),
  ('זמרת', '1065'),
  ('זנוח', '816'),
  ('זרועה', '2064'),
  ('זרזיר', '975'),
  ('זרחיה', '818'),
  ('חבצלת השרון', '235'),
  ('חבר', '1110'),
  ('חברון', '3400'),
  ('חגור', '717'),
  ('חגי', '3764'),
  ('חגלה', '205'),
  ('חד נס', '4026'),
  ('חדיד', '618'),
  ('חדרה', '6500'),
  ('חוגייראת דהרה', '948'),
  ('חולדה', '160'),
  ('חולון', '6600'),
  ('חולית', '1239'),
  ('חולתה', '253'),
  ('חוסן', '662'),
  ('חוסנייה', '1332'),
  ('חופית', '115'),
  ('חוקוק', '374'),
  ('חורה', '1303'),
  ('חורפיש', '496'),
  ('חורשים', '355'),
  ('חזון', '1047'),
  ('חיבת ציון', '219'),
  ('חיננית', '3643'),
  ('חיפה', '4000'),
  ('חירות', '162'),
  ('חלוץ', '1272'),
  ('חלץ', '820'),
  ('חמאם', '993'),
  ('חמד', '801'),
  ('חמדיה', '343'),
  ('חניאל', '807'),
  ('חניתה', '280'),
  ('חנתון', '1257'),
  ('חספין', '4005'),
  ('חפץ חיים', '363'),
  ('חפצי בה', '90'),
  ('חצב', '700'),
  ('חצבה', '13'),
  ('חצור הגלילית', '2034'),
  ('חצור אשדוד', '406'),
  ('חצרים', '397'),
  ('חרב לאת', '422'),
  ('חרוצים', '1024'),
  ('חריש', '1247'),
  ('חרמש', '3717'),
  ('חרשים', '1209'),
  ('חשמונאים', '3770'),
  ('טבריה', '6700'),
  ('טובא זנגריה', '962'),
  ('טורעאן', '498'),
  ('טירת יהודה', '663'),
  ('טירת כרמל', '2100'),
  ('טירת צבי', '268'),
  ('טל מנשה', '3873'),
  ('טל שחר', '462'),
  ('טל אל', '1181'),
  ('טללים', '1177'),
  ('טמרה', '8900'),
  ('טמרה יזרעאל', '547'),
  ('טנא', '3743'),
  ('טפחות', '1214'),
  ('יאנוח גת', '1295'),
  ('יבול', '1232'),
  ('יבנאל', '46'),
  ('יבנה', '2660'),
  ('יגור', '96'),
  ('יגל', '798'),
  ('יד בנימין', '577'),
  ('יד השמונה', '1134'),
  ('יד חנה', '758'),
  ('יד מרדכי', '358'),
  ('יד נתן', '775'),
  ('יד רמבם', '64'),
  ('ידידה', '1144'),
  ('יהוד מונוסון', '9400'),
  ('יהוד', '9400'),
  ('יהל', '1158'),
  ('יובל', '2009'),
  ('יובלים', '1226'),
  ('יודפת', '1112'),
  ('יונתן', '4007'),
  ('יושיביה', '803'),
  ('יזרעאל', '452'),
  ('יחיעם', '409'),
  ('יטבתה', '866'),
  ('ייטב', '3607'),
  ('יכיני', '811'),
  ('ינוב', '753'),
  ('ינון', '2011'),
  ('יסוד המעלה', '29'),
  ('יסודות', '440'),
  ('יסעור', '575'),
  ('יעד', '1138'),
  ('יעל', '1117'),
  ('יעף', '1044'),
  ('יערה', '795'),
  ('יפיע', '499'),
  ('יפעת', '134'),
  ('יפתח', '453'),
  ('יציץ', '759'),
  ('יקום', '417'),
  ('יקיר', '3647'),
  ('יקנעם מושבה', '241'),
  ('יקנעם עילית', '240'),
  ('יקנעם', '240'),
  ('יראון', '623'),
  ('ירדנה', '2026'),
  ('ירוחם', '831'),
  ('ירושלים', '3000'),
  ('י ם', '3000'),
  ('ירושלם', '3000'),
  ('ירחיב', '718'),
  ('ירכא', '502'),
  ('ירקונה', '183'),
  ('ישע', '916'),
  ('ישעי', '805'),
  ('ישרש', '828'),
  ('יתד', '1227'),
  ('כאבול', '504'),
  ('כאוכב אבו אל היגא', '505'),
  ('כברי', '576'),
  ('כדורי', '371'),
  ('כדיתה', '1338'),
  ('כוכב השחר', '3564'),
  ('כוכב יאיר צור יגאל', '1224'),
  ('כוכב יעקב', '3779'),
  ('כוכב מיכאל', '824'),
  ('כורזים', '1252'),
  ('כחל', '1210'),
  ('כחלה', '1367'),
  ('כיסופים', '840'),
  ('כישור', '1153'),
  ('כליל', '1183'),
  ('כלנית', '1229'),
  ('כמאנה', '1331'),
  ('כמהין', '1291'),
  ('כמון', '1201'),
  ('כנות', '2006'),
  ('כנף', '4028'),
  ('כסיפה', '1059'),
  ('כסלון', '859'),
  ('כסרא סמיע', '1296'),
  ('כעביה טבאש חגאגרה', '978'),
  ('כפר אביב', '857'),
  ('כפר אוריה', '364'),
  ('כפר אחים', '690'),
  ('כפר ביאליק', '220'),
  ('כפר בילו', '177'),
  ('כפר בלום', '357'),
  ('כפר בן נון', '2010'),
  ('כפר ברא', '633'),
  ('כפר ברוך', '132'),
  ('כפר גדעון', '106'),
  ('כפר גלים', '427'),
  ('כפר גליקסון', '310'),
  ('כפר גלעדי', '76'),
  ('כפר דניאל', '707'),
  ('כפר החורש', '192'),
  ('כפר המכבי', '254'),
  ('כפר הנגיד', '582'),
  ('כפר הנוער הדתי', '890'),
  ('כפר הנשיא', '443'),
  ('כפר הס', '187'),
  ('כפר הריף', '888'),
  ('כפר ויתקין', '190'),
  ('כפר ורבורג', '320'),
  ('כפר ורדים', '1263'),
  ('כפר זוהרים', '1325'),
  ('כפר זיתים', '786'),
  ('כפר חבד', '696'),
  ('כפר חושן', '609'),
  ('כפר חיטים', '255'),
  ('כפר חיים', '193'),
  ('כפר חנניה', '1297'),
  ('כפר חסידים א', '112'),
  ('כפר חסידים ב', '889'),
  ('כפר חרוב', '4004'),
  ('כפר טרומן', '673'),
  ('כפר יאסיף', '507'),
  ('כפר ידידיה', '233'),
  ('כפר יהושע', '140'),
  ('כפר יונה', '168'),
  ('כפר יחזקאל', '85'),
  ('כפר יעבץ', '170'),
  ('כפר כמא', '508'),
  ('כפר כנא', '509'),
  ('כפר מונש', '387'),
  ('כפר מימון', '1095'),
  ('כפר מלל', '98'),
  ('כפר מנדא', '510'),
  ('כפר מנחם', '274'),
  ('כפר מסריק', '297'),
  ('כפר מצר', '512'),
  ('כפר מרדכי', '764'),
  ('כפר נטר', '316'),
  ('כפר סאלד', '345'),
  ('כפר סבא', '6900'),
  ('כפר סילבר', '107'),
  ('כפר סירקין', '249'),
  ('כפר עבודה', '875'),
  ('כפר עזה', '845'),
  ('כפר פינס', '189'),
  ('כפר קאסם', '634'),
  ('כפר קיש', '388'),
  ('כפר קרע', '654'),
  ('כפר ראש הנקרה', '579'),
  ('כפר רופין', '295'),
  ('כפר רות', '1166'),
  ('כפר שמאי', '605'),
  ('כפר שמואל', '743'),
  ('כפר שמריהו', '267'),
  ('כפר תבור', '47'),
  ('כרכום', '1285'),
  ('כרם ביבנה ישיבה', '1094'),
  ('כרם בן זמרה', '664'),
  ('כרם בן שמן', '88'),
  ('כרם מהרל', '580'),
  ('כרם שלום', '1085'),
  ('כרמי יוסף', '1264'),
  ('כרמי קטיף', '1374'),
  ('כרמיאל', '1139'),
  ('כרמיה', '768'),
  ('כרמים', '1198'),
  ('כרמל', '3656'),
  ('לבון', '1207'),
  ('לביא', '585'),
  ('לבנים', '1230'),
  ('להב', '2023'),
  ('להבות הבשן', '380'),
  ('להבות חביבה', '715'),
  ('להבים', '1271'),
  ('לוד', '7000'),
  ('לוזית', '52'),
  ('לוחמי הגיטאות', '595'),
  ('לוטם', '1171'),
  ('לוטן', '1255'),
  ('לימן', '674'),
  ('לכיש', '24'),
  ('לפיד', '1310'),
  ('לפידות', '1173'),
  ('לקיה', '1060'),
  ('מאור', '2055'),
  ('מבוא ביתר', '771'),
  ('מבוא חורון', '3709'),
  ('מבוא חמה', '4204'),
  ('מבוא מודיעים', '1141'),
  ('מבואות ים', '1318'),
  ('מבואות יריחו', '3825'),
  ('מבועים', '1080'),
  ('מבטחים', '829'),
  ('מבקיעים', '573'),
  ('מבשרת ציון', '1015'),
  ('מגד אל כרום', '516'),
  ('מגדל שמס', '4201'),
  ('מגאר', '481'),
  ('מגדים', '689'),
  ('מגדל', '65'),
  ('מגדל העמק', '874'),
  ('מגידו', '586'),
  ('מגל', '375'),
  ('מגן', '695'),
  ('מגן שאול', '1155'),
  ('מגשימים', '722'),
  ('מדרך עוז', '2029'),
  ('מדרשת בן גוריון', '1140'),
  ('מדרשת רופין', '897'),
  ('מודיעין עילית', '3797'),
  ('מודיעין מכבים רעות', '1200'),
  ('מודיעין', '1200'),
  ('מולדת', '269'),
  ('מוצא עילית', '208'),
  ('מוקייבלה', '635'),
  ('מורן', '1163'),
  ('מורשת', '1178'),
  ('מזור', '606'),
  ('מזכרת בתיה', '28'),
  ('מזרע', '104'),
  ('מזרעה', '517'),
  ('מחולה', '3599'),
  ('מחנה יתיר', '1196'),
  ('מחניים', '308'),
  ('מחסיה', '776'),
  ('מטולה', '43'),
  ('מטע', '822'),
  ('מי עמי', '1128'),
  ('מיטב', '2054'),
  ('מייסר', '649'),
  ('מיצר', '4019'),
  ('מירב', '1282'),
  ('מירון', '607'),
  ('מישר', '731'),
  ('מיתר', '1268'),
  ('מכחול', '1343'),
  ('מכמורת', '382'),
  ('מכמנים', '1202'),
  ('מלאה', '164'),
  ('מלילות', '2044'),
  ('מלכיה', '596'),
  ('מנוחה', '2030'),
  ('מנוף', '1174'),
  ('מנות', '1205'),
  ('מנחמיה', '48'),
  ('מנרה', '347'),
  ('מנשית זבדה', '994'),
  ('מסד', '1258'),
  ('מסדה', '263'),
  ('מסילות', '298'),
  ('מסילת ציון', '742'),
  ('מסלול', '748'),
  ('מסעדה', '4203'),
  ('מסעודין אל עזאזמה', '939'),
  ('מעברות', '197'),
  ('מעגלים', '1082'),
  ('מעגן', '678'),
  ('מעגן מיכאל', '694'),
  ('מעוז חיים', '272'),
  ('מעון', '3657'),
  ('מעונה', '570'),
  ('מעיליא', '518'),
  ('מעין ברוך', '416'),
  ('מעין צבי', '290'),
  ('מעלה גלבוע', '1127'),
  ('מעלה גמלא', '4008'),
  ('מעלה החמישה', '286'),
  ('מעלה מכמש', '3651'),
  ('מעלה עירון', '1327'),
  ('מעלה עמוס', '3653'),
  ('מעלות תרשיחא', '1063'),
  ('מעלות', '1063'),
  ('תרשיחא', '1063'),
  ('מענית', '344'),
  ('מעש', '230'),
  ('מפלסים', '668'),
  ('מצובה', '325'),
  ('מצליח', '757'),
  ('מצפה', '58'),
  ('מצפה אביב', '1222'),
  ('מצפה אילן', '1370'),
  ('מצפה יריחו', '3576'),
  ('מצפה נטופה', '1190'),
  ('מצפה רמון', '99'),
  ('מצפה שלם', '3610'),
  ('מצר', '648'),
  ('מרגליות', '843'),
  ('מרום גולן', '4101'),
  ('מרחב עם', '1340'),
  ('מרחביה מושב', '97'),
  ('מרחביה קיבוץ', '66'),
  ('מרכז שפירא', '1098'),
  ('משאבי שדה', '421'),
  ('משגב דב', '765'),
  ('משגב עם', '378'),
  ('משהד', '520'),
  ('משואה', '3605'),
  ('משואות יצחק', '620'),
  ('משמר איילון', '670'),
  ('משמר דוד', '563'),
  ('משמר הירדן', '732'),
  ('משמר הנגב', '395'),
  ('משמר העמק', '130'),
  ('משמר השבעה', '729'),
  ('משמר השרון', '194'),
  ('משמר יהודה', '3865'),
  ('משמרות', '213'),
  ('משמרת', '425'),
  ('משען', '791'),
  ('מתן', '1315'),
  ('מתת', '1184'),
  ('מתתיהו', '3648'),
  ('נאות גולן', '4551'),
  ('נאות הכיכר', '1124'),
  ('נאות מרדכי', '408'),
  ('נאות סמדר', '1197'),
  ('נאעורה', '524'),
  ('נבטים', '396'),
  ('נגבה', '315'),
  ('נגוהות', '3724'),
  ('נהורה', '309'),
  ('נהלל', '80'),
  ('נהריה', '9100'),
  ('נוב', '4304'),
  ('נוגה', '55'),
  ('נוה צוף', '3573'),
  ('נווה', '1366'),
  ('נווה אבות', '926'),
  ('נווה אור', '590'),
  ('נווה אטיב', '4303'),
  ('נווה אילן', '405'),
  ('נווה איתן', '296'),
  ('נווה זוהר', '1057'),
  ('נווה זיו', '1314'),
  ('נווה חריף', '1279'),
  ('נווה ים', '312'),
  ('נווה ימין', '686'),
  ('נווה ירק', '858'),
  ('נווה מבטח', '827'),
  ('נווה מיכאל', '1071'),
  ('נועם', '15'),
  ('נוף איילון', '1333'),
  ('נוף הגליל', '1061'),
  ('נצרת עילית', '1061'),
  ('נופי פרת', '3876'),
  ('נופית', '1284'),
  ('נופך', '257'),
  ('נורדיה', '447'),
  ('נורית', '833'),
  ('נחושה', '59'),
  ('נחל עוז', '844'),
  ('נחלה', '2045'),
  ('נחלים', '449'),
  ('נחם', '809'),
  ('נחף', '522'),
  ('נחשולים', '433'),
  ('נחשון', '777'),
  ('נחשונים', '705'),
  ('נטועה', '1147'),
  ('נטור', '4014'),
  ('נטע', '1369'),
  ('נטעים', '174'),
  ('נטף', '1254'),
  ('ניין', '523'),
  ('ניצן', '351'),
  ('ניצן ב', '1419'),
  ('ניצנה קהילת חינוך', '1195'),
  ('ניצני סיני', '1280'),
  ('ניצני עוז', '851'),
  ('ניצנים', '359'),
  ('ניר אליהו', '808'),
  ('ניר בנים', '553'),
  ('ניר גלים', '720'),
  ('ניר דוד תל עמל', '256'),
  ('ניר חן', '11'),
  ('ניר יפה', '165'),
  ('ניר יצחק', '402'),
  ('ניר ישראל', '699'),
  ('ניר משה', '2047'),
  ('ניר עוז', '69'),
  ('ניר עם', '348'),
  ('ניר עציון', '769'),
  ('ניר עקיבא', '2048'),
  ('ניר צבי', '331'),
  ('נירים', '602'),
  ('נירית', '1236'),
  ('נמרוד', '4035'),
  ('נס הרים', '825'),
  ('נס עמים', '1143'),
  ('נס ציונה', '7200'),
  ('נעורים', '186'),
  ('נעלה', '3787'),
  ('נעמה', '3713'),
  ('נען', '158'),
  ('נצאצרה שבט', '1041'),
  ('נצר חזני', '1372'),
  ('נצר סרני', '435'),
  ('נצרת', '7300'),
  ('נריה', '3890'),
  ('נשר', '2500'),
  ('נתיב הלה', '693'),
  ('נתיב העשרה', '1242'),
  ('נתיב השיירה', '792'),
  ('נתיבות', '246'),
  ('נתניה', '7400'),
  ('סאגור', '525'),
  ('סאסא', '578'),
  ('סביון', '587'),
  ('סגולה', '2046'),
  ('סולם', '526'),
  ('סופה', '1238'),
  ('סחנין', '7500'),
  ('סייד שבט', '1170'),
  ('סלמה', '1245'),
  ('סלעית', '3567'),
  ('סמר', '1156'),
  ('סנסנה', '3777'),
  ('סעד', '419'),
  ('סער', '454'),
  ('ספיר', '1176'),
  ('סתריה', '610'),
  ('עגר', '4501'),
  ('עבדון', '892'),
  ('עברון', '376'),
  ('עגור', '794'),
  ('עדי', '1199'),
  ('עדנים', '2035'),
  ('עוזה', '826'),
  ('עוזייר', '528'),
  ('עולש', '737'),
  ('עומר', '666'),
  ('עופר', '810'),
  ('עופרה', '3617'),
  ('עוצם', '32'),
  ('עוקבי בנו עוקבה', '957'),
  ('עזוז', '328'),
  ('עזר', '1149'),
  ('עזריאל', '837'),
  ('עזריה', '711'),
  ('עזריקם', '817'),
  ('עידן', '1175'),
  ('עיילבון', '530'),
  ('עיינות', '156'),
  ('עילוט', '511'),
  ('עין איילה', '687'),
  ('עין אל אסד', '546'),
  ('עין גב', '273'),
  ('עין גדי', '2042'),
  ('עין דור', '436'),
  ('עין הבשור', '1240'),
  ('עין החורש', '167'),
  ('עין המפרץ', '289'),
  ('עין הנציב', '383'),
  ('עין העמק', '367'),
  ('עין השופט', '270'),
  ('עין השלושה', '676'),
  ('עין ורד', '157'),
  ('עין זיוון', '4503'),
  ('עין חצבה', '1053'),
  ('עין יהב', '806'),
  ('עין יעקב', '813'),
  ('עין כרם ביס חקלאי', '1056'),
  ('עין כרמל', '426'),
  ('עין מאהל', '532'),
  ('עין נקובא', '521'),
  ('עין עירון', '223'),
  ('עין צורים', '622'),
  ('עין קנייא', '4502'),
  ('עין ראפה', '514'),
  ('עין שמר', '139'),
  ('עין שריד', '880'),
  ('עין תמר', '1251'),
  ('עינת', '871'),
  ('עיר אובות', '1187'),
  ('עכו', '7600'),
  ('עלומים', '1146'),
  ('עלי זהב', '3727'),
  ('עלמה', '688'),
  ('עלמון', '3715'),
  ('עמוקה', '1212'),
  ('עמינדב', '779'),
  ('עמיעד', '385'),
  ('עמיעוז', '318'),
  ('עמיקם', '773'),
  ('עמיר', '319'),
  ('עמקה', '708'),
  ('ענב', '3712'),
  ('עספיא', '534'),
  ('עפולה', '7700'),
  ('עצמון שגב', '917'),
  ('עראבה', '531'),
  ('עראמשה', '1246'),
  ('ערב אל נעים', '1335'),
  ('ערד', '2560'),
  ('ערוגות', '593'),
  ('ערערה', '637'),
  ('ערערה בנגב', '1192'),
  ('עשרת', '591'),
  ('עתלית', '53'),
  ('עתניאל', '3748'),
  ('פארן', '1151'),
  ('פדואל', '3768'),
  ('פדויים', '750'),
  ('פדיה', '838'),
  ('פוריה כפר עבודה', '1104'),
  ('פוריה נווה עובד', '1105'),
  ('פוריה עילית', '1313'),
  ('פוריידיס', '537'),
  ('פורת', '767'),
  ('פטיש', '749'),
  ('פלך', '1185'),
  ('פלמחים', '597'),
  ('פני חבר', '3723'),
  ('פסוטה', '535'),
  ('פעמי תשז', '2059'),
  ('פרדס חנה כרכור', '7800'),
  ('פרדס חנה', '7800'),
  ('כרכור', '7800'),
  ('פרדסיה', '171'),
  ('פרוד', '599'),
  ('פרזון', '2053'),
  ('פרי גן', '1231'),
  ('פתח תקווה', '7900'),
  ('פתחיה', '839'),
  ('צאלים', '413'),
  ('צביה', '1180'),
  ('צבעון', '1213'),
  ('צובה', '465'),
  ('צוחר', '1136'),
  ('צופים', '3791'),
  ('צופית', '198'),
  ('צופר', '1150'),
  ('צוקי ים', '1102'),
  ('צוקים', '1262'),
  ('צור הדסה', '1113'),
  ('צור יצחק', '1345'),
  ('צור משה', '276'),
  ('צור נתן', '1148'),
  ('צוריאל', '774'),
  ('צורית', '1221'),
  ('ציפורי', '613'),
  ('צלפון', '796'),
  ('צנדלה', '636'),
  ('צפריה', '594'),
  ('צפרירים', '1079'),
  ('צפת', '8000'),
  ('צרופה', '612'),
  ('צרעה', '567'),
  ('קבוצת יבנה', '334'),
  ('קדימה צורן', '195'),
  ('קדמה', '392'),
  ('קדמת צבי', '4025'),
  ('קדר', '3781'),
  ('קדרון', '615'),
  ('קדרים', '1211'),
  ('קוממיות', '766'),
  ('קורנית', '1179'),
  ('קטורה', '1052'),
  ('קיסריה', '1167'),
  ('קלחים', '414'),
  ('קלנסווה', '638'),
  ('קלע', '4024'),
  ('קציר', '1243'),
  ('קצר א סר', '1347'),
  ('קצרין', '4100'),
  ('קריית אונו', '2620'),
  ('קריית אתא', '6800'),
  ('קריית ביאליק', '9500'),
  ('קריית גת', '2630'),
  ('קריית טבעון', '2300'),
  ('קריית ים', '9600'),
  ('קריית מוצקין', '8200'),
  ('קריית מלאכי', '1034'),
  ('קריית שמונה', '2800'),
  ('קריית יערים', '1137'),
  ('קריית יערים מוסד', '2039'),
  ('קריית נטפים', '3746'),
  ('קריית ענבים', '78'),
  ('קריית עקרון', '469'),
  ('קשת', '4006'),
  ('ראמה', '543'),
  ('ראס אל עין', '1334'),
  ('ראס עלי', '990'),
  ('ראש העין', '2640'),
  ('ראש פינה', '26'),
  ('ראשון לציון', '8300'),
  ('רבדים', '564'),
  ('רביבים', '354'),
  ('רביד', '1225'),
  ('רגבה', '390'),
  ('רגבים', '444'),
  ('רהט', '1161'),
  ('רווחה', '2051'),
  ('רוויה', '2016'),
  ('רוח מדבר', '1341'),
  ('רוחמה', '362'),
  ('רומאנה', '539'),
  ('רומת הייב', '997'),
  ('רותם', '3782'),
  ('רחוב', '854'),
  ('רחובות', '8400'),
  ('ריינה', '542'),
  ('רינתיה', '616'),
  ('רכסים', '922'),
  ('רם און', '1069'),
  ('רמות', '4702'),
  ('רמות השבים', '206'),
  ('רמות מאיר', '735'),
  ('רמות מנשה', '445'),
  ('רמות נפתלי', '372'),
  ('רמלה', '8500'),
  ('רמת גן', '8600'),
  ('רמת דוד', '135'),
  ('רמת הכובש', '184'),
  ('רמת השופט', '335'),
  ('רמת השרון', '2650'),
  ('רמת יוחנן', '178'),
  ('רמת ישי', '122'),
  ('רמת מגשימים', '4701'),
  ('רמת צבי', '339'),
  ('רמת רזיאל', '460'),
  ('רמת רחל', '127'),
  ('רנן', '789'),
  ('רעים', '713'),
  ('רעננה', '8700'),
  ('רקפת', '1228'),
  ('רשפון', '247'),
  ('רשפים', '437'),
  ('רתמים', '1260'),
  ('שאר ישוב', '324'),
  ('שבי דרום', '1377'),
  ('שבי ציון', '282'),
  ('שבי שומרון', '3571'),
  ('שבלי אום אל גנם', '913'),
  ('שגב שלום', '1286'),
  ('שדה אילן', '721'),
  ('שדה אליהו', '304'),
  ('שדה אליעזר', '861'),
  ('שדה בוקר', '885'),
  ('שדה דוד', '36'),
  ('שדה ורבורג', '284'),
  ('שדה יואב', '293'),
  ('שדה יעקב', '142'),
  ('שדה יצחק', '2008'),
  ('שדה משה', '18'),
  ('שדה נחום', '259'),
  ('שדה נחמיה', '329'),
  ('שדה ניצן', '1058'),
  ('שדה עוזיהו', '739'),
  ('שדה צבי', '2049'),
  ('שדות ים', '327'),
  ('שדות מיכה', '27'),
  ('שדי אברהם', '1223'),
  ('שדי חמד', '2015'),
  ('שדי תרומות', '2057'),
  ('שדמה', '555'),
  ('שדמות דבורה', '306'),
  ('שדמות מחולה', '3578'),
  ('שדרות', '1031'),
  ('שואבה', '741'),
  ('שובה', '761'),
  ('שובל', '394'),
  ('שוהם', '1304'),
  ('שומרה', '614'),
  ('שומריה', '1265'),
  ('שוקדה', '415'),
  ('שורש', '456'),
  ('שורשים', '1235'),
  ('שושנת העמקים', '224'),
  ('שזור', '527'),
  ('שחר', '7'),
  ('שחרות', '1266'),
  ('שיבולים', '865'),
  ('שיזף', '1378'),
  ('שיטים', '1267'),
  ('שייח דנון', '658'),
  ('שילה', '3641'),
  ('שילת', '1165'),
  ('שכניה', '1160'),
  ('שלווה', '873'),
  ('שלווה במדבר', '1373'),
  ('שלוחות', '439'),
  ('שלומי', '812'),
  ('שלומית', '1364'),
  ('שמיר', '366'),
  ('שמרת', '432'),
  ('שמשית', '1337'),
  ('שני', '1287'),
  ('שניר', '1132'),
  ('שעב', '538'),
  ('שעל', '4009'),
  ('שעלבים', '856'),
  ('שער אפרים', '661'),
  ('שער הגולן', '264'),
  ('שער העמקים', '237'),
  ('שער מנשה', '921'),
  ('שפיים', '232'),
  ('שפיר', '692'),
  ('שפר', '846'),
  ('שפרעם', '8800'),
  ('שקד', '3649'),
  ('שקף', '1233'),
  ('שרונה', '292'),
  ('שריגים לי און', '1114'),
  ('שריד', '126'),
  ('שרשרת', '398'),
  ('שתולה', '1045'),
  ('שתולים', '763'),
  ('תאשור', '2062'),
  ('תדהר', '2061'),
  ('תובל', '1172'),
  ('תושיה', '1083'),
  ('תימורים', '163'),
  ('תירוש', '10'),
  ('תל אביב יפו', '5000'),
  ('תל אביב', '5000'),
  ('יפו', '5000'),
  ('תא', '5000'),
  ('תל יוסף', '84'),
  ('תל יצחק', '287'),
  ('תל מונד', '154'),
  ('תל עדשים', '103'),
  ('תל ציון', '3815'),
  ('תל קציר', '719'),
  ('תל שבע', '1054'),
  ('תל תאומים', '1283'),
  ('תלם', '3719'),
  ('תלמי אליהו', '1051'),
  ('תלמי אלעזר', '2003'),
  ('תלמי בילו', '2050'),
  ('תלמי יוסף', '1237'),
  ('תלמי יחיאל', '727'),
  ('תלמי יפה', '744'),
  ('תלמים', '814'),
  ('תמרת', '1244'),
  ('תנובות', '2002'),
  ('תעוז', '752'),
  ('תפרח', '709'),
  ('תקומה', '665'),
  ('תקוע', '3563'),
  ('תראבין א צאנע ישוב', '1346'),
  ('תרום', '778')
) as v(norm_name, code)
 where tc.norm_name = v.norm_name;

create index if not exists town_centres_code on public.town_centres (code) where code is not null;

-- --------------------------------------------------------------------------
-- Matching, now in three passes
--
--   a. the city, matched exactly on its spelling key;
--   b. the city with something appended ("ירושלים תלפיות") — the longest settlement
--      name that is a whole-word prefix of it;
--   c. the city as a NUMBER, matched on the CBS settlement symbol.
--
-- (c) is last on purpose: a name we recognise is better evidence than a code, and a
-- settlement whose NAME is a number does not exist.
-- --------------------------------------------------------------------------
create or replace function public.place_branches_by_town()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  placed integer;
begin
  perform public.require_price_writer();

  with candidate as (
    select b.id, t.lat, t.lon
      from public.branches b
      join lateral (
        select tc.lat, tc.lon
          from public.town_centres tc
         where tc.norm_name = public.norm_place(b.city)
            or public.norm_place(b.city) like tc.norm_name || ' %'
            or (btrim(b.city) ~ '^[0-9]+$' and tc.code is not null
                and ltrim(tc.code, '0') = ltrim(btrim(b.city), '0'))
         -- A name beats a code: the name rows sort first because a code-only match
         -- has no bearing on norm_name's length, and an exact name is longest.
         order by (tc.norm_name = public.norm_place(b.city)) desc, length(tc.norm_name) desc
         limit 1
      ) t on true
     where b.latitude is null
       and b.city is not null
  )
  update public.branches b set latitude          = c.lat,
         longitude         = c.lon,
         geocoded_at       = now(),
         geocode_source    = 'israel-cities (town centre)',
         geocode_precision = 'locality'
    from candidate c
   where c.id = b.id;

  get diagnostics placed = row_count;
  return placed;
end;
$$;

revoke execute on function public.place_branches_by_town() from public, anon;
grant execute on function public.place_branches_by_town() to authenticated, service_role;

-- The same thing the function does, run now as the owner.
do $$
declare
  placed integer;
begin
  with candidate as (
    select b.id, t.lat, t.lon
      from public.branches b
      join lateral (
        select tc.lat, tc.lon
          from public.town_centres tc
         where tc.norm_name = public.norm_place(b.city)
            or public.norm_place(b.city) like tc.norm_name || ' %'
            or (btrim(b.city) ~ '^[0-9]+$' and tc.code is not null
                and ltrim(tc.code, '0') = ltrim(btrim(b.city), '0'))
         order by (tc.norm_name = public.norm_place(b.city)) desc, length(tc.norm_name) desc
         limit 1
      ) t on true
     where b.latitude is null
       and b.city is not null
  )
  update public.branches b set latitude          = c.lat,
         longitude         = c.lon,
         geocoded_at       = now(),
         geocode_source    = 'israel-cities (town centre)',
         geocode_precision = 'locality'
    from candidate c
   where c.id = b.id;

  get diagnostics placed = row_count;
  raise notice '0047: placed % more branches from their settlement symbol', placed;
end
$$;

-- ======================== 0048_branch_address.sql ========================

-- ---------------------------------------------------------------------------
-- 0048 — a distance is not an answer to "where".
--
-- "הכי קרוב אליי" started working (0045–0047) and the first thing it got wrong was
-- obvious the moment somebody used it: it says "12 ק״מ ממך" and nothing else. Not
-- which branch, not which town, and nothing to put into Waze. A distance with no
-- place attached is a number, and the person still has to go and find the shop.
--
-- branches_within_km() already returns the branch's name and city and has since
-- 0026. It does not return the ADDRESS, which is the one field Waze can actually use
-- — and `branches.address` has been carrying it from the Stores file all along.
--
-- Dropped and recreated rather than replaced: a function's OUT columns are part of
-- its signature, so `create or replace` cannot add one.
--
-- WHY THE ADDRESS AND NOT THE COORDINATES. Because the coordinates are the TOWN
-- CENTRE (geocode_precision = 'locality'), and handing a navigation app a point we
-- know is not the shop is exactly the lie this whole feature refuses to tell. The
-- address is text we were given by the publisher; Waze resolves it itself, and gets
-- the door right far more often than our centroid would. The screen keeps saying
-- "מרכז העיר" beside the distance for the same reason.
-- ---------------------------------------------------------------------------

drop function if exists public.branches_within_km(double precision, double precision, integer, integer);

create function public.branches_within_km(
  p_lat       double precision,
  p_lon       double precision,
  p_radius_km integer default 0,
  p_limit     integer default 200
)
returns table (
  branch_id uuid,
  store_id  uuid,
  name_he   text,
  city      text,
  address   text,
  latitude  double precision,
  longitude double precision,
  km        double precision
)
language sql
stable
parallel safe
set search_path = public
as $$
  with box as (
    select
      -- A degree of latitude is ~111 km anywhere; a degree of longitude shrinks
      -- with the cosine of the latitude. Generous by 10%: the prefilter must never
      -- exclude a branch the exact distance would have kept.
      case when p_radius_km > 0 then p_radius_km / 111.0 * 1.1 else 999 end as dlat,
      case when p_radius_km > 0
           then p_radius_km / (111.0 * greatest(cos(radians(p_lat)), 0.2)) * 1.1
           else 999 end as dlon
  )
  select b.id, b.store_id, b.name_he, b.city, b.address, b.latitude, b.longitude,
         public.km_between(p_lat, p_lon, b.latitude, b.longitude) as km
    from public.branches b, box
   where b.is_active
     and b.latitude is not null
     and p_lat is not null and p_lon is not null
     and b.latitude  between p_lat - box.dlat and p_lat + box.dlat
     and b.longitude between p_lon - box.dlon and p_lon + box.dlon
     and (p_radius_km = 0 or public.km_between(p_lat, p_lon, b.latitude, b.longitude) <= p_radius_km)
   order by km
   limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

revoke execute on function public.branches_within_km(double precision, double precision, integer, integer) from public;
grant execute on function public.branches_within_km(double precision, double precision, integer, integer) to anon, authenticated, service_role;

-- ======================== 0049_recover_refused_symbols.sql ========================

-- ---------------------------------------------------------------------------
-- 0049 — the settlements whose number I threw away.
--
-- 0047 taught the matcher that some publishers write a settlement's CBS symbol where
-- its name goes, and it worked: branches in חיפה (4000) and בית שאן (9200) were placed
-- by it. Asking what was STILL unplaced turned up six more numbers the matcher did not
-- know — and four of them are settlements the app has had all along:
--
--   2720 טירה      2730 טייבה      3616 מעלה אדומים      3780 ביתר עילית
--
-- A bug of mine, from 0046. Those four were refused by the import's gate because the
-- dataset had put them on a geocoder's fallback point, and then re-added by hand from
-- the curated list — which carries a name and a coordinate and NO symbol. Their
-- coordinate was the thing that was wrong; the government's key for them never was.
-- A refused coordinate is not a refused identity, and dropping the key cost those
-- branches their position just as surely as a wrong pin would have.
--
-- scripts/build-settlements.mjs now carries the symbol across when it re-adds a
-- settlement by hand, and tests/town-centres.test.ts asserts that a hand-placed
-- settlement still answers to its number. This sets what that recovered.
--
-- The remaining unmatched values are not settlements and are not pretended to be:
-- "0" (a placeholder several chains use), an empty field, and 10018 / 10044 / 10098,
-- which look like a chain's own internal numbering. Those branches stay unplaced,
-- stay out of "closest to me", and stay counted on the screen.
-- ---------------------------------------------------------------------------

update public.town_centres tc set code = v.code
  from (values
  ('אבו גוש', '472'),
  ('אבו סנאן', '473'),
  ('אבו קרינאת יישוב', '1342'),
  ('אבו תלול', '1375'),
  ('אבטין', '652'),
  ('אבטליון', '1275'),
  ('אביאל', '679'),
  ('אביבים', '1115'),
  ('אביגדור', '819'),
  ('אביחיל', '175'),
  ('אביטל', '2052'),
  ('אביעזר', '1070'),
  ('אבירים', '1220'),
  ('אבן יהודה', '182'),
  ('אבן מנחם', '1081'),
  ('אבן ספיר', '783'),
  ('אבן שמואל', '400'),
  ('אבני איתן', '4011'),
  ('אבשלום', '1311'),
  ('אדירים', '113'),
  ('אדמית', '1068'),
  ('אדרת', '1123'),
  ('אודים', '446'),
  ('אודם', '4010'),
  ('אוהד', '1046'),
  ('אום אל פחם', '2710'),
  ('אום אל קוטוף', '2024'),
  ('אום בטין', '1358'),
  ('אומן', '1108'),
  ('אומץ', '680'),
  ('אופקים', '31'),
  ('אור הגנוז', '1294'),
  ('אור הנר', '67'),
  ('אור יהודה', '2400'),
  ('אור עקיבא', '1020'),
  ('אורה', '780'),
  ('אורות', '2012'),
  ('אורטל', '4013'),
  ('אורים', '403'),
  ('אורנים', '882'),
  ('אורנית', '3760'),
  ('אושה', '278'),
  ('אזור', '565'),
  ('אחוזם', '821'),
  ('אחוזת ברק', '1330'),
  ('אחיהוד', '785'),
  ('אחיטוב', '850'),
  ('אחיסמך', '804'),
  ('אחיעזר', '797'),
  ('אטרש שבט', '965'),
  ('איבי הנחל', '3891'),
  ('איבים', '338'),
  ('אייל', '716'),
  ('איילת השחר', '77'),
  ('אילון', '294'),
  ('אילות', '1126'),
  ('אילניה', '49'),
  ('אילת', '2600'),
  ('אירוס', '1336'),
  ('איתמר', '3762'),
  ('איתן', '37'),
  ('איתנים', '886'),
  ('אכסאל', '478'),
  ('אל סייד', '1359'),
  ('אל עזי', '1339'),
  ('אל עריאן', '1316'),
  ('אל רום', '4003'),
  ('אלומה', '1145'),
  ('אלומות', '330'),
  ('אלון הגליל', '1182'),
  ('אלוני אבא', '429'),
  ('אלוני הבשן', '4017'),
  ('אלוני יצחק', '868'),
  ('אלונים', '285'),
  ('אלי עד', '4002'),
  ('אליאב', '1365'),
  ('אליכין', '41'),
  ('אליפז', '1248'),
  ('אליפלט', '730'),
  ('אליקים', '682'),
  ('אלישיב', '204'),
  ('אלישמע', '841'),
  ('אלמגור', '1125'),
  ('אלמוג', '3556'),
  ('אלעד', '1309'),
  ('אלעזר', '3618'),
  ('אלפי מנשה', '3750'),
  ('אלקוש', '603'),
  ('אמונים', '772'),
  ('אמירים', '1064'),
  ('אמנון', '1253'),
  ('אמציה', '23'),
  ('אניעם', '4012'),
  ('אעבלין', '529'),
  ('אפיק', '4301'),
  ('אפיקים', '176'),
  ('אפק', '313'),
  ('ארבל', '701'),
  ('ארגמן', '3598'),
  ('ארז', '714'),
  ('אריאל', '3570'),
  ('ארסוף', '1324'),
  ('אשבול', '71'),
  ('אשבל', '1276'),
  ('אשדוד', '70'),
  ('אשחר', '1188'),
  ('אשכולות', '3722'),
  ('אשל הנשיא', '2021'),
  ('אשלים', '1152'),
  ('אשקלון', '7100'),
  ('אשרת', '1256'),
  ('אשתאול', '740'),
  ('אתגר', '1298'),
  ('באקה אל גרביה', '6000'),
  ('באר אורה', '21'),
  ('באר גנים', '1376'),
  ('באר טוביה', '155'),
  ('באר יעקב', '2530'),
  ('באר מילכה', '1278'),
  ('באר שבע', '9000'),
  ('בארות יצחק', '450'),
  ('בארותיים', '697'),
  ('בארי', '399'),
  ('בוסתן הגליל', '559'),
  ('בועיינה נוגידאת', '482'),
  ('בוקעאתא', '4001'),
  ('בורגתה', '698'),
  ('בחן', '2043'),
  ('בטחה', '762'),
  ('ביצרון', '234'),
  ('ביר אל מכסור', '998'),
  ('ביריה', '368'),
  ('בית אורן', '317'),
  ('בית אל', '3574'),
  ('בית אלעזרי', '562'),
  ('בית אלפא', '95'),
  ('בית ברל', '1076'),
  ('בית גן', '480'),
  ('בית גוברין', '619'),
  ('בית גמליאל', '571'),
  ('בית דגן', '466'),
  ('בית הגדי', '723'),
  ('בית הלוי', '373'),
  ('בית הלל', '322'),
  ('בית העמק', '572'),
  ('בית השיטה', '242'),
  ('בית זית', '710'),
  ('בית זרע', '143'),
  ('בית חוגלה', '3864'),
  ('בית חורון', '3575'),
  ('בית חירות', '877'),
  ('בית חלקיה', '2033'),
  ('בית חנן', '159'),
  ('בית חנניה', '800'),
  ('בית חשמונאי', '1050'),
  ('בית יהושע', '288'),
  ('בית יוסף', '265'),
  ('בית ינאי', '200'),
  ('בית יצחק שער חפר', '326'),
  ('בית יתיר', '3745'),
  ('בית לחם הגלילית', '430'),
  ('בית מאיר', '751'),
  ('בית נחמיה', '784'),
  ('בית ניר', '16'),
  ('בית נקופה', '672'),
  ('בית עובד', '202'),
  ('בית עוזיאל', '301'),
  ('בית עזרא', '756'),
  ('בית עריף', '604'),
  ('בית צבי', '212'),
  ('בית קמה', '598'),
  ('בית קשת', '365'),
  ('בית רימון', '1162'),
  ('בית שאן', '9200'),
  ('בית שמש', '2610'),
  ('בית שערים', '248'),
  ('בית שקמה', '747'),
  ('ביתן אהרן', '252'),
  ('ביתר עילית', '3780'),
  ('בלפוריה', '94'),
  ('בן זכאי', '760'),
  ('בן עמי', '712'),
  ('בני ברק', '6100'),
  ('בני דקלים', '1368'),
  ('בני דרום', '592'),
  ('בני דרור', '386'),
  ('בני יהודה', '4015'),
  ('בני נצרים', '1363'),
  ('בני עטרות', '448'),
  ('בני עיש', '1066'),
  ('בני ציון', '418'),
  ('בני ראם', '588'),
  ('בניה', '685'),
  ('בנימינה גבעת עדה', '9800'),
  ('בסמה', '1326'),
  ('בסמת טבעון', '944'),
  ('בענה', '483'),
  ('בצרה', '389'),
  ('בצת', '589'),
  ('בקוע', '864'),
  ('בר גיורא', '823'),
  ('בר יוחאי', '1191'),
  ('בר כוכבא', '3499'),
  ('ברוכין', '3744'),
  ('ברור חיל', '428'),
  ('ברוש', '2060'),
  ('ברכיה', '746'),
  ('ברעם', '667'),
  ('ברק', '141'),
  ('ברקאי', '617'),
  ('ברקן', '3654'),
  ('ברקת', '2038'),
  ('בת הדר', '1323'),
  ('בת חן', '1361'),
  ('בת חפר', '1319'),
  ('בת ים', '6200'),
  ('בת שלמה', '33'),
  ('גדיידה מכר', '1292'),
  ('גולס', '485'),
  ('גלגוליה', '627'),
  ('גסר א זרקא', '541'),
  ('גש גוש חלב', '487'),
  ('גת', '628'),
  ('גאולי תימן', '872'),
  ('גאולים', '379'),
  ('גאליה', '853'),
  ('גבולות', '352'),
  ('גבים', '424'),
  ('גבע', '86'),
  ('גבע בנימין', '3763'),
  ('גבע כרמל', '683'),
  ('גבעולים', '2014'),
  ('גבעון החדשה', '3644'),
  ('גבעות בר', '1344'),
  ('גבעות עדן', '1362'),
  ('גבעת אבני', '1293'),
  ('גבעת אלה', '1288'),
  ('גבעת ברנר', '147'),
  ('גבעת השלושה', '870'),
  ('גבעת זאב', '3730'),
  ('גבעת חיים איחוד', '2018'),
  ('גבעת חיים מאוחד', '173'),
  ('גבעת חן', '207'),
  ('גבעת יואב', '4021'),
  ('גבעת יערים', '787'),
  ('גבעת ישעיהו', '919'),
  ('גבעת כח', '802'),
  ('גבעת נילי', '360'),
  ('גבעת עוז', '703'),
  ('גבעת שמואל', '681'),
  ('גבעת שמש', '566'),
  ('גבעת שפירא', '1077'),
  ('גבעתי', '793'),
  ('גבעתיים', '6300'),
  ('גברעם', '342'),
  ('גבת', '133'),
  ('גדות', '35'),
  ('גדיש', '145'),
  ('גדעונה', '442'),
  ('גדרה', '2550'),
  ('גונן', '852'),
  ('גורן', '755'),
  ('גורנות הגליל', '1219'),
  ('גזית', '457'),
  ('גזר', '370'),
  ('גיאה', '706'),
  ('גיבתון', '196'),
  ('גיזו', '1043'),
  ('גילון', '1204'),
  ('גילת', '736'),
  ('גינוסר', '262'),
  ('גיניגר', '92'),
  ('גינתון', '863'),
  ('גיתה', '1206'),
  ('גיתית', '3613'),
  ('גלאון', '393'),
  ('גליל ים', '346'),
  ('גלעד אבן יצחק', '369'),
  ('גמזו', '745'),
  ('גן הדרום', '1072'),
  ('גן השומרון', '225'),
  ('גן חיים', '239'),
  ('גן יאשיה', '734'),
  ('גן יבנה', '166'),
  ('גן נר', '1274'),
  ('גן שורק', '311'),
  ('גן שלמה', '144'),
  ('גן שמואל', '72'),
  ('גנות', '836'),
  ('גנות הדר', '549'),
  ('גני הדר', '1103'),
  ('גני טל', '1371'),
  ('גני יוחנן', '862'),
  ('גני מודיעין', '3823'),
  ('גני עם', '218'),
  ('גני תקווה', '229'),
  ('געש', '842'),
  ('געתון', '463'),
  ('גפן', '39'),
  ('גרופית', '1129'),
  ('גשור', '4022'),
  ('גשר', '305'),
  ('גשר הזיו', '574'),
  ('גת קיבוץ', '340'),
  ('גת רימון', '128'),
  ('דאלית אל כרמל', '494'),
  ('דבורה', '146'),
  ('דבוריה', '489'),
  ('דביר', '849'),
  ('דברת', '407'),
  ('דגניה א', '62'),
  ('דגניה ב', '79'),
  ('דובב', '1067'),
  ('דור', '738'),
  ('דורות', '336'),
  ('דחי', '475'),
  ('דייר אל אסד', '490'),
  ('דייר חנא', '492'),
  ('דייר ראפאת', '493'),
  ('דימונה', '2200'),
  ('דישון', '2063'),
  ('דליה', '300'),
  ('דלתון', '431'),
  ('דמיידה', '1317'),
  ('דן', '303'),
  ('דפנה', '302'),
  ('דקל', '1241'),
  ('דריגאת', '1349'),
  ('האון', '702'),
  ('הבונים', '675'),
  ('הגושרים', '356'),
  ('הדר עם', '191'),
  ('הוד השרון', '9700'),
  ('הודיה', '726'),
  ('הודיות', '1322'),
  ('הושעיה', '1186'),
  ('הזורע', '250'),
  ('הזורעים', '307'),
  ('החותרים', '434'),
  ('היוגב', '684'),
  ('המעפיל', '377'),
  ('הסוללים', '677'),
  ('העוגן', '423'),
  ('הר אדר', '3769'),
  ('הר גילה', '3603'),
  ('הר עמשא', '1261'),
  ('הראל', '464'),
  ('הרדוף', '1249'),
  ('הרצליה', '6400'),
  ('הררית', '1203'),
  ('ורדון', '1133'),
  ('זבדיאל', '815'),
  ('זוהר', '44'),
  ('זיקים', '584'),
  ('זיתן', '788'),
  ('זכרון יעקב', '9300'),
  ('זכריה', '799'),
  ('זמר', '1290'),
  ('זמרת', '1065'),
  ('זנוח', '816'),
  ('זרועה', '2064'),
  ('זרזיר', '975'),
  ('זרחיה', '818'),
  ('חבצלת השרון', '235'),
  ('חבר', '1110'),
  ('חברון', '3400'),
  ('חגור', '717'),
  ('חגי', '3764'),
  ('חגלה', '205'),
  ('חד נס', '4026'),
  ('חדיד', '618'),
  ('חדרה', '6500'),
  ('חוגייראת דהרה', '948'),
  ('חולדה', '160'),
  ('חולון', '6600'),
  ('חולית', '1239'),
  ('חולתה', '253'),
  ('חוסן', '662'),
  ('חוסנייה', '1332'),
  ('חופית', '115'),
  ('חוקוק', '374'),
  ('חורה', '1303'),
  ('חורפיש', '496'),
  ('חורשים', '355'),
  ('חזון', '1047'),
  ('חיבת ציון', '219'),
  ('חיננית', '3643'),
  ('חיפה', '4000'),
  ('חירות', '162'),
  ('חלוץ', '1272'),
  ('חלץ', '820'),
  ('חמאם', '993'),
  ('חמד', '801'),
  ('חמדיה', '343'),
  ('חניאל', '807'),
  ('חניתה', '280'),
  ('חנתון', '1257'),
  ('חספין', '4005'),
  ('חפץ חיים', '363'),
  ('חפצי בה', '90'),
  ('חצב', '700'),
  ('חצבה', '13'),
  ('חצור הגלילית', '2034'),
  ('חצור אשדוד', '406'),
  ('חצרים', '397'),
  ('חרב לאת', '422'),
  ('חרוצים', '1024'),
  ('חריש', '1247'),
  ('חרמש', '3717'),
  ('חרשים', '1209'),
  ('חשמונאים', '3770'),
  ('טבריה', '6700'),
  ('טובא זנגריה', '962'),
  ('טורעאן', '498'),
  ('טייבה', '2730'),
  ('טירה', '2720'),
  ('טירת יהודה', '663'),
  ('טירת כרמל', '2100'),
  ('טירת צבי', '268'),
  ('טל מנשה', '3873'),
  ('טל שחר', '462'),
  ('טל אל', '1181'),
  ('טללים', '1177'),
  ('טמרה', '8900'),
  ('טמרה יזרעאל', '547'),
  ('טנא', '3743'),
  ('טפחות', '1214'),
  ('יאנוח גת', '1295'),
  ('יבול', '1232'),
  ('יבנאל', '46'),
  ('יבנה', '2660'),
  ('יגור', '96'),
  ('יגל', '798'),
  ('יד בנימין', '577'),
  ('יד השמונה', '1134'),
  ('יד חנה', '758'),
  ('יד מרדכי', '358'),
  ('יד נתן', '775'),
  ('יד רמבם', '64'),
  ('ידידה', '1144'),
  ('יהוד מונוסון', '9400'),
  ('יהוד', '9400'),
  ('יהל', '1158'),
  ('יובל', '2009'),
  ('יובלים', '1226'),
  ('יודפת', '1112'),
  ('יונתן', '4007'),
  ('יושיביה', '803'),
  ('יזרעאל', '452'),
  ('יחיעם', '409'),
  ('יטבתה', '866'),
  ('ייטב', '3607'),
  ('יכיני', '811'),
  ('ינוב', '753'),
  ('ינון', '2011'),
  ('יסוד המעלה', '29'),
  ('יסודות', '440'),
  ('יסעור', '575'),
  ('יעד', '1138'),
  ('יעל', '1117'),
  ('יעף', '1044'),
  ('יערה', '795'),
  ('יפיע', '499'),
  ('יפעת', '134'),
  ('יפתח', '453'),
  ('יציץ', '759'),
  ('יקום', '417'),
  ('יקיר', '3647'),
  ('יקנעם מושבה', '241'),
  ('יקנעם עילית', '240'),
  ('יקנעם', '240'),
  ('יראון', '623'),
  ('ירדנה', '2026'),
  ('ירוחם', '831'),
  ('ירושלים', '3000'),
  ('י ם', '3000'),
  ('ירושלם', '3000'),
  ('ירחיב', '718'),
  ('ירכא', '502'),
  ('ירקונה', '183'),
  ('ישע', '916'),
  ('ישעי', '805'),
  ('ישרש', '828'),
  ('יתד', '1227'),
  ('כאבול', '504'),
  ('כאוכב אבו אל היגא', '505'),
  ('כברי', '576'),
  ('כדורי', '371'),
  ('כדיתה', '1338'),
  ('כוכב השחר', '3564'),
  ('כוכב יאיר צור יגאל', '1224'),
  ('כוכב יעקב', '3779'),
  ('כוכב מיכאל', '824'),
  ('כורזים', '1252'),
  ('כחל', '1210'),
  ('כחלה', '1367'),
  ('כיסופים', '840'),
  ('כישור', '1153'),
  ('כליל', '1183'),
  ('כלנית', '1229'),
  ('כמאנה', '1331'),
  ('כמהין', '1291'),
  ('כמון', '1201'),
  ('כנות', '2006'),
  ('כנף', '4028'),
  ('כסיפה', '1059'),
  ('כסלון', '859'),
  ('כסרא סמיע', '1296'),
  ('כעביה טבאש חגאגרה', '978'),
  ('כפר אביב', '857'),
  ('כפר אוריה', '364'),
  ('כפר אחים', '690'),
  ('כפר ביאליק', '220'),
  ('כפר בילו', '177'),
  ('כפר בלום', '357'),
  ('כפר בן נון', '2010'),
  ('כפר ברא', '633'),
  ('כפר ברוך', '132'),
  ('כפר גדעון', '106'),
  ('כפר גלים', '427'),
  ('כפר גליקסון', '310'),
  ('כפר גלעדי', '76'),
  ('כפר דניאל', '707'),
  ('כפר החורש', '192'),
  ('כפר המכבי', '254'),
  ('כפר הנגיד', '582'),
  ('כפר הנוער הדתי', '890'),
  ('כפר הנשיא', '443'),
  ('כפר הס', '187'),
  ('כפר הריף', '888'),
  ('כפר ויתקין', '190'),
  ('כפר ורבורג', '320'),
  ('כפר ורדים', '1263'),
  ('כפר זוהרים', '1325'),
  ('כפר זיתים', '786'),
  ('כפר חבד', '696'),
  ('כפר חושן', '609'),
  ('כפר חיטים', '255'),
  ('כפר חיים', '193'),
  ('כפר חנניה', '1297'),
  ('כפר חסידים א', '112'),
  ('כפר חסידים ב', '889'),
  ('כפר חרוב', '4004'),
  ('כפר טרומן', '673'),
  ('כפר יאסיף', '507'),
  ('כפר ידידיה', '233'),
  ('כפר יהושע', '140'),
  ('כפר יונה', '168'),
  ('כפר יחזקאל', '85'),
  ('כפר יעבץ', '170'),
  ('כפר כמא', '508'),
  ('כפר כנא', '509'),
  ('כפר מונש', '387'),
  ('כפר מימון', '1095'),
  ('כפר מלל', '98'),
  ('כפר מנדא', '510'),
  ('כפר מנחם', '274'),
  ('כפר מסריק', '297'),
  ('כפר מצר', '512'),
  ('כפר מרדכי', '764'),
  ('כפר נטר', '316'),
  ('כפר סאלד', '345'),
  ('כפר סבא', '6900'),
  ('כפר סילבר', '107'),
  ('כפר סירקין', '249'),
  ('כפר עבודה', '875'),
  ('כפר עזה', '845'),
  ('כפר פינס', '189'),
  ('כפר קאסם', '634'),
  ('כפר קיש', '388'),
  ('כפר קרע', '654'),
  ('כפר ראש הנקרה', '579'),
  ('כפר רופין', '295'),
  ('כפר רות', '1166'),
  ('כפר שמאי', '605'),
  ('כפר שמואל', '743'),
  ('כפר שמריהו', '267'),
  ('כפר תבור', '47'),
  ('כרכום', '1285'),
  ('כרם ביבנה ישיבה', '1094'),
  ('כרם בן זמרה', '664'),
  ('כרם בן שמן', '88'),
  ('כרם מהרל', '580'),
  ('כרם שלום', '1085'),
  ('כרמי יוסף', '1264'),
  ('כרמי קטיף', '1374'),
  ('כרמיאל', '1139'),
  ('כרמיה', '768'),
  ('כרמים', '1198'),
  ('כרמל', '3656'),
  ('לבון', '1207'),
  ('לביא', '585'),
  ('לבנים', '1230'),
  ('להב', '2023'),
  ('להבות הבשן', '380'),
  ('להבות חביבה', '715'),
  ('להבים', '1271'),
  ('לוד', '7000'),
  ('לוזית', '52'),
  ('לוחמי הגיטאות', '595'),
  ('לוטם', '1171'),
  ('לוטן', '1255'),
  ('לימן', '674'),
  ('לכיש', '24'),
  ('לפיד', '1310'),
  ('לפידות', '1173'),
  ('לקיה', '1060'),
  ('מאור', '2055'),
  ('מבוא ביתר', '771'),
  ('מבוא חורון', '3709'),
  ('מבוא חמה', '4204'),
  ('מבוא מודיעים', '1141'),
  ('מבואות ים', '1318'),
  ('מבואות יריחו', '3825'),
  ('מבועים', '1080'),
  ('מבטחים', '829'),
  ('מבקיעים', '573'),
  ('מבשרת ציון', '1015'),
  ('מגד אל כרום', '516'),
  ('מגדל שמס', '4201'),
  ('מגאר', '481'),
  ('מגדים', '689'),
  ('מגדל', '65'),
  ('מגדל העמק', '874'),
  ('מגידו', '586'),
  ('מגל', '375'),
  ('מגן', '695'),
  ('מגן שאול', '1155'),
  ('מגשימים', '722'),
  ('מדרך עוז', '2029'),
  ('מדרשת בן גוריון', '1140'),
  ('מדרשת רופין', '897'),
  ('מודיעין עילית', '3797'),
  ('מודיעין מכבים רעות', '1200'),
  ('מודיעין', '1200'),
  ('מולדת', '269'),
  ('מוצא עילית', '208'),
  ('מוקייבלה', '635'),
  ('מורן', '1163'),
  ('מורשת', '1178'),
  ('מזור', '606'),
  ('מזכרת בתיה', '28'),
  ('מזרע', '104'),
  ('מזרעה', '517'),
  ('מחולה', '3599'),
  ('מחנה יתיר', '1196'),
  ('מחניים', '308'),
  ('מחסיה', '776'),
  ('מטולה', '43'),
  ('מטע', '822'),
  ('מי עמי', '1128'),
  ('מיטב', '2054'),
  ('מייסר', '649'),
  ('מיצר', '4019'),
  ('מירב', '1282'),
  ('מירון', '607'),
  ('מישר', '731'),
  ('מיתר', '1268'),
  ('מכחול', '1343'),
  ('מכמורת', '382'),
  ('מכמנים', '1202'),
  ('מלאה', '164'),
  ('מלילות', '2044'),
  ('מלכיה', '596'),
  ('מנוחה', '2030'),
  ('מנוף', '1174'),
  ('מנות', '1205'),
  ('מנחמיה', '48'),
  ('מנרה', '347'),
  ('מנשית זבדה', '994'),
  ('מסד', '1258'),
  ('מסדה', '263'),
  ('מסילות', '298'),
  ('מסילת ציון', '742'),
  ('מסלול', '748'),
  ('מסעדה', '4203'),
  ('מסעודין אל עזאזמה', '939'),
  ('מעברות', '197'),
  ('מעגלים', '1082'),
  ('מעגן', '678'),
  ('מעגן מיכאל', '694'),
  ('מעוז חיים', '272'),
  ('מעון', '3657'),
  ('מעונה', '570'),
  ('מעיליא', '518'),
  ('מעין ברוך', '416'),
  ('מעין צבי', '290'),
  ('מעלה אדומים', '3616'),
  ('מעלה אפרים', '3608'),
  ('מעלה גלבוע', '1127'),
  ('מעלה גמלא', '4008'),
  ('מעלה החמישה', '286'),
  ('מעלה מכמש', '3651'),
  ('מעלה עירון', '1327'),
  ('מעלה עמוס', '3653'),
  ('מעלות תרשיחא', '1063'),
  ('מעלות', '1063'),
  ('תרשיחא', '1063'),
  ('מענית', '344'),
  ('מעש', '230'),
  ('מפלסים', '668'),
  ('מצובה', '325'),
  ('מצליח', '757'),
  ('מצפה', '58'),
  ('מצפה אביב', '1222'),
  ('מצפה אילן', '1370'),
  ('מצפה יריחו', '3576'),
  ('מצפה נטופה', '1190'),
  ('מצפה רמון', '99'),
  ('מצפה שלם', '3610'),
  ('מצר', '648'),
  ('מרגליות', '843'),
  ('מרום גולן', '4101'),
  ('מרחב עם', '1340'),
  ('מרחביה מושב', '97'),
  ('מרחביה קיבוץ', '66'),
  ('מרכז שפירא', '1098'),
  ('משאבי שדה', '421'),
  ('משגב דב', '765'),
  ('משגב עם', '378'),
  ('משהד', '520'),
  ('משואה', '3605'),
  ('משואות יצחק', '620'),
  ('משמר איילון', '670'),
  ('משמר דוד', '563'),
  ('משמר הירדן', '732'),
  ('משמר הנגב', '395'),
  ('משמר העמק', '130'),
  ('משמר השבעה', '729'),
  ('משמר השרון', '194'),
  ('משמר יהודה', '3865'),
  ('משמרות', '213'),
  ('משמרת', '425'),
  ('משען', '791'),
  ('מתן', '1315'),
  ('מתת', '1184'),
  ('מתתיהו', '3648'),
  ('נאות גולן', '4551'),
  ('נאות הכיכר', '1124'),
  ('נאות מרדכי', '408'),
  ('נאות סמדר', '1197'),
  ('נאעורה', '524'),
  ('נבטים', '396'),
  ('נגבה', '315'),
  ('נגוהות', '3724'),
  ('נהורה', '309'),
  ('נהלל', '80'),
  ('נהריה', '9100'),
  ('נוב', '4304'),
  ('נוגה', '55'),
  ('נוה צוף', '3573'),
  ('נווה', '1366'),
  ('נווה אבות', '926'),
  ('נווה אור', '590'),
  ('נווה אטיב', '4303'),
  ('נווה אילן', '405'),
  ('נווה איתן', '296'),
  ('נווה זוהר', '1057'),
  ('נווה זיו', '1314'),
  ('נווה חריף', '1279'),
  ('נווה ים', '312'),
  ('נווה ימין', '686'),
  ('נווה ירק', '858'),
  ('נווה מבטח', '827'),
  ('נווה מיכאל', '1071'),
  ('נועם', '15'),
  ('נוף איילון', '1333'),
  ('נוף הגליל', '1061'),
  ('נצרת עילית', '1061'),
  ('נופי פרת', '3876'),
  ('נופית', '1284'),
  ('נופך', '257'),
  ('נורדיה', '447'),
  ('נורית', '833'),
  ('נחושה', '59'),
  ('נחל עוז', '844'),
  ('נחלה', '2045'),
  ('נחלים', '449'),
  ('נחם', '809'),
  ('נחף', '522'),
  ('נחשולים', '433'),
  ('נחשון', '777'),
  ('נחשונים', '705'),
  ('נטועה', '1147'),
  ('נטור', '4014'),
  ('נטע', '1369'),
  ('נטעים', '174'),
  ('נטף', '1254'),
  ('ניין', '523'),
  ('ניצן', '351'),
  ('ניצן ב', '1419'),
  ('ניצנה קהילת חינוך', '1195'),
  ('ניצני סיני', '1280'),
  ('ניצני עוז', '851'),
  ('ניצנים', '359'),
  ('ניר אליהו', '808'),
  ('ניר בנים', '553'),
  ('ניר גלים', '720'),
  ('ניר דוד תל עמל', '256'),
  ('ניר חן', '11'),
  ('ניר יפה', '165'),
  ('ניר יצחק', '402'),
  ('ניר ישראל', '699'),
  ('ניר משה', '2047'),
  ('ניר עוז', '69'),
  ('ניר עם', '348'),
  ('ניר עציון', '769'),
  ('ניר עקיבא', '2048'),
  ('ניר צבי', '331'),
  ('נירים', '602'),
  ('נירית', '1236'),
  ('נמרוד', '4035'),
  ('נס הרים', '825'),
  ('נס עמים', '1143'),
  ('נס ציונה', '7200'),
  ('נעורים', '186'),
  ('נעלה', '3787'),
  ('נעמה', '3713'),
  ('נען', '158'),
  ('נצאצרה שבט', '1041'),
  ('נצר חזני', '1372'),
  ('נצר סרני', '435'),
  ('נצרת', '7300'),
  ('נריה', '3890'),
  ('נשר', '2500'),
  ('נתיב הלה', '693'),
  ('נתיב העשרה', '1242'),
  ('נתיב השיירה', '792'),
  ('נתיבות', '246'),
  ('נתניה', '7400'),
  ('סאגור', '525'),
  ('סאסא', '578'),
  ('סביון', '587'),
  ('סגולה', '2046'),
  ('סולם', '526'),
  ('סופה', '1238'),
  ('סחנין', '7500'),
  ('סייד שבט', '1170'),
  ('סלמה', '1245'),
  ('סלעית', '3567'),
  ('סמר', '1156'),
  ('סנסנה', '3777'),
  ('סעד', '419'),
  ('סער', '454'),
  ('ספיר', '1176'),
  ('סתריה', '610'),
  ('עגר', '4501'),
  ('עבדון', '892'),
  ('עברון', '376'),
  ('עגור', '794'),
  ('עדי', '1199'),
  ('עדנים', '2035'),
  ('עוזה', '826'),
  ('עוזייר', '528'),
  ('עולש', '737'),
  ('עומר', '666'),
  ('עופר', '810'),
  ('עופרה', '3617'),
  ('עוצם', '32'),
  ('עוקבי בנו עוקבה', '957'),
  ('עזוז', '328'),
  ('עזר', '1149'),
  ('עזריאל', '837'),
  ('עזריה', '711'),
  ('עזריקם', '817'),
  ('עידן', '1175'),
  ('עיילבון', '530'),
  ('עיינות', '156'),
  ('עילוט', '511'),
  ('עין איילה', '687'),
  ('עין אל אסד', '546'),
  ('עין גב', '273'),
  ('עין גדי', '2042'),
  ('עין דור', '436'),
  ('עין הבשור', '1240'),
  ('עין החורש', '167'),
  ('עין המפרץ', '289'),
  ('עין הנציב', '383'),
  ('עין העמק', '367'),
  ('עין השופט', '270'),
  ('עין השלושה', '676'),
  ('עין ורד', '157'),
  ('עין זיוון', '4503'),
  ('עין חצבה', '1053'),
  ('עין יהב', '806'),
  ('עין יעקב', '813'),
  ('עין כרם ביס חקלאי', '1056'),
  ('עין כרמל', '426'),
  ('עין מאהל', '532'),
  ('עין נקובא', '521'),
  ('עין עירון', '223'),
  ('עין צורים', '622'),
  ('עין קנייא', '4502'),
  ('עין ראפה', '514'),
  ('עין שמר', '139'),
  ('עין שריד', '880'),
  ('עין תמר', '1251'),
  ('עינת', '871'),
  ('עיר אובות', '1187'),
  ('עכו', '7600'),
  ('עלומים', '1146'),
  ('עלי זהב', '3727'),
  ('עלמה', '688'),
  ('עלמון', '3715'),
  ('עמוקה', '1212'),
  ('עמינדב', '779'),
  ('עמיעד', '385'),
  ('עמיעוז', '318'),
  ('עמיקם', '773'),
  ('עמיר', '319'),
  ('עמקה', '708'),
  ('ענב', '3712'),
  ('עספיא', '534'),
  ('עפולה', '7700'),
  ('עצמון שגב', '917'),
  ('עראבה', '531'),
  ('עראמשה', '1246'),
  ('ערב אל נעים', '1335'),
  ('ערד', '2560'),
  ('ערוגות', '593'),
  ('ערערה', '637'),
  ('ערערה בנגב', '1192'),
  ('עשרת', '591'),
  ('עתלית', '53'),
  ('עתניאל', '3748'),
  ('פארן', '1151'),
  ('פדואל', '3768'),
  ('פדויים', '750'),
  ('פדיה', '838'),
  ('פוריה כפר עבודה', '1104'),
  ('פוריה נווה עובד', '1105'),
  ('פוריה עילית', '1313'),
  ('פוריידיס', '537'),
  ('פורת', '767'),
  ('פטיש', '749'),
  ('פלך', '1185'),
  ('פלמחים', '597'),
  ('פני חבר', '3723'),
  ('פסוטה', '535'),
  ('פעמי תשז', '2059'),
  ('פרדס חנה כרכור', '7800'),
  ('פרדס חנה', '7800'),
  ('כרכור', '7800'),
  ('פרדסיה', '171'),
  ('פרוד', '599'),
  ('פרזון', '2053'),
  ('פרי גן', '1231'),
  ('פתח תקווה', '7900'),
  ('פתחיה', '839'),
  ('צאלים', '413'),
  ('צביה', '1180'),
  ('צבעון', '1213'),
  ('צובה', '465'),
  ('צוחר', '1136'),
  ('צופים', '3791'),
  ('צופית', '198'),
  ('צופר', '1150'),
  ('צוקי ים', '1102'),
  ('צוקים', '1262'),
  ('צור הדסה', '1113'),
  ('צור יצחק', '1345'),
  ('צור משה', '276'),
  ('צור נתן', '1148'),
  ('צוריאל', '774'),
  ('צורית', '1221'),
  ('ציפורי', '613'),
  ('צלפון', '796'),
  ('צנדלה', '636'),
  ('צפריה', '594'),
  ('צפרירים', '1079'),
  ('צפת', '8000'),
  ('צרופה', '612'),
  ('צרעה', '567'),
  ('קבוצת יבנה', '334'),
  ('קדימה צורן', '195'),
  ('קדמה', '392'),
  ('קדמת צבי', '4025'),
  ('קדר', '3781'),
  ('קדרון', '615'),
  ('קדרים', '1211'),
  ('קוממיות', '766'),
  ('קורנית', '1179'),
  ('קטורה', '1052'),
  ('קיסריה', '1167'),
  ('קלחים', '414'),
  ('קלנסווה', '638'),
  ('קלע', '4024'),
  ('קציר', '1243'),
  ('קצר א סר', '1347'),
  ('קצרין', '4100'),
  ('קריית אונו', '2620'),
  ('קריית אתא', '6800'),
  ('קריית ביאליק', '9500'),
  ('קריית גת', '2630'),
  ('קריית טבעון', '2300'),
  ('קריית ים', '9600'),
  ('קריית מוצקין', '8200'),
  ('קריית מלאכי', '1034'),
  ('קריית שמונה', '2800'),
  ('קריית יערים', '1137'),
  ('קריית יערים מוסד', '2039'),
  ('קריית נטפים', '3746'),
  ('קריית ענבים', '78'),
  ('קריית עקרון', '469'),
  ('קשת', '4006'),
  ('ראמה', '543'),
  ('ראס אל עין', '1334'),
  ('ראס עלי', '990'),
  ('ראש העין', '2640'),
  ('ראש פינה', '26'),
  ('ראשון לציון', '8300'),
  ('רבדים', '564'),
  ('רביבים', '354'),
  ('רביד', '1225'),
  ('רגבה', '390'),
  ('רגבים', '444'),
  ('רהט', '1161'),
  ('רווחה', '2051'),
  ('רוויה', '2016'),
  ('רוח מדבר', '1341'),
  ('רוחמה', '362'),
  ('רומאנה', '539'),
  ('רומת הייב', '997'),
  ('רותם', '3782'),
  ('רחוב', '854'),
  ('רחובות', '8400'),
  ('ריינה', '542'),
  ('רינתיה', '616'),
  ('רכסים', '922'),
  ('רם און', '1069'),
  ('רמות', '4702'),
  ('רמות השבים', '206'),
  ('רמות מאיר', '735'),
  ('רמות מנשה', '445'),
  ('רמות נפתלי', '372'),
  ('רמלה', '8500'),
  ('רמת גן', '8600'),
  ('רמת דוד', '135'),
  ('רמת הכובש', '184'),
  ('רמת השופט', '335'),
  ('רמת השרון', '2650'),
  ('רמת יוחנן', '178'),
  ('רמת ישי', '122'),
  ('רמת מגשימים', '4701'),
  ('רמת צבי', '339'),
  ('רמת רזיאל', '460'),
  ('רמת רחל', '127'),
  ('רנן', '789'),
  ('רעים', '713'),
  ('רעננה', '8700'),
  ('רקפת', '1228'),
  ('רשפון', '247'),
  ('רשפים', '437'),
  ('רתמים', '1260'),
  ('שאר ישוב', '324'),
  ('שבי דרום', '1377'),
  ('שבי ציון', '282'),
  ('שבי שומרון', '3571'),
  ('שבלי אום אל גנם', '913'),
  ('שגב שלום', '1286'),
  ('שדה אילן', '721'),
  ('שדה אליהו', '304'),
  ('שדה אליעזר', '861'),
  ('שדה בוקר', '885'),
  ('שדה דוד', '36'),
  ('שדה ורבורג', '284'),
  ('שדה יואב', '293'),
  ('שדה יעקב', '142'),
  ('שדה יצחק', '2008'),
  ('שדה משה', '18'),
  ('שדה נחום', '259'),
  ('שדה נחמיה', '329'),
  ('שדה ניצן', '1058'),
  ('שדה עוזיהו', '739'),
  ('שדה צבי', '2049'),
  ('שדות ים', '327'),
  ('שדות מיכה', '27'),
  ('שדי אברהם', '1223'),
  ('שדי חמד', '2015'),
  ('שדי תרומות', '2057'),
  ('שדמה', '555'),
  ('שדמות דבורה', '306'),
  ('שדמות מחולה', '3578'),
  ('שדרות', '1031'),
  ('שואבה', '741'),
  ('שובה', '761'),
  ('שובל', '394'),
  ('שוהם', '1304'),
  ('שומרה', '614'),
  ('שומריה', '1265'),
  ('שוקדה', '415'),
  ('שורש', '456'),
  ('שורשים', '1235'),
  ('שושנת העמקים', '224'),
  ('שזור', '527'),
  ('שחר', '7'),
  ('שחרות', '1266'),
  ('שיבולים', '865'),
  ('שיזף', '1378'),
  ('שיטים', '1267'),
  ('שייח דנון', '658'),
  ('שילה', '3641'),
  ('שילת', '1165'),
  ('שכניה', '1160'),
  ('שלווה', '873'),
  ('שלווה במדבר', '1373'),
  ('שלוחות', '439'),
  ('שלומי', '812'),
  ('שלומית', '1364'),
  ('שמיר', '366'),
  ('שמרת', '432'),
  ('שמשית', '1337'),
  ('שני', '1287'),
  ('שניר', '1132'),
  ('שעב', '538'),
  ('שעל', '4009'),
  ('שעלבים', '856'),
  ('שער אפרים', '661'),
  ('שער הגולן', '264'),
  ('שער העמקים', '237'),
  ('שער מנשה', '921'),
  ('שפיים', '232'),
  ('שפיר', '692'),
  ('שפר', '846'),
  ('שפרעם', '8800'),
  ('שקד', '3649'),
  ('שקף', '1233'),
  ('שרונה', '292'),
  ('שריגים לי און', '1114'),
  ('שריד', '126'),
  ('שרשרת', '398'),
  ('שתולה', '1045'),
  ('שתולים', '763'),
  ('תאשור', '2062'),
  ('תדהר', '2061'),
  ('תובל', '1172'),
  ('תושיה', '1083'),
  ('תימורים', '163'),
  ('תירוש', '10'),
  ('תל אביב יפו', '5000'),
  ('תל אביב', '5000'),
  ('יפו', '5000'),
  ('תא', '5000'),
  ('תל יוסף', '84'),
  ('תל יצחק', '287'),
  ('תל מונד', '154'),
  ('תל עדשים', '103'),
  ('תל ציון', '3815'),
  ('תל קציר', '719'),
  ('תל שבע', '1054'),
  ('תל תאומים', '1283'),
  ('תלם', '3719'),
  ('תלמי אליהו', '1051'),
  ('תלמי אלעזר', '2003'),
  ('תלמי בילו', '2050'),
  ('תלמי יוסף', '1237'),
  ('תלמי יחיאל', '727'),
  ('תלמי יפה', '744'),
  ('תלמים', '814'),
  ('תמרת', '1244'),
  ('תנובות', '2002'),
  ('תעוז', '752'),
  ('תפרח', '709'),
  ('תקומה', '665'),
  ('תקוע', '3563'),
  ('תראבין א צאנע ישוב', '1346'),
  ('תרום', '778')
) as v(norm_name, code)
 where tc.norm_name = v.norm_name;

-- And place whatever that makes placeable. Same two rules as always: only a branch
-- with NO position, and only a match we can defend.
do $$
declare
  placed integer;
begin
  with candidate as (
    select b.id, t.lat, t.lon
      from public.branches b
      join lateral (
        select tc.lat, tc.lon
          from public.town_centres tc
         where tc.norm_name = public.norm_place(b.city)
            or public.norm_place(b.city) like tc.norm_name || ' %'
            or (btrim(b.city) ~ '^[0-9]+$' and tc.code is not null
                and ltrim(tc.code, '0') = ltrim(btrim(b.city), '0'))
         order by (tc.norm_name = public.norm_place(b.city)) desc, length(tc.norm_name) desc
         limit 1
      ) t on true
     where b.latitude is null
       and b.city is not null
  )
  update public.branches b set latitude          = c.lat,
         longitude         = c.lon,
         geocoded_at       = now(),
         geocode_source    = 'israel-cities (town centre)',
         geocode_precision = 'locality'
    from candidate c
   where c.id = b.id;

  get diagnostics placed = row_count;
  raise notice '0049: placed % more branches from a recovered settlement symbol', placed;
end
$$;

-- ======================== 0050_branch_named_for_its_town.sql ========================

-- ---------------------------------------------------------------------------
-- 0050 — the chain that puts the town in the branch's NAME.
--
-- יוחננוף: 25 beer offers in the feed, 0 of 52 branches placed, every one of those
-- offers invisible in "closest to me". Asking what its branches actually hold:
--
--   city = '0'   51 branches, an example named "אור יהודה", address "unknown"
--   city = ''     1 branch
--
-- The publisher's Stores file writes 0 where the settlement goes and puts the
-- settlement in the branch's name instead. Nothing in 0045–0049 could see that: they
-- all read `city`, and '0' is not a place.
--
-- SO THIS READS THE NAME — AND ONLY WHERE THE NAME IS A SETTLEMENT, WHOLE.
--
-- That restraint is the entire design. A branch name is usually not a town: it is
-- "קניון איילון", "ביג פאשן", "סניף המרכזי". Matching a town name INSIDE a branch
-- name would place a Haifa branch called נווה שאנן at a moshav of the same name
-- somewhere else entirely — a confident, undetectable, wrong pin, which is the one
-- failure this product cannot absorb. So:
--
--   * the whole name, normalised, must BE a settlement we know ("אור יהודה"), or
--   * the whole name minus the chain's own name must be ("יוחננוף אור יהודה").
--
-- No substring matching, no longest-prefix, no guessing. A branch called after a
-- shopping centre stays unplaced, which is what it should be.
--
-- Recorded separately — geocode_source says 'from branch name' — so that if this ever
-- turns out to be the wrong call, every row it wrote can be found and undone.
-- ---------------------------------------------------------------------------

create or replace function public.place_branches_by_town()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  by_city integer;
  by_name integer;
begin
  perform public.require_price_writer();

  -- Passes a–c: the city field, by name, by appended neighbourhood, by CBS symbol.
  with candidate as (
    select b.id, t.lat, t.lon
      from public.branches b
      join lateral (
        select tc.lat, tc.lon
          from public.town_centres tc
         where tc.norm_name = public.norm_place(b.city)
            or public.norm_place(b.city) like tc.norm_name || ' %'
            or (btrim(b.city) ~ '^[0-9]+$' and tc.code is not null
                and ltrim(tc.code, '0') = ltrim(btrim(b.city), '0'))
         order by (tc.norm_name = public.norm_place(b.city)) desc, length(tc.norm_name) desc
         limit 1
      ) t on true
     where b.latitude is null
       and b.city is not null
  )
  update public.branches b set latitude          = c.lat,
         longitude         = c.lon,
         geocoded_at       = now(),
         geocode_source    = 'israel-cities (town centre)',
         geocode_precision = 'locality'
    from candidate c
   where c.id = b.id;
  get diagnostics by_city = row_count;

  -- Pass d: the branch's NAME, whole, with the chain's own name allowed to be in it.
  with candidate as (
    select b.id, t.lat, t.lon
      from public.branches b
      join public.stores s on s.id = b.store_id
      join lateral (
        select tc.lat, tc.lon
          from public.town_centres tc
         where tc.norm_name = public.norm_place(b.name_he)
            or tc.norm_name = btrim(
                 regexp_replace(
                   replace(public.norm_place(b.name_he), public.norm_place(s.name_he), ' '),
                   '\s+', ' ', 'g'
                 )
               )
         limit 1
      ) t on true
     where b.latitude is null
       and b.name_he is not null
  )
  update public.branches b set latitude          = c.lat,
         longitude         = c.lon,
         geocoded_at       = now(),
         geocode_source    = 'israel-cities (town centre, from branch name)',
         geocode_precision = 'locality'
    from candidate c
   where c.id = b.id;
  get diagnostics by_name = row_count;

  return by_city + by_name;
end;
$$;

revoke execute on function public.place_branches_by_town() from public, anon;
grant execute on function public.place_branches_by_town() to authenticated, service_role;

-- Run it now, as the owner.
do $$
declare
  placed integer;
begin
  with candidate as (
    select b.id, t.lat, t.lon
      from public.branches b
      join public.stores s on s.id = b.store_id
      join lateral (
        select tc.lat, tc.lon
          from public.town_centres tc
         where tc.norm_name = public.norm_place(b.name_he)
            or tc.norm_name = btrim(
                 regexp_replace(
                   replace(public.norm_place(b.name_he), public.norm_place(s.name_he), ' '),
                   '\s+', ' ', 'g'
                 )
               )
         limit 1
      ) t on true
     where b.latitude is null
       and b.name_he is not null
  )
  update public.branches b set latitude          = c.lat,
         longitude         = c.lon,
         geocoded_at       = now(),
         geocode_source    = 'israel-cities (town centre, from branch name)',
         geocode_precision = 'locality'
    from candidate c
   where c.id = b.id;

  get diagnostics placed = row_count;
  raise notice '0050: placed % branches named after their town', placed;
end
$$;

-- ======================== 0051_four_more_settlements.sql ========================

-- ---------------------------------------------------------------------------
-- 0051 — four settlements that real branches were waiting for.
--
-- After 0050 the count stood at 1,021 of 1,160 branches placed. Asking what was
-- still unmatched turned up four names that are not noise:
--
--   אפרת          its dataset row (3650) sits on the geocoder's fallback point
--                 in the Negev, so the import refused it — correctly — and nothing
--                 put it back.
--   כפר עציון     its dataset row (3488) is at 32.178, 34.907, which is near
--                 Ra'anana. Kfar Etzion is in Gush Etzion. Refused with the two
--                 other settlements sharing that point, and also never put back.
--   טירת הכרמל    the dataset does not carry it at all.
--   טבעון         how people and Stores files write קריית טבעון.
--
-- The first three are added to scripts/data/curated-towns.json by hand, on the same
-- disclosed standard as the other ninety: well-established public geographic
-- knowledge, an approximate centre, good to a kilometre or two, marked
-- source = 'compiled' so a later import can tell what it is replacing. Two of them
-- get their CBS symbol back from the dataset row that was refused, because a refused
-- coordinate is not a refused identity (0049).
--
-- WHAT IS STILL NOT MATCHED, AND WILL NOT BE:
--
--   '0'              78 branches. A placeholder several chains write where a town
--                    goes. It is not a place and no amount of data will make it one.
--   (empty)          47 branches with no city at all.
--   'מ.א. עמק חפר'   a regional council, not a settlement. Placing it at the
--                    council's centre would be a different claim than the one this
--                    column makes.
--   'תל אבית יפה'    one branch, and a typo in the publisher's own file for
--                    תל אביב-יפו. Encoding somebody's typo as a legitimate spelling
--                    of a city is not a fix; if they correct it, it resolves itself.
--   10018 / 10044 / 10098 / 1306 / 50
--                    a chain's own internal numbering, or symbols for settlements
--                    the government list we have does not carry.
--
-- Each of those branches keeps no position, stays out of "closest to me", and stays
-- counted in the line on the screen that says how many offers are not shown.
-- ---------------------------------------------------------------------------

-- Four rows, not the whole table again: 0046 and 0049 are applied, every other
-- settlement is already there with the same values, and a 110 KB paste for four
-- rows is how a paste arrives truncated.
insert into public.town_centres (norm_name, name, lat, lon, source) values
  ('אפרת', 'אפרת', 31.655, 35.167, 'compiled'),
  ('טירת הכרמל', 'טירת הכרמל', 32.761, 34.972, 'compiled'),
  ('כפר עציון', 'כפר עציון', 31.65, 35.114, 'compiled'),
  ('טבעון', 'קריית טבעון', 32.7332039, 35.1453385, 'data.gov.il+osm')
on conflict (norm_name) do update set name = excluded.name, lat = excluded.lat, lon = excluded.lon, source = excluded.source;

update public.town_centres tc set code = v.code
  from (values
  ('אפרת', '3650'),
  ('כפר עציון', '3488'),
  ('טבעון', '2300')
) as v(norm_name, code)
 where tc.norm_name = v.norm_name;

-- Place what this makes placeable: the same four passes, only ever filling a branch
-- that has no position.
do $$
declare
  placed integer;
begin
  with candidate as (
    select b.id, t.lat, t.lon
      from public.branches b
      join public.stores s on s.id = b.store_id
      join lateral (
        select tc.lat, tc.lon
          from public.town_centres tc
         where tc.norm_name = public.norm_place(b.city)
            or public.norm_place(b.city) like tc.norm_name || ' %'
            or (btrim(b.city) ~ '^[0-9]+$' and tc.code is not null
                and ltrim(tc.code, '0') = ltrim(btrim(b.city), '0'))
            or tc.norm_name = public.norm_place(b.name_he)
            or tc.norm_name = btrim(
                 regexp_replace(
                   replace(public.norm_place(b.name_he), public.norm_place(s.name_he), ' '),
                   '\s+', ' ', 'g'
                 )
               )
         order by (tc.norm_name = public.norm_place(b.city)) desc, length(tc.norm_name) desc
         limit 1
      ) t on true
     where b.latitude is null
  )
  update public.branches b set latitude          = c.lat,
         longitude         = c.lon,
         geocoded_at       = now(),
         geocode_source    = 'israel-cities (town centre)',
         geocode_precision = 'locality'
    from candidate c
   where c.id = b.id;

  get diagnostics placed = row_count;
  raise notice '0051: placed % more branches', placed;
end
$$;

-- ======================== 0054_market_reference_precomputed.sql ========================

-- ---------------------------------------------------------------------------
-- 0054 · The market comparison is computed once per import, not once per read.
--
-- WHY. The notification worker has failed every hour since 2026-10-17 — 100
-- consecutive runs, zero successes — with
--
--   offers unavailable: canceling statement due to statement timeout
--
-- It reads one row: `offers_ranked where observation_id = <one id>`. Measured on
-- production 2026-10-23, EXPLAIN (ANALYZE) on exactly that query:
--
--   Execution Time: 7900 ms          for ONE row
--     store_min  GroupAggregate      3662 ms over 52,254 rows
--     market     GroupAggregate      7850 ms over 14,614 rows
--
-- Both aggregates run over the whole dataset before the `observation_id` filter
-- is applied, because `as materialized` is an optimisation fence: the planner
-- cannot push the outer filter into them. Asking for one row costs the same as
-- asking for all of them.
--
-- 0018 introduced those CTEs to stop the same work happening once per ROW, and
-- that was right at staging's scale (~10,600 promotions). Production now holds
-- more, and "once per query" is still an aggregate over everything. 0022 then
-- fixed the reference-price probe, which was the other half; this is the half
-- that was left.
--
-- WHAT. The quantity does not change between imports — it changes when prices
-- change, which is when an import runs. So it becomes a materialized view,
-- refreshed at the end of ingestion and indexed, and the read turns from
-- "aggregate fifty thousand rows" into an index lookup.
--
-- offers_ranked keeps every column, name, type and meaning. Only the speed
-- changes.
--
-- Rollback: the 0022 definition of offers_ranked, then
-- `drop materialized view public.market_reference`.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- The precomputed comparison: exactly the store_min + market pair from 0022,
-- lifted out of the query.
-- --------------------------------------------------------------------------

drop materialized view if exists public.market_reference;

create materialized view public.market_reference as
with store_min as (
  -- one number per chain: its lowest current regular price for this pack
  select r.sku_id, r.store_id, min(r.price_agorot) as price_agorot
    from public.regular_prices_current r
    join public.sources src on src.id = r.source_id and src.kind in ('chain_feed', 'admin')
   where r.observed_at >= now() - interval '14 days'
   group by r.sku_id, r.store_id
)
-- for a pack at a chain: the median of the OTHER chains' numbers, when there are at least two
select p.sku_id,
       p.store_id,
       (percentile_cont(0.5) within group (order by m.price_agorot))::integer as median_agorot,
       count(*)::integer                                                      as chains
  from (select distinct sku_id, store_id from public.promotions_current) p
  join store_min m on m.sku_id = p.sku_id and m.store_id <> p.store_id
 group by p.sku_id, p.store_id
having count(*) >= 2;

-- Unique, because REFRESH ... CONCURRENTLY requires one, and concurrently is
-- what keeps the site readable while an import rebuilds the comparison.
create unique index market_reference_key on public.market_reference (sku_id, store_id);

-- offers_ranked runs as the caller (security_invoker), so the caller must be
-- able to read what it joins. Without this an anonymous visitor gets
-- "permission denied for materialized view market_reference".
--
-- What it exposes: a median of public shelf prices per pack and chain. No user
-- data, and nothing not already derivable from the price feeds.
grant select on public.market_reference to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- offers_ranked: the same view, with the two CTEs replaced by a join.
-- --------------------------------------------------------------------------

create or replace view public.offers_ranked
with (security_invoker = on)
as
select
  o.id                                   as observation_id,
  o.sku_id,
  s.beer_id,
  be.slug                                as beer_slug,
  be.name_he                             as beer_name,
  be.name_en                             as beer_name_en,
  s.variant,
  s.category,
  br.slug                                as brand_slug,
  s.container,
  s.volume_ml,
  s.pack_quantity,
  s.total_volume_ml,
  s.display_he                           as sku_name,
  o.store_id,
  st.slug                                as store_slug,
  st.name_he                             as store_name,
  o.branch_id,
  o.identity_key,
  o.promo_type,
  o.conditions,
  o.deposit_agorot,
  o.deposit_included,
  o.valid_from,
  o.valid_to,
  o.observed_at,
  (psrc.slug = 'sample-data')            as is_sample,
  o.price_agorot                         as effective_agorot,
  round(o.price_agorot::numeric * 1000 / s.total_volume_ml)::integer as unit_price_per_liter_agorot,
  ref.price_agorot                       as reference_agorot,
  ref.observed_at                        as reference_observed_at,
  ref.trust                              as reference_trust,
  case when pct.raw between 1 and 70 then pct.raw end as value_pct,
  coalesce(pct.raw > 70, false)          as needs_review,
  mk.median_agorot                       as market_reference_agorot,
  mk.chains                              as market_chains,
  case when mk.median_agorot > o.price_agorot
       then round((mk.median_agorot - o.price_agorot) * 100.0 / mk.median_agorot)::integer
  end                                    as market_value_pct
from public.promotions_current o
join public.skus   s  on s.id  = o.sku_id
join public.product_categories pc on pc.slug = s.category and pc.in_scope
join public.beers  be on be.id = s.beer_id
join public.brands br on br.id = be.brand_id
join public.stores st on st.id = o.store_id
join public.sources psrc on psrc.id = o.source_id
left join lateral (
  -- The reference is the same pack at the same chain (same branch first), with the deposit
  -- treated the same way on both sides: a deposit difference is never a "saving".
  -- 0022: the same row as 0018's single query — this branch's newest regular price, else the chain-wide
  -- (branch-less) one — found by two one-row probes of price_obs_live_regular instead of reading every
  -- branch's price of the pack and sorting them.
  select r.price_agorot
         + case when coalesce(r.deposit_included, false) = coalesce(o.deposit_included, false) then 0
                when coalesce(r.deposit_included, false) then -coalesce(r.deposit_agorot, 0)
                else coalesce(r.deposit_agorot, 0) end as price_agorot,
         r.observed_at,
         case src.kind when 'chain_feed' then 'feed' when 'admin' then 'moderated' else 'unverified' end as trust
    from (
    (select r.id, 0 as prio
       from public.price_observations r
      where r.kind = 'regular' and r.status = 'live'
        and r.sku_id = o.sku_id and r.store_id = o.store_id and r.branch_id = o.branch_id
        and r.observed_at >= now() - interval '14 days'
      order by r.observed_at desc, r.id desc
      limit 1)
      union all
    (select r.id, 1 as prio
       from public.price_observations r
      where r.kind = 'regular' and r.status = 'live'
        and r.sku_id = o.sku_id and r.store_id = o.store_id and r.branch_id is null
        and r.observed_at >= now() - interval '14 days'
      order by r.observed_at desc, r.id desc
      limit 1)
      order by prio
      limit 1
    ) pick
    join public.price_observations r on r.id = pick.id
    join public.sources src on src.id = r.source_id
) ref on true
left join lateral (
  select round((ref.price_agorot - o.price_agorot) * 100.0 / ref.price_agorot)::integer as raw
   where ref.trust in ('feed', 'moderated') and ref.price_agorot > o.price_agorot
) pct on true
left join public.market_reference mk on mk.sku_id = o.sku_id and mk.store_id = o.store_id;

-- --------------------------------------------------------------------------
-- Refreshing it.
--
-- CONCURRENTLY so readers are never blocked: the site stays up while an import
-- rebuilds the comparison. It needs the unique index above and cannot run
-- inside a transaction block, so the caller invokes it on its own.
--
-- Safe to call when nothing has changed; it recomputes the same rows.
-- --------------------------------------------------------------------------

create or replace function public.refresh_market_reference()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The same gate as refresh_offers_catalog (0044): rebuilding the comparison is
  -- part of the price write path, and an importer is exactly who may do it.
  perform public.require_price_writer();

  refresh materialized view concurrently public.market_reference;
end;
$$;

revoke all on function public.refresh_market_reference() from public, anon;
grant execute on function public.refresh_market_reference() to authenticated, service_role;

-- ======================== 0055_catalog_refresh_needs_a_where.sql ========================

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

-- ======================== 0056_refreshes_get_time_to_run.sql ========================

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

-- ======================== 0057_offers_near_a_point.sql ========================

-- ---------------------------------------------------------------------------
-- 0057 — the deals around a point, each at the branch it is actually at
--
-- The owner asked for a map (2026-10-24). Migration 0039 explained why there was
-- not one, and named the condition for building it: "the day
-- scripts/ingest/geocode.mjs runs, this screen starts answering properly with no
-- further change." The geocoder is configured now, so this is that day's SQL.
--
-- THE UNIT IS A BRANCH, NOT A CHAIN. `offers_catalog` holds one row per deal per
-- chain — the cheapest observation of it — and that row names a single branch,
-- the one the price was seen at. A map drawn from that would show one pin per
-- deal, at one shop, for a deal running in forty. `promotion_branches` (0017) is
-- the list of branches a promotion was actually observed at, so the map is built
-- from the join of the two: every branch that has the deal, with the deal.
--
-- DISTANCE IS NULL, NEVER ZERO. A branch we cannot place has no distance, and
-- `km_between` returns null for it. It is not 0 km, it is not the city centre
-- pretending to be a shop, and such a branch is simply not returned here —
-- because a map can only draw what it can put somewhere, and a pin in the wrong
-- place is the one failure this product cannot absorb (0026, 0039). A deal in a
-- branch we cannot place is still reachable everywhere else in the app; it is
-- the map alone that has nothing to say about it.
--
-- THE RADIUS IS DONE IN SQL, not in the browser. The brief is explicit that the
-- map must not fetch the whole country to show one neighbourhood (§9). 1,124
-- branches is small enough that a filter over them is cheap, and the limit is a
-- backstop rather than a budget.
--
-- NOT SECURITY DEFINER, for the same reasons 0039 gave: every table it reads —
-- offers_catalog (0044), promotion_branches (0017), branches (0008) — is already
-- world-readable by policy, and where a shop is, is public information. Passing
-- a point in is geography, not identity: nothing about the asker is stored, and
-- this function has nowhere to store it.
--
-- Additive: one function. Safe to run twice.
-- ---------------------------------------------------------------------------

create or replace function public.offers_near(
  p_lat       double precision,
  p_lon       double precision,
  p_radius_km double precision default 15,
  p_limit     integer default 400
)
returns table (
  branch_id     uuid,
  branch_name   text,
  branch_city   text,
  latitude      double precision,
  longitude     double precision,
  geo_precision text,
  km            double precision,
  offer_key     text,
  store_slug    text,
  store_name    text,
  beer_slug     text,
  beer_name     text,
  pack_label    text,
  effective_agorot integer,
  value_pct     integer,
  promo_type    public.promo_type,
  valid_to      timestamptz,
  observed_at   timestamptz
)
language sql
stable
set search_path = public
as $$
  select b.id,
         b.name_he,
         b.city,
         b.latitude,
         b.longitude,
         b.geocode_precision,
         public.km_between(p_lat, p_lon, b.latitude, b.longitude) as km,
         c.offer_key,
         c.store_slug,
         c.store_name,
         c.beer_slug,
         c.beer_name,
         c.pack_label,
         c.effective_agorot,
         c.value_pct,
         c.promo_type,
         c.valid_to,
         c.observed_at
    from public.offers_catalog c
    join public.promotion_branches pb on pb.promotion_id = c.promotion_id
    join public.branches b on b.id = pb.branch_id
   where c.promotion_id is not null
     and b.is_active
     and b.latitude is not null
     and b.longitude is not null
     -- A point is required. Without one there is no "near", and returning the
     -- whole country unordered would be the bug this function exists to prevent.
     and p_lat is not null
     and p_lon is not null
     -- 0 means "no limit", the same reading profiles.search_radius_km already has
     -- in distance.ts, so the two cannot drift apart.
     and (coalesce(p_radius_km, 0) = 0
          or public.km_between(p_lat, p_lon, b.latitude, b.longitude) <= p_radius_km)
   -- Nearest first, and within one branch the best saving first, so a pin that
   -- shows a single deal shows that branch's best one.
   order by km asc, c.value_pct desc nulls last, c.effective_agorot asc
   limit greatest(coalesce(p_limit, 400), 1);
$$;

comment on function public.offers_near(double precision, double precision, double precision, integer) is
  'Live chain deals at branches within p_radius_km of a point, nearest first. One row '
  'per branch per deal. Branches with no position are omitted: a map can only draw '
  'what it can place, and a pin in the wrong place is worse than no pin (0057).';

grant execute on function public.offers_near(double precision, double precision, double precision, integer)
  to anon, authenticated, service_role;

-- ======================== 0058_offers_near_starts_from_the_branches.sql ========================

-- ---------------------------------------------------------------------------
-- 0058 — the map's query starts from the branches near you, not from every
--        promotion in the country
--
-- MEASURED, production, 2026-10-25, the moment 0057 was applied. The function
-- exists and answers with a timeout:
--
--   offers_near(32.0853, 34.7818, 15, 400)  →  57014, statement timeout
--
-- Taken apart over REST, the cost is in exactly one place:
--
--   offers_catalog                 542 rows   0.5 s
--   branches with a position     1,016 rows   0.3 s
--   promotion_branches                        TIMES OUT on its own
--
-- WHAT promotion_branches COSTS. It is a view (0017) over every promotion
-- occurrence ever recorded, with a DISTINCT ON per (promotion, branch) and a
-- correlated subquery per row to find each chain's newest scan. Asked for its
-- whole self it is not cheap, and 0057 joined the whole of it to the catalogue
-- and only then narrowed to the branches in range. The narrowing has to come
-- first: there are a thousand branches and a handful are near any point.
--
-- SO THE QUERY IS INVERTED. `here` is the branches inside the radius — one scan
-- of a small table — and the view is reached with a branch_id already in hand,
-- which it can push into its own scan because branch_id is part of its DISTINCT
-- ON key. A cheap bounding box runs before the trigonometry; `km_between` then
-- answers exactly, once per branch instead of twice per row.
--
-- AND TWO INDEXES IT HAD NO WAY TO USE. promotion_occurrences was indexed on
-- (store_id, canonical_key) only — the chain page's question. "Which promotions
-- does THIS branch have" had no index at all and meant a sequential scan.
-- branch_scans had (store_id, scanned_at) for the same reason.
--
-- Nothing about the ANSWER changes: same rows, same order, same refusals. A
-- branch we cannot place is still absent, no point still means no rows, and
-- radius 0 still means no limit — the bounding box is skipped in that case
-- rather than being built from an infinite side.
--
-- Additive: two indexes and one function redefined. Safe to run twice.
-- ---------------------------------------------------------------------------

-- "Which promotions does this branch have", which nothing indexed before.
create index if not exists promotion_occurrences_branch
  on public.promotion_occurrences (branch_id);

-- The view's other join: this branch's row in a scan, by the file it names.
create index if not exists branch_scans_branch_file
  on public.branch_scans (branch_id, promo_file);

create or replace function public.offers_near(
  p_lat       double precision,
  p_lon       double precision,
  p_radius_km double precision default 15,
  p_limit     integer default 400
)
returns table (
  branch_id     uuid,
  branch_name   text,
  branch_city   text,
  latitude      double precision,
  longitude     double precision,
  geo_precision text,
  km            double precision,
  offer_key     text,
  store_slug    text,
  store_name    text,
  beer_slug     text,
  beer_name     text,
  pack_label    text,
  effective_agorot integer,
  value_pct     integer,
  promo_type    public.promo_type,
  valid_to      timestamptz,
  observed_at   timestamptz
)
language sql
stable
set search_path = public
as $$
  with here as materialized (
    select b.id, b.name_he, b.city, b.latitude, b.longitude, b.geocode_precision,
           public.km_between(p_lat, p_lon, b.latitude, b.longitude) as km
      from public.branches b
     where b.is_active
       and b.latitude is not null
       and b.longitude is not null
       -- A point is required. Without one there is no "near", and returning the
       -- whole country unordered would be the bug this function exists to prevent.
       and p_lat is not null
       and p_lon is not null
       -- A box before the trigonometry, and only when there is a radius to box.
       -- One degree of latitude is ~111 km; of longitude, ~111 km × cos(lat).
       and (coalesce(p_radius_km, 0) = 0 or (
             b.latitude between p_lat - (p_radius_km / 111.0) and p_lat + (p_radius_km / 111.0)
         and b.longitude between p_lon - (p_radius_km / (111.0 * greatest(cos(radians(p_lat)), 0.01)))
                            and p_lon + (p_radius_km / (111.0 * greatest(cos(radians(p_lat)), 0.01)))
       ))
  )
  select h.id,
         h.name_he,
         h.city,
         h.latitude,
         h.longitude,
         h.geocode_precision,
         h.km,
         c.offer_key,
         c.store_slug,
         c.store_name,
         c.beer_slug,
         c.beer_name,
         c.pack_label,
         c.effective_agorot,
         c.value_pct,
         c.promo_type,
         c.valid_to,
         c.observed_at
    from here h
    join public.promotion_branches pb on pb.branch_id = h.id
    join public.offers_catalog c on c.promotion_id = pb.promotion_id
   where coalesce(p_radius_km, 0) = 0 or h.km <= p_radius_km
   -- Nearest first, and within one branch the best saving first, so a pin that
   -- shows a single deal shows that branch's best one.
   order by h.km asc, c.value_pct desc nulls last, c.effective_agorot asc
   limit greatest(coalesce(p_limit, 400), 1);
$$;

comment on function public.offers_near(double precision, double precision, double precision, integer) is
  'Live chain deals at branches within p_radius_km of a point, nearest first. One row '
  'per branch per deal. Starts from the branches in range, because promotion_branches '
  'is expensive asked for its whole self (0058). Branches with no position are omitted: '
  'a map can only draw what it can place, and a pin in the wrong place is worse than none.';

grant execute on function public.offers_near(double precision, double precision, double precision, integer)
  to anon, authenticated, service_role;

-- ======================== 0059_which_branches_have_a_promotion.sql ========================

-- ---------------------------------------------------------------------------
-- 0059 — which branches have a promotion, computed once per import
--
-- MEASURED, production, 2026-10-25. 0058 inverted the map's query to start from
-- the branches in range, and it still times out at the 3-second ceiling anon
-- reads under:
--
--   offers_near(32.0853, 34.7818, 15)   →  57014, after 3.9 s
--
-- WHY INVERTING IT WAS NOT ENOUGH, which is the useful part. Taken apart over
-- REST:
--
--   promotion_occurrences                        225,419 rows
--   promotion_branches filtered to ONE branch     28 rows, 0.40 s  ← fast
--   promotion_branches joined to a set of them               times out
--
-- A constant filter is fast because it is pushed into the view. A JOIN predicate
-- is not, and cannot be: `promotion_branches` is a DISTINCT ON over every
-- occurrence ever recorded, and Postgres cannot pull a DISTINCT ON subquery up
-- into the outer query, so it has no way to parameterise it per branch. It
-- evaluates the whole thing — a sort of 225,419 rows — and only then joins. No
-- index fixes that, because nothing is being looked up.
--
-- SO IT IS A TABLE NOW, which is exactly what 0044 did to the feed for exactly
-- this reason: the expensive half is computed at the end of an import instead of
-- on every read. The pairs are small — one row per (promotion, branch) actually
-- observed, against a quarter of a million occurrences — and a plain index
-- answers "which promotions does this branch have" in microseconds.
--
-- STALENESS, SAID PLAINLY. Between imports this is as old as the last one, which
-- is already true of every price in the app. The view it is built from stays,
-- and stays the definition: this table is only its answer, cached.
--
-- The delete says WHERE on purpose. An unqualified one is refused through
-- PostgREST by Supabase's safeupdate guard, which cost this project twelve days
-- of silently unpublished prices (0055).
--
-- Filled at the end of this file, so the map works the moment this is pasted
-- rather than at the next import.
-- ---------------------------------------------------------------------------

create table if not exists public.promotion_branch_pins (
  promotion_id bigint not null,
  branch_id    uuid   not null,
  observed_at  timestamptz,
  primary key (branch_id, promotion_id)
);

comment on table public.promotion_branch_pins is
  'Which branches a promotion was observed at — promotion_branches (0017), computed '
  'once per import instead of per read. The view is still the definition; this is its '
  'answer. Never written by hand: refresh_promotion_branches() rebuilds it (0059).';

create index if not exists promotion_branch_pins_promotion
  on public.promotion_branch_pins (promotion_id);

-- Public, like everything it is derived from: where a shop is and what it is
-- selling are both already world-readable by policy.
grant select on public.promotion_branch_pins to anon, authenticated, service_role;

alter table public.promotion_branch_pins enable row level security;

drop policy if exists promotion_branch_pins_read on public.promotion_branch_pins;
create policy promotion_branch_pins_read on public.promotion_branch_pins
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Rebuild it. Same guard as the prices it is derived from (0008): whoever may
-- write a price may write what we computed from it.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_promotion_branches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  written integer;
begin
  perform public.require_price_writer();

  -- One transaction: readers keep seeing the previous pairs until it commits, and
  -- a failure leaves the old ones rather than an empty map.
  --
  -- The WHERE is not a filter, it is a password — see 0055. Every row has a
  -- branch_id, so this clears the table, which is what a rebuild is.
  delete from public.promotion_branch_pins where branch_id is not null;
  insert into public.promotion_branch_pins (promotion_id, branch_id, observed_at)
  select pb.promotion_id, pb.branch_id, pb.observed_at
    from public.promotion_branches pb;
  get diagnostics written = row_count;

  return written;
end;
$$;

revoke execute on function public.refresh_promotion_branches() from public, anon;
grant execute on function public.refresh_promotion_branches() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The map's query, now reading the table.
-- ---------------------------------------------------------------------------
create or replace function public.offers_near(
  p_lat       double precision,
  p_lon       double precision,
  p_radius_km double precision default 15,
  p_limit     integer default 400
)
returns table (
  branch_id     uuid,
  branch_name   text,
  branch_city   text,
  latitude      double precision,
  longitude     double precision,
  geo_precision text,
  km            double precision,
  offer_key     text,
  store_slug    text,
  store_name    text,
  beer_slug     text,
  beer_name     text,
  pack_label    text,
  effective_agorot integer,
  value_pct     integer,
  promo_type    public.promo_type,
  valid_to      timestamptz,
  observed_at   timestamptz
)
language sql
stable
set search_path = public
as $$
  with here as materialized (
    select b.id, b.name_he, b.city, b.latitude, b.longitude, b.geocode_precision,
           public.km_between(p_lat, p_lon, b.latitude, b.longitude) as km
      from public.branches b
     where b.is_active
       and b.latitude is not null
       and b.longitude is not null
       -- A point is required. Without one there is no "near", and returning the
       -- whole country unordered would be the bug this function exists to prevent.
       and p_lat is not null
       and p_lon is not null
       -- A box before the trigonometry, and only when there is a radius to box.
       and (coalesce(p_radius_km, 0) = 0 or (
             b.latitude between p_lat - (p_radius_km / 111.0) and p_lat + (p_radius_km / 111.0)
         and b.longitude between p_lon - (p_radius_km / (111.0 * greatest(cos(radians(p_lat)), 0.01)))
                            and p_lon + (p_radius_km / (111.0 * greatest(cos(radians(p_lat)), 0.01)))
       ))
  )
  select h.id, h.name_he, h.city, h.latitude, h.longitude, h.geocode_precision, h.km,
         c.offer_key, c.store_slug, c.store_name, c.beer_slug, c.beer_name, c.pack_label,
         c.effective_agorot, c.value_pct, c.promo_type, c.valid_to, c.observed_at
    from here h
    join public.promotion_branch_pins pb on pb.branch_id = h.id
    join public.offers_catalog c on c.promotion_id = pb.promotion_id
   where coalesce(p_radius_km, 0) = 0 or h.km <= p_radius_km
   order by h.km asc, c.value_pct desc nulls last, c.effective_agorot asc
   limit greatest(coalesce(p_limit, 400), 1);
$$;

grant execute on function public.offers_near(double precision, double precision, double precision, integer)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fill it once, now, so the map answers the moment this is pasted. Idempotent:
-- the delete runs first, and running this file twice simply rebuilds it.
-- ---------------------------------------------------------------------------
delete from public.promotion_branch_pins where branch_id is not null;
insert into public.promotion_branch_pins (promotion_id, branch_id, observed_at)
select pb.promotion_id, pb.branch_id, pb.observed_at from public.promotion_branches pb;

-- ======================== 0060_three_drinks_shops.sql ========================

-- ---------------------------------------------------------------------------
-- 0060 — three drinks shops, filled in by hand
--
-- The owner asked for יין בעיר, הרמיטאז׳ and בנא משקאות, 2026-10-25, knowing
-- what it means: none of the three publishes a price file, so nothing imports
-- them and nobody should expect them to fill themselves.
--
-- WHY THEY ARE DIFFERENT FROM EVERY OTHER SHOP HERE. The nineteen chains above
-- are in the price-transparency programme: the law requires them to publish a
-- file, the importer reads it every morning, and a price arrives with a scan, a
-- branch and an observation behind it. These three are drinks shops below that
-- threshold. Their deals will come from the admin screen, which is the same
-- path a person's own submission takes — and they carry the same trust marks as
-- any hand-entered price, because that is what they are.
--
-- SO THEY WILL LOOK EMPTY UNTIL SOMEBODY TYPES, and that is correct rather than
-- broken. A chain with no live deal already shows as having none; these simply
-- start there. Nothing in the app needs to know they are special: a store is a
-- store, and the honesty is in where its prices came from, which the app
-- already says on every line.
--
-- The names are the owner's, with one guess flagged: he wrote "הרימטג", which
-- is almost certainly הרמיטאז׳. If it is a different shop, change the name here
-- — the slug is what everything else holds on to.
--
-- Additive, and idempotent: a slug that is already there is left alone.
-- ---------------------------------------------------------------------------

insert into public.stores (slug, name_he) values
  ('yain-bair',  'יין בעיר'),
  ('hermitage',  'הרמיטאז׳'),
  ('bana',       'בנא משקאות')
on conflict (slug) do nothing;

-- ======================== 0064_deals_by_town.sql ========================

-- ---------------------------------------------------------------------------
-- 0064 — the whole country, by town
--
-- MEASURED, production, 2026-10-25, after the owner chose "בכל הארץ" and saw
-- only what was within about forty kilometres of him:
--
--   offers_near(TLV, radius 0, limit 400)     400 rows,  86 branches, none > 40 km
--   offers_near(TLV, radius 0, limit 5000)  1,000 rows, 103 branches, none > 40 km
--   offers_near(TLV, radius 0, limit 30000) 1,000 rows, 103 branches, none > 40 km
--
-- PostgREST caps a response at 1,000 rows whatever the function says, and
-- offers_near orders by distance — so "no limit" could only ever mean "the
-- nearest thousand rows", which is a hundred branches around one city. The
-- radius was being honoured and the answer was still wrong.
--
-- ONE ROW PER BRANCH WOULD NOT FIX IT EITHER: a thousand branches carry deals,
-- which is the cap again, and a thousand markers on a phone is not a map, it is
-- a smear. The unit for a country is a TOWN.
--
-- GROUPED BY THE POINT, not by the name. Branches are placed at their town's
-- centre until a geocoder puts them on their street (0045), so the branches of
-- one town share a coordinate exactly — and grouping by that coordinate is both
-- simpler than normalising names and honest about what the map can actually
-- draw. When a branch does get a street-level fix it becomes its own pin, which
-- is the right behaviour: it is no longer "somewhere in that town".
--
-- Public and not SECURITY DEFINER, for the reasons 0057 gives: everything it
-- reads is world-readable, and where a shop is, is public information.
--
-- Additive: one function. Safe to run twice.
-- ---------------------------------------------------------------------------

create or replace function public.deals_by_town()
returns table (
  town       text,
  latitude   double precision,
  longitude  double precision,
  branches   integer,
  deals      integer,
  best_value_pct integer,
  cheapest_agorot integer
)
language sql
stable
set search_path = public
as $$
  select
    -- One name for the point. Several branches share it; they also share a town,
    -- so any of their city values will do, and the app resolves a CBS symbol to
    -- its name before it reaches a screen (0047).
    min(b.city)                                   as town,
    b.latitude,
    b.longitude,
    count(distinct b.id)::integer                 as branches,
    count(*)::integer                             as deals,
    max(c.value_pct)::integer                     as best_value_pct,
    min(c.effective_agorot)::integer              as cheapest_agorot
    from public.branches b
    join public.promotion_branch_pins pb on pb.branch_id = b.id
    join public.offers_catalog c on c.promotion_id = pb.promotion_id
   where b.is_active
     and b.latitude is not null
     and b.longitude is not null
   group by b.latitude, b.longitude
   -- Busiest first, so a cap — if one is ever needed — keeps what matters.
   order by count(*) desc
   limit 400;
$$;

comment on function public.deals_by_town() is
  'Every place in the country that has a live chain deal, one row per POINT: the '
  'towns, because branches sit at their town centre until they are geocoded and a '
  'thousand markers is not a map (0064). offers_near is still the answer for "near me".';

grant execute on function public.deals_by_town() to anon, authenticated, service_role;

-- ======================== 0065_a_town_knows_its_own_name.sql ========================

-- ---------------------------------------------------------------------------
-- 0065 — a town pin knows its own name
--
-- MEASURED, production, minutes after 0064 shipped. The country view works —
-- 142 towns, 16,864 deals, 789 shops, 1.16 s — and thirty of those towns come
-- back named "0", including six of the ten largest:
--
--   580 deals at 31.2457, 34.7925      574 at 32.0878, 34.8860
--   501 at 32.1773, 34.9075            487 at 32.3286, 34.8566
--
-- Those are Beer Sheva, Petah Tikva, Kfar Saba, Netanya, Rishon LeZion and
-- Ashdod. On the screen they would have read "כאן".
--
-- WHY. The name came from `min(b.city)`, and some chains write "0" where the
-- town's name goes (0047). "0" sorts before every real value, so one branch
-- filing a zero renamed the whole town to nothing.
--
-- THE POINT ALREADY KNOWS. These coordinates are not approximations of a town —
-- they ARE town_centres rows, copied onto the branches by place_branches_by_town
-- (0045). So the name is a lookup on the coordinate, which is exact rather than
-- a guess, and it names all thirty. The city column stays as the fallback for a
-- branch that has a real street-level fix and so is not on a town's centre at
-- all; "0" is excluded there too, since it is not a name.
--
-- Nothing else changes: same rows, same counts, same order.
--
-- One function replaced. Safe to run twice.
-- ---------------------------------------------------------------------------

create or replace function public.deals_by_town()
returns table (
  town       text,
  latitude   double precision,
  longitude  double precision,
  branches   integer,
  deals      integer,
  best_value_pct integer,
  cheapest_agorot integer
)
language sql
stable
set search_path = public
as $$
  select
    -- The town centre this point IS, else whatever the chains called it, and
    -- never "0" — which is a symbol some of them write instead of a name.
    coalesce(tc.name, min(nullif(btrim(b.city), '0')))  as town,
    b.latitude,
    b.longitude,
    count(distinct b.id)::integer                       as branches,
    count(*)::integer                                   as deals,
    max(c.value_pct)::integer                           as best_value_pct,
    min(c.effective_agorot)::integer                    as cheapest_agorot
    from public.branches b
    join public.promotion_branch_pins pb on pb.branch_id = b.id
    join public.offers_catalog c on c.promotion_id = pb.promotion_id
    left join public.town_centres tc
      on tc.lat = b.latitude and tc.lon = b.longitude
   where b.is_active
     and b.latitude is not null
     and b.longitude is not null
   group by b.latitude, b.longitude, tc.name
   order by count(*) desc
   limit 400;
$$;

grant execute on function public.deals_by_town() to anon, authenticated, service_role;

-- ======================== 0066_prune_history.sql ========================

-- ---------------------------------------------------------------------------
-- 0066 · Price history that stops growing by itself, and a cleanup of what nothing reads
--
-- Measured on staging (2026-10-14, 2½ weeks of daily full-branch imports): 845 MB, of which the price
-- ledger is 689 MB / 770,556 rows. Every import re-recorded every price and promotion, changed or not —
-- ~60,000 rows (~37 MB) a day; production reached 548 MB of the free plan's 500 MB in two weeks.
--   - 475,477 of the 491,368 superseded rows had exactly the price of the row that replaced them;
--   - 209,401 rows were REJECTED (rolled-back runs, resets) — no screen or computation reads them;
--   - 159,928 of 182,778 promotion occurrences belonged to files no longer current (scope reads only the
--     latest scan of each chain, 0017); 10,615 of 11,737 branch scans were older scans;
--   - 30,741 of 36,021 mix-and-match groups were superseded or rejected.
--
-- 1. record_price: an UNCHANGED price is seen again, not written again (one sample row a week is kept for the
--    Deal Score's history). New column first_observed_at remembers when the unchanged run began.
-- 2. prune_history(p_kind, p_apply, p_batch): deletes, in bounded batches and one kind per call, only what
--    nothing reads —
--      rejected price rows; occurrences not in the latest scan's files; branch scans older than 7 days that
--      are not their chain's latest scan; superseded and rejected group promotions (their items cascade).
--    Live, held and superseded price rows are untouched (the Deal Score reads 180 days of live + superseded);
--    notification events are untouched (their dedupe keys are what stop a deal being announced twice).
--    Without p_apply it only counts. Executable by the service role only (the import's credentials).
-- 3. An index on superseded_by (a delete from the ledger checks that no row still points at it), and two
--    partial indexes on what is pruned.
--
-- Deleting frees space for reuse; the size Supabase reports drops only after `vacuum full` on the table
-- (docs/PRUNE-HISTORY.md). Rollback: supabase/rollback/0066_prune_history.down.sql (the deleted rows are not
-- restored by it — the backup taken before the first prune is the way back).
-- ---------------------------------------------------------------------------

alter table public.price_observations add column if not exists first_observed_at timestamptz;

create index if not exists price_obs_superseded_by on public.price_observations (superseded_by)
  where superseded_by is not null;

-- What prune_history looks for, found without reading the whole ledger (a full read of 689 MB took 7.8 s on
-- staging, against the service role's 8 s statement timeout). Both stay small: what they index is pruned daily.
create index if not exists price_obs_rejected on public.price_observations (id) where status = 'rejected';
create index if not exists promotion_groups_dead on public.promotion_groups (id) where status in ('superseded', 'rejected');

-- The ledger stays append-only (0008/0014), with exactly two exceptions, each as narrow as it can be:
--   - SEEN AGAIN: a live row may have observed_at moved FORWARD (and first_observed_at set once, to the old
--     observed_at). Price, terms, identity, source and run never change.
--   - PRUNED: a REJECTED row may be deleted, and only inside prune_history() (it sets beer_deals.prune for its
--     own transaction). Every other delete is refused, as before.
create or replace function public.price_observations_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'rejected' and current_setting('beer_deals.prune', true) = 'on' then
      return old;
    end if;
    raise exception 'price observations are append-only; mark a bad row rejected instead'
      using errcode = '42501';
  end if;

  if (to_jsonb(new) - 'status' - 'superseded_by' - 'created_by' - 'audience' - 'deposit_agorot' - 'deposit_included'
                    - 'observed_at' - 'first_observed_at')
     is distinct from
     (to_jsonb(old) - 'status' - 'superseded_by' - 'created_by' - 'audience' - 'deposit_agorot' - 'deposit_included'
                    - 'observed_at' - 'first_observed_at') then
    raise exception 'price observations are append-only; record a new observation instead of editing one'
      using errcode = '42501';
  end if;

  if new.observed_at is distinct from old.observed_at
     or new.first_observed_at is distinct from old.first_observed_at then
    if old.status <> 'live' or new.status <> 'live'
       or new.observed_at < old.observed_at
       or old.first_observed_at is not null and new.first_observed_at is distinct from old.first_observed_at
       or old.first_observed_at is null and new.first_observed_at is distinct from old.observed_at then
      raise exception 'only a live observation may be seen again, and only later'
        using errcode = '42501';
    end if;
  end if;

  if old.status in ('superseded', 'rejected') and new.status is distinct from old.status then
    raise exception 'a % observation cannot change status again', old.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.record_price(
  p_sku_id       uuid,
  p_store_id     uuid,
  p_kind         public.price_kind,
  p_price_agorot integer,
  p_observed_at  timestamptz,
  p_source_slug  text,
  p_branch_id    uuid                 default null,
  p_valid_from   timestamptz          default null,
  p_valid_to     timestamptz          default null,
  p_promo_type   public.promo_type    default null,
  p_conditions   jsonb                default '{}'::jsonb,
  p_natural_key  text                 default null,
  p_content_hash text                 default null,
  p_raw          jsonb                default null,
  p_run_id       uuid                 default null,
  p_status       text                 default 'live'
)
returns public.price_observations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source   public.sources;
  v_existing public.price_observations;
  v_row      public.price_observations;
  v_price    integer := p_price_agorot;
  v_identity text;
  v_qty      integer;
  v_total    integer;
  v_newer    bigint;
  v_same     public.price_observations;
begin
  perform public.require_price_writer();

  select * into v_source from public.sources where slug = p_source_slug;
  if not found then
    raise exception 'unknown source %', p_source_slug using errcode = 'P0002';
  end if;

  if p_status not in ('live', 'held') then
    raise exception 'status must be live or held' using errcode = '22023';
  end if;
  if not exists (select 1 from public.skus where id = p_sku_id and is_active) then
    raise exception 'unknown or inactive sku' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.stores where id = p_store_id) then
    raise exception 'unknown store' using errcode = 'P0002';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and store_id = p_store_id
  ) then
    raise exception 'the branch does not belong to that store' using errcode = '22023';
  end if;

  -- Replay: nothing to do.
  if p_content_hash is not null then
    select * into v_existing
      from public.price_observations
     where source_id = v_source.id and content_hash = p_content_hash and status <> 'rejected';
    if found then
      return v_existing;
    end if;
  end if;

  if p_kind = 'promotion' then
    if p_promo_type is null then
      raise exception 'a promotion needs a promo_type' using errcode = '22023';
    end if;

    if p_promo_type = 'multi_buy' then
      v_qty   := (p_conditions #>> '{multi_buy,qty}')::integer;
      v_total := (p_conditions #>> '{multi_buy,total_agorot}')::integer;
      if v_qty is null or v_qty < 2 or v_total is null or v_total <= 0 then
        raise exception 'a multi_buy needs conditions.multi_buy = {qty >= 2, total_agorot > 0}'
          using errcode = '22023';
      end if;
      if v_price is not null and v_price <> ceil(v_total::numeric / v_qty)::integer then
        raise exception 'price_agorot must equal ceil(total_agorot / qty) for a multi_buy'
          using errcode = '22023';
      end if;
      v_price := ceil(v_total::numeric / v_qty)::integer;
    end if;

    v_identity := coalesce(
      p_natural_key,
      md5(concat_ws('|', p_promo_type::text, p_valid_from::text, p_valid_to::text, p_conditions::text))
    );
  else
    if p_promo_type is not null or p_valid_to is not null then
      raise exception 'a regular price has no promo_type and no end date' using errcode = '22023';
    end if;
    v_identity := 'regular';
  end if;

  if v_price is null then
    raise exception 'a price is required' using errcode = '22023';
  end if;

  -- One writer at a time per SKU × chain, so two imports cannot both decide they
  -- are "the newest".
  perform pg_advisory_xact_lock(hashtext(p_sku_id::text || p_store_id::text));

  -- 0066 · UNCHANGED IS NOT NEW. The same price, for the same pack, at the same branch, under the same identity
  -- and terms, re-read from a newer file, does not add a row: the live row is marked as seen again (observed_at
  -- moves forward, so close_missing_promotions keeps it and the 14-day windows still see it). One row per WEEK is
  -- still written for an unchanged price, so the Deal Score's history (0027: live + superseded rows over 180 days,
  -- at least 4 of them) keeps its samples — at a seventh of the volume a daily row cost.
  if p_status = 'live' then
    select * into v_same
      from public.price_observations o
     where o.sku_id = p_sku_id
       and o.store_id = p_store_id
       and o.branch_id is not distinct from p_branch_id
       and o.kind = p_kind
       and o.identity_key = v_identity
       and o.source_id = v_source.id
       and o.status = 'live'
       and o.price_agorot = v_price
       and o.promo_type is not distinct from p_promo_type
       and o.valid_from is not distinct from p_valid_from
       and o.valid_to is not distinct from p_valid_to
       and o.conditions = coalesce(p_conditions, '{}'::jsonb)
     order by o.observed_at desc, o.id desc
     limit 1;

    if found and p_observed_at < coalesce(v_same.first_observed_at, v_same.observed_at) + interval '7 days' then
      if p_observed_at > v_same.observed_at then
        update public.price_observations set first_observed_at = coalesce(first_observed_at, observed_at),
               observed_at       = p_observed_at
         where id = v_same.id
        returning * into v_same;
      end if;
      return v_same;
    end if;
  end if;


  insert into public.price_observations (
    sku_id, store_id, branch_id, kind, price_agorot, observed_at, valid_from, valid_to,
    promo_type, conditions, identity_key, source_id, run_id, natural_key, content_hash,
    raw, status, created_by
  ) values (
    p_sku_id, p_store_id, p_branch_id, p_kind, v_price, p_observed_at, p_valid_from, p_valid_to,
    p_promo_type, coalesce(p_conditions, '{}'::jsonb), v_identity, v_source.id, p_run_id, p_natural_key, p_content_hash,
    p_raw, p_status, auth.uid()
  )
  returning * into v_row;

  if p_status = 'live' then
    select o.id into v_newer
      from public.price_observations o
     where o.sku_id = v_row.sku_id
       and o.store_id = v_row.store_id
       and o.branch_id is not distinct from v_row.branch_id
       and o.kind = v_row.kind
       and o.identity_key = v_row.identity_key
       and o.status = 'live'
       and o.id <> v_row.id
       and (o.observed_at > v_row.observed_at or (o.observed_at = v_row.observed_at and o.id > v_row.id))
     order by o.observed_at desc, o.id desc
     limit 1;

    if v_newer is not null then
      update public.price_observations set status = 'superseded', superseded_by = v_newer where id = v_row.id;
    else
      update public.price_observations o set status = 'superseded', superseded_by = v_row.id
       where o.sku_id = v_row.sku_id
         and o.store_id = v_row.store_id
         and o.branch_id is not distinct from v_row.branch_id
         and o.kind = v_row.kind
         and o.identity_key = v_row.identity_key
         and o.status = 'live'
         and o.id <> v_row.id;
    end if;

    select * into v_row from public.price_observations where id = v_row.id;
  end if;

  return v_row;
end;
$$;

-- One kind per call: each call is one statement under the service role's 8 s statement timeout (measured on
-- staging: all four kinds in one call took 7.4 s with a cold cache).
drop function if exists public.prune_history(boolean, integer);

create or replace function public.prune_history(p_kind text, p_apply boolean default false, p_batch integer default 5000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids bigint[];
  v_n   integer := 0;
begin
  -- The writer's guard; and execute is granted to the service role alone (below), so in practice it is the import's.
  perform public.require_price_writer();
  if p_batch is null or p_batch < 1 or p_batch > 50000 then
    raise exception 'p_batch must be between 1 and 50000' using errcode = '22023';
  end if;

  if p_kind = 'rejected_prices' then
    -- Price rows marked rejected (rolled-back runs, resets). A row still pointing at one lets go of it first.
    if not p_apply then
      return (select count(*) from public.price_observations where status = 'rejected');
    end if;
    select array_agg(id) into v_ids
      from (select id from public.price_observations where status = 'rejected' order by id limit p_batch) b;
    if v_ids is not null then
      perform set_config('beer_deals.prune', 'on', true);
      update public.price_observations set superseded_by = null where superseded_by = any(v_ids);
      delete from public.price_observations where id = any(v_ids);
      get diagnostics v_n = row_count;
      perform set_config('beer_deals.prune', 'off', true);
    end if;
    return v_n;

  elsif p_kind = 'stale_occurrences' then
    -- Listed in a file that is no longer its branch's file in its chain's latest scan (scope reads only that).
    select array_agg(o.id) into v_ids
      from (select o.id
              from public.promotion_occurrences o
             where not exists (
                     select 1
                       from (select distinct on (x.store_id) x.store_id, x.scan_id
                               from public.branch_scans x
                              order by x.store_id, x.scanned_at desc) l
                       join public.branch_scans s on s.scan_id = l.scan_id and s.store_id = l.store_id
                      where l.store_id = o.store_id and s.branch_id = o.branch_id and s.promo_file = o.source_file)
             limit case when p_apply then p_batch else null end) o;
    if not p_apply then
      return coalesce(cardinality(v_ids), 0);
    end if;
    if v_ids is not null then
      delete from public.promotion_occurrences where id = any(v_ids);
      get diagnostics v_n = row_count;
    end if;
    return v_n;

  elsif p_kind = 'old_branch_scans' then
    -- Older than a week, and not its chain's latest scan (the latest is always kept).
    select array_agg(s.id) into v_ids
      from (select s.id
              from public.branch_scans s
             where s.scanned_at < now() - interval '7 days'
               and s.scan_id <> (select x.scan_id from public.branch_scans x
                                  where x.store_id = s.store_id order by x.scanned_at desc limit 1)
             limit case when p_apply then p_batch else null end) s;
    if not p_apply then
      return coalesce(cardinality(v_ids), 0);
    end if;
    if v_ids is not null then
      delete from public.branch_scans where id = any(v_ids);
      get diagnostics v_n = row_count;
    end if;
    return v_n;

  elsif p_kind = 'old_groups' then
    -- Group promotions that were replaced or rejected (their items go with them: on delete cascade).
    if not p_apply then
      return (select count(*) from public.promotion_groups where status in ('superseded', 'rejected'));
    end if;
    delete from public.promotion_groups
     where id in (select id from public.promotion_groups where status in ('superseded', 'rejected') limit p_batch);
    get diagnostics v_n = row_count;
    return v_n;
  end if;

  raise exception 'unknown kind %: rejected_prices, stale_occurrences, old_branch_scans or old_groups', p_kind
    using errcode = '22023';
end;
$$;

revoke execute on function public.prune_history(text, boolean, integer) from public, anon, authenticated;
grant execute on function public.prune_history(text, boolean, integer) to service_role;

-- ======================== 0067_abandoned_ingestion_runs.sql ========================

-- 0067: a run that never finished does not block the next one.
--
-- WHAT HAPPENED (production, 2026-10-27 to 2026-10-29). The daily import was cancelled
-- at the workflow's 180-minute limit three days running. A cancelled job never reaches
-- finish_ingestion_run, so each publisher's run stayed `running` for ever. The next
-- evening's import read the same files (the chains had not published new ones), hashed
-- them to the same value, and start_ingestion_run answered "already imported" from the
-- dead run. Shufersal, Tiv Taam, Yochananof, King Store, Fresh Market and four more were
-- skipped, their promotions aged out, and the app showed them with no deals at all.
--
-- THE RULE. A run still `running` more than four hours after it started is not running:
-- the longest job allowed is three hours (ingest-*.yml, timeout-minutes: 180). Before
-- looking for an earlier run of the same files, start_ingestion_run marks such runs of
-- this source `failed`, with `abandoned: true` in their stats, and so does not mistake
-- them for an import. Whatever they wrote stays as written: every row was accepted by
-- the same checks as any other, and replaying the same file marks those prices seen again
-- (0066) rather than duplicating them.
--
-- Everything else in the function is 0013's, unchanged.

create or replace function public.start_ingestion_run(p_source_slug text, p_file_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.sources;
  v_run    public.ingestion_runs;
begin
  perform public.require_price_writer();

  select * into v_source from public.sources where slug = p_source_slug;
  if not found then
    raise exception 'unknown source %', p_source_slug using errcode = 'P0002';
  end if;

  update public.ingestion_runs set status = 'failed',
         finished_at = now(),
         stats = stats || jsonb_build_object('abandoned', true, 'abandoned_at', now())
   where source_id = v_source.id
     and status = 'running'
     and started_at < now() - interval '4 hours';

  if p_file_hash is not null then
    select * into v_run from public.ingestion_runs
     where source_id = v_source.id and file_hash = p_file_hash and status in ('running', 'succeeded');
    if found then
      return jsonb_build_object('run_id', v_run.id, 'already_imported', true, 'status', v_run.status);
    end if;
  end if;

  insert into public.ingestion_runs (source_id, file_hash) values (v_source.id, p_file_hash) returning * into v_run;
  return jsonb_build_object('run_id', v_run.id, 'already_imported', false, 'status', v_run.status);
end;
$$;

revoke all on function public.start_ingestion_run(text, text) from public, anon;
grant execute on function public.start_ingestion_run(text, text) to authenticated, service_role;

-- ======================== 0068_shop_crate_prices.sql ========================

-- ---------------------------------------------------------------------------
-- 0068 — crate prices at liquor shops' websites.
--
-- WHY. A crate (24 bottles or cans) is what many people buy beer in, and the
-- supermarkets' price-transparency files almost never carry one: in production on
-- 2026-10-30 the whole feed had two crate SKUs, and no chain had ever published a
-- promotion on a crate. Crates are sold by liquor and drinks shops, which are not
-- bound by the transparency law and publish no files. Their websites do show a
-- price, and the owner chose (2026-10-30) to read it from the two shops whose terms
-- do not forbid it — אליאסי משקאות and בית היין — while asking the others for leave.
--
-- WHAT THIS IS, AND IS NOT. One row per crate on a shop's site: the shop's own
-- title, the pack read from it, the price the site shows, and the page it is on.
-- It is NOT a price_observation: those are shelf prices at a branch, carry an
-- ingestion run and feed the Deal Score, and a website's price is none of those
-- (online prices often differ from a shop's counter, and delivery is extra). So it
-- has a table of its own, and the app words it as "the price on the shop's site".
--
-- FRESHNESS. `seen_at` is when the site last showed the row. The app reads only
-- rows seen in the last three days; a crate that leaves the site stops being shown
-- without anything having to delete it, and the writer clears rows unseen for a week.
--
-- WHO WRITES. The daily import's service role, nothing else. Everybody may read:
-- these are public prices on public pages.
-- ---------------------------------------------------------------------------

create table if not exists public.shop_crate_prices (
  id             uuid primary key default gen_random_uuid(),
  -- The shop, by a slug the app knows (src/lib/shops.ts): eliasi, winehouse.
  shop           text not null check (shop ~ '^[a-z0-9-]{2,40}$'),
  beer_id        uuid not null references public.beers (id) on delete cascade,
  -- '' = the beer's main product, as skus.variant (0014).
  variant        text not null default '',
  -- The shop's own name for it, kept so a person can recognise it on the site.
  title          text not null check (length(title) between 3 and 200),
  pack_quantity  integer not null check (pack_quantity between 10 and 48),
  volume_ml      integer check (volume_ml between 200 and 1000),
  container      text check (container in ('can', 'bottle')),
  -- A crate under ₪20 or over ₪1,000 is a misread, not a price.
  price_agorot   integer not null check (price_agorot between 2000 and 100000),
  url            text not null check (url ~ '^https://[a-z0-9.-]+/' and length(url) <= 500),
  in_stock       boolean not null default true,
  pickup_only    boolean not null default false,
  seen_at        timestamptz not null default now(),
  unique (shop, url)
);

comment on table public.shop_crate_prices is
  'Crate prices shown on liquor shops'' websites (0068): the shop''s title, the pack, the price and the page. Not shelf prices; written by the daily import only.';

create index if not exists shop_crate_prices_beer_idx on public.shop_crate_prices (beer_id, seen_at desc);

alter table public.shop_crate_prices enable row level security;

grant select on public.shop_crate_prices to anon, authenticated;
grant select, insert, update, delete on public.shop_crate_prices to service_role;

create policy shop_crate_prices_read on public.shop_crate_prices
  for select to anon, authenticated using (true);

-- ======================== the ledger ========================

do $ledger$
begin
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key);
  insert into supabase_migrations.schema_migrations (version)
  values ('0001'), ('0002'), ('0003'), ('0004'), ('0005'), ('0006'), ('0007'), ('0008'), ('0009'), ('0010'), ('0011'), ('0012'), ('0013'), ('0014'), ('0015'), ('0016'), ('0017'), ('0018'), ('0019'), ('0020'), ('0021'), ('0022'), ('0023'), ('0024'), ('0025'), ('0026'), ('0027'), ('0028'), ('0029'), ('0030'), ('0031'), ('0032'), ('0033'), ('0034'), ('0035'), ('0036'), ('0037'), ('0038'), ('0039'), ('0040'), ('0041'), ('0042'), ('0043'), ('0044'), ('0045'), ('0046'), ('0047'), ('0048'), ('0049'), ('0050'), ('0051'), ('0054'), ('0055'), ('0056'), ('0057'), ('0058'), ('0059'), ('0060'), ('0064'), ('0065'), ('0066'), ('0067'), ('0068')
  on conflict (version) do nothing;
  raise notice 'ledger: recorded 63 migrations';
exception when others then
  raise notice 'ledger NOT recorded (%): the schema applied, but a later CLI push may offer to re-run it', sqlerrm;
end
$ledger$;
