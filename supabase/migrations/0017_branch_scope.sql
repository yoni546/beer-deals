-- ---------------------------------------------------------------------------
-- 0017 · Where a promotion is actually available (release 0.9.0)
--
-- Until 0.8.0 a promotion seen at one sampled branch was shown as the chain's. This migration keeps the
-- evidence needed to say, truthfully, where it is:
--
--   1. The branch INVENTORY: every branch the publisher's own Stores file lists (not only those we read).
--   2. BRANCH SCANS: for each scan, each known branch's outcome — read / unchanged / no promotions file /
--      not published / stale / failed — with the file names and times. "Not observed" is never "absent".
--   3. CANONICAL PROMOTIONS: one row per (chain, canonical key). The key is the ingestion's conservative
--      fingerprint (kind, the exact items, quantity, price, terms, start and end — never the price alone),
--      carried by each branch observation as its identity key.
--   4. OCCURRENCES: every branch whose current promotions file LISTS a public promotion on our beers — the
--      evidence of where it runs. Recorded whether or not that branch's copy passed our own price checks
--      (a check we could not complete at one branch is not evidence the chain does not run it there).
--   5. SCOPE: chainwide / participating_branches / single_branch / unknown, with the evidence and the
--      counts behind it (known, checked, matching, as of when). The rule lives in ONE function,
--      promotion_scope(); refresh_promotion_scope() applies it after every import.
--
-- Eligibility (who may redeem: audience, 0014) and scope (where) are independent: a universal promotion can
-- be single-branch, and scope is computed only for what is shown.
--
-- Additive: new columns, tables, functions and views; the three feed views are replaced with the same
-- columns plus the scope ones. Rollback: drop the new objects and re-run the views from 0015.
-- ---------------------------------------------------------------------------

-- 1. Branch inventory ------------------------------------------------------------------------------

alter table public.branches
  add column listed_in_stores_file boolean not null default false,
  add column source_listed_at      timestamptz;

-- 2. Branch scans -----------------------------------------------------------------------------------

create table public.branch_scans (
  id            bigint generated always as identity primary key,
  scan_id       text not null check (char_length(scan_id) between 1 and 80),
  store_id      uuid not null references public.stores (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  scanned_at    timestamptz not null,
  status        text not null check (status in ('ok', 'unchanged', 'no_promo_file', 'not_published', 'stale', 'failed')),
  price_file    text,
  promo_file    text,
  price_file_at timestamptz,
  promo_file_at timestamptz,
  reason        text check (reason is null or char_length(reason) <= 300),
  unique (scan_id, branch_id)
);
create index branch_scans_store on public.branch_scans (store_id, scanned_at desc);

alter table public.branch_scans enable row level security;
grant select on public.branch_scans to authenticated, service_role;
create policy branch_scans_read_admin on public.branch_scans for select to authenticated using (public.is_admin());

-- 3. Canonical promotions ----------------------------------------------------------------------------

create table public.promotions (
  id                    bigint generated always as identity primary key,
  store_id              uuid not null references public.stores (id) on delete cascade,
  canonical_key         text not null check (char_length(canonical_key) between 1 and 200),
  kind                  text not null check (kind in ('price', 'group')),
  description_he        text,
  valid_from            timestamptz,
  valid_to              timestamptz,
  -- Set only when the publisher itself states the promotion runs at every branch. No feed we read does
  -- today; the column exists so that evidence is used the day it appears, and never invented.
  source_declared_scope text check (source_declared_scope in ('chainwide')),
  scope                 text not null default 'unknown'
                        check (scope in ('chainwide', 'participating_branches', 'single_branch', 'unknown')),
  scope_evidence        text not null default 'insufficient_coverage'
                        check (scope_evidence in ('source_declared', 'observed_all_known_eligible_branches', 'observed_subset', 'insufficient_coverage')),
  branches_known        integer not null default 0 check (branches_known >= 0),
  branches_checked      integer not null default 0 check (branches_checked >= 0),
  branches_matching     integer not null default 0 check (branches_matching >= 0),
  coverage_ratio        numeric generated always as (case when branches_checked > 0 then round(branches_matching::numeric / branches_checked, 3) end) stored,
  coverage_as_of        timestamptz,
  only_branch_id        uuid references public.branches (id) on delete set null,
  first_seen_at         timestamptz not null default now(),
  refreshed_at          timestamptz not null default now(),
  unique (store_id, canonical_key),
  check (branches_checked <= branches_known or branches_known = 0)
);

alter table public.promotions enable row level security;
grant select on public.promotions to anon, authenticated, service_role;
create policy promotions_read on public.promotions for select to anon, authenticated using (true);

-- 4. The one rule -----------------------------------------------------------------------------------

/**
 * Where a promotion is, from what was checked. "בכל הרשת" (chainwide) needs either the publisher's own
 * statement, or the promotion at EVERY known branch with every known branch checked in the same scan.
 *   - a sample (checked < known), any source failure, or an incomplete inventory → never chainwide;
 *   - "only this branch" (single_branch) likewise needs EVERY known branch checked, and exactly one listing it;
 *   - seen at some, but not all, of several checked branches → participating_branches (it is certainly not
 *     chainwide, and certainly runs somewhere);
 *   - otherwise (one branch checked; or all checked have it but not all were checked) → unknown.
 */
create or replace function public.promotion_scope(
  p_source_declared text,
  p_known           integer,
  p_checked         integer,
  p_matching        integer,
  out scope          text,
  out scope_evidence text
)
language plpgsql
immutable
as $$
begin
  if p_source_declared = 'chainwide' then
    scope := 'chainwide'; scope_evidence := 'source_declared';
  elsif p_known > 0 and p_checked = p_known and p_matching = p_known then
    scope := 'chainwide'; scope_evidence := 'observed_all_known_eligible_branches';
  elsif p_known >= 2 and p_checked = p_known and p_matching = 1 then
    scope := 'single_branch'; scope_evidence := 'observed_subset';
  elsif p_checked >= 2 and p_matching >= 1 and p_matching < p_checked then
    scope := 'participating_branches'; scope_evidence := 'observed_subset';
  else
    scope := 'unknown'; scope_evidence := 'insufficient_coverage';
  end if;
end;
$$;

-- 5. Occurrences: a public promotion listed in a branch's promotions file ----------------------------------

create table public.promotion_occurrences (
  id                  bigint generated always as identity primary key,
  store_id            uuid not null references public.stores (id) on delete cascade,
  branch_id           uuid not null references public.branches (id) on delete cascade,
  canonical_key       text not null check (char_length(canonical_key) between 1 and 200),
  source_promotion_id text,
  source_file         text not null,               -- the branch's PromoFull file it was read from
  observed_at         timestamptz not null,
  valid_from          timestamptz,
  valid_to            timestamptz,
  kind                text not null check (kind in ('price', 'group')),
  price_agorot        integer,
  required_qty        integer,
  total_agorot        integer,
  conditions          jsonb not null default '{}'::jsonb, -- the terms as read (audience, basket, limit)
  published           boolean not null,           -- this branch's copy passed our checks and is shown
  reason              text check (reason is null or char_length(reason) <= 300),
  unique (branch_id, source_file, canonical_key, source_promotion_id)
);
create index promotion_occurrences_key on public.promotion_occurrences (store_id, canonical_key);

alter table public.promotion_occurrences enable row level security;
grant select on public.promotion_occurrences to anon, authenticated, service_role;
create policy promotion_occurrences_read on public.promotion_occurrences for select to anon, authenticated using (true);

-- 6. Scans and refresh (the import's write path; service role / admins only) ----------------------------

/**
 * Records one scan's outcome for every known branch of a chain, and the inventory itself.
 * p_branches: [{branch_id, status, price_file, promo_file, price_file_at, promo_file_at, reason}]
 */
create or replace function public.record_branch_scan(p_scan_id text, p_store_id uuid, p_scanned_at timestamptz, p_branches jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform public.require_price_writer();
  insert into public.branch_scans (scan_id, store_id, branch_id, scanned_at, status, price_file, promo_file, price_file_at, promo_file_at, reason)
  select p_scan_id, p_store_id, (b ->> 'branch_id')::uuid, p_scanned_at, b ->> 'status', b ->> 'price_file', b ->> 'promo_file',
         (b ->> 'price_file_at')::timestamptz, (b ->> 'promo_file_at')::timestamptz, left(b ->> 'reason', 300)
    from jsonb_array_elements(p_branches) b
    join public.branches br on br.id = (b ->> 'branch_id')::uuid and br.store_id = p_store_id
  on conflict (scan_id, branch_id) do update
     set status = excluded.status, price_file = excluded.price_file, promo_file = excluded.promo_file,
         price_file_at = excluded.price_file_at, promo_file_at = excluded.promo_file_at, reason = excluded.reason,
         scanned_at = excluded.scanned_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/** Records where public promotions were listed. p_rows: [{branch_id, canonical_key, source_promotion_id, source_file,
 *  observed_at, valid_from, valid_to, kind, price_agorot, required_qty, total_agorot, conditions, published, reason}] */
create or replace function public.record_promotion_occurrences(p_store_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform public.require_price_writer();
  insert into public.promotion_occurrences (store_id, branch_id, canonical_key, source_promotion_id, source_file, observed_at, valid_from, valid_to,
                                            kind, price_agorot, required_qty, total_agorot, conditions, published, reason)
  select p_store_id, (r ->> 'branch_id')::uuid, r ->> 'canonical_key', r ->> 'source_promotion_id', r ->> 'source_file',
         (r ->> 'observed_at')::timestamptz, (r ->> 'valid_from')::timestamptz, (r ->> 'valid_to')::timestamptz, r ->> 'kind',
         (r ->> 'price_agorot')::integer, (r ->> 'required_qty')::integer, (r ->> 'total_agorot')::integer,
         coalesce(r -> 'conditions', '{}'::jsonb), coalesce((r ->> 'published')::boolean, false), left(r ->> 'reason', 300)
    from jsonb_array_elements(p_rows) r
    join public.branches br on br.id = (r ->> 'branch_id')::uuid and br.store_id = p_store_id
  on conflict (branch_id, source_file, canonical_key, source_promotion_id) do update
     set published = excluded.published, reason = excluded.reason;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/**
 * The newest promotions file of a branch is its complete list of promotions: anything still standing
 * there from an older file, and not in this one, is over (superseded). Called once per branch read.
 */
create or replace function public.close_missing_promotions(p_branch_id uuid, p_observed_at timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prices integer;
  v_groups integer;
begin
  perform public.require_price_writer();
  update public.price_observations
     set status = 'superseded'
   where branch_id = p_branch_id and kind = 'promotion' and status = 'live' and observed_at < p_observed_at;
  get diagnostics v_prices = row_count;
  update public.promotion_groups
     set status = 'superseded'
   where branch_id = p_branch_id and status = 'live' and observed_at < p_observed_at;
  get diagnostics v_groups = row_count;
  return v_prices + v_groups;
end;
$$;

/**
 * Canonical promotions and their scope for one chain, from its latest scan: known = the branches that scan
 * accounted for (the whole inventory), checked = those whose current promotions file was read (re-read or
 * unchanged), matching = checked branches whose CURRENT file lists the promotion. Stale or failed branches
 * are not checked — never counted as having, or lacking, a promotion.
 */
create or replace function public.refresh_promotion_scope(p_store_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scan    text;
  v_as_of   timestamptz;
  v_known   integer;
  v_checked integer;
  v_count   integer;
begin
  perform public.require_price_writer();

  select s.scan_id, max(s.scanned_at) into v_scan, v_as_of
    from public.branch_scans s
   where s.store_id = p_store_id
   group by s.scan_id
   order by max(s.scanned_at) desc
   limit 1;

  select count(*), count(*) filter (where status in ('ok', 'unchanged'))
    into v_known, v_checked
    from public.branch_scans
   where store_id = p_store_id and scan_id = v_scan;

  -- One canonical row per promotion that is shown (a live, public observation), created on first sight.
  insert into public.promotions (store_id, canonical_key, kind, description_he, valid_from, valid_to)
  select distinct on (x.key) p_store_id, x.key, x.kind, x.description, x.valid_from, x.valid_to
    from (
      select o.identity_key as key, 'price' as kind, o.conditions ->> 'note_he' as description, o.valid_from, o.valid_to, o.observed_at
        from public.price_observations o
       where o.store_id = p_store_id and o.kind = 'promotion' and o.status = 'live' and o.audience = 'everyone'
      union all
      select g.natural_key, 'group', g.description_he, g.valid_from, g.valid_to, g.observed_at
        from public.promotion_groups g
       where g.store_id = p_store_id and g.status = 'live' and g.audience = 'everyone'
    ) x
   order by x.key, x.observed_at desc
  on conflict (store_id, canonical_key) do nothing;

  with current_listing as (
    -- each checked branch's current promotions file, and what it lists
    select occ.canonical_key, occ.branch_id
      from public.promotion_occurrences occ
      join public.branch_scans s on s.scan_id = v_scan and s.branch_id = occ.branch_id
                                and s.status in ('ok', 'unchanged') and s.promo_file = occ.source_file
     where occ.store_id = p_store_id
  ),
  matching as (
    select canonical_key, count(distinct branch_id)::integer as n, min(branch_id::text)::uuid as one_branch
      from current_listing
     group by canonical_key
  )
  update public.promotions p
     set branches_known    = coalesce(v_known, 0),
         branches_checked  = coalesce(v_checked, 0),
         branches_matching = coalesce(m.n, 0),
         scope             = sc.scope,
         scope_evidence    = sc.scope_evidence,
         coverage_as_of    = v_as_of,
         only_branch_id    = case when coalesce(m.n, 0) = 1 then m.one_branch end,
         refreshed_at      = now()
    from public.promotions p2
    left join matching m on m.canonical_key = p2.canonical_key
    cross join lateral public.promotion_scope(p2.source_declared_scope, coalesce(v_known, 0), coalesce(v_checked, 0), coalesce(m.n, 0)) sc
   where p.id = p2.id and p2.store_id = p_store_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.record_branch_scan(text, uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke execute on function public.close_missing_promotions(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.record_promotion_occurrences(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_promotion_occurrences(uuid, jsonb) to service_role, authenticated;
revoke execute on function public.refresh_promotion_scope(uuid) from public, anon, authenticated;
grant execute on function public.record_branch_scan(text, uuid, timestamptz, jsonb) to service_role, authenticated;
grant execute on function public.close_missing_promotions(uuid, timestamptz) to service_role, authenticated;
grant execute on function public.refresh_promotion_scope(uuid) to service_role, authenticated;
grant execute on function public.promotion_scope(text, integer, integer, integer) to anon, authenticated, service_role;

-- 7. The feeds carry the scope --------------------------------------------------------------------------

create or replace view public.offers_feed
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

create or replace view public.group_offers_feed
with (security_invoker = on)
as
select distinct on (g.store_id, g.natural_key)
  'grp:' || g.id::text                       as offer_key,
  g.id                                       as group_id,
  g.store_id,
  st.slug                                    as store_slug,
  st.name_he                                 as store_name,
  g.description_he,
  g.required_qty,
  g.total_agorot,
  ceil(g.total_agorot::numeric / g.required_qty)::integer as per_unit_agorot,
  g.deposit_agorot,
  g.deposit_included,
  g.valid_from,
  g.valid_to,
  g.observed_at,
  (src.slug = 'sample-data')                 as is_sample,
  items.beer_ids,
  items.beer_slugs,
  items.packs,
  count(*) over (partition by g.store_id, g.natural_key)::integer as branch_count,
  g.branch_id,
  bn.name_he                                 as branch_name,
  bn.city                                    as branch_city,
  pr.id                                      as promotion_id,
  pr.scope,
  pr.scope_evidence,
  pr.branches_known,
  pr.branches_checked,
  pr.branches_matching,
  pr.coverage_as_of,
  ob.name_he                                 as only_branch_name,
  ob.city                                    as only_branch_city
from public.promotion_groups g
join public.stores  st  on st.id  = g.store_id
left join public.branches bn on bn.id = g.branch_id
join public.sources src on src.id = g.source_id
left join public.promotions pr on pr.store_id = g.store_id and pr.canonical_key = g.natural_key
left join public.branches ob on ob.id = pr.only_branch_id
cross join lateral (
  select array_agg(distinct k.beer_id)  as beer_ids,
         array_agg(distinct be.slug)    as beer_slugs,
         jsonb_agg(jsonb_build_object('sku_id', k.id, 'beer_slug', be.slug, 'beer_name', be.name_he, 'label', k.display_he,
                                      'container', k.container, 'volume_ml', k.volume_ml, 'pack_quantity', k.pack_quantity)
                   order by be.slug, k.volume_ml, k.pack_quantity) as packs
    from public.promotion_group_items gi
    join public.skus k on k.id = gi.sku_id
    join public.product_categories pc on pc.slug = k.category and pc.in_scope
    join public.beers be on be.id = k.beer_id
   where gi.group_id = g.id
) items
where g.status = 'live'
  and g.audience = 'everyone'
  and items.packs is not null
  and (g.valid_from is null or g.valid_from <= now())
  and ((g.valid_to is not null and g.valid_to > now()) or (g.valid_to is null and g.observed_at > now() - interval '7 days'))
order by g.store_id, g.natural_key, g.total_agorot, g.observed_at desc;

-- The branches whose current promotions file lists a promotion, for the "where" sheet (names and cities).
-- Current = the file the chain's latest scan names for that branch (branch_scans is not public; this view
-- exposes only the promotion, the branch and when).
create or replace view public.promotion_branches
as
select distinct on (pr.id, occ.branch_id)
       pr.id           as promotion_id,
       occ.branch_id,
       bn.name_he      as branch_name,
       bn.city         as branch_city,
       occ.observed_at
  from public.promotion_occurrences occ
  join public.promotions pr on pr.store_id = occ.store_id and pr.canonical_key = occ.canonical_key
  join public.branches bn on bn.id = occ.branch_id
  join public.branch_scans s on s.branch_id = occ.branch_id and s.promo_file = occ.source_file and s.status in ('ok', 'unchanged')
   and s.scan_id = (select s2.scan_id from public.branch_scans s2 where s2.store_id = occ.store_id order by s2.scanned_at desc limit 1)
 order by pr.id, occ.branch_id, occ.observed_at desc;

grant select on public.promotion_branches to anon, authenticated, service_role;
