-- ---------------------------------------------------------------------------
-- 0044 — the chain half of the feed is computed once per import, not per request
--
-- MEASURED, production, 2026-10-12:
--
--   explain analyze select store_slug, value_pct from public.offers_feed;
--   Execution Time: 15306.545 ms
--
-- Past Supabase's 8-second cancellation for anon and authenticated, on the app
-- real people use. The chain listing threw; every page touching the feed waited.
-- This is older than the V2 branch — the read model is 0009's — and was found
-- only when somebody walked through the app against a database with real volume.
--
-- WHERE THE TIME GOES. Production holds 18,627 live promotion rows and shows 526
-- offers. offers_ranked (0022) finds each row's reference price with two one-row
-- index probes, which is the right trade on a warm instance and the wrong one on
-- a cold free-tier disk: 18,627 random probes at roughly 0.8 ms each is the 15
-- seconds observed. scripts/bench/feed-at-scale.mjs reproduces the shape — at
-- production's promotion volume the same query is 575 ms here (in memory, warm),
-- and 49 ms when read from a table instead. Twelve times less work per request,
-- and more than that where a probe costs a seek.
--
-- WHAT CHANGES. Nothing about what the feed SAYS. The view is a UNION ALL of two
-- halves, and only the expensive one is stored:
--
--   * the chain half (offers_ranked, the DISTINCT ON, the branch and promotion
--     joins) becomes `offers_catalog`, a table filled by refresh_offers_catalog()
--     at the end of an ingestion run — the same shape offer_scores has used since
--     0027, for the same reason;
--   * the manual half (deals_public) stays LIVE in the view, so a deal an admin
--     approves still appears the moment they approve it. Freezing that half would
--     have traded a performance win for a moderation bug.
--
-- A TABLE, NOT A MATERIALIZED VIEW. `refresh materialized view concurrently`
-- cannot run inside a transaction, so it cannot be called from a function; the
-- non-concurrent form takes an ACCESS EXCLUSIVE lock and would stall every reader
-- for the length of the rebuild. A delete-and-insert inside one transaction takes
-- ordinary row locks, and readers see the previous rows until it commits.
--
-- STALENESS, SAID PLAINLY. Between imports the chain half is as old as the last
-- refresh. That is already true of every price in it — they are observations with
-- an `observed_at`, not live quotes — and `refreshed_at` records when the table
-- was last built so a screen can say so if it ever needs to.
--
-- Additive and reversible: one table, one function, one view redefined with the
-- same columns in the same order. Rolling back is restoring 0017's view.
-- ---------------------------------------------------------------------------

-- The chain half, by itself, so the refresh has something to select from and the
-- definition stays in one place rather than being duplicated into the function.
create or replace view public.offers_catalog_source
with (security_invoker = on)
as
select
  'obs:' || o.observation_id::text          as offer_key,
  'catalog'::text                           as origin,
  o.sku_id,
  o.beer_id, o.beer_slug, o.beer_name,
  o.store_id, o.store_slug, o.store_name,
  o.sku_name                                as pack_label,
  o.container, o.volume_ml, o.pack_quantity,
  o.effective_agorot,
  o.unit_price_per_liter_agorot,
  o.reference_agorot,
  o.reference_trust,
  o.value_pct,
  o.needs_review,
  o.market_reference_agorot,
  o.market_value_pct,
  o.promo_type,
  o.conditions,
  o.valid_from, o.valid_to,
  o.observed_at,
  o.is_sample,
  o.conditions ->> 'note_he'                as notes,
  o.variant,
  o.category,
  o.deposit_agorot,
  o.deposit_included,
  o.branch_count,
  o.branch_id,
  bn.name_he                                as branch_name,
  bn.city                                   as branch_city,
  pr.id                                     as promotion_id,
  pr.scope,
  pr.scope_evidence,
  pr.branches_known,
  pr.branches_checked,
  pr.branches_matching,
  pr.coverage_as_of,
  ob.name_he                                as only_branch_name,
  ob.city                                   as only_branch_city
from (
  select distinct on (r.sku_id, r.store_id, r.identity_key)
         r.*,
         count(*) over (partition by r.sku_id, r.store_id, r.identity_key)::integer as branch_count
    from public.offers_ranked r
   order by r.sku_id, r.store_id, r.identity_key, r.effective_agorot, r.value_pct desc nulls last, r.observed_at desc
) o
left join public.branches bn on bn.id = o.branch_id
left join public.promotions pr on pr.store_id = o.store_id and pr.canonical_key = o.identity_key
left join public.branches ob on ob.id = pr.only_branch_id
;

-- Same columns, same order, by construction.
create table if not exists public.offers_catalog as
  select * from public.offers_catalog_source with no data;

alter table public.offers_catalog
  add column if not exists refreshed_at timestamptz not null default now();

create unique index if not exists offers_catalog_key on public.offers_catalog (offer_key);
create index if not exists offers_catalog_store on public.offers_catalog (store_slug);
create index if not exists offers_catalog_beer on public.offers_catalog (beer_slug);

-- Public, like the view it replaces: every row here comes from tables whose own
-- policy is `select … using (true)`. Nothing becomes visible that was not.
grant select on public.offers_catalog to anon, authenticated, service_role;

-- A table carries no RLS of its own, so this one is deliberately deny-all to
-- writers: it is filled only by the function below, which runs as the owner.
alter table public.offers_catalog enable row level security;

comment on table public.offers_catalog is
  'The chain half of offers_feed, computed once per import by refresh_offers_catalog(). '
  'Never written by hand: it is derived from offers_catalog_source.';

-- ---------------------------------------------------------------------------
-- Rebuild it. Guarded by the same rule as the prices it is derived from (0008):
-- whoever may write a price may write what we computed from it.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_offers_catalog()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  written integer;
begin
  perform public.require_price_writer();

  -- One transaction: readers keep seeing the previous rows until it commits, and
  -- a failure leaves the old ones in place rather than an empty feed.
  delete from public.offers_catalog;
  insert into public.offers_catalog
  select s.*, now() from public.offers_catalog_source s;
  get diagnostics written = row_count;

  return written;
end;
$$;

revoke execute on function public.refresh_offers_catalog() from public, anon;
grant execute on function public.refresh_offers_catalog() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The feed itself: the stored chain half, and the manual half still live.
-- ---------------------------------------------------------------------------
create or replace view public.offers_feed
with (security_invoker = on)
as
select
  offer_key, origin, sku_id,
  beer_id, beer_slug, beer_name,
  store_id, store_slug, store_name,
  pack_label,
  container, volume_ml, pack_quantity,
  effective_agorot,
  unit_price_per_liter_agorot,
  reference_agorot,
  reference_trust,
  value_pct,
  needs_review,
  market_reference_agorot,
  market_value_pct,
  promo_type,
  conditions,
  valid_from, valid_to,
  observed_at,
  is_sample,
  notes,
  variant,
  category,
  deposit_agorot,
  deposit_included,
  branch_count,
  branch_id,
  branch_name,
  branch_city,
  promotion_id,
  scope,
  scope_evidence,
  branches_known,
  branches_checked,
  branches_matching,
  coverage_as_of,
  only_branch_name,
  only_branch_city
from public.offers_catalog

union all


select
  'deal:' || d.id::text,
  'legacy',
  null::uuid,
  d.beer_id, d.beer_slug, d.beer_name,
  d.store_id, d.store_slug, d.store_name,
  case d.category when 'sixpack' then 'שישייה' when 'case' then 'ארגז' else 'בודד' end,
  null::public.container_type, null::integer, null::integer,
  d.deal_price_agorot,
  null::integer,
  d.regular_price_agorot,
  'moderated',
  case when d.discount_percent between 1 and 70 then d.discount_percent end,
  d.discount_percent > 70,
  null::integer, null::integer,
  null::public.promo_type,
  '{}'::jsonb,
  null::timestamptz, null::timestamptz,
  d.approved_at,
  coalesce(d.notes = 'מבצע לדוגמה', false),
  d.notes,
  '',
  'beer',
  null::integer,
  null::boolean,
  1,
  null::uuid,
  null::text,
  null::text,
  null::bigint,
  null::text,
  null::text,
  null::integer,
  null::integer,
  null::integer,
  null::timestamptz,
  null::text,
  null::text
from public.deals_public d;
-- ---------------------------------------------------------------------------
-- Fill it now.
--
-- Without this the feed's chain half is EMPTY between applying this migration
-- and the next import — every chain offer gone from every screen, for hours,
-- with nothing on fire to explain it. The migration pays the cost once (about
-- fifteen seconds on production, which is the very number that justified the
-- change) so that nobody else does.
--
-- Not through refresh_offers_catalog(): that guards on require_price_writer(),
-- and a migration runs as the owner with no auth.uid() to check.
-- ---------------------------------------------------------------------------
insert into public.offers_catalog
select s.*, now() from public.offers_catalog_source s
on conflict (offer_key) do nothing;

-- ---------------------------------------------------------------------------
-- WHAT GOES STALE, AND FOR HOW LONG
--
-- The stored half carries names as well as prices — beer_name, store_name,
-- branch_name — so renaming a beer in the admin panel now shows on the chain
-- offers at the next import rather than at once. Prices themselves were already
-- only as fresh as the last import (they are observations with an observed_at,
-- not live quotes), so nothing about a PRICE got staler here.
--
-- That is a real regression in one narrow place, accepted knowingly: a rename is
-- rare, /admin/beers always shows the truth, and the alternative — rebuilding
-- fifteen seconds of table inside an admin's click — is worse than a name that
-- catches up overnight. The cleaner answer is to store ids here and join the
-- names live in the view; it is a bigger change than this one and belongs on its
-- own, with its own measurement.
-- ---------------------------------------------------------------------------
