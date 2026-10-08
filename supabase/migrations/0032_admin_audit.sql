-- ---------------------------------------------------------------------------
-- 0032 — the admin audit log.
--
-- THE GAP THIS CLOSES. Nothing in this database records what an administrator
-- did. Each table keeps at most the LATEST actor on a column -- `approved_by`,
-- `resolved_by`, `weekly_deal_set_by`, `updated_by` -- and every one of them is
-- overwritten by the next action and erased by some of them. `set_deal_status`
-- is the plainest case: taking a deal off the site deliberately nulls
-- `approved_by` and `approved_at`, because leaving them would misreport who
-- stands behind a deal that is no longer public. Correct, and it means that
-- after one click there is no record anywhere that the deal was ever approved,
-- by whom, or who removed it. `admin_delete_deal` destroys the row outright.
--
-- So: one append-only table that says who did what, when, to which thing, with
-- just enough of the before-and-after to answer the question a person actually
-- asks -- "who took this down, and can we put it back?"
--
-- WHAT MAKES IT AN AUDIT LOG RATHER THAN A TABLE OF NOTES:
--
--   APPEND-ONLY, ENFORCED. A trigger refuses UPDATE and DELETE. The thing being
--     audited cannot rewrite its own record, and neither can a super admin from
--     the app -- there is no path in the schema that edits a row here.
--
--   NO WRITE GRANT TO ANYBODY. Entries are written only from inside the
--     SECURITY DEFINER functions that perform the actions, in the SAME
--     transaction. An action that fails leaves no entry, because it did not
--     happen; an action that succeeds cannot leave none.
--
--   IT DOES NOT MOVE WHEN THE WORLD DOES. `actor` is a plain uuid with no
--     foreign key, beside the email as it stood at the time. A deleted or
--     renamed account must not be able to blank out who did something -- which
--     is exactly what `on delete set null` would do.
--
-- It is not a change-data-capture log and does not try to be: it records the
-- decisions a person made through the admin panel, not every write.
-- ---------------------------------------------------------------------------

create table if not exists public.admin_actions (
  id           bigint generated always as identity primary key,
  -- Deliberately not a foreign key: see above.
  actor        uuid not null,
  -- Who that was, in words, at the time. Resolved once, here, so reading the log
  -- never depends on an account still existing.
  actor_email  text,
  -- 'deal.approve', 'deal.remove', 'admin.grant', … Dotted, so a screen can group
  -- by the part before the dot without a second column to keep in step.
  action       text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  -- What it was done to. 'deal' | 'report' | 'admin' | 'settings'.
  subject_kind text not null check (subject_kind ~ '^[a-z_]+$'),
  -- The id as text, because the subjects are uuids, bigints and one singleton row.
  subject_id   text,
  -- Enough to answer "what changed, and can it be undone?" -- never the whole row.
  details      jsonb not null default '{}'::jsonb,
  at           timestamptz not null default now()
);

comment on table public.admin_actions is
  'Append-only record of what administrators did. Written only from inside the definer functions that do the work; a trigger refuses UPDATE and DELETE.';

create index if not exists admin_actions_at_idx on public.admin_actions (at desc);
create index if not exists admin_actions_subject_idx on public.admin_actions (subject_kind, subject_id, at desc);

alter table public.admin_actions enable row level security;

-- No policy and no grant, for anybody. Reading goes through admin_audit() below,
-- which checks the caller is an administrator; writing goes through the definer
-- functions. There is no direct path in or out.

create or replace function public.admin_actions_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'the admin audit log is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists admin_actions_no_update on public.admin_actions;
create trigger admin_actions_no_update
  before update or delete on public.admin_actions
  for each row execute function public.admin_actions_append_only();

-- --------------------------------------------------------------------------
-- The one way in.
--
-- Called from inside the functions that already checked the caller's role, so it
-- does NOT check again: it is not an entry point, and a second require_admin()
-- here would be a second place to get that check wrong. It is not granted to
-- anybody, so the only callers are the definer functions themselves.
-- --------------------------------------------------------------------------

create or replace function public.record_admin_action(
  p_action       text,
  p_subject_kind text,
  p_subject_id   text,
  p_details      jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    -- Every caller is behind require_admin()/require_super_admin(), so this cannot
    -- happen through the app. If it ever does, the action has no author and the
    -- entry would be a lie.
    raise exception 'an admin action must have an author' using errcode = '42501';
  end if;

  insert into public.admin_actions (actor, actor_email, action, subject_kind, subject_id, details)
  values (
    uid,
    (select u.email from auth.users u where u.id = uid),
    p_action,
    p_subject_kind,
    p_subject_id,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke execute on function public.record_admin_action(text, text, text, jsonb) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- Every administrator action, now recorded.
--
-- Each function below is its previous definition with ONE statement added. The
-- bodies are otherwise unchanged, down to the Hebrew error messages: callers and
-- tests depend on them, and a rewrite that "tidied" one of these would be a
-- behaviour change hidden inside an audit feature.
--
-- The entry is written AFTER the work, inside the same transaction: an action
-- that raises leaves no entry because it did not happen, and one that commits
-- cannot leave none.
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
  perform public.require_admin();

  if p_status = 'approved' then
    -- Approval carries an audit trail, so it has its own entry point.
    return public.approve_deal(p_deal_id);
  end if;

  -- Read first, because the update below deliberately erases approved_by/at --
  -- and that is precisely what nothing used to record anywhere.
  select * into before from public.deals where id = p_deal_id;

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

  perform public.record_admin_action(
    case p_status when 'rejected' then 'deal.reject' else 'deal.remove' end,
    'deal', p_deal_id::text,
    jsonb_build_object(
      'from_status', before.status,
      'to_status', p_status,
      -- The two columns the update above just cleared. Without this the record of
      -- who stood behind the deal is gone for good.
      'was_approved_by', before.approved_by,
      'was_approved_at', before.approved_at,
      'beer_id', row.beer_id,
      'store_id', row.store_id
    )
  );

  return row;
end;
$$;

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
  row    public.deals;
  before public.deals;
begin
  perform public.require_admin();

  select * into before from public.deals where id = p_deal_id;

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

  -- Only what actually moved. An entry saying "edited" with no before-and-after
  -- answers nothing, and one carrying the whole row twice is unreadable.
  perform public.record_admin_action('deal.edit', 'deal', p_deal_id::text, jsonb_strip_nulls(jsonb_build_object(
    'beer_id', case when before.beer_id is distinct from row.beer_id
                    then jsonb_build_array(before.beer_id, row.beer_id) end,
    'store_id', case when before.store_id is distinct from row.store_id
                     then jsonb_build_array(before.store_id, row.store_id) end,
    'category', case when before.category is distinct from row.category
                     then jsonb_build_array(before.category, row.category) end,
    'deal_price_agorot', case when before.deal_price_agorot is distinct from row.deal_price_agorot
                              then jsonb_build_array(before.deal_price_agorot, row.deal_price_agorot) end,
    'regular_price_agorot', case when before.regular_price_agorot is distinct from row.regular_price_agorot
                                 then jsonb_build_array(before.regular_price_agorot, row.regular_price_agorot) end,
    'notes', case when before.notes is distinct from row.notes
                  then jsonb_build_array(before.notes, row.notes) end
  )));

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

  perform public.record_admin_action('report.close', 'report', p_report_id::text, jsonb_build_object(
    'to_status', p_status,
    -- Closing a report says nothing about the deal (0002); the log keeps the two
    -- apart in the same way, and names the deal so the pair can be read together.
    'deal_id', row.deal_id
  ));

  return row;
end;
$$;

create or replace function public.set_weekly_deal(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  previous uuid;
begin
  perform public.require_admin();

  -- Unchanged from 0002, message and all: callers and tests depend on it.
  if p_deal_id is not null and not exists (
    select 1 from public.deals d where d.id = p_deal_id and d.status = 'approved'
  ) then
    raise exception 'the weekly deal must be an approved deal' using errcode = '22023';
  end if;

  select s.weekly_deal_id into previous from public.app_settings s where s.id;

  -- Remember that this deal was chosen (0030). app_settings holds a pointer with
  -- no history, so once it moves on nothing would say this deal was ever the pick
  -- — and the contributor's credit for it would quietly disappear.
  if p_deal_id is not null then
    update public.deals set was_weekly = true where id = p_deal_id;
  end if;

  update public.app_settings
     set weekly_deal_id     = p_deal_id,
         weekly_deal_set_by = auth.uid(),
         weekly_deal_set_at = now(),
         updated_by         = auth.uid()
   where id;

  perform public.record_admin_action(
    case when p_deal_id is null then 'weekly.clear' else 'weekly.set' end,
    'deal', coalesce(p_deal_id::text, previous::text),
    jsonb_build_object('from_deal_id', previous, 'to_deal_id', p_deal_id)
  );
end;
$$;

create or replace function public.grant_admin(p_email text, p_level public.admin_level)
returns public.admins
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  before public.admin_level;
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

  select a.level into before from public.admins a where a.user_id = target;

  insert into public.admins (user_id, level, added_by)
  values (target, p_level, auth.uid())
  on conflict (user_id) do update set level = excluded.level
  returning * into row;

  -- Who was given what. The single most consequential action in this system, and
  -- until now the only trace of it was `added_by`, overwritten on the next change
  -- of level and gone entirely once the row is revoked.
  perform public.record_admin_action(
    case when before is null then 'admin.grant' else 'admin.change_level' end,
    'admin', target::text,
    jsonb_strip_nulls(jsonb_build_object('email', lower(trim(p_email)), 'from_level', before, 'to_level', p_level))
  );

  return row;
end;
$$;

create or replace function public.revoke_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  before public.admin_level;
begin
  perform public.require_super_admin();

  if p_user_id = auth.uid() then
    -- Guards against the one irreversible mistake in this system: an admin
    -- table with nobody left who can write to it.
    raise exception 'you cannot remove yourself' using errcode = '22023';
  end if;

  select a.level into before from public.admins a where a.user_id = p_user_id;

  delete from public.admins where user_id = p_user_id;

  perform public.record_admin_action('admin.revoke', 'admin', p_user_id::text,
    jsonb_strip_nulls(jsonb_build_object('from_level', before)));
end;
$$;

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

create or replace function public.admin_delete_deal(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  before public.deals;
begin
  perform public.require_super_admin();

  if exists (select 1 from public.deal_reports r where r.deal_id = p_deal_id and r.status = 'open') then
    raise exception 'יש דיווח פתוח על המבצע הזה. צריך לטפל בדיווח קודם.' using errcode = '22023';
  end if;

  -- The only action here that destroys a row. Everything the entry will ever be
  -- able to say has to be read before the delete, not after it.
  select * into before from public.deals where id = p_deal_id;

  update public.app_settings set weekly_deal_id = null where id and weekly_deal_id = p_deal_id;
  delete from public.deals where id = p_deal_id;

  perform public.record_admin_action('deal.delete', 'deal', p_deal_id::text, jsonb_strip_nulls(jsonb_build_object(
    'status', before.status,
    'beer_id', before.beer_id,
    'store_id', before.store_id,
    'category', before.category,
    'deal_price_agorot', before.deal_price_agorot,
    'regular_price_agorot', before.regular_price_agorot,
    'was_approved_by', before.approved_by,
    'submitted_by', before.created_by,
    'entered_by_admin', before.entered_by_admin
  )));
end;
$$;

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
  row    public.app_settings;
  before public.app_settings;
begin
  perform public.require_super_admin();

  select * into before from public.app_settings where id;

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

  -- These six numbers decide whose phone rings, so a change to them is exactly
  -- the kind of thing somebody will want to look back at. Only what moved.
  perform public.record_admin_action('settings.notifications', 'settings', 'app_settings',
    jsonb_strip_nulls(jsonb_build_object(
      'min_discount_percent', case when before.notify_min_discount_percent is distinct from row.notify_min_discount_percent
        then jsonb_build_array(before.notify_min_discount_percent, row.notify_min_discount_percent) end,
      'max_price_agorot', case when before.notify_max_price_agorot is distinct from row.notify_max_price_agorot
        then jsonb_build_array(before.notify_max_price_agorot, row.notify_max_price_agorot) end,
      'cooldown_hours', case when before.notify_cooldown_hours is distinct from row.notify_cooldown_hours
        then jsonb_build_array(before.notify_cooldown_hours, row.notify_cooldown_hours) end,
      'daily_cap', case when before.notify_daily_cap is distinct from row.notify_daily_cap
        then jsonb_build_array(before.notify_daily_cap, row.notify_daily_cap) end,
      'quiet_start', case when before.notify_quiet_start is distinct from row.notify_quiet_start
        then jsonb_build_array(before.notify_quiet_start, row.notify_quiet_start) end,
      'quiet_end', case when before.notify_quiet_end is distinct from row.notify_quiet_end
        then jsonb_build_array(before.notify_quiet_end, row.notify_quiet_end) end
    )));

  return row;
end;
$$;

-- --------------------------------------------------------------------------
-- Reading it.
--
-- Definer, because the table has no read grant for anybody -- and guarded, like
-- every other definer entry point here.
-- --------------------------------------------------------------------------

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
  perform public.require_admin();

  return query
  select a.id, a.actor, a.actor_email, a.action, a.subject_kind, a.subject_id, a.details, a.at,
         a.actor = auth.uid() as is_me
    from public.admin_actions a
   where p_before_id is null or a.id < p_before_id
   order by a.id desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke execute on function public.admin_audit(integer, bigint) from public, anon;
grant execute on function public.admin_audit(integer, bigint) to authenticated;
