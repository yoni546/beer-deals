-- ---------------------------------------------------------------------------
-- 0023 · The public (anon) role cannot execute the signed-in and admin functions at all
--
-- Postgres grants EXECUTE on every new function to PUBLIC. 0002 granted these to `authenticated` but never
-- took the PUBLIC grant back, so the anonymous REST role could call them. Each already refuses inside
-- (require_admin / require_super_admin / "not signed in"), so nothing was reachable — this removes the
-- door rather than relying on the lock (production audit, 2026-10-06).
--
-- `authenticated` keeps its grant: this app's visitors have an anonymous Supabase SESSION, which is the
-- authenticated role. Additive in effect (no behaviour a legitimate caller relies on changes).
-- Rollback: grant execute on the same functions to public.
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_update_deal(uuid, uuid, uuid, public.deal_category, integer, integer, text) from public, anon;
revoke execute on function public.approve_deal(uuid) from public, anon;
revoke execute on function public.grant_admin(text, public.admin_level) from public, anon;
revoke execute on function public.resolve_report(uuid, public.report_status) from public, anon;
revoke execute on function public.revoke_admin(uuid) from public, anon;
revoke execute on function public.save_preferences(text, uuid[]) from public, anon;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke execute on function public.set_deal_status(uuid, public.deal_status) from public, anon;
revoke execute on function public.set_weekly_deal(uuid) from public, anon;
revoke execute on function public.update_notification_settings(integer, integer, integer) from public, anon;
