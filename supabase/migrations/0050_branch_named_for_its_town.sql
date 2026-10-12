-- ---------------------------------------------------------------------------
-- 0050 — the chain that puts the town in the branch's NAME.
--
-- יוחננוף: 25 beer offers in the feed, 0 of 52 branches placed, every one of those
-- offers invisible in "closest to me". Asking what its branches actually hold:
--
--   city = '0'   51 branches, an example named "אור יהודה", address "unknown"
--   city = ''     1 branch
--
-- The publisher's Stores file writes 0 where the settlement goes and puts the
-- settlement in the branch's name instead. Nothing in 0045–0049 could see that: they
-- all read `city`, and '0' is not a place.
--
-- SO THIS READS THE NAME — AND ONLY WHERE THE NAME IS A SETTLEMENT, WHOLE.
--
-- That restraint is the entire design. A branch name is usually not a town: it is
-- "קניון איילון", "ביג פאשן", "סניף המרכזי". Matching a town name INSIDE a branch
-- name would place a Haifa branch called נווה שאנן at a moshav of the same name
-- somewhere else entirely — a confident, undetectable, wrong pin, which is the one
-- failure this product cannot absorb. So:
--
--   * the whole name, normalised, must BE a settlement we know ("אור יהודה"), or
--   * the whole name minus the chain's own name must be ("יוחננוף אור יהודה").
--
-- No substring matching, no longest-prefix, no guessing. A branch called after a
-- shopping centre stays unplaced, which is what it should be.
--
-- Recorded separately — geocode_source says 'from branch name' — so that if this ever
-- turns out to be the wrong call, every row it wrote can be found and undone.
-- ---------------------------------------------------------------------------

create or replace function public.place_branches_by_town()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  by_city integer;
  by_name integer;
begin
  perform public.require_price_writer();

  -- Passes a–c: the city field, by name, by appended neighbourhood, by CBS symbol.
  with candidate as (
    select b.id, t.lat, t.lon
      from public.branches b
      join lateral (
        select tc.lat, tc.lon
          from public.town_centres tc
         where tc.norm_name = public.norm_place(b.city)
            or public.norm_place(b.city) like tc.norm_name || ' %'
            or (btrim(b.city) ~ '^[0-9]+$' and tc.code is not null
                and ltrim(tc.code, '0') = ltrim(btrim(b.city), '0'))
         order by (tc.norm_name = public.norm_place(b.city)) desc, length(tc.norm_name) desc
         limit 1
      ) t on true
     where b.latitude is null
       and b.city is not null
  )
  update public.branches b
     set latitude          = c.lat,
         longitude         = c.lon,
         geocoded_at       = now(),
         geocode_source    = 'israel-cities (town centre)',
         geocode_precision = 'locality'
    from candidate c
   where c.id = b.id;
  get diagnostics by_city = row_count;

  -- Pass d: the branch's NAME, whole, with the chain's own name allowed to be in it.
  with candidate as (
    select b.id, t.lat, t.lon
      from public.branches b
      join public.stores s on s.id = b.store_id
      join lateral (
        select tc.lat, tc.lon
          from public.town_centres tc
         where tc.norm_name = public.norm_place(b.name_he)
            or tc.norm_name = btrim(
                 regexp_replace(
                   replace(public.norm_place(b.name_he), public.norm_place(s.name_he), ' '),
                   '\s+', ' ', 'g'
                 )
               )
         limit 1
      ) t on true
     where b.latitude is null
       and b.name_he is not null
  )
  update public.branches b
     set latitude          = c.lat,
         longitude         = c.lon,
         geocoded_at       = now(),
         geocode_source    = 'israel-cities (town centre, from branch name)',
         geocode_precision = 'locality'
    from candidate c
   where c.id = b.id;
  get diagnostics by_name = row_count;

  return by_city + by_name;
end;
$$;

revoke execute on function public.place_branches_by_town() from public, anon;
grant execute on function public.place_branches_by_town() to authenticated, service_role;

-- Run it now, as the owner.
do $$
declare
  placed integer;
begin
  with candidate as (
    select b.id, t.lat, t.lon
      from public.branches b
      join public.stores s on s.id = b.store_id
      join lateral (
        select tc.lat, tc.lon
          from public.town_centres tc
         where tc.norm_name = public.norm_place(b.name_he)
            or tc.norm_name = btrim(
                 regexp_replace(
                   replace(public.norm_place(b.name_he), public.norm_place(s.name_he), ' '),
                   '\s+', ' ', 'g'
                 )
               )
         limit 1
      ) t on true
     where b.latitude is null
       and b.name_he is not null
  )
  update public.branches b
     set latitude          = c.lat,
         longitude         = c.lon,
         geocoded_at       = now(),
         geocode_source    = 'israel-cities (town centre, from branch name)',
         geocode_precision = 'locality'
    from candidate c
   where c.id = b.id;

  get diagnostics placed = row_count;
  raise notice '0050: placed % branches named after their town', placed;
end
$$;
