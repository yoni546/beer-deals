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
