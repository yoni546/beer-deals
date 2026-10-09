-- ---------------------------------------------------------------------------
-- 0040 — a Moderator tier: Owner, Admin, Moderator, User.
--
-- WHAT WAS HERE. Two levels, `admin` and `super_admin`, and `is_admin()` meaning
-- "has a row in `admins`". Everybody who could review a deal could also manage
-- the catalogue, read the whole moderation history and reach every admin screen.
-- The brief asks for four roles with the moderation job separated out, and it is
-- the right separation: reviewing prices is the job you want to hand to somebody
-- else, and managing beers and granting privileges is the job you do not.
--
--   User        no row in `admins`
--   Moderator   reviews deals and reports. Nothing else.
--   Admin       the catalogue, the weekly pick, coverage, the dashboard.
--   Owner       `super_admin`: grants and revokes, deletes, notification rules.
--
-- `is_admin()` IS TIGHTENED, NOT WIDENED. It now means admin-or-owner, and a
-- moderator is no longer one. Every policy and every `require_admin()` that
-- exists today therefore CLOSES to moderators by default, and this migration
-- re-opens exactly the ones the job needs, by name. That direction matters: the
-- mistake you cannot recover from is a new role silently inheriting a permission
-- nobody listed, and the only way to be sure is to make the default "no".
--
-- NOTHING IS ENFORCED IN THE INTERFACE. The nav hides what a moderator cannot
-- use, as a courtesy; the database refuses it, which is the part that counts
-- (CLAUDE.md). tests/roles.test.ts walks every door for each of the four.
-- ---------------------------------------------------------------------------

-- Postgres cannot add an enum value inside a transaction that then USES it, and
-- this file is applied as one. So the value goes in first, on its own.
alter type public.admin_level add value if not exists 'moderator' before 'admin';

-- --------------------------------------------------------------------------
-- Who is what.
-- --------------------------------------------------------------------------

/**
 * May this person moderate? True for every level, including the two that
 * already existed — an administrator does not lose the job by gaining others.
 */
create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

/**
 * May this person manage? Admin or owner, and from 0040 NOT a moderator.
 *
 * This is the one semantic change in the migration, and it is a tightening: every
 * caller of is_admin() that is not re-opened below now refuses a moderator.
 */
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a
     where a.user_id = auth.uid() and a.level in ('admin', 'super_admin')
  );
$$;

revoke execute on function public.is_moderator() from public;
grant execute on function public.is_moderator() to authenticated, anon;

create or replace function public.require_moderator()
returns void
language plpgsql
stable
as $$
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- What a moderator may SEE: the queue, the reports, and nothing else new.
--
-- Named one by one. `price_observations`, `ingestion_runs`, `branch_scans`,
-- `promotion_groups`, the catalogue tables and the deal-image bucket are all
-- left on is_admin(), which now excludes a moderator — that is the default-closed
-- half of this migration doing its work.
-- --------------------------------------------------------------------------

drop policy if exists deals_read_admin on public.deals;
create policy deals_read_moderator on public.deals
  for select to authenticated using (public.is_moderator());

drop policy if exists reports_read_admin on public.deal_reports;
create policy reports_read_moderator on public.deal_reports
  for select to authenticated using (public.is_moderator());

drop policy if exists reports_admin_update on public.deal_reports;
create policy reports_moderator_update on public.deal_reports
  for update to authenticated using (public.is_moderator()) with check (public.is_moderator());

-- Editing a deal goes through admin_update_deal(), but the UPDATE policy is what
-- lets the definer function's row be seen on the way back out.
drop policy if exists deals_admin_update on public.deals;
create policy deals_moderator_update on public.deals
  for update to authenticated using (public.is_moderator()) with check (public.is_moderator());

-- The roster: a moderator sees who the administrators are, as everybody in the
-- panel does, and still cannot change it.
drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_moderator());

-- --------------------------------------------------------------------------
-- What a moderator may DO.
--
-- Only the review itself. Each function below is its current definition with
-- require_admin() replaced by require_moderator() and nothing else changed.
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
  perform public.require_moderator();

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
  perform public.require_moderator();

  if p_status = 'approved' then
    return public.approve_deal(p_deal_id);
  end if;

  select * into before from public.deals where id = p_deal_id;

  update public.deals
     set status = p_status,
         approved_by = null,
         approved_at = null,
         deactivated_at = now()
   where id = p_deal_id
  returning * into row;

  if row.id is null then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;

  update public.app_settings
     set weekly_deal_id = null
   where id and weekly_deal_id = p_deal_id;

  perform public.record_admin_action(
    case p_status when 'rejected' then 'deal.reject' else 'deal.remove' end,
    'deal', p_deal_id::text,
    jsonb_build_object(
      'from_status', before.status,
      'to_status', p_status,
      'was_approved_by', before.approved_by,
      'was_approved_at', before.approved_at,
      'beer_id', row.beer_id,
      'store_id', row.store_id
    )
  );

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
  perform public.require_moderator();

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
    'deal_id', row.deal_id
  ));

  return row;
end;
$$;

-- The moderation reading screens follow the job, not the rank.
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
  perform public.require_moderator();

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
    from public.offer_standings() k
    cross join lateral (select k.ended_weight, k.still_weight, k.voices, k.newest_at, k.standing) s
    left join public.offer_feedback f on f.offer_key = k.offer_key and f.note is not null
   where s.standing <> 'quiet'
   group by k.offer_key, s.ended_weight, s.still_weight, s.voices, s.newest_at, s.standing
   order by (s.standing = 'unclear') desc, s.ended_weight desc, s.newest_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

-- Who is sending us rubbish, and stopping them, is moderation.
create or replace function public.admin_submitters(p_limit integer default 50)
returns table (
  user_id      uuid,
  display_name text,
  approved     integer,
  rejected     integer,
  pending      integer,
  last_at      timestamptz,
  is_blocked   boolean,
  block_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_moderator();

  return query
  select d.created_by,
         c.display_name,
         count(*) filter (where d.status = 'approved')::integer,
         count(*) filter (where d.status = 'rejected')::integer,
         count(*) filter (where d.status = 'pending')::integer,
         max(d.created_at),
         (b.user_id is not null),
         b.reason
    from public.deals d
    left join public.contributors c on c.profile_id = d.created_by
    left join public.submission_blocks b on b.user_id = d.created_by
   where d.created_by is not null
     and not d.entered_by_admin
   group by d.created_by, c.display_name, b.user_id, b.reason
   order by (b.user_id is not null) desc,
            count(*) filter (where d.status = 'rejected') desc,
            max(d.created_at) desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

/**
 * The audit log, readable by everybody who can act in the panel.
 *
 * Including a moderator, deliberately: a log only the most powerful person can
 * see is not accountability, it is a privilege — and a moderator's own actions
 * are in it.
 */
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
  perform public.require_moderator();

  return query
  select a.id, a.actor, a.actor_email, a.action, a.subject_kind, a.subject_id, a.details, a.at,
         a.actor = auth.uid() as is_me
    from public.admin_actions a
   where p_before_id is null or a.id < p_before_id
   order by a.id desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

-- --------------------------------------------------------------------------
-- And one refusal that has to be written down rather than inherited.
--
-- A moderator must not be able to block somebody who can out-rank them, and an
-- administrator must not be able to block an owner. The old rule ("you cannot
-- block an admin") is now "you cannot block somebody at your level or above",
-- which is the same rule once there are three levels instead of two.
-- --------------------------------------------------------------------------

create or replace function public.admin_block_submitter(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean  text := nullif(trim(p_reason), '');
  mine   public.admin_level;
  theirs public.admin_level;
  stats  record;
begin
  perform public.require_moderator();

  if clean is null or char_length(clean) < 3 then
    raise exception 'צריך לכתוב למה. בלי סיבה אי אפשר לבדוק את ההחלטה אחר כך.' using errcode = '22023';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'אי אפשר לחסום את עצמכם.' using errcode = '22023';
  end if;

  select a.level into mine   from public.admins a where a.user_id = auth.uid();
  select a.level into theirs from public.admins a where a.user_id = p_user_id;

  -- An enum compares by its declared order: moderator < admin < super_admin.
  if theirs is not null and theirs >= mine then
    raise exception 'אי אפשר לחסום מישהו בדרגה שלכם או מעליה.' using errcode = '42501';
  end if;

  select count(*) filter (where status = 'approved') as approved,
         count(*) filter (where status = 'rejected') as rejected
    into stats
    from public.deals where created_by = p_user_id;

  insert into public.submission_blocks (user_id, reason, blocked_by)
  values (p_user_id, clean, auth.uid())
  on conflict (user_id) do update set reason = excluded.reason, blocked_by = excluded.blocked_by, blocked_at = now();

  perform public.record_admin_action('submitter.block', 'submitter', p_user_id::text,
    jsonb_build_object('reason', clean, 'approved', stats.approved, 'rejected', stats.rejected));
end;
$$;

create or replace function public.admin_unblock_submitter(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  before text;
begin
  perform public.require_moderator();

  select b.reason into before from public.submission_blocks b where b.user_id = p_user_id;
  if before is null then
    raise exception 'החשבון הזה לא חסום.' using errcode = 'P0002';
  end if;

  delete from public.submission_blocks where user_id = p_user_id;

  perform public.record_admin_action('submitter.unblock', 'submitter', p_user_id::text,
    jsonb_build_object('was_reason', before));
end;
$$;

grant execute on function public.require_moderator() to authenticated, anon;

-- --------------------------------------------------------------------------
-- Adding a deal by hand is moderation, not management.
--
-- It publishes a deal approved and attributed to whoever typed it — which is
-- exactly the authority approving somebody else's submission already carries.
-- Withholding it from a moderator would not withhold the power, only the short
-- way to it, and the audit log records both the same.
--
-- Lifted from 0032, not 0025. Both define this function and the earlier one has
-- no audit entry: re-issuing that body would have silently stopped recording
-- hand-entered deals. The third time this file pattern has cost something, and
-- the third time a test caught it.
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
  perform public.require_moderator();

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
