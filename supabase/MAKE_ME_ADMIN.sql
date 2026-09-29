-- ===========================================================================
-- Make yourself the Super Admin.
--
-- BEFORE running this, create your admin user in the dashboard:
--   Authentication -> Users -> Add user -> Create new user
--   (your email, a password, and tick "Auto Confirm User")
--
-- THEN change the email on the next line to that same address, and run the
-- whole file in the SQL Editor.
--
-- This file used to ALSO insert 15 invented "sample" deals. Those reached
-- production and were shown to real users as real prices, so that part now
-- lives in supabase/seed/dev-demo-deals.sql, which refuses to run unless you
-- explicitly confirm the database is not production.
-- ===========================================================================

-- 👇 This must match the email you created in the dashboard.
create temporary table my_email as select 'you@example.com'::text as email;


do $$
declare
  target uuid;
begin
  select u.id into target
    from auth.users u, my_email m
   where lower(u.email) = lower(trim(m.email));

  if target is null then
    raise exception
      'No user with that email. Create it first: Authentication -> Users -> Add user.';
  end if;

  insert into public.admins (user_id, level, added_by)
  values (target, 'super_admin', target)
  on conflict (user_id) do update set level = 'super_admin';

  raise notice 'You are now a super admin.';
end
$$;
