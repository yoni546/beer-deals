-- ---------------------------------------------------------------------------
-- 0011 — what the redesigned screens need from the database.
--
--   * save_preferences() : the name becomes optional (one fewer thing to type
--     during onboarding).
--   * regular_prices_feed : regular (non-promotional) prices with the names,
--     pack, unit price and freshness the beer and store pages display.
--
-- Additive, like 0007–0010. Rollback: drop the view and restore the previous
-- save_preferences() body from 0010.
--
-- History: an earlier draft of this file (never applied to a hosted database) also added
-- profiles.theme_override and profiles.appearance for a manual theme picker. That picker was
-- removed before release: favourite #1 alone decides the app's look (PRODUCT.md). If a
-- database was ever built from that draft, docs/STAGING.md has the one-line cleanup.
-- ---------------------------------------------------------------------------

-- The name is optional now. An empty string would violate the column's length
-- check, so it is stored as NULL ("no name yet"), which the app already handles.
create or replace function public.save_preferences(
  p_first_name text,
  p_beer_ids   uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  i   integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_beer_ids is null or array_length(p_beer_ids, 1) <> 4 then
    raise exception 'choose exactly four beers' using errcode = '22023';
  end if;

  if (select count(distinct b) from unnest(p_beer_ids) b) <> 4 then
    raise exception 'the four beers must be different' using errcode = '22023';
  end if;

  update public.profiles
     set first_name   = nullif(trim(p_first_name), ''),
         onboarded_at = coalesce(onboarded_at, now())
   where id = uid;

  delete from public.user_favorite_beers where profile_id = uid;

  for i in 1 .. 4 loop
    insert into public.user_favorite_beers (profile_id, beer_id, rank)
    values (uid, p_beer_ids[i], i::smallint);
  end loop;
end;
$$;

-- Regular prices, ready to show. `is_stale` = not confirmed within the last 14
-- days: the app still lists it (it is the last known price) but labels it, and it
-- no longer counts as a reference for a discount (see offers_ranked).
create view public.regular_prices_feed
with (security_invoker = on)
as
select
  r.id                        as observation_id,
  r.sku_id,
  s.beer_id,
  be.slug                     as beer_slug,
  be.name_he                  as beer_name,
  s.container,
  s.volume_ml,
  s.pack_quantity,
  s.display_he                as pack_label,
  r.store_id,
  st.slug                     as store_slug,
  st.name_he                  as store_name,
  r.branch_id,
  r.price_agorot,
  round(r.price_agorot::numeric * 1000 / s.total_volume_ml)::integer as unit_price_per_liter_agorot,
  r.observed_at,
  r.is_sample,
  case src.kind when 'chain_feed' then 'feed' when 'admin' then 'moderated' else 'unverified' end as trust,
  (r.observed_at < now() - interval '14 days') as is_stale
from public.regular_prices_current r
join public.skus    s   on s.id   = r.sku_id
join public.beers   be  on be.id  = s.beer_id
join public.stores  st  on st.id  = r.store_id
join public.sources src on src.id = r.source_id;

grant select on public.regular_prices_feed to anon, authenticated, service_role;
