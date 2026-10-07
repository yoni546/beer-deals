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
