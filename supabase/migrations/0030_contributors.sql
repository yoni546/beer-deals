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
