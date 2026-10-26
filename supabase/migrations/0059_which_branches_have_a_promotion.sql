-- ---------------------------------------------------------------------------
-- 0059 — which branches have a promotion, computed once per import
--
-- MEASURED, production, 2026-10-25. 0058 inverted the map's query to start from
-- the branches in range, and it still times out at the 3-second ceiling anon
-- reads under:
--
--   offers_near(32.0853, 34.7818, 15)   →  57014, after 3.9 s
--
-- WHY INVERTING IT WAS NOT ENOUGH, which is the useful part. Taken apart over
-- REST:
--
--   promotion_occurrences                        225,419 rows
--   promotion_branches filtered to ONE branch     28 rows, 0.40 s  ← fast
--   promotion_branches joined to a set of them               times out
--
-- A constant filter is fast because it is pushed into the view. A JOIN predicate
-- is not, and cannot be: `promotion_branches` is a DISTINCT ON over every
-- occurrence ever recorded, and Postgres cannot pull a DISTINCT ON subquery up
-- into the outer query, so it has no way to parameterise it per branch. It
-- evaluates the whole thing — a sort of 225,419 rows — and only then joins. No
-- index fixes that, because nothing is being looked up.
--
-- SO IT IS A TABLE NOW, which is exactly what 0044 did to the feed for exactly
-- this reason: the expensive half is computed at the end of an import instead of
-- on every read. The pairs are small — one row per (promotion, branch) actually
-- observed, against a quarter of a million occurrences — and a plain index
-- answers "which promotions does this branch have" in microseconds.
--
-- STALENESS, SAID PLAINLY. Between imports this is as old as the last one, which
-- is already true of every price in the app. The view it is built from stays,
-- and stays the definition: this table is only its answer, cached.
--
-- The delete says WHERE on purpose. An unqualified one is refused through
-- PostgREST by Supabase's safeupdate guard, which cost this project twelve days
-- of silently unpublished prices (0055).
--
-- Filled at the end of this file, so the map works the moment this is pasted
-- rather than at the next import.
-- ---------------------------------------------------------------------------

create table if not exists public.promotion_branch_pins (
  promotion_id bigint not null,
  branch_id    uuid   not null,
  observed_at  timestamptz,
  primary key (branch_id, promotion_id)
);

comment on table public.promotion_branch_pins is
  'Which branches a promotion was observed at — promotion_branches (0017), computed '
  'once per import instead of per read. The view is still the definition; this is its '
  'answer. Never written by hand: refresh_promotion_branches() rebuilds it (0059).';

create index if not exists promotion_branch_pins_promotion
  on public.promotion_branch_pins (promotion_id);

-- Public, like everything it is derived from: where a shop is and what it is
-- selling are both already world-readable by policy.
grant select on public.promotion_branch_pins to anon, authenticated, service_role;

alter table public.promotion_branch_pins enable row level security;

drop policy if exists promotion_branch_pins_read on public.promotion_branch_pins;
create policy promotion_branch_pins_read on public.promotion_branch_pins
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Rebuild it. Same guard as the prices it is derived from (0008): whoever may
-- write a price may write what we computed from it.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_promotion_branches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  written integer;
begin
  perform public.require_price_writer();

  -- One transaction: readers keep seeing the previous pairs until it commits, and
  -- a failure leaves the old ones rather than an empty map.
  --
  -- The WHERE is not a filter, it is a password — see 0055. Every row has a
  -- branch_id, so this clears the table, which is what a rebuild is.
  delete from public.promotion_branch_pins where branch_id is not null;
  insert into public.promotion_branch_pins (promotion_id, branch_id, observed_at)
  select pb.promotion_id, pb.branch_id, pb.observed_at
    from public.promotion_branches pb;
  get diagnostics written = row_count;

  return written;
end;
$$;

revoke execute on function public.refresh_promotion_branches() from public, anon;
grant execute on function public.refresh_promotion_branches() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The map's query, now reading the table.
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
  with here as materialized (
    select b.id, b.name_he, b.city, b.latitude, b.longitude, b.geocode_precision,
           public.km_between(p_lat, p_lon, b.latitude, b.longitude) as km
      from public.branches b
     where b.is_active
       and b.latitude is not null
       and b.longitude is not null
       -- A point is required. Without one there is no "near", and returning the
       -- whole country unordered would be the bug this function exists to prevent.
       and p_lat is not null
       and p_lon is not null
       -- A box before the trigonometry, and only when there is a radius to box.
       and (coalesce(p_radius_km, 0) = 0 or (
             b.latitude between p_lat - (p_radius_km / 111.0) and p_lat + (p_radius_km / 111.0)
         and b.longitude between p_lon - (p_radius_km / (111.0 * greatest(cos(radians(p_lat)), 0.01)))
                            and p_lon + (p_radius_km / (111.0 * greatest(cos(radians(p_lat)), 0.01)))
       ))
  )
  select h.id, h.name_he, h.city, h.latitude, h.longitude, h.geocode_precision, h.km,
         c.offer_key, c.store_slug, c.store_name, c.beer_slug, c.beer_name, c.pack_label,
         c.effective_agorot, c.value_pct, c.promo_type, c.valid_to, c.observed_at
    from here h
    join public.promotion_branch_pins pb on pb.branch_id = h.id
    join public.offers_catalog c on c.promotion_id = pb.promotion_id
   where coalesce(p_radius_km, 0) = 0 or h.km <= p_radius_km
   order by h.km asc, c.value_pct desc nulls last, c.effective_agorot asc
   limit greatest(coalesce(p_limit, 400), 1);
$$;

grant execute on function public.offers_near(double precision, double precision, double precision, integer)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fill it once, now, so the map answers the moment this is pasted. Idempotent:
-- the delete runs first, and running this file twice simply rebuilds it.
-- ---------------------------------------------------------------------------
delete from public.promotion_branch_pins where branch_id is not null;
insert into public.promotion_branch_pins (promotion_id, branch_id, observed_at)
select pb.promotion_id, pb.branch_id, pb.observed_at from public.promotion_branches pb;
