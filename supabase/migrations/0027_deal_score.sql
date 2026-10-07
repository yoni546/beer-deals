-- ---------------------------------------------------------------------------
-- 0027 — the Deal Score: how good this deal really is, on one number we can
--        defend line by line.
--
-- WHAT IT IS NOT. It is not a number invented to put a badge on a card. Every
-- point comes from a measurement already on record, the weights are fixed and
-- written down (docs/DEAL-SCORE.md), and the same offer always scores the same.
-- A person who asks "why 94?" can be answered from the `basis` column.
--
-- NO VERIFIED REFERENCE, NO SCORE. An offer whose `value_pct` is null has no
-- trusted regular price to be measured against -- 0017 emits it only when the
-- reference is a chain feed or an admin, from the same branch or chain-wide,
-- seen within 14 days, and only when the raw discount lands between 1% and 70%.
-- Such an offer gets NO ROW here, not a guessed one. The UI shows the deal
-- without a score, the way it already shows a price without a percentage. This
-- is the same rule CLAUDE.md sets for discounts, applied one level up.
--
-- WHY A TABLE AND NOT A VIEW. 0018's header records what happened the last time
-- something recomputed over the ledger per request: the feeds timed out at
-- ~10,600 live promotions and ~32,000 regular prices. The historical component
-- here reads 180 days of the price ledger, which is far heavier still. It is
-- computed once per import and stored. Nothing on a page ever computes a score.
--
-- WHY offers_feed IS NOT TOUCHED. Joining this in would mean replacing the view
-- the whole app reads, whose cost 0018 and 0022 spent two migrations getting
-- down. The app reads scores separately -- one indexed read, keyed by the same
-- offer_key the feed already emits -- and merges them.
-- ---------------------------------------------------------------------------

create table if not exists public.offer_scores (
  -- 'obs:<observation_id>' or 'deal:<uuid>': exactly the key offers_feed emits.
  offer_key   text primary key,
  score       smallint not null check (score between 0 and 100),
  band        text not null check (band in ('amazing', 'very_good', 'fair', 'weak')),
  -- What the number was built from: each component's input and contribution, plus
  -- the weights used. This is the audit trail that makes the score explainable.
  basis       jsonb not null,
  computed_at timestamptz not null default now()
);

comment on table public.offer_scores is
  'How good each scorable offer is, 0-100, recomputed by the import. An offer with no trusted reference price is absent, never zero.';

create index if not exists offer_scores_rank_idx on public.offer_scores (score desc);

alter table public.offer_scores enable row level security;

grant select on public.offer_scores to anon, authenticated, service_role;

-- The same shape as every other read-model table: the world may read it, and only
-- the definer function below writes it.
create policy offer_scores_read on public.offer_scores
  for select to anon, authenticated using (true);

-- --------------------------------------------------------------------------
-- The formula, in one place.
--
-- Three components, each 0-100, each from a measurement already on record:
--
--   CHAIN (weight 0.25) -- offers_feed.value_pct: how far below this chain's own
--     trusted regular price the offer is. 50% off or better scores 100. It is the
--     weakest signal of the three: it is measured against a price the same chain
--     set, so a chain that raises its shelf price makes its own discount look
--     deeper.
--
--   MARKET (weight 0.45) -- offers_feed.market_value_pct: how far below the MEDIAN
--     of at least two OTHER chains' lowest current regular prices it is (0022). No
--     chain can inflate this one, which is why it carries the most weight. Negative
--     (dearer than the market) contributes nothing rather than going below zero.
--
--   HISTORY (weight 0.30) -- where this price sits against every price we have
--     recorded for this exact pack in the last 180 days, promotional and regular
--     alike. At or below the lowest we have ever seen: 100. At or above the median:
--     0. Linear between. This is the "is this actually a good price, or just a
--     good-looking discount" component, and it needs at least four observations
--     before it is allowed to speak.
--
-- Components that are not available are left out and the remaining weights are
-- renormalised, so an offer is never punished for data we do not hold. But an
-- offer with ONLY the chain's own claim is capped at 80: one self-reported signal
-- is not enough to call something exceptional.
--
-- Bands: 85+ amazing, 70+ very good, 45+ fair, below that weak.
-- --------------------------------------------------------------------------

create or replace function public.refresh_offer_scores()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  written integer;
begin
  -- Written by the import, or by an admin after a manual change. The same guard the
  -- price write path uses (0008): a score is part of the price picture, and whoever
  -- may write a price may write what we think of it.
  perform public.require_price_writer();

  with history as (
    -- Every price we hold for this pack, recently enough to still mean something.
    -- Both kinds: a promotion is only remarkable against what the pack usually costs
    -- AND against the best it has ever been.
    select p.sku_id,
           min(p.price_agorot)                                                  as lowest_agorot,
           (percentile_cont(0.5) within group (order by p.price_agorot))::integer as typical_agorot,
           count(*)::integer                                                    as samples
      from public.price_observations p
     where p.observed_at >= now() - interval '180 days'
       and p.status in ('live', 'superseded')
     group by p.sku_id
    having count(*) >= 4
  ),
  scored as (
    select
      f.offer_key,
      f.value_pct,
      f.market_value_pct,
      f.effective_agorot,
      h.lowest_agorot,
      h.typical_agorot,
      h.samples,
      -- CHAIN: 50% off or better is full marks.
      least(100.0, greatest(0.0, f.value_pct::numeric / 50.0 * 100.0)) as chain_points,
      case
        when f.market_value_pct is null then null
        else least(100.0, greatest(0.0, f.market_value_pct::numeric / 50.0 * 100.0))
      end as market_points,
      case
        when h.typical_agorot is null or h.typical_agorot <= h.lowest_agorot then null
        when f.effective_agorot <= h.lowest_agorot then 100.0
        when f.effective_agorot >= h.typical_agorot then 0.0
        else (h.typical_agorot - f.effective_agorot)::numeric
             / (h.typical_agorot - h.lowest_agorot)::numeric * 100.0
      end as history_points
      from public.offers_feed f
      left join history h on h.sku_id = f.sku_id
      -- The gate: a score needs a reference we trust, and an offer flagged for
      -- review is exactly the one we must not put a confident number on.
     where f.value_pct is not null
       and not f.needs_review
       and not f.is_sample
  ),
  weighted as (
    select
      s.*,
      (0.25
        + coalesce(case when s.market_points is null then 0 else 0.45 end, 0)
        + coalesce(case when s.history_points is null then 0 else 0.30 end, 0)) as total_weight,
      (s.chain_points * 0.25
        + coalesce(s.market_points * 0.45, 0)
        + coalesce(s.history_points * 0.30, 0)) as weighted_points
      from scored s
  ),
  final as (
    select
      w.offer_key,
      -- Renormalise over the components we actually had...
      least(
        100,
        greatest(
          0,
          round(
            case
              -- ...and cap a chain-only score: one self-reported signal cannot
              -- make something exceptional.
              when w.market_points is null and w.history_points is null
                then least(80.0, w.weighted_points / w.total_weight)
              else w.weighted_points / w.total_weight
            end
          )::integer
        )
      ) as score,
      jsonb_strip_nulls(jsonb_build_object(
        'chain',   jsonb_build_object('value_pct', w.value_pct, 'points', round(w.chain_points), 'weight', 0.25),
        'market',  case when w.market_points is null then null else
                     jsonb_build_object('value_pct', w.market_value_pct, 'points', round(w.market_points), 'weight', 0.45) end,
        'history', case when w.history_points is null then null else
                     jsonb_build_object('lowest_agorot', w.lowest_agorot, 'typical_agorot', w.typical_agorot,
                                        'samples', w.samples, 'points', round(w.history_points), 'weight', 0.30) end,
        'capped',  (w.market_points is null and w.history_points is null)
      )) as basis
      from weighted w
  )
  insert into public.offer_scores (offer_key, score, band, basis, computed_at)
  select f.offer_key,
         f.score,
         case
           when f.score >= 85 then 'amazing'
           when f.score >= 70 then 'very_good'
           when f.score >= 45 then 'fair'
           else 'weak'
         end,
         f.basis,
         now()
    from final f
  on conflict (offer_key) do update
     set score = excluded.score,
         band = excluded.band,
         basis = excluded.basis,
         computed_at = excluded.computed_at;

  get diagnostics written = row_count;

  -- An offer that has ended, or whose reference has gone stale, must not keep a
  -- score it can no longer justify.
  delete from public.offer_scores s
   where not exists (
     select 1 from public.offers_feed f
      where f.offer_key = s.offer_key and f.value_pct is not null and not f.needs_review
   );

  return written;
end;
$$;

revoke execute on function public.refresh_offer_scores() from public, anon;
grant execute on function public.refresh_offer_scores() to authenticated, service_role;
