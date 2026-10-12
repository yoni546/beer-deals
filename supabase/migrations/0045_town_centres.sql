-- ---------------------------------------------------------------------------
-- 0045 — putting the branches on the map, honestly.
--
-- THE PROBLEM THIS SOLVES. Migration 0026 shipped `branches.latitude` and
-- `branches.longitude` deliberately empty, because the price-transparency Stores
-- file carries a branch's name, address and city and never a coordinate. The
-- consequence, visible to every person who opens the app: "הכי קרוב אליי" has
-- never worked. 0 of ~1,160 branches has a position, so the screen correctly says
-- it does not know where the shops are — and correctly saying nothing is still
-- nothing.
--
-- WHAT THIS DOES. It places each branch at the CENTRE OF ITS TOWN, and records
-- that this is what it did: geocode_precision = 'locality', which 0026 defines as
-- "the CITY centre, not the shop", which ScopeLine already words as "(מרכז העיר)"
-- next to the distance. Nothing here claims a doorstep.
--
-- WHY THAT IS NOT THE INVENTED COORDINATE THE PIPELINE REFUSES. The thing
-- scripts/ingest/lib/geocode/null.mjs exists to prevent is a plausible, wrong,
-- UNDETECTABLE position — a pin on a building that is not the shop, indistinguishable
-- from a real fix once it is in the table. A town centre is a different object: it is
-- labelled as a town centre in the row, in the API and on the screen, and it answers
-- the question the app actually asks, which is "is there a Rami Levy in my town or do
-- I have to drive to the next one". At 5 km radius steps a town centre is the right
-- resolution; for the shop's own door it is openly not, and the app says so.
--
-- A real street-level geocode (docs/GEOCODING.md, GEOCODER="nominatim") remains the
-- better answer and still works: `place_branches_by_town()` only ever fills a branch
-- that has NO position, so a later rooftop fix is never overwritten by a town centre,
-- and this migration is a floor rather than a ceiling.
--
-- Additive and reversible: one reference table, two functions, one backfill that
-- touches only rows whose latitude is null.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- 1. Comparing two spellings of one place
--
-- The Stores files, the person typing their town, and src/data/israel-cities.ts
-- disagree about maqaf vs hyphen ("תל אביב-יפו" / "תל אביב יפו"), about geresh,
-- and about קרית vs קריית. None of that is a different town. This is the whole
-- of the latitude we take: no transliteration, no edit distance, no guessing.
-- --------------------------------------------------------------------------
create or replace function public.norm_place(raw text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    lower(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(coalesce(raw, ''), '[־‐‑‒–—―-]', ' ', 'g'),
              '[׳״''’"״׳.,]', '', 'g'
            ),
            'קרית', 'קריית', 'g'
          ),
          '\s+', ' ', 'g'
        )
      )
    ),
    ''
  );
$$;

comment on function public.norm_place(text) is
  'One spelling key for a place name. Mechanical only: hyphens and maqaf to space, '
  'geresh and punctuation dropped, קרית unified with קריית, whitespace collapsed.';

-- --------------------------------------------------------------------------
-- 2. Where each town is
--
-- One row per SPELLING, each carrying the town's display name and its approximate
-- centre, so a lookup is a primary-key hit. Generated from src/data/israel-cities.ts
-- by scripts/build-town-centres-sql.mjs — tests/town-centres.test.ts fails if the two
-- copies drift. `source` is the same weaker claim that file makes out loud: these are
-- hand-compiled approximate centres, good to a kilometre or two, not an official
-- dataset. data.gov.il's רשימת יישובים is the upgrade, and it would arrive here as a
-- new migration with source = 'data.gov.il'.
-- --------------------------------------------------------------------------
create table if not exists public.town_centres (
  norm_name text primary key,
  name      text not null,
  lat       double precision not null,
  lon       double precision not null,
  source    text not null default 'compiled',
  constraint town_centres_bounds check (lat between 29.3 and 33.5 and lon between 34.0 and 36.0)
);

comment on table public.town_centres is
  'Approximate town centres, one row per spelling. Reference geography, not user data.';

-- Published geography with nothing personal in it, and the app already ships the
-- same list to the browser in src/data/israel-cities.ts. Read-only to everybody:
-- there is no write grant and no write policy, so the only way a row changes is a
-- migration or the service role.
grant select on public.town_centres to anon, authenticated, service_role;

alter table public.town_centres enable row level security;

create policy town_centres_read on public.town_centres
  for select to anon, authenticated using (true);

insert into public.town_centres (norm_name, name, lat, lon, source) values
  ('קריית שמונה', 'קריית שמונה', 33.207, 35.572, 'compiled'),
  ('מטולה', 'מטולה', 33.279, 35.578, 'compiled'),
  ('צפת', 'צפת', 32.965, 35.498, 'compiled'),
  ('חצור הגלילית', 'חצור הגלילית', 32.98, 35.545, 'compiled'),
  ('ראש פינה', 'ראש פינה', 32.969, 35.542, 'compiled'),
  ('מעלות תרשיחא', 'מעלות־תרשיחא', 33.016, 35.272, 'compiled'),
  ('מעלות', 'מעלות־תרשיחא', 33.016, 35.272, 'compiled'),
  ('תרשיחא', 'מעלות־תרשיחא', 33.016, 35.272, 'compiled'),
  ('נהריה', 'נהריה', 33.006, 35.095, 'compiled'),
  ('שלומי', 'שלומי', 33.072, 35.145, 'compiled'),
  ('עכו', 'עכו', 32.928, 35.082, 'compiled'),
  ('כרמיאל', 'כרמיאל', 32.916, 35.296, 'compiled'),
  ('סחנין', 'סחנין', 32.865, 35.3, 'compiled'),
  ('טמרה', 'טמרה', 32.853, 35.198, 'compiled'),
  ('שפרעם', 'שפרעם', 32.806, 35.172, 'compiled'),
  ('נצרת', 'נצרת', 32.702, 35.303, 'compiled'),
  ('נוף הגליל', 'נוף הגליל', 32.713, 35.32, 'compiled'),
  ('נצרת עילית', 'נוף הגליל', 32.713, 35.32, 'compiled'),
  ('טבריה', 'טבריה', 32.79, 35.531, 'compiled'),
  ('מגדל העמק', 'מגדל העמק', 32.675, 35.245, 'compiled'),
  ('עפולה', 'עפולה', 32.607, 35.289, 'compiled'),
  ('בית שאן', 'בית שאן', 32.497, 35.5, 'compiled'),
  ('יקנעם עילית', 'יקנעם עילית', 32.661, 35.11, 'compiled'),
  ('יקנעם', 'יקנעם עילית', 32.661, 35.11, 'compiled'),
  ('קריית טבעון', 'קריית טבעון', 32.721, 35.127, 'compiled'),
  ('חיפה', 'חיפה', 32.794, 34.99, 'compiled'),
  ('קריית ביאליק', 'קריית ביאליק', 32.831, 35.081, 'compiled'),
  ('קריית מוצקין', 'קריית מוצקין', 32.839, 35.077, 'compiled'),
  ('קריית ים', 'קריית ים', 32.845, 35.069, 'compiled'),
  ('קריית אתא', 'קריית אתא', 32.804, 35.106, 'compiled'),
  ('נשר', 'נשר', 32.767, 35.043, 'compiled'),
  ('טירת כרמל', 'טירת כרמל', 32.76, 34.972, 'compiled'),
  ('חדרה', 'חדרה', 32.434, 34.92, 'compiled'),
  ('אור עקיבא', 'אור עקיבא', 32.509, 34.918, 'compiled'),
  ('זכרון יעקב', 'זכרון יעקב', 32.573, 34.952, 'compiled'),
  ('פרדס חנה כרכור', 'פרדס חנה־כרכור', 32.474, 34.975, 'compiled'),
  ('פרדס חנה', 'פרדס חנה־כרכור', 32.474, 34.975, 'compiled'),
  ('כרכור', 'פרדס חנה־כרכור', 32.474, 34.975, 'compiled'),
  ('בנימינה', 'בנימינה', 32.515, 34.949, 'compiled'),
  ('נתניה', 'נתניה', 32.321, 34.853, 'compiled'),
  ('אבן יהודה', 'אבן יהודה', 32.271, 34.888, 'compiled'),
  ('כפר יונה', 'כפר יונה', 32.317, 34.937, 'compiled'),
  ('טירה', 'טירה', 32.234, 34.951, 'compiled'),
  ('טייבה', 'טייבה', 32.267, 35.01, 'compiled'),
  ('קלנסווה', 'קלנסווה', 32.285, 34.981, 'compiled'),
  ('רעננה', 'רעננה', 32.185, 34.871, 'compiled'),
  ('כפר סבא', 'כפר סבא', 32.175, 34.907, 'compiled'),
  ('הוד השרון', 'הוד השרון', 32.15, 34.889, 'compiled'),
  ('הרצליה', 'הרצליה', 32.166, 34.843, 'compiled'),
  ('רמת השרון', 'רמת השרון', 32.146, 34.839, 'compiled'),
  ('תל אביב יפו', 'תל אביב-יפו', 32.085, 34.782, 'compiled'),
  ('תל אביב', 'תל אביב-יפו', 32.085, 34.782, 'compiled'),
  ('יפו', 'תל אביב-יפו', 32.085, 34.782, 'compiled'),
  ('תא', 'תל אביב-יפו', 32.085, 34.782, 'compiled'),
  ('בני ברק', 'בני ברק', 32.084, 34.833, 'compiled'),
  ('גבעתיים', 'גבעתיים', 32.072, 34.81, 'compiled'),
  ('רמת גן', 'רמת גן', 32.082, 34.814, 'compiled'),
  ('פתח תקווה', 'פתח תקווה', 32.088, 34.887, 'compiled'),
  ('קריית אונו', 'קריית אונו', 32.056, 34.855, 'compiled'),
  ('אור יהודה', 'אור יהודה', 32.03, 34.853, 'compiled'),
  ('יהוד מונוסון', 'יהוד־מונוסון', 32.033, 34.889, 'compiled'),
  ('יהוד', 'יהוד־מונוסון', 32.033, 34.889, 'compiled'),
  ('חולון', 'חולון', 32.015, 34.774, 'compiled'),
  ('בת ים', 'בת ים', 32.017, 34.75, 'compiled'),
  ('ראשון לציון', 'ראשון לציון', 31.964, 34.805, 'compiled'),
  ('נס ציונה', 'נס ציונה', 31.929, 34.799, 'compiled'),
  ('רחובות', 'רחובות', 31.894, 34.809, 'compiled'),
  ('רמלה', 'רמלה', 31.928, 34.866, 'compiled'),
  ('לוד', 'לוד', 31.952, 34.896, 'compiled'),
  ('שוהם', 'שוהם', 31.999, 34.948, 'compiled'),
  ('מודיעין מכבים רעות', 'מודיעין־מכבים־רעות', 31.899, 35.01, 'compiled'),
  ('מודיעין', 'מודיעין־מכבים־רעות', 31.899, 35.01, 'compiled'),
  ('אלעד', 'אלעד', 32.051, 34.951, 'compiled'),
  ('ראש העין', 'ראש העין', 32.096, 34.956, 'compiled'),
  ('ירושלים', 'ירושלים', 31.769, 35.217, 'compiled'),
  ('י ם', 'ירושלים', 31.769, 35.217, 'compiled'),
  ('ירושלם', 'ירושלים', 31.769, 35.217, 'compiled'),
  ('בית שמש', 'בית שמש', 31.747, 34.988, 'compiled'),
  ('מבשרת ציון', 'מבשרת ציון', 31.797, 35.148, 'compiled'),
  ('ביתר עילית', 'ביתר עילית', 31.698, 35.113, 'compiled'),
  ('מעלה אדומים', 'מעלה אדומים', 31.773, 35.298, 'compiled'),
  ('גבעת זאב', 'גבעת זאב', 31.86, 35.168, 'compiled'),
  ('יבנה', 'יבנה', 31.878, 34.739, 'compiled'),
  ('גדרה', 'גדרה', 31.813, 34.778, 'compiled'),
  ('אשדוד', 'אשדוד', 31.802, 34.655, 'compiled'),
  ('אשקלון', 'אשקלון', 31.669, 34.574, 'compiled'),
  ('קריית מלאכי', 'קריית מלאכי', 31.728, 34.747, 'compiled'),
  ('קריית גת', 'קריית גת', 31.61, 34.764, 'compiled'),
  ('שדרות', 'שדרות', 31.525, 34.596, 'compiled'),
  ('נתיבות', 'נתיבות', 31.422, 34.589, 'compiled'),
  ('אופקים', 'אופקים', 31.311, 34.62, 'compiled'),
  ('באר שבע', 'באר שבע', 31.252, 34.791, 'compiled'),
  ('רהט', 'רהט', 31.393, 34.754, 'compiled'),
  ('עומר', 'עומר', 31.267, 34.846, 'compiled'),
  ('מיתר', 'מיתר', 31.322, 34.933, 'compiled'),
  ('להבים', 'להבים', 31.371, 34.816, 'compiled'),
  ('דימונה', 'דימונה', 31.07, 35.033, 'compiled'),
  ('ערד', 'ערד', 31.259, 35.212, 'compiled'),
  ('ירוחם', 'ירוחם', 30.988, 34.929, 'compiled'),
  ('מצפה רמון', 'מצפה רמון', 30.61, 34.801, 'compiled'),
  ('אילת', 'אילת', 29.557, 34.952, 'compiled'),
  ('אריאל', 'אריאל', 32.106, 35.187, 'compiled'),
  ('מעלה אפרים', 'מעלה אפרים', 32.07, 35.333, 'compiled')
on conflict (norm_name) do update
  set name = excluded.name, lat = excluded.lat, lon = excluded.lon, source = excluded.source;

-- --------------------------------------------------------------------------
-- 3. Placing the branches
--
-- Two passes, in this order:
--
--   a. the branch's city, matched exactly on the spelling key.
--   b. the branch's city with something appended — "ירושלים תלפיות",
--      "פתח תקווה (סגולה)" — matched on the longest town name that is a whole-word
--      prefix of it. A neighbourhood inside a town is still that town.
--
-- No fuzzy third pass. A branch whose city we do not recognise keeps no position,
-- stays out of "closest to me", and is counted on the admin coverage screen, which
-- is the behaviour the feature was built around from the start.
--
-- ONLY FILLS WHAT IS EMPTY. A branch that already has a position — a real street
-- fix from a geocoder, or a correction — is never touched.
--
-- Guarded by require_price_writer(), on 0008's rule: whoever may write a price for a
-- branch may say which town that branch is in.
-- --------------------------------------------------------------------------
create or replace function public.place_branches_by_town()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  placed integer;
begin
  perform public.require_price_writer();

  with candidate as (
    select b.id,
           t.lat,
           t.lon
      from public.branches b
      join lateral (
        select tc.lat, tc.lon
          from public.town_centres tc
         where tc.norm_name = public.norm_place(b.city)
            or public.norm_place(b.city) like tc.norm_name || ' %'
         order by length(tc.norm_name) desc
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

  get diagnostics placed = row_count;
  return placed;
end;
$$;

comment on function public.place_branches_by_town() is
  'Gives every unplaced branch the centre of its town, recorded as precision=locality. '
  'Never overwrites a position that is already there.';

revoke execute on function public.place_branches_by_town() from public, anon;
grant execute on function public.place_branches_by_town() to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 4. And the person's own town
--
-- The same gap existed at the other end of the measurement. PlacePicker sends a
-- point when the town is PICKED from the list, and sends none when the town is
-- TYPED — so somebody who typed "חולון" had told us exactly where they live and
-- still got "we have your town but not the positions". 0.32.4 fixed the wording;
-- this fixes the thing the wording was about.
--
-- Only when the caller has no point of its own: a shared GPS position always wins
-- over a town centre, and this never overwrites one.
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
  uid   uuid := auth.uid();
  city  text := nullif(btrim(p_city), '');
  lat   double precision := p_lat;
  lon   double precision := p_lon;
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

  -- A town we know, with no point supplied: measure from its centre.
  if lat is null and city is not null then
    select tc.lat, tc.lon into lat, lon
      from public.town_centres tc
     where tc.norm_name = public.norm_place(city)
     limit 1;
  end if;

  -- Same reason as 0024: a missing profile row must not turn into a save that
  -- reports success and changes nothing.
  insert into public.profiles (id) values (uid) on conflict (id) do nothing;

  update public.profiles
     set home_city        = city,
         home_lat         = lat,
         home_lon         = lon,
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
-- 5. The backfill, now.
--
-- Applying this migration is what makes "הכי קרוב אליי" work for the branches
-- already in the table. It is the same call the import makes from now on
-- (scripts/ingest/run.mjs), so a new branch is placed the day it appears.
-- --------------------------------------------------------------------------
do $$
declare
  placed integer;
begin
  -- The function's own guard is for callers; applying a migration is already the owner.
  with candidate as (
    select b.id, t.lat, t.lon
      from public.branches b
      join lateral (
        select tc.lat, tc.lon
          from public.town_centres tc
         where tc.norm_name = public.norm_place(b.city)
            or public.norm_place(b.city) like tc.norm_name || ' %'
         order by length(tc.norm_name) desc
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

  get diagnostics placed = row_count;
  raise notice '0045: placed % branches at their town centre', placed;
end
$$;

-- Profiles that already hold a town and no point get the same treatment, once.
update public.profiles p
   set home_lat = tc.lat,
       home_lon = tc.lon
  from public.town_centres tc
 where p.home_lat is null
   and p.home_city is not null
   and tc.norm_name = public.norm_place(p.home_city);
