-- ---------------------------------------------------------------------------
-- 0041 — the fields the owner asked for on the people screen.
--
-- 0035 built a deliberately narrow screen: the public name somebody chose, and
-- what they sent us. It left out city, search radius, favourite beers and the
-- registration date, on the strength of a comment in 0003 saying administrators
-- are not given profile reads. The owner asked for those four by name and called
-- them non-sensitive, which is the call that is theirs to make. This is that
-- change, made narrowly rather than by opening `profiles`.
--
-- WHAT IS STILL NOT HERE, and will not be without being asked for again:
--   · first_name          — the private name. The PUBLIC one (contributors,
--                           0030) is a different field somebody chose to publish.
--   · home_lat/home_lon   — a coordinate is a doorstep. The TOWN answers every
--                           question this screen exists for.
--   · email               — reachable to an owner through grant_admin by address;
--                           it has no job on a moderation screen.
--   · notification state, push endpoints, watchlist, feedback they filed.
--
-- `profiles` KEEPS its owner-only policy. Nothing here grants a table read: the
-- function below is SECURITY DEFINER and returns four columns, so widening it
-- later is an edit somebody has to make on purpose rather than a door left open.
-- ---------------------------------------------------------------------------

create or replace function public.admin_people(p_limit integer default 100)
returns table (
  user_id        uuid,
  display_name   text,
  home_city      text,
  search_radius_km integer,
  registered_at  timestamptz,
  favourites     text[],
  approved       integer,
  rejected       integer,
  pending        integer,
  score          integer,
  trust          text,
  is_blocked     boolean,
  block_reason   text,
  admin_level    text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Moderation, not management: the people here are the ones sending us prices.
  perform public.require_moderator();

  return query
  select p.id,
         c.display_name,
         p.home_city,
         p.search_radius_km,
         p.created_at,
         coalesce(
           (select array_agg(b.name_he order by f.rank)
              from public.user_favorite_beers f
              join public.beers b on b.id = f.beer_id
             where f.profile_id = p.id),
           '{}'
         ),
         coalesce(c.approved, 0),
         -- Rejections are counted here and deliberately NOT stored on
         -- `contributors` (0030), which is world-readable: how often somebody was
         -- turned down is a fact for a moderator, not for a leaderboard.
         (select count(*)::integer from public.deals d
           where d.created_by = p.id and d.status = 'rejected'),
         (select count(*)::integer from public.deals d
           where d.created_by = p.id and d.status = 'pending'),
         coalesce(c.score, 0),
         public.contributor_trust(c.score),
         (b.user_id is not null),
         b.reason,
         a.level::text
    from public.profiles p
    left join public.contributors c on c.profile_id = p.id
    left join public.submission_blocks b on b.user_id = p.id
    left join public.admins a on a.user_id = p.id
   -- People who have done something, newest first. Somebody who opened the app
   -- once and chose nothing is not a person this screen is about.
   where p.onboarded_at is not null
   order by p.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke execute on function public.admin_people(integer) from public, anon;
grant execute on function public.admin_people(integer) to authenticated;

-- --------------------------------------------------------------------------
-- Where the people are, and where the deals are not (Phase T).
--
-- The question this answers is the only one that changes what gets built next:
-- WHICH TOWNS HAVE PEOPLE AND NO DEALS. Everything else on the coverage screen
-- describes the pipeline; this describes the gap.
--
-- Counted by the town somebody typed, not by a coordinate — the town is what
-- they told us, and it is enough to decide where to go looking for prices.
-- --------------------------------------------------------------------------

create or replace function public.admin_people_by_city(p_limit integer default 50)
returns table (
  city            text,
  people          integer,
  with_radius     integer,
  -- How many live offers somebody in this town could actually reach, within the
  -- radius they themselves set. Null while no branch has a position (0026) —
  -- which is "we do not know", not zero.
  deals_nearby    integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  located boolean;
begin
  perform public.require_admin();

  select exists (select 1 from public.branches b where b.latitude is not null) into located;

  return query
  select p.home_city,
         count(*)::integer,
         count(*) filter (where p.search_radius_km is not null)::integer,
         case when located then count(distinct reach.offer_key)::integer end
    from public.profiles p
    -- Per PERSON, not per town: two people in the same place may have set
    -- different radii, and one of them having said "nationwide" does not mean
    -- the town is covered. Measuring from a town centre would also quietly
    -- discard the precise position of anybody who tapped "use my location".
    left join lateral (
      select o.offer_key
        from public.offers_feed o
        join public.branches br
          on br.store_id = o.store_id
         and br.latitude is not null
         and (
           -- 0 means nationwide (RADIUS_CHOICES); null means they never said, and
           -- 25 km is what the app assumes for them elsewhere.
           coalesce(p.search_radius_km, 25) = 0
           or public.km_between(p.home_lat, p.home_lon, br.latitude, br.longitude)
              <= coalesce(nullif(p.search_radius_km, 0), 25)
         )
       where located and p.home_lat is not null
    ) reach on true
   where p.home_city is not null and p.onboarded_at is not null
   group by p.home_city
   -- Most people first, and within that the emptiest: that ordering IS the
   -- question this screen exists to answer.
   order by count(*) desc, count(distinct reach.offer_key), p.home_city
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke execute on function public.admin_people_by_city(integer) from public, anon;
grant execute on function public.admin_people_by_city(integer) to authenticated;
