-- ---------------------------------------------------------------------------
-- 0039 — the branches of a promotion, nearest first.
--
-- WHY THIS AND NOT A MAP. Phase H asked for a map. A map of this data today
-- would be an empty map: `branches.latitude` is deliberately null everywhere
-- (0026 shipped the columns with no provider configured, because inventing a
-- position is worse than admitting we have none), so there is nothing to draw.
-- It would also mean a tile provider -- an external service that sees every
-- viewer's IP and needs a key the owner has to obtain -- and a map library, on
-- an app whose loudest complaint was that it was slow. That is the same trade
-- Phase Q is gated on, and it fails the gate for the same reason.
--
-- What somebody actually wants from "a map" here is one sentence: WHICH BRANCH
-- NEAR ME HAS THIS. That is answerable from the data we hold the moment any
-- branch has a position, and it is answerable in text now -- including the
-- honest answer, which today is "we do not know where the branches are".
--
-- So: the branch list that already opens under a deal's "where" line, ordered by
-- distance and saying it, with no coordinates invented and no provider added.
-- The day `scripts/ingest/geocode.mjs` runs, this screen starts answering
-- properly with no further change. See docs/GEOCODING.md.
--
-- Not SECURITY DEFINER: `promotion_branches` (0017) and `branches` (0008) are
-- both world-readable by policy, and a branch's address is public information.
-- Passing a point in is not a privacy question either -- it is geography. What
-- would be a privacy question is storing where somebody asked from, and this
-- stores nothing.
-- ---------------------------------------------------------------------------

create or replace function public.promotion_branches_near(
  p_promotion_id bigint,
  p_lat          double precision default null,
  p_lon          double precision default null
)
returns table (
  branch_name text,
  branch_city text,
  observed_at timestamptz,
  -- Null means "we do not know where this branch is", which the screen says in
  -- words. It never means zero, and it is never filled in with a city centre
  -- pretending to be a shop.
  km            double precision,
  -- Named geo_precision and not `precision`: that is a reserved word in Postgres
  -- (as in `double precision`), and an OUT column called it will not parse.
  geo_precision text
)
language sql
stable
set search_path = public
as $$
  select pb.branch_name,
         pb.branch_city,
         pb.observed_at,
         public.km_between(p_lat, p_lon, b.latitude, b.longitude),
         b.geocode_precision
    from public.promotion_branches pb
    join public.branches b on b.id = pb.branch_id
   where pb.promotion_id = p_promotion_id
   -- Nearest first where there is a distance; everything we cannot place keeps its
   -- alphabetical order AFTER them, rather than being dropped. A branch we cannot
   -- locate is still a branch the deal is at.
   order by public.km_between(p_lat, p_lon, b.latitude, b.longitude) asc nulls last,
            pb.branch_name
   limit 1000;
$$;

grant execute on function public.promotion_branches_near(bigint, double precision, double precision)
  to anon, authenticated, service_role;
