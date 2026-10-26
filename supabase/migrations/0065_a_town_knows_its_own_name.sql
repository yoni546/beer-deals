-- ---------------------------------------------------------------------------
-- 0065 — a town pin knows its own name
--
-- MEASURED, production, minutes after 0064 shipped. The country view works —
-- 142 towns, 16,864 deals, 789 shops, 1.16 s — and thirty of those towns come
-- back named "0", including six of the ten largest:
--
--   580 deals at 31.2457, 34.7925      574 at 32.0878, 34.8860
--   501 at 32.1773, 34.9075            487 at 32.3286, 34.8566
--
-- Those are Beer Sheva, Petah Tikva, Kfar Saba, Netanya, Rishon LeZion and
-- Ashdod. On the screen they would have read "כאן".
--
-- WHY. The name came from `min(b.city)`, and some chains write "0" where the
-- town's name goes (0047). "0" sorts before every real value, so one branch
-- filing a zero renamed the whole town to nothing.
--
-- THE POINT ALREADY KNOWS. These coordinates are not approximations of a town —
-- they ARE town_centres rows, copied onto the branches by place_branches_by_town
-- (0045). So the name is a lookup on the coordinate, which is exact rather than
-- a guess, and it names all thirty. The city column stays as the fallback for a
-- branch that has a real street-level fix and so is not on a town's centre at
-- all; "0" is excluded there too, since it is not a name.
--
-- Nothing else changes: same rows, same counts, same order.
--
-- One function replaced. Safe to run twice.
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
    -- The town centre this point IS, else whatever the chains called it, and
    -- never "0" — which is a symbol some of them write instead of a name.
    coalesce(tc.name, min(nullif(btrim(b.city), '0')))  as town,
    b.latitude,
    b.longitude,
    count(distinct b.id)::integer                       as branches,
    count(*)::integer                                   as deals,
    max(c.value_pct)::integer                           as best_value_pct,
    min(c.effective_agorot)::integer                    as cheapest_agorot
    from public.branches b
    join public.promotion_branch_pins pb on pb.branch_id = b.id
    join public.offers_catalog c on c.promotion_id = pb.promotion_id
    left join public.town_centres tc
      on tc.lat = b.latitude and tc.lon = b.longitude
   where b.is_active
     and b.latitude is not null
     and b.longitude is not null
   group by b.latitude, b.longitude, tc.name
   order by count(*) desc
   limit 400;
$$;

grant execute on function public.deals_by_town() to anon, authenticated, service_role;
