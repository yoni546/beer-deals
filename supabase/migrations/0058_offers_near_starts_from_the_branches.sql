-- ---------------------------------------------------------------------------
-- 0058 — the map's query starts from the branches near you, not from every
--        promotion in the country
--
-- MEASURED, production, 2026-10-25, the moment 0057 was applied. The function
-- exists and answers with a timeout:
--
--   offers_near(32.0853, 34.7818, 15, 400)  →  57014, statement timeout
--
-- Taken apart over REST, the cost is in exactly one place:
--
--   offers_catalog                 542 rows   0.5 s
--   branches with a position     1,016 rows   0.3 s
--   promotion_branches                        TIMES OUT on its own
--
-- WHAT promotion_branches COSTS. It is a view (0017) over every promotion
-- occurrence ever recorded, with a DISTINCT ON per (promotion, branch) and a
-- correlated subquery per row to find each chain's newest scan. Asked for its
-- whole self it is not cheap, and 0057 joined the whole of it to the catalogue
-- and only then narrowed to the branches in range. The narrowing has to come
-- first: there are a thousand branches and a handful are near any point.
--
-- SO THE QUERY IS INVERTED. `here` is the branches inside the radius — one scan
-- of a small table — and the view is reached with a branch_id already in hand,
-- which it can push into its own scan because branch_id is part of its DISTINCT
-- ON key. A cheap bounding box runs before the trigonometry; `km_between` then
-- answers exactly, once per branch instead of twice per row.
--
-- AND TWO INDEXES IT HAD NO WAY TO USE. promotion_occurrences was indexed on
-- (store_id, canonical_key) only — the chain page's question. "Which promotions
-- does THIS branch have" had no index at all and meant a sequential scan.
-- branch_scans had (store_id, scanned_at) for the same reason.
--
-- Nothing about the ANSWER changes: same rows, same order, same refusals. A
-- branch we cannot place is still absent, no point still means no rows, and
-- radius 0 still means no limit — the bounding box is skipped in that case
-- rather than being built from an infinite side.
--
-- Additive: two indexes and one function redefined. Safe to run twice.
-- ---------------------------------------------------------------------------

-- "Which promotions does this branch have", which nothing indexed before.
create index if not exists promotion_occurrences_branch
  on public.promotion_occurrences (branch_id);

-- The view's other join: this branch's row in a scan, by the file it names.
create index if not exists branch_scans_branch_file
  on public.branch_scans (branch_id, promo_file);

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
       -- One degree of latitude is ~111 km; of longitude, ~111 km × cos(lat).
       and (coalesce(p_radius_km, 0) = 0 or (
             b.latitude between p_lat - (p_radius_km / 111.0) and p_lat + (p_radius_km / 111.0)
         and b.longitude between p_lon - (p_radius_km / (111.0 * greatest(cos(radians(p_lat)), 0.01)))
                            and p_lon + (p_radius_km / (111.0 * greatest(cos(radians(p_lat)), 0.01)))
       ))
  )
  select h.id,
         h.name_he,
         h.city,
         h.latitude,
         h.longitude,
         h.geocode_precision,
         h.km,
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
    from here h
    join public.promotion_branches pb on pb.branch_id = h.id
    join public.offers_catalog c on c.promotion_id = pb.promotion_id
   where coalesce(p_radius_km, 0) = 0 or h.km <= p_radius_km
   -- Nearest first, and within one branch the best saving first, so a pin that
   -- shows a single deal shows that branch's best one.
   order by h.km asc, c.value_pct desc nulls last, c.effective_agorot asc
   limit greatest(coalesce(p_limit, 400), 1);
$$;

comment on function public.offers_near(double precision, double precision, double precision, integer) is
  'Live chain deals at branches within p_radius_km of a point, nearest first. One row '
  'per branch per deal. Starts from the branches in range, because promotion_branches '
  'is expensive asked for its whole self (0058). Branches with no position are omitted: '
  'a map can only draw what it can place, and a pin in the wrong place is worse than none.';

grant execute on function public.offers_near(double precision, double precision, double precision, integer)
  to anon, authenticated, service_role;
