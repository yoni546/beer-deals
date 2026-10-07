-- ---------------------------------------------------------------------------
-- 0026 — where the branches are, and where the person is.
--
-- V2's core question is "where should I buy the beer I want RIGHT NOW", and the
-- answer depends on how far they are willing to go. Until now the schema could
-- not express any of it: `branches` carried `name_he`, `city` and `address` and
-- NO coordinates at all, `profiles` had no location and no radius, and nothing
-- anywhere could measure a distance. This lays the foundation; the screens come
-- after it.
--
-- WHAT THIS DOES NOT DO: it does not invent a single coordinate.
--
-- The price-transparency Stores file gives a branch's name, address and city —
-- never a latitude or longitude. Real branch coordinates therefore require
-- geocoding through an external provider, which needs a credential this
-- repository does not have and must not guess. So the columns ship empty, the
-- provenance of every future fill is recorded beside it, and the app is written
-- to treat "we do not know where this branch is" as a first-class state rather
-- than as zero. A branch with no coordinates is never silently placed anywhere.
--
-- WHY PLAIN SQL AND NOT POSTGIS. The test suite runs the real migrations on
-- PGlite, which is what makes the RLS and behaviour tests trustworthy; depending
-- on postgis/earthdistance would put this schema beyond what those tests can
-- build. At Israeli scale — about 1,100 branches — a bounding-box prefilter on a
-- plain btree index followed by haversine is comfortably fast, and it is exact
-- enough for a radius a person chooses in 5 km steps. If the branch count ever
-- grows by an order of magnitude, swapping the index for a spatial one is a
-- local change: every caller goes through branches_within_km().
--
-- Additive and reversible: new nullable columns, two functions, one index.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- 1. Branch coordinates, and how we came by them
-- --------------------------------------------------------------------------

alter table public.branches
  add column if not exists latitude          double precision,
  add column if not exists longitude         double precision,
  add column if not exists geocoded_at       timestamptz,
  add column if not exists geocode_source    text,
  add column if not exists geocode_precision text;

comment on column public.branches.latitude is
  'WGS84. Null means we do not know where this branch is -- which is shown as not knowing, never as a position.';
comment on column public.branches.geocode_source is
  'Which provider or dataset produced the coordinates. Part of the record, like a price''s source.';
comment on column public.branches.geocode_precision is
  'How exact the fix is: rooftop | street | locality. A locality fix is the CITY centre, not the shop, and the app says so rather than implying a doorstep.';

do $$
begin
  -- Both or neither: half a coordinate is not a location.
  if not exists (select 1 from pg_constraint where conname = 'branches_geo_pair') then
    alter table public.branches add constraint branches_geo_pair
      check ((latitude is null) = (longitude is null));
  end if;

  -- Israel, generously bounded. This is a typo and unit-confusion guard (a swapped
  -- pair, degrees-vs-radians, a 0/0 "null island" fix), not a political boundary:
  -- a coordinate outside it is a mistake we would rather refuse than draw on a map.
  if not exists (select 1 from pg_constraint where conname = 'branches_geo_bounds') then
    alter table public.branches add constraint branches_geo_bounds
      check (
        latitude is null
        or (latitude between 29.3 and 33.5 and longitude between 34.0 and 36.0)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'branches_geocode_precision') then
    alter table public.branches add constraint branches_geocode_precision
      check (geocode_precision is null or geocode_precision in ('rooftop', 'street', 'locality'));
  end if;

  -- A coordinate without a recorded source is a coordinate we cannot defend.
  if not exists (select 1 from pg_constraint where conname = 'branches_geo_provenance') then
    alter table public.branches add constraint branches_geo_provenance
      check (latitude is null or (geocoded_at is not null and geocode_source is not null));
  end if;
end
$$;

-- The bounding-box prefilter. Partial, because a branch with no fix is never a candidate.
create index if not exists branches_geo_idx
  on public.branches (latitude, longitude)
  where latitude is not null and is_active;

-- --------------------------------------------------------------------------
-- 2. Where the person is, and how far they will go
-- --------------------------------------------------------------------------

alter table public.profiles
  add column if not exists home_city       text,
  add column if not exists home_lat        double precision,
  add column if not exists home_lon        double precision,
  add column if not exists search_radius_km integer;

comment on column public.profiles.home_city is
  'The settlement the person named. The minimum we need: V2 asks "where do you live", never for a street address.';
comment on column public.profiles.search_radius_km is
  'How far they said they are willing to travel. Null = not set. 0 means nationwide (no distance limit).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_home_pair') then
    alter table public.profiles add constraint profiles_home_pair
      check ((home_lat is null) = (home_lon is null));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_home_bounds') then
    alter table public.profiles add constraint profiles_home_bounds
      check (
        home_lat is null
        or (home_lat between 29.3 and 33.5 and home_lon between 34.0 and 36.0)
      );
  end if;

  -- The radii the app offers, plus 0 for nationwide. A number outside this set
  -- is a bug in a caller, not a preference.
  if not exists (select 1 from pg_constraint where conname = 'profiles_radius') then
    alter table public.profiles add constraint profiles_radius
      check (search_radius_km is null or search_radius_km in (0, 5, 10, 15, 20, 25, 50));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_home_city_length') then
    alter table public.profiles add constraint profiles_home_city_length
      check (home_city is null or char_length(trim(home_city)) between 1 and 60);
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- 3. Saving it
--
-- Through a function, not a column grant, for the same reason save_preferences
-- exists: 0010 revoked table-wide UPDATE on `profiles` and re-granted it column
-- by column, so the columns that decide what a person is shown are written in
-- one audited place that can only ever touch auth.uid()'s own row.
-- --------------------------------------------------------------------------

create or replace function public.save_location(
  p_city      text,
  p_lat       double precision,
  p_lon       double precision,
  p_radius_km integer
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

  if (p_lat is null) <> (p_lon is null) then
    raise exception 'a latitude without a longitude is not a place' using errcode = '22023';
  end if;

  if p_radius_km is not null and p_radius_km not in (0, 5, 10, 15, 20, 25, 50) then
    raise exception 'that is not one of the distances on offer' using errcode = '22023';
  end if;

  -- Same reason as 0024: a missing profile row must not turn into a save that
  -- reports success and changes nothing.
  insert into public.profiles (id) values (uid) on conflict (id) do nothing;

  update public.profiles
     set home_city        = nullif(trim(p_city), ''),
         home_lat         = p_lat,
         home_lon         = p_lon,
         search_radius_km = p_radius_km
   where id = uid;

  if not found then
    raise exception 'could not save your location' using errcode = '23503';
  end if;
end;
$$;

revoke execute on function public.save_location(text, double precision, double precision, integer) from public, anon;
grant execute on function public.save_location(text, double precision, double precision, integer) to authenticated;

-- --------------------------------------------------------------------------
-- 4. Distance
--
-- Haversine on a sphere of radius 6371 km. Good to a few metres per kilometre
-- against the ellipsoid, which is far below the precision of a city centroid or
-- of a radius chosen in 5 km steps.
-- --------------------------------------------------------------------------

create or replace function public.km_between(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
)
returns double precision
language sql
immutable
parallel safe
as $$
  select case
    when lat1 is null or lon1 is null or lat2 is null or lon2 is null then null
    else 6371 * 2 * asin(
      sqrt(
        power(sin(radians(lat2 - lat1) / 2), 2)
        + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
      )
    )
  end;
$$;

grant execute on function public.km_between(double precision, double precision, double precision, double precision)
  to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- 5. The branches near a point
--
-- One place that knows how "near" is computed, so swapping the index for a
-- spatial one later is a change here and nowhere else.
--
-- p_radius_km = 0 means nationwide: no distance limit, still ordered by distance.
-- A branch with no coordinates is never returned: we do not know that it is near,
-- and claiming it is would be the same class of mistake as an invented price.
-- --------------------------------------------------------------------------

create or replace function public.branches_within_km(
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
  select b.id, b.store_id, b.name_he, b.city, b.latitude, b.longitude,
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

grant execute on function public.branches_within_km(double precision, double precision, integer, integer)
  to anon, authenticated, service_role;
