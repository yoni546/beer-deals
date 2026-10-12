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
