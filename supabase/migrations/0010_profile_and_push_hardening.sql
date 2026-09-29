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
