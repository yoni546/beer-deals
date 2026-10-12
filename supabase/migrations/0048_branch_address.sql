-- ---------------------------------------------------------------------------
-- 0048 — a distance is not an answer to "where".
--
-- "הכי קרוב אליי" started working (0045–0047) and the first thing it got wrong was
-- obvious the moment somebody used it: it says "12 ק״מ ממך" and nothing else. Not
-- which branch, not which town, and nothing to put into Waze. A distance with no
-- place attached is a number, and the person still has to go and find the shop.
--
-- branches_within_km() already returns the branch's name and city and has since
-- 0026. It does not return the ADDRESS, which is the one field Waze can actually use
-- — and `branches.address` has been carrying it from the Stores file all along.
--
-- Dropped and recreated rather than replaced: a function's OUT columns are part of
-- its signature, so `create or replace` cannot add one.
--
-- WHY THE ADDRESS AND NOT THE COORDINATES. Because the coordinates are the TOWN
-- CENTRE (geocode_precision = 'locality'), and handing a navigation app a point we
-- know is not the shop is exactly the lie this whole feature refuses to tell. The
-- address is text we were given by the publisher; Waze resolves it itself, and gets
-- the door right far more often than our centroid would. The screen keeps saying
-- "מרכז העיר" beside the distance for the same reason.
-- ---------------------------------------------------------------------------

drop function if exists public.branches_within_km(double precision, double precision, integer, integer);

create function public.branches_within_km(
  p_lat       double precision,
  p_lon       double precision,
  p_radius_km integer default 0,
  p_limit     integer default 200
)
returns table (
  branch_id uuid,
  store_id  uuid,
  name_he   text,
  city      text,
  address   text,
  latitude  double precision,
  longitude double precision,
  km        double precision
)
language sql
stable
parallel safe
set search_path = public
as $$
  with box as (
    select
      -- A degree of latitude is ~111 km anywhere; a degree of longitude shrinks
      -- with the cosine of the latitude. Generous by 10%: the prefilter must never
      -- exclude a branch the exact distance would have kept.
      case when p_radius_km > 0 then p_radius_km / 111.0 * 1.1 else 999 end as dlat,
      case when p_radius_km > 0
           then p_radius_km / (111.0 * greatest(cos(radians(p_lat)), 0.2)) * 1.1
           else 999 end as dlon
  )
  select b.id, b.store_id, b.name_he, b.city, b.address, b.latitude, b.longitude,
         public.km_between(p_lat, p_lon, b.latitude, b.longitude) as km
    from public.branches b, box
   where b.is_active
     and b.latitude is not null
     and p_lat is not null and p_lon is not null
     and b.latitude  between p_lat - box.dlat and p_lat + box.dlat
     and b.longitude between p_lon - box.dlon and p_lon + box.dlon
     and (p_radius_km = 0 or public.km_between(p_lat, p_lon, b.latitude, b.longitude) <= p_radius_km)
   order by km
   limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

revoke execute on function public.branches_within_km(double precision, double precision, integer, integer) from public;
grant execute on function public.branches_within_km(double precision, double precision, integer, integer) to anon, authenticated, service_role;
