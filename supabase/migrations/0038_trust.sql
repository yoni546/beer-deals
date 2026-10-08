-- ---------------------------------------------------------------------------
-- 0038 — trust: one ladder, and what it is explicitly NOT for.
--
-- WHAT TRUST IS HERE. Context for a person's judgement, and weight in a tally.
-- That is the whole list.
--
-- WHAT IT IS NOT, AND WILL NOT BECOME. It is not a permission. A trusted
-- contributor cannot approve their own deal, cannot publish without moderation,
-- cannot read anything a stranger cannot, and cannot do one thing an
-- administrator can. Authorization lives in Postgres and is decided by
-- `require_admin()` and the RLS policies -- never by a score. The tests in
-- tests/trust.test.ts exist to make that difficult to change by accident: they
-- give somebody the highest standing in the system and then prove every door is
-- still shut.
--
-- The temptation this closes off deliberately: auto-approving a trusted person's
-- submission. It is the obvious "reward", it would save a moderator real time,
-- and it is exactly the thing the brief rules out -- a reputation number that
-- publishes prices is a reputation number that can be farmed into publishing a
-- wrong one. `deals_submit` (0003) pins every submission to `status = 'pending'`
-- at the storage layer, and nothing here touches that.
--
-- WHY A FUNCTION AND NOT AN EXPRESSION. The ladder was already in the schema,
-- written inline inside offer_standings (0031) as `least(2, score / 50)`. One
-- ladder in two places is two ladders waiting to disagree, and the second place
-- is always the one somebody forgets. Both now call these.
--
--   0–49    new       one voice, and no record yet to read
--   50–99   known     two voices: a few finds accepted
--   100+    trusted   three voices, and the cap
--
-- Capped at three ON PURPOSE. This is a tie-breaker between neighbours standing
-- in the same shop, not a system where one person's say-so settles a question
-- alone. Whatever the score reaches, three strangers still outweigh one expert.
-- ---------------------------------------------------------------------------

create or replace function public.contributor_weight(p_score integer)
returns integer
language sql
immutable
as $$
  select 1 + least(2, coalesce(p_score, 0) / 50);
$$;

comment on function public.contributor_weight(integer) is
  'How much one person''s report counts: 1, 2 from 50 points, 3 from 100. Capped at 3 deliberately (0038).';

create or replace function public.contributor_trust(p_score integer)
returns text
language sql
immutable
as $$
  select case
           when coalesce(p_score, 0) >= 100 then 'trusted'
           when coalesce(p_score, 0) >= 50  then 'known'
           else 'new'
         end;
$$;

comment on function public.contributor_trust(integer) is
  'The ladder in one word, for a moderator to read: new | known | trusted (0038). Context, never a permission.';

grant execute on function public.contributor_weight(integer) to anon, authenticated, service_role;
grant execute on function public.contributor_trust(integer) to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- The tally, now reading the shared ladder.
--
-- Byte-identical to 0031 apart from the weight expression, which is the whole
-- point: there is one ladder, and this is the first place that used it.
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
           * public.contributor_weight(c.score)::numeric as weight
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
-- What a moderator sees about the person whose deal they are judging.
--
-- Context, in one word, beside the counts they already have. NOT an order: the
-- pending queue stays oldest-first, because a queue that serves trusted people
-- first makes a newcomer's FIRST submission wait behind everybody else's -- and
-- that first wait is what decides whether they ever send a second one. Trust
-- informs the judgement; it does not buy a place in the line.
-- --------------------------------------------------------------------------

create or replace function public.admin_submitter_trust(p_user_ids uuid[])
returns table (user_id uuid, display_name text, score integer, trust text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select c.profile_id, c.display_name, c.score, public.contributor_trust(c.score)
    from public.contributors c
   where c.profile_id = any(p_user_ids);
end;
$$;

revoke execute on function public.admin_submitter_trust(uuid[]) from public, anon;
grant execute on function public.admin_submitter_trust(uuid[]) to authenticated;

-- --------------------------------------------------------------------------
-- And what the person themselves can see about their own standing.
--
-- A ladder nobody can see is not an incentive, it is a secret. This says where
-- they are and what it does -- which is deliberately a short list, because
-- over-promising a reward that is only "your reports count double" would be
-- worse than saying nothing.
-- --------------------------------------------------------------------------

create or replace function public.my_standing()
returns table (display_name text, score integer, approved integer, weekly integer, trust text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  return query
  select c.display_name, c.score, c.approved, c.weekly, public.contributor_trust(c.score)
    from public.contributors c
   where c.profile_id = uid;
end;
$$;

revoke execute on function public.my_standing() from public, anon;
grant execute on function public.my_standing() to authenticated;
