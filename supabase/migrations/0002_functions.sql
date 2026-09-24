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
