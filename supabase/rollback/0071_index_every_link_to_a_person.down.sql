-- Undo 0071 (account deletion becomes slow again on the price ledger).
drop index if exists public.price_obs_created_by;
drop index if exists public.deals_approved_by;
drop index if exists public.offer_feedback_reported_by;
drop index if exists public.deal_reports_resolved_by;
drop index if exists public.admins_added_by;
drop index if exists public.submission_blocks_blocked_by;
