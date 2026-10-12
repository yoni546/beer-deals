-- ---------------------------------------------------------------------------
-- 0051 — four settlements that real branches were waiting for.
--
-- After 0050 the count stood at 1,021 of 1,160 branches placed. Asking what was
-- still unmatched turned up four names that are not noise:
--
--   אפרת          its dataset row (3650) sits on the geocoder's fallback point
--                 in the Negev, so the import refused it — correctly — and nothing
--                 put it back.
--   כפר עציון     its dataset row (3488) is at 32.178, 34.907, which is near
--                 Ra'anana. Kfar Etzion is in Gush Etzion. Refused with the two
--                 other settlements sharing that point, and also never put back.
--   טירת הכרמל    the dataset does not carry it at all.
--   טבעון         how people and Stores files write קריית טבעון.
--
-- The first three are added to scripts/data/curated-towns.json by hand, on the same
-- disclosed standard as the other ninety: well-established public geographic
-- knowledge, an approximate centre, good to a kilometre or two, marked
-- source = 'compiled' so a later import can tell what it is replacing. Two of them
-- get their CBS symbol back from the dataset row that was refused, because a refused
-- coordinate is not a refused identity (0049).
--
-- WHAT IS STILL NOT MATCHED, AND WILL NOT BE:
--
--   '0'              78 branches. A placeholder several chains write where a town
--                    goes. It is not a place and no amount of data will make it one.
--   (empty)          47 branches with no city at all.
--   'מ.א. עמק חפר'   a regional council, not a settlement. Placing it at the
--                    council's centre would be a different claim than the one this
--                    column makes.
--   'תל אבית יפה'    one branch, and a typo in the publisher's own file for
--                    תל אביב-יפו. Encoding somebody's typo as a legitimate spelling
--                    of a city is not a fix; if they correct it, it resolves itself.
--   10018 / 10044 / 10098 / 1306 / 50
--                    a chain's own internal numbering, or symbols for settlements
--                    the government list we have does not carry.
--
-- Each of those branches keeps no position, stays out of "closest to me", and stays
-- counted in the line on the screen that says how many offers are not shown.
-- ---------------------------------------------------------------------------

-- Four rows, not the whole table again: 0046 and 0049 are applied, every other
-- settlement is already there with the same values, and a 110 KB paste for four
-- rows is how a paste arrives truncated.
insert into public.town_centres (norm_name, name, lat, lon, source) values
  ('אפרת', 'אפרת', 31.655, 35.167, 'compiled'),
  ('טירת הכרמל', 'טירת הכרמל', 32.761, 34.972, 'compiled'),
  ('כפר עציון', 'כפר עציון', 31.65, 35.114, 'compiled'),
  ('טבעון', 'קריית טבעון', 32.7332039, 35.1453385, 'data.gov.il+osm')
on conflict (norm_name) do update
  set name = excluded.name, lat = excluded.lat, lon = excluded.lon, source = excluded.source;

update public.town_centres tc
   set code = v.code
  from (values
  ('אפרת', '3650'),
  ('כפר עציון', '3488'),
  ('טבעון', '2300')
) as v(norm_name, code)
 where tc.norm_name = v.norm_name;

-- Place what this makes placeable: the same four passes, only ever filling a branch
-- that has no position.
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
         where tc.norm_name = public.norm_place(b.city)
            or public.norm_place(b.city) like tc.norm_name || ' %'
            or (btrim(b.city) ~ '^[0-9]+$' and tc.code is not null
                and ltrim(tc.code, '0') = ltrim(btrim(b.city), '0'))
            or tc.norm_name = public.norm_place(b.name_he)
            or tc.norm_name = btrim(
                 regexp_replace(
                   replace(public.norm_place(b.name_he), public.norm_place(s.name_he), ' '),
                   '\s+', ' ', 'g'
                 )
               )
         order by (tc.norm_name = public.norm_place(b.city)) desc, length(tc.norm_name) desc
         limit 1
      ) t on true
     where b.latitude is null
  )
  update public.branches b
     set latitude          = c.lat,
         longitude         = c.lon,
         geocoded_at       = now(),
         geocode_source    = 'israel-cities (town centre)',
         geocode_precision = 'locality'
    from candidate c
   where c.id = b.id;

  get diagnostics placed = row_count;
  raise notice '0051: placed % more branches', placed;
end
$$;
