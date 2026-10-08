-- ---------------------------------------------------------------------------
-- 0035 — moderating the people who submit, without a directory of people.
--
-- THE CONSTRAINT THIS IS BUILT INSIDE. "Admins are deliberately NOT given read
-- access to every profile. Moderating deals does not require knowing who else
-- uses the app" (0003). That is still true, and a "users" screen that listed
-- names, emails, cities and favourite beers would be a straight reversal of it
-- for no moderation benefit.
--
-- So this is not a people directory. It is the one tool the panel was actually
-- missing: when somebody keeps submitting rubbish, a moderator can stop THAT
-- ACCOUNT from submitting, and nothing else. What the screen shows about a person
-- is only what they chose to publish (their display name, if any) and what they
-- did TO US: how many of their submissions were approved, rejected or are still
-- waiting, and when they last sent one. No email, no first name, no favourites,
-- no location.
--
-- WHY THIS AND NOT A HARDER LIMIT. 0033 bounds what any single session can write
-- -- eight deals an hour. That stops a flood and does nothing about a person who
-- sends four bad deals a day for a fortnight. A limit is arithmetic; this is a
-- judgement, so it is made by a person, recorded with a reason, and reversible.
--
-- WHAT IT IS NOT: a ban. A blocked person keeps their account, their favourites,
-- their notifications and everything they have already had approved, including
-- the credit for it on the leaderboard. They cannot put new deals in the queue.
-- Taking somebody's beers away because they filed bad prices would be a
-- punishment out of all proportion to the thing being prevented.
-- ---------------------------------------------------------------------------

create table if not exists public.submission_blocks (
  -- One row per blocked account, or none. Current state, not a history: the
  -- history of blocking and unblocking is in admin_actions (0032), which cannot
  -- be edited, where this row can be lifted.
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- Why, in the moderator's own words. Required: a block nobody can explain is a
  -- block nobody can review.
  reason     text not null check (char_length(trim(reason)) between 3 and 280),
  blocked_by uuid references auth.users (id) on delete set null,
  blocked_at timestamptz not null default now()
);

comment on table public.submission_blocks is
  'Accounts that may not put new deals in the moderation queue. Not a ban: everything else about the account is untouched.';

alter table public.submission_blocks enable row level security;

-- No grant and no policy for anybody: written by the two functions below and read
-- by admin_submitters() and the trigger, all of them SECURITY DEFINER.

-- --------------------------------------------------------------------------
-- The block, where it has to be: on the insert.
--
-- Same reasoning as 0033. `deals_submit` is a direct table insert under RLS, so a
-- check in a server action would be a check on the polite route only.
-- --------------------------------------------------------------------------

create or replace function public.deals_submission_allowed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.entered_by_admin or new.created_by is null then
    return new;
  end if;

  if exists (select 1 from public.submission_blocks b where b.user_id = new.created_by) then
    -- Deliberately does not quote the moderator's reason back at them: it is written
    -- for another moderator to review, not as a message to the person.
    --
    -- P0001 (the plain raise_exception code), NOT 42501. This is an authorization
    -- refusal in the dictionary sense, but describeDbError turns 42501 into the
    -- fixed sentence "you have no permission for this" -- which is what you want
    -- for a request that should never have been made, and is exactly wrong here:
    -- the person made an ordinary request and deserves the sentence written for
    -- them. Same reasoning as the rate limits in 0033.
    raise exception
      'החשבון הזה לא יכול לשלוח מבצעים חדשים כרגע. אם זו טעות, כתבו לנו.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists deals_submission_allowed on public.deals;
create trigger deals_submission_allowed
  before insert on public.deals
  for each row execute function public.deals_submission_allowed();

-- --------------------------------------------------------------------------
-- Who has been submitting, and how it has gone.
--
-- Everything here is either what the person chose to publish or what they sent
-- us. `display_name` comes from contributors (0030) and is null for somebody who
-- never chose one -- the row then says nothing about who they are, which is the
-- whole point and is why the identifier is only there to act on.
-- --------------------------------------------------------------------------

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
  perform public.require_admin();

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
   -- The ones worth looking at first: blocked, then whoever has the most rejected.
   order by (b.user_id is not null) desc,
            count(*) filter (where d.status = 'rejected') desc,
            max(d.created_at) desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke execute on function public.admin_submitters(integer) from public, anon;
grant execute on function public.admin_submitters(integer) to authenticated;

-- --------------------------------------------------------------------------
-- Blocking, and lifting it.
-- --------------------------------------------------------------------------

create or replace function public.admin_block_submitter(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := nullif(trim(p_reason), '');
  stats record;
begin
  perform public.require_admin();

  if clean is null or char_length(clean) < 3 then
    raise exception 'צריך לכתוב למה. בלי סיבה אי אפשר לבדוק את ההחלטה אחר כך.' using errcode = '22023';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'אי אפשר לחסום את עצמכם.' using errcode = '22023';
  end if;

  -- An administrator's own submissions go up approved and attributed to them; a
  -- block on one would do nothing except confuse the next moderator.
  if exists (select 1 from public.admins a where a.user_id = p_user_id) then
    raise exception 'אי אפשר לחסום מנהל. קודם מסירים את ההרשאה.' using errcode = '22023';
  end if;

  select count(*) filter (where status = 'approved') as approved,
         count(*) filter (where status = 'rejected') as rejected
    into stats
    from public.deals where created_by = p_user_id;

  insert into public.submission_blocks (user_id, reason, blocked_by)
  values (p_user_id, clean, auth.uid())
  on conflict (user_id) do update set reason = excluded.reason, blocked_by = excluded.blocked_by, blocked_at = now();

  -- The reason AND the record that justified it, together. A block reviewed six
  -- months later needs both, and the counts will have moved by then.
  perform public.record_admin_action('submitter.block', 'submitter', p_user_id::text,
    jsonb_build_object('reason', clean, 'approved', stats.approved, 'rejected', stats.rejected));
end;
$$;

revoke execute on function public.admin_block_submitter(uuid, text) from public, anon;
grant execute on function public.admin_block_submitter(uuid, text) to authenticated;

create or replace function public.admin_unblock_submitter(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  before text;
begin
  perform public.require_admin();

  select b.reason into before from public.submission_blocks b where b.user_id = p_user_id;
  if before is null then
    raise exception 'החשבון הזה לא חסום.' using errcode = 'P0002';
  end if;

  delete from public.submission_blocks where user_id = p_user_id;

  perform public.record_admin_action('submitter.unblock', 'submitter', p_user_id::text,
    jsonb_build_object('was_reason', before));
end;
$$;

revoke execute on function public.admin_unblock_submitter(uuid) from public, anon;
grant execute on function public.admin_unblock_submitter(uuid) to authenticated;
