-- ---------------------------------------------------------------------------
-- 0031 — "המבצע עדיין קיים" / "המבצע נגמר", on any offer.
--
-- THE GAP THIS CLOSES. Until now only a user-submitted deal could be reported:
-- the button renders for `origin = 'legacy'` alone, and `deal_reports.deal_id` is
-- a foreign key to `deals` whose RLS predicate requires an approved `deals` row.
-- The chain feed is the bulk of what anybody sees, and none of it had a report
-- path at all — not in the UI, and not in the schema. A person standing in front
-- of an empty shelf had nowhere to say so.
--
-- So feedback is keyed by `offer_key` — the same 'obs:…' / 'deal:…' / 'grp:…'
-- string the feed already emits, and that offer_scores (0027) and the contributor
-- map are already keyed by. It is not a foreign key, deliberately: an offer is a
-- row of a VIEW over two different tables, and a promotion that ends stops being
-- in the view at all. Feedback about something that has since vanished is still
-- evidence about what happened, so it must not disappear with it.
--
-- BOTH DIRECTIONS. A deal can be confirmed as well as reported gone, which is what
-- makes it possible to disagree with somebody rather than only to escalate.
--
-- ONE STANDING OPINION PER PERSON PER OFFER. Saying it again replaces what you
-- said before — including changing your mind, which is the normal case when a
-- deal comes back. No "one open report" state machine: the latest thing a person
-- believes is the only thing worth counting.
--
-- NOTHING IS EXPIRED BY A TAP. See `offer_standing` below: the decision weighs
-- both directions, how recent each is, and who said it. Where it is genuinely
-- unclear it says so and an admin looks — it does not guess, and it never deletes
-- anything. A deal is taken down by a person, as it always was.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'offer_verdict') then
    create type public.offer_verdict as enum ('still_there', 'ended');
  end if;
end
$$;

create table if not exists public.offer_feedback (
  id          bigint generated always as identity primary key,
  -- 'obs:<observation_id>' | 'deal:<uuid>' | 'grp:<id>'. Not a foreign key: see above.
  offer_key   text not null check (offer_key ~ '^(obs|deal|grp):[0-9a-zA-Z-]{1,64}$'),
  verdict     public.offer_verdict not null,
  reported_by uuid not null references auth.users (id) on delete cascade,
  -- Optional, and reachable: the old flow had a 280-character column the UI could
  -- never write to, because it always sent an empty string.
  note        text check (note is null or char_length(trim(note)) between 1 and 280),
  -- What the screen was showing when they tapped. A report against a price that has
  -- since changed is about a different deal, and this is how that is told apart.
  seen_price_agorot integer check (seen_price_agorot is null or seen_price_agorot > 0),
  created_at  timestamptz not null default now(),
  unique (offer_key, reported_by)
);

comment on table public.offer_feedback is
  'What people say about an offer that is on the screen: still there, or gone. One standing opinion per person per offer; saying it again replaces it.';

create index if not exists offer_feedback_key_idx on public.offer_feedback (offer_key, created_at desc);

alter table public.offer_feedback enable row level security;

grant select on public.offer_feedback to anon, authenticated, service_role;

-- Everyone may see the tally — it is shown on the line. Nobody writes directly.
create policy offer_feedback_read on public.offer_feedback
  for select to anon, authenticated using (true);

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
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_offer_key !~ '^(obs|deal|grp):[0-9a-zA-Z-]{1,64}$' then
    raise exception 'that is not an offer' using errcode = '22023';
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

revoke execute on function public.report_offer(text, public.offer_verdict, text, integer) from public, anon;
grant execute on function public.report_offer(text, public.offer_verdict, text, integer) to authenticated;

-- --------------------------------------------------------------------------
-- The same standing, for every offer at once — what a SCREEN needs.
--
-- Feedback that only an admin can see is the system that was already here
-- (`deal_reports`). The point of asking people is that the answer reaches the
-- next person who is deciding whether to drive somewhere, so the line itself has
-- to be able to say "people report this one is gone". Per-offer calls cannot do
-- that: a Home render touches dozens of offers.
--
-- So: one read, keyed by offer_key, for every offer anybody has said anything
-- about in the last thirty days. Offers nobody has spoken about are simply absent
-- — the screen says nothing, which is the honest default.
--
-- The rules that decide a standing live here and nowhere else; `offer_standing`
-- (below) is the single-offer view of this one.
--
-- A tap is not a verdict. Three things decide how much one counts:
--
--   WHO SAID IT. Somebody whose finds have been accepted has earned more weight
--     than somebody with no record: 1 normally, 2 from 50 points, 3 from 100
--     (contributors, 0030). It is capped there on purpose — this is a tie-breaker
--     between neighbours in a shop, not a reputation system that lets one person
--     decide alone.
--
--   HOW RECENT. Full weight for a week, half for a fortnight, nothing after
--     thirty days. A shelf a month ago says nothing about a shelf today.
--
--   WHICH WAY. Both directions are counted, so a confirmation can answer a report
--     instead of only an admin being able to.
--
-- And the result is one of four words, never an action:
--
--   'ended'        enough people, recently, say it is gone, and nobody credible
--                  disagrees. The app LABELS it; it does not delete it.
--   'still_there'  somebody checked and it was there.
--   'unclear'      both sides have real weight. This is the case that goes to an
--                  admin, because it is exactly the case a rule should not decide.
--   'quiet'        not enough to say anything.
-- --------------------------------------------------------------------------

create or replace function public.offer_standings()
returns table (
  offer_key    text,
  ended_weight numeric,
  still_weight numeric,
  voices       integer,
  newest_at    timestamptz,
  standing     text
)
language sql
stable
set search_path = public
as $$
  with weighted as (
    select f.offer_key,
           f.verdict,
           f.created_at,
           case
             when f.created_at >= now() - interval '7 days'  then 1.0
             when f.created_at >= now() - interval '14 days' then 0.5
             else 0
           end
           * (1 + least(2, coalesce(c.score, 0) / 50))::numeric as weight
      from public.offer_feedback f
      left join public.contributors c on c.profile_id = f.reported_by
     where f.created_at >= now() - interval '30 days'
  ),
  totals as (
    select w.offer_key,
           coalesce(sum(w.weight) filter (where w.verdict = 'ended'), 0)       as ended_weight,
           coalesce(sum(w.weight) filter (where w.verdict = 'still_there'), 0) as still_weight,
           count(*)::integer                                                  as voices,
           max(w.created_at)                                                  as newest_at
      from weighted w
     group by w.offer_key
  )
  select t.offer_key,
         t.ended_weight,
         t.still_weight,
         t.voices,
         t.newest_at,
         case
           when t.ended_weight >= 2 and t.still_weight >= 2 then 'unclear'
           when t.ended_weight >= 3 and t.ended_weight >= t.still_weight * 2 then 'ended'
           when t.still_weight >= 2 and t.still_weight > t.ended_weight then 'still_there'
           else 'quiet'
         end as standing
    from totals t
   where t.offer_key is not null;
$$;

grant execute on function public.offer_standings() to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- What the feedback adds up to, for ONE offer.
--
-- The same rules as `offer_standings()`, applied to one key.
-- --------------------------------------------------------------------------

create or replace function public.offer_standing(p_offer_key text)
returns table (
  ended_weight numeric,
  still_weight numeric,
  voices       integer,
  newest_at    timestamptz,
  standing     text
)
language sql
stable
set search_path = public
as $$
  -- One place for the rules: this is the single-offer view of `offer_standings()`
  -- above. An offer nobody has spoken about still gets an answer here -- zeros and
  -- 'quiet' -- because a caller asking about one offer is asking a question and
  -- deserves a row, where a caller asking about a screenful wants only the offers
  -- that have something to say.
  select coalesce(s.ended_weight, 0),
         coalesce(s.still_weight, 0),
         coalesce(s.voices, 0),
         s.newest_at,
         coalesce(s.standing, 'quiet')
    from (select 1) one
    left join public.offer_standings() s on s.offer_key = p_offer_key;
$$;

grant execute on function public.offer_standing(text) to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- What an admin needs to look at: every offer whose feedback says something, with
-- the weight behind it, worst first.
-- --------------------------------------------------------------------------

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
  -- A definer function that reads what people wrote has to say who may call it.
  perform public.require_admin();

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
    -- Qualified below as `k.offer_key`: an unqualified `offer_key` would be read as
    -- this function's own OUT parameter of the same name, which plpgsql reports as
    -- ambiguous.
    from public.offer_standings() k
    cross join lateral (select k.ended_weight, k.still_weight, k.voices, k.newest_at, k.standing) s
    left join public.offer_feedback f on f.offer_key = k.offer_key and f.note is not null
   where s.standing <> 'quiet'
   group by k.offer_key, s.ended_weight, s.still_weight, s.voices, s.newest_at, s.standing
   order by (s.standing = 'unclear') desc, s.ended_weight desc, s.newest_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke execute on function public.admin_offer_feedback(integer) from public, anon;
grant execute on function public.admin_offer_feedback(integer) to authenticated;
