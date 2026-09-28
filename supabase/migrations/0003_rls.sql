-- ---------------------------------------------------------------------------
-- Beer Deals — Row Level Security.
--
-- Every table is locked by default and opened one policy at a time. The rule
-- the spec cares most about — "a submitted deal is not visible until an admin
-- approves it" — is a SELECT policy here, not a WHERE clause in a component.
-- If every line of the frontend were deleted, these rules would still hold.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Table privileges.
--
-- Two different questions, and both have to be answered. A GRANT decides
-- whether a role may touch the table at all; a POLICY decides which rows it
-- then sees. RLS on a table with no grant is unreachable, and a grant with no
-- policy is wide open — so each table below gets exactly the verbs it needs.
--
-- These are written out rather than left to Supabase's "automatically expose
-- new tables" setting, which hands every new table to the API by default. That
-- setting is off for this project on purpose: a table added later should be
-- invisible until somebody deliberately opens it, not the other way round. The
-- tests run against these same grants, so a missing one fails the suite instead
-- of production.
-- --------------------------------------------------------------------------

grant select on public.beers        to anon, authenticated;
grant select on public.stores       to anon, authenticated;
grant select on public.app_settings to anon, authenticated;
grant select on public.deals        to anon, authenticated;

-- Catalogue edits are an admin job, gated by the policies below.
grant insert, update, delete on public.beers  to authenticated;
grant insert, update, delete on public.stores to authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_favorite_beers to authenticated;

-- Reading the roster answers "am I an admin?". Writing it is possible only
-- through grant_admin()/revoke_admin(), which run as the owner — so no INSERT,
-- UPDATE or DELETE is granted here at all.
grant select on public.admins to authenticated;

-- INSERT is a submission; UPDATE and DELETE are admin-only by policy.
grant insert, update, delete on public.deals to authenticated;

grant select, insert, update on public.deal_reports to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Written only by the notification sender, which uses the service role.
grant select on public.push_log to authenticated;

alter table public.beers               enable row level security;
alter table public.stores              enable row level security;
alter table public.profiles            enable row level security;
alter table public.user_favorite_beers enable row level security;
alter table public.admins              enable row level security;
alter table public.deals               enable row level security;
alter table public.deal_reports        enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.app_settings        enable row level security;
alter table public.push_log            enable row level security;

-- --------------------------------------------------------------------------
-- Catalogue: world-readable, admin-writable.
-- --------------------------------------------------------------------------

create policy beers_read on public.beers
  for select to anon, authenticated using (true);

create policy beers_admin_write on public.beers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy stores_read on public.stores
  for select to anon, authenticated using (true);

create policy stores_admin_write on public.stores
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- Profiles: yours, and nobody else's.
--
-- Admins are deliberately NOT given read access to every profile. Moderating
-- deals does not require knowing who else uses the app; the notification sender
-- reads profiles with the service role, outside RLS, for the one job that needs
-- it.
-- --------------------------------------------------------------------------

create policy profiles_read_own on public.profiles
  for select to authenticated using (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- No INSERT policy: rows are created by the on_auth_user_created trigger.
-- No DELETE policy: profiles die with their auth user, by cascade.

create policy favorites_read_own on public.user_favorite_beers
  for select to authenticated using (profile_id = auth.uid());

create policy favorites_write_own on public.user_favorite_beers
  for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- --------------------------------------------------------------------------
-- Admins.
--
-- Readable by any signed-in user so the app can ask "am I an admin?" and so an
-- admin can see the roster. Writable only through grant_admin/revoke_admin,
-- which check is_super_admin() — there is no policy that permits a direct
-- INSERT here at all, which is the point: a regular admin cannot promote
-- themselves even if they craft the request by hand.
-- --------------------------------------------------------------------------

create policy admins_read on public.admins
  for select to authenticated using (true);

-- --------------------------------------------------------------------------
-- Deals — the central rule.
--
-- Three separate SELECT policies, which PostgreSQL ORs together:
--   * everyone sees approved deals,
--   * you see your own submissions whatever their status, so you can tell that
--     it arrived and is waiting,
--   * admins see everything, which is what makes a moderation queue possible.
-- --------------------------------------------------------------------------

create policy deals_read_approved on public.deals
  for select to anon, authenticated using (status = 'approved');

create policy deals_read_own on public.deals
  for select to authenticated using (created_by = auth.uid());

create policy deals_read_admin on public.deals
  for select to authenticated using (public.is_admin());

-- Anyone signed in may submit — but only as themselves, and only as pending.
-- The WITH CHECK is what makes "submitted deals are never published
-- automatically" true at the storage layer: a crafted insert asking for
-- status='approved' is rejected by the database.
create policy deals_submit on public.deals
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and status = 'pending'
    and approved_by is null
    and approved_at is null
  );

-- Regular users get no UPDATE and no DELETE, not even on their own submission.
-- Once it is in the queue it belongs to the moderators. Admin edits go through
-- admin_update_deal / set_deal_status.
create policy deals_admin_update on public.deals
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Deleting a deal destroys the record of who approved it. Admins deactivate
-- instead (status = 'inactive'); only a super admin may truly remove one.
create policy deals_super_admin_delete on public.deals
  for delete to authenticated using (public.is_super_admin());

-- --------------------------------------------------------------------------
-- Reports.
--
-- You may file one and see your own. You may not see other people's reports,
-- and you may not resolve anything — resolve_report() is the only way, and it
-- requires an admin.
-- --------------------------------------------------------------------------

create policy reports_read_own on public.deal_reports
  for select to authenticated using (reported_by = auth.uid());

create policy reports_read_admin on public.deal_reports
  for select to authenticated using (public.is_admin());

create policy reports_file on public.deal_reports
  for insert to authenticated
  with check (
    reported_by = auth.uid()
    and status = 'open'
    and exists (select 1 from public.deals d where d.id = deal_id and d.status = 'approved')
  );

create policy reports_admin_update on public.deal_reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- Push subscriptions: strictly your own devices. Nobody, admin included, reads
-- these through the API — the notification sender uses the service role.
-- --------------------------------------------------------------------------

create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy push_log_read_own on public.push_log
  for select to authenticated using (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- App settings.
--
-- The whole row is world-readable: the Weekly Deal is public by design, and the
-- notification thresholds are not secrets — knowing that a deal needs 25% off
-- to trigger a push tells you nothing you could abuse. Writes go through
-- set_weekly_deal (admin) and update_notification_settings (super admin).
-- --------------------------------------------------------------------------

create policy app_settings_read on public.app_settings
  for select to anon, authenticated using (true);

-- --------------------------------------------------------------------------
-- Deal images.
--
-- Public bucket, because deal photos are shown to everyone. Uploads are
-- restricted to signed-in users writing into a folder named after their own
-- user id, so one user cannot overwrite another's image.
-- --------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deal-images', 'deal-images', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

create policy "deal images are public"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'deal-images');

create policy "users upload deal images into their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'deal-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "admins manage deal images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'deal-images' and public.is_admin());
