-- ---------------------------------------------------------------------------
-- 0042 — the dashboard answers the questions it was asked to answer.
--
-- The brief lists what the admin dashboard should show, and ends with a rule
-- that decides the shape of this migration: "Do not add vanity metrics that
-- cannot be correctly calculated."
--
-- So, item by item, what the data can and cannot support:
--
--   CAN     most popular beer      — by how many people have it as favourite #1,
--                                    which is the only sense in which this app has
--                                    a popular beer: #1 is the app (PRODUCT.md).
--   CAN     most popular chain     — by live offers people can actually use.
--   CAN     most active town       — by people who said where they live.
--   CAN     highest Deal Score     — straight from offer_scores (0027).
--   CAN     strongest contributors — contributors, already ranked (0030).
--   CAN     new registrations, new/approved/rejected/removed deals, reports,
--           notifications sent — all already counted in admin_overview (0025).
--
--   CANNOT  "active users today" / "this week". Nothing records a visit. There is
--           no session table, no page-view log, and the app deliberately collects
--           none. Counting people who DID something (submitted, reported, set a
--           name) and calling it "active users" would be a different number
--           wearing that label, and the dashboard's whole problem in 0.11.1 was
--           four numbers that did not mean what they said. It is left out, and
--           the screen says why rather than leaving a gap somebody fills in with
--           an assumption.
--
-- Every figure here is a count over rows that exist, with its window stated.
-- ---------------------------------------------------------------------------

create or replace function public.admin_highlights()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  perform public.require_admin();

  select jsonb_build_object(
    'top_beer', (
      -- Favourite #1 only. #2–#4 shape the app and are a different question; mixing
      -- them would make "popular" mean two things at once.
      select jsonb_build_object('name', b.name_he, 'slug', b.slug, 'people', count(*))
        from public.user_favorite_beers f
        join public.beers b on b.id = f.beer_id
       where f.rank = 1
       group by b.name_he, b.slug
       order by count(*) desc, b.name_he
       limit 1
    ),
    'top_store', (
      -- By what somebody could actually buy today, not by how much we have stored.
      select jsonb_build_object('name', s.name_he, 'slug', s.slug, 'offers', count(*))
        from public.offers_feed o
        join public.stores s on s.id = o.store_id
       group by s.name_he, s.slug
       order by count(*) desc, s.name_he
       limit 1
    ),
    'top_city', (
      select jsonb_build_object('city', p.home_city, 'people', count(*))
        from public.profiles p
       where p.home_city is not null and p.onboarded_at is not null
       group by p.home_city
       order by count(*) desc, p.home_city
       limit 1
    ),
    'best_score', (
      select jsonb_build_object(
               'score', sc.score,
               'band', sc.band,
               'beer', o.beer_name,
               'store', o.store_name,
               'offer_key', sc.offer_key
             )
        from public.offer_scores sc
        join public.offers_feed o on o.offer_key = sc.offer_key
       order by sc.score desc
       limit 1
    ),
    'top_contributors', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.display_name, 'score', c.score, 'approved', c.approved)
                       order by c.score desc, c.approved desc)
        from (select * from public.contributors where score > 0 order by score desc, approved desc limit 3) c
    ), '[]'::jsonb),
    -- Said in the payload rather than assumed by the screen: there is no visit
    -- log, so "active users" is a number this system cannot produce honestly.
    'activity_measurable', false,
    'as_of', now()
  ) into result;

  return result;
end;
$$;

revoke execute on function public.admin_highlights() from public, anon;
grant execute on function public.admin_highlights() to authenticated;
