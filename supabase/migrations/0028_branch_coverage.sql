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
