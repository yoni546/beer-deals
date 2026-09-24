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
