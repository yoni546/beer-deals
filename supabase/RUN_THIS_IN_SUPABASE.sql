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
