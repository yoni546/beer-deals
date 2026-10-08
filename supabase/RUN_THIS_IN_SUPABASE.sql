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
  update public.profiles p
     set primary_beer_id = (
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

  update public.profiles
     set first_name   = trim(p_first_name),
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

  update public.deals
     set status      = 'approved',
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

  update public.deals
     set status = p_status,
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
  update public.app_settings
     set weekly_deal_id = null
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

  update public.deals
     set beer_id              = p_beer_id,
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

  update public.deal_reports
     set status = p_status, resolved_by = auth.uid(), resolved_at = now()
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

  update public.app_settings
     set weekly_deal_id     = p_deal_id,
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

  update public.app_settings
     set notify_min_discount_percent = p_min_discount_percent,
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
  on conflict (endpoint) do update
    set user_id    = excluded.user_id,
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
on conflict (slug) do update
  set name_he       = excluded.name_he,
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
update public.deals d
   set status = 'inactive', approved_by = null, approved_at = null
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

  update public.deals
     set status      = 'approved',
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

update public.beers b
   set brand_id = br.id
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
      update public.price_observations o
         set status = 'superseded', superseded_by = v_row.id
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

  update public.profiles
     set first_name   = trim(p_first_name),
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
  on conflict (endpoint) do update
    set user_id    = excluded.user_id,
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

  update public.profiles
     set first_name   = nullif(trim(p_first_name), ''),
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

  update public.app_settings
     set notify_min_discount_percent = p_min_discount_percent,
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

  update public.ingestion_runs
     set status = p_status, finished_at = now(), stats = stats || coalesce(p_stats, '{}'::jsonb)
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
  update public.notification_events e
     set status = 'done', outcome = 'rolled_back', processed_at = now()
   where e.status = 'pending'
     and e.offer_key in (select 'obs:' || o.id from public.price_observations o where o.run_id = p_run_id);

  update public.ingestion_runs
     set status = 'rolled_back',
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
    update public.promotion_groups g
       set status = 'superseded'
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

  update public.notification_events e
     set status = 'done', outcome = 'rolled_back', processed_at = now()
   where e.status = 'pending'
     and e.offer_key in (select 'obs:' || o.id from public.price_observations o where o.run_id = p_run_id);

  update public.ingestion_runs
     set status = 'rolled_back',
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
      update public.price_observations o
         set status = 'superseded', superseded_by = v_row.id
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
    update public.promotion_groups g
       set status = 'superseded'
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
  on conflict (scan_id, branch_id) do update
     set status = excluded.status, price_file = excluded.price_file, promo_file = excluded.promo_file,
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
  on conflict (branch_id, source_file, canonical_key, source_promotion_id) do update
     set published = excluded.published, reason = excluded.reason;
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
  update public.price_observations
     set status = 'superseded'
   where branch_id = p_branch_id and kind = 'promotion' and status = 'live' and observed_at < p_observed_at;
  get diagnostics v_prices = row_count;
  update public.promotion_groups
     set status = 'superseded'
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
  update public.promotions p
     set branches_known    = coalesce(v_known, 0),
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

  update public.ingestion_runs
     set stats  = v_run.stats,
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

update public.skus s
   set packaging = case
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

  update public.profiles
     set first_name   = nullif(trim(p_first_name), ''),
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

  update public.deals
     set status = p_status,
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
  update public.app_settings
     set weekly_deal_id = null
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

  update public.profiles
     set home_city        = nullif(trim(p_city), ''),
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
  on conflict (offer_key) do update
     set score = excluded.score,
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

  update public.app_settings
     set weekly_deal_id     = p_deal_id,
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
  update public.contributors c
     set approved   = t.approved,
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
  on conflict (offer_key, reported_by) do update
     set verdict = excluded.verdict,
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

  update public.deals
     set status      = 'approved',
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

  update public.deals
     set status = p_status,
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
  update public.app_settings
     set weekly_deal_id = null
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

  update public.deals
     set beer_id              = p_beer_id,
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

  update public.deal_reports
     set status = p_status, resolved_by = auth.uid(), resolved_at = now()
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

  update public.app_settings
     set weekly_deal_id     = p_deal_id,
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

  update public.app_settings
     set notify_min_discount_percent = p_min_discount_percent,
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
  on conflict (offer_key, reported_by) do update
     set verdict = excluded.verdict,
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

  update public.beers
     set name_he    = trim(p_name_he),
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
