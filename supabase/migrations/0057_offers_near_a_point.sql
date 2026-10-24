-- ---------------------------------------------------------------------------
-- 0057 — the deals around a point, each at the branch it is actually at
--
-- The owner asked for a map (2026-10-24). Migration 0039 explained why there was
-- not one, and named the condition for building it: "the day
-- scripts/ingest/geocode.mjs runs, this screen starts answering properly with no
-- further change." The geocoder is configured now, so this is that day's SQL.
--
-- THE UNIT IS A BRANCH, NOT A CHAIN. `offers_catalog` holds one row per deal per
-- chain — the cheapest observation of it — and that row names a single branch,
-- the one the price was seen at. A map drawn from that would show one pin per
-- deal, at one shop, for a deal running in forty. `promotion_branches` (0017) is
-- the list of branches a promotion was actually observed at, so the map is built
-- from the join of the two: every branch that has the deal, with the deal.
--
-- DISTANCE IS NULL, NEVER ZERO. A branch we cannot place has no distance, and
-- `km_between` returns null for it. It is not 0 km, it is not the city centre
-- pretending to be a shop, and such a branch is simply not returned here —
-- because a map can only draw what it can put somewhere, and a pin in the wrong
-- place is the one failure this product cannot absorb (0026, 0039). A deal in a
-- branch we cannot place is still reachable everywhere else in the app; it is
-- the map alone that has nothing to say about it.
--
-- THE RADIUS IS DONE IN SQL, not in the browser. The brief is explicit that the
-- map must not fetch the whole country to show one neighbourhood (§9). 1,124
-- branches is small enough that a filter over them is cheap, and the limit is a
-- backstop rather than a budget.
--
-- NOT SECURITY DEFINER, for the same reasons 0039 gave: every table it reads —
-- offers_catalog (0044), promotion_branches (0017), branches (0008) — is already
-- world-readable by policy, and where a shop is, is public information. Passing
-- a point in is geography, not identity: nothing about the asker is stored, and
-- this function has nowhere to store it.
--
-- Additive: one function. Safe to run twice.
-- ---------------------------------------------------------------------------

create or replace function public.offers_near(
  p_lat       double precision,
  p_lon       double precision,
  p_radius_km double precision default 15,
  p_limit     integer default 400
)
returns table (
  branch_id     uuid,
  branch_name   text,
  branch_city   text,
  latitude      double precision,
  longitude     double precision,
  geo_precision text,
  km            double precision,
  offer_key     text,
  store_slug    text,
  store_name    text,
  beer_slug     text,
  beer_name     text,
  pack_label    text,
  effective_agorot integer,
  value_pct     integer,
  promo_type    public.promo_type,
  valid_to      timestamptz,
  observed_at   timestamptz
)
language sql
stable
set search_path = public
as $$
  select b.id,
         b.name_he,
         b.city,
         b.latitude,
         b.longitude,
         b.geocode_precision,
         public.km_between(p_lat, p_lon, b.latitude, b.longitude) as km,
         c.offer_key,
         c.store_slug,
         c.store_name,
         c.beer_slug,
         c.beer_name,
         c.pack_label,
         c.effective_agorot,
         c.value_pct,
         c.promo_type,
         c.valid_to,
         c.observed_at
    from public.offers_catalog c
    join public.promotion_branches pb on pb.promotion_id = c.promotion_id
    join public.branches b on b.id = pb.branch_id
   where c.promotion_id is not null
     and b.is_active
     and b.latitude is not null
     and b.longitude is not null
     -- A point is required. Without one there is no "near", and returning the
     -- whole country unordered would be the bug this function exists to prevent.
     and p_lat is not null
     and p_lon is not null
     -- 0 means "no limit", the same reading profiles.search_radius_km already has
     -- in distance.ts, so the two cannot drift apart.
     and (coalesce(p_radius_km, 0) = 0
          or public.km_between(p_lat, p_lon, b.latitude, b.longitude) <= p_radius_km)
   -- Nearest first, and within one branch the best saving first, so a pin that
   -- shows a single deal shows that branch's best one.
   order by km asc, c.value_pct desc nulls last, c.effective_agorot asc
   limit greatest(coalesce(p_limit, 400), 1);
$$;

comment on function public.offers_near(double precision, double precision, double precision, integer) is
  'Live chain deals at branches within p_radius_km of a point, nearest first. One row '
  'per branch per deal. Branches with no position are omitted: a map can only draw '
  'what it can place, and a pin in the wrong place is worse than no pin (0057).';

grant execute on function public.offers_near(double precision, double precision, double precision, integer)
  to anon, authenticated, service_role;
