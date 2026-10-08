-- ---------------------------------------------------------------------------
-- 0033 — rate limits on what a stranger can write (security finding M-2).
--
-- WHAT WAS OPEN. Every visitor gets an anonymous session automatically, and an
-- anonymous session can write three things:
--
--   * a deal, straight into the moderation queue. `deals_submit` (0003) checks
--     that it is theirs and pending -- it does not check HOW MANY. A loop over
--     the PostgREST endpoint can put ten thousand rows in front of the
--     moderators and make the queue useless, which is the cheapest way to take
--     this product down. No server action is involved, so nothing in the app
--     could have stopped it.
--   * feedback on an offer (0031). `unique (offer_key, reported_by)` stops
--     stuffing ONE offer, and stops nothing at all across the feed: one session
--     can file a verdict on every offer there is.
--   * a public display name (0030), which is cheap to write and shows up on
--     other people's screens.
--
-- WHERE THE LIMIT LIVES. In Postgres, for the same reason authorization does:
-- the deal path is a direct table insert under RLS, so a limit in a server
-- action would be a limit on the polite route only. A trigger and the two
-- definer functions cover every caller -- the app, a script, a hand-written
-- PostgREST request.
--
-- HOW IT COUNTS. By counting the rows themselves, in a window, rather than
-- keeping a separate ledger of attempts. A counter table would be one more
-- thing that can drift from the truth it is supposed to describe, and would
-- itself need a write path and a cleanup job. The rows are already there,
-- already timestamped, already indexed by author.
--
-- WHAT IT IS NOT. It is not a defence against a botnet: a thousand anonymous
-- sessions are a thousand quotas. It raises the cost of the one-session flood
-- from a shell loop to real work, and it bounds what any single account can do.
-- Supabase's own limit on anonymous sign-ins (~30/hour/IP) is the layer above
-- this one, and it belongs to the hosted project rather than to the schema.
--
-- The messages are Hebrew on purpose: describeDbError passes an unrecognised
-- code's message straight to the person, so these are read by the person who
-- hit the limit, not only by a log.
-- ---------------------------------------------------------------------------

/**
 * One refusal, worded once.
 *
 * SQLSTATE 54000 is program_limit_exceeded -- deliberately NOT 42501, which
 * `describeDbError` turns into "you have no permission for this". Hitting a
 * limit is not the same as not being allowed, and telling somebody who found
 * four deals tonight that they have no permission would be a lie.
 */
create or replace function public.rate_limited(p_message text)
returns void
language plpgsql
immutable
as $$
begin
  raise exception '%', p_message using errcode = '54000';
end;
$$;

-- --------------------------------------------------------------------------
-- Deals: the queue is the thing worth protecting.
--
-- Eight in an hour and twenty-five in a day, counted over everything this person
-- has ever submitted in the window -- including the rejected ones, deliberately.
-- Somebody whose submissions keep being rejected is exactly who should be slowed
-- down, and resetting their quota on rejection would reward it.
--
-- A moderator's own entry is exempt: it arrives through admin_add_deal, which is
-- behind require_admin(), and an administrator vouching for a deal is not a
-- stranger filling a queue.
-- --------------------------------------------------------------------------

create or replace function public.deals_submission_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
  today  integer;
begin
  -- Admin-entered and feed rows are not submissions.
  if new.entered_by_admin or new.created_by is null then
    return new;
  end if;

  select count(*) filter (where d.created_at >= now() - interval '1 hour'),
         count(*) filter (where d.created_at >= now() - interval '24 hours')
    into recent, today
    from public.deals d
   where d.created_by = new.created_by;

  if recent >= 8 then
    perform public.rate_limited('שלחתם הרבה מבצעים בזמן קצר. נסו שוב בעוד שעה — הם לא הולכים לאיבוד.');
  end if;
  if today >= 25 then
    perform public.rate_limited('הגעתם למספר המבצעים שאפשר לשלוח ביום. נסו שוב מחר.');
  end if;

  return new;
end;
$$;

drop trigger if exists deals_submission_rate on public.deals;
create trigger deals_submission_rate
  before insert on public.deals
  for each row execute function public.deals_submission_rate();

-- --------------------------------------------------------------------------
-- Feedback: sixty an hour.
--
-- High on purpose. Somebody walking an aisle and answering "still there" on a
-- dozen offers is the behaviour this feature was built for, and a limit that
-- punishes the most useful person in the system would be the wrong trade. Sixty
-- an hour is well past anything a person does and well short of a script.
--
-- Counted over this person's rows in the window, and changing your mind rewrites
-- `created_at` (0031), so a verdict you revise counts once again rather than
-- twice. That is the intended reading: it is a write either way.
-- --------------------------------------------------------------------------

create or replace function public.report_offer(
  p_offer_key   text,
  p_verdict     public.offer_verdict,
  p_note        text default null,
  p_seen_price  integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  recent integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_offer_key !~ '^(obs|deal|grp):[0-9a-zA-Z-]{1,64}$' then
    raise exception 'that is not an offer' using errcode = '22023';
  end if;

  select count(*) into recent
    from public.offer_feedback f
   where f.reported_by = uid
     and f.created_at >= now() - interval '1 hour';

  if recent >= 60 then
    perform public.rate_limited('רשמנו הרבה דיווחים מכם בשעה האחרונה. נסו שוב בעוד זמן מה.');
  end if;

  insert into public.offer_feedback (offer_key, verdict, reported_by, note, seen_price_agorot)
  values (p_offer_key, p_verdict, uid, nullif(trim(p_note), ''), p_seen_price)
  on conflict (offer_key, reported_by) do update
     set verdict = excluded.verdict,
         note = excluded.note,
         seen_price_agorot = excluded.seen_price_agorot,
         created_at = now();
end;
$$;

-- --------------------------------------------------------------------------
-- The public name: ten changes an hour.
--
-- Not about load -- the row is tiny -- but about what it is FOR. The name is
-- shown on other people's screens beside a price, and a name that changes every
-- few seconds is not a credit, it is a billboard. Ten an hour leaves plenty of
-- room to settle on a spelling.
-- --------------------------------------------------------------------------

create table if not exists public.display_name_changes (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  at         timestamptz not null default now()
);

comment on table public.display_name_changes is
  'When somebody set or cleared their public display name. The only reason it exists: contributors holds the CURRENT name and nothing counts changes (0033).';

create index if not exists display_name_changes_idx on public.display_name_changes (profile_id, at desc);

alter table public.display_name_changes enable row level security;
-- No grant and no policy: written by set_display_name (definer) and read by
-- nothing else. Unlike the two above there is no row to count, because the point
-- of the table being rewritten is that the old value is gone.

create or replace function public.set_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  clean  text := nullif(trim(p_name), '');
  recent integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select count(*) into recent
    from public.display_name_changes c
   where c.profile_id = uid
     and c.at >= now() - interval '1 hour';

  if recent >= 10 then
    perform public.rate_limited('שיניתם את השם הרבה פעמים בשעה האחרונה. נסו שוב בעוד זמן מה.');
  end if;

  -- Clearing it is a real choice, and it takes the row away rather than leaving an
  -- empty name behind.
  if clean is null then
    delete from public.contributors where profile_id = uid;
    -- Recorded before the early return: clearing the name is a change, and a loop
    -- that alternates between a name and nothing is the obvious way around a limit
    -- that only counted the setting of one.
    insert into public.display_name_changes (profile_id) values (uid);
    return;
  end if;

  if char_length(clean) < 2 or char_length(clean) > 24 then
    raise exception 'a name is between two and twenty-four characters' using errcode = '22023';
  end if;

  insert into public.profiles (id) values (uid) on conflict (id) do nothing;

  insert into public.contributors (profile_id, display_name)
  values (uid, clean)
  on conflict (profile_id) do update set display_name = excluded.display_name, updated_at = now();

  insert into public.display_name_changes (profile_id) values (uid);
end;
$$;

revoke execute on function public.set_display_name(text) from public, anon;
grant execute on function public.set_display_name(text) to authenticated;

revoke execute on function public.rate_limited(text) from public, anon, authenticated;
