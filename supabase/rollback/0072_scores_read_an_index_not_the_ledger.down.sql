-- Undo 0072. The Deal Score refresh goes back to reading the whole price
-- ledger, which on 2026-11-11 did not finish inside service_role's 120s.
drop index if exists public.price_obs_scores;
