-- ---------------------------------------------------------------------------
-- 0064 — the whole country, by town
--
-- MEASURED, production, 2026-10-25, after the owner chose "בכל הארץ" and saw
-- only what was within about forty kilometres of him:
--
--   offers_near(TLV, radius 0, limit 400)     400 rows,  86 branches, none > 40 km
--   offers_near(TLV, radius 0, limit 5000)  1,000 rows, 103 branches, none > 40 km
--   offers_near(TLV, radius 0, limit 30000) 1,000 rows, 103 branches, none > 40 km
--
-- PostgREST caps a response at 1,000 rows whatever the function says, and
-- offers_near orders by distance — so "no limit" could only ever mean "the
-- nearest thousand rows", which is a hundred branches around one city. The
-- radius was being honoured and the answer was still wrong.
--
-- ONE ROW PER BRANCH WOULD NOT FIX IT EITHER: a thousand branches carry deals,
-- which is the cap again, and a thousand markers on a phone is not a map, it is
-- a smear. The unit for a country is a TOWN.
--
-- GROUPED BY THE POINT, not by the name. Branches are placed at their town's
-- centre until a geocoder puts them on their street (0045), so the branches of
-- one town share a coordinate exactly — and grouping by that coordinate is both
-- simpler than normalising names and honest about what the map can actually
-- draw. When a branch does get a street-level fix it becomes its own pin, which
-- is the right behaviour: it is no longer "somewhere in that town".
--
-- Public and not SECURITY DEFINER, for the reasons 0057 gives: everything it
-- reads is world-readable, and where a shop is, is public information.
--
-- Additive: one function. Safe to run twice.
-- ---------------------------------------------------------------------------

create or replace function public.deals_by_town()
returns table (
  town       text,
  latitude   double precision,
  longitude  double precision,
  branches   integer,
  deals      integer,
  best_value_pct integer,
  cheapest_agorot integer
)
language sql
stable
set search_path = public
as $$
  select
    -- One name for the point. Several branches share it; they also share a town,
    -- so any of their city values will do, and the app resolves a CBS symbol to
    -- its name before it reaches a screen (0047).
    min(b.city)                                   as town,
    b.latitude,
    b.longitude,
    count(distinct b.id)::integer                 as branches,
    count(*)::integer                             as deals,
    max(c.value_pct)::integer                     as best_value_pct,
    min(c.effective_agorot)::integer              as cheapest_agorot
    from public.branches b
    join public.promotion_branch_pins pb on pb.branch_id = b.id
    join public.offers_catalog c on c.promotion_id = pb.promotion_id
   where b.is_active
     and b.latitude is not null
     and b.longitude is not null
   group by b.latitude, b.longitude
   -- Busiest first, so a cap — if one is ever needed — keeps what matters.
   order by count(*) desc
   limit 400;
$$;

comment on function public.deals_by_town() is
  'Every place in the country that has a live chain deal, one row per POINT: the '
  'towns, because branches sit at their town centre until they are geocoded and a '
  'thousand markers is not a map (0064). offers_near is still the answer for "near me".';

grant execute on function public.deals_by_town() to anon, authenticated, service_role;
