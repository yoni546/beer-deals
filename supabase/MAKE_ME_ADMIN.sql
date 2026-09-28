-- ===========================================================================
-- Make yourself the Super Admin, and put a few demo deals on the shelf.
--
-- BEFORE running this, create your admin user in the dashboard:
--   Authentication -> Users -> Add user -> Create new user
--   (your email, a password, and tick "Auto Confirm User")
--
-- THEN change the email on the next line to that same address, and run the
-- whole file in the SQL Editor.
-- ===========================================================================

-- 👇 This must match the email you created in the dashboard. Change it if you
--    used a different one.
create temporary table my_email as select 'yoni1hayman@gmail.com'::text as email;


-- --------------------------------------------------------------------------
-- 1. Super Admin.
--
-- Looked up by email rather than pasted as a UUID, so there is no id to copy
-- wrong. Fails loudly if no such user exists, instead of quietly doing nothing.
-- --------------------------------------------------------------------------

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


-- --------------------------------------------------------------------------
-- 2. Demo deals, so the app has something to show before real ones arrive.
--
-- They are marked "מבצע לדוגמה" in the notes, so this one line removes them all
-- once you have real deals:
--
--     delete from public.deals where notes = 'מבצע לדוגמה';
--
-- notified_at is set to now() deliberately: these are fake, and nobody should
-- get a push about a deal that does not exist in any shop.
-- --------------------------------------------------------------------------

with me as (
  select user_id from public.admins where level = 'super_admin' order by created_at limit 1
),
demo (beer, store, cat, deal_agorot, regular_agorot) as (
  values
    ('goldstar',  'rami-levy',  'sixpack', 2490,  3990),
    ('goldstar',  'shufersal',  'sixpack', 2990,  3990),
    ('goldstar',  'yochananof', 'sixpack', 3290,  3990),
    ('goldstar',  'rami-levy',  'case',    8900, 13900),
    ('goldstar',  'makolet',    'single',   690,   990),
    ('maccabee',  'victory',    'sixpack', 2690,  3790),
    ('maccabee',  'rami-levy',  'case',    7900, 11900),
    ('heineken',  'shufersal',  'sixpack', 3990,  5490),
    ('heineken',  'tiv-taam',   'case',   14900, 19900),
    ('heineken',  'ampm',       'single',  1090,  1490),
    ('corona',    'yochananof', 'sixpack', 4290,  5990),
    ('corona',    'osher-ad',   'single',  1190,  1590),
    ('tuborg',    'osher-ad',   'sixpack', 2790,  3890),
    ('carlsberg', 'rami-levy',  'single',   590,   890),
    ('stella',    'carrefour',  'sixpack', 3690,  4990)
)
insert into public.deals (
  beer_id, store_id, category,
  deal_price_agorot, regular_price_agorot,
  status, approved_by, approved_at, notified_at, notes
)
select
  b.id, s.id, demo.cat::public.deal_category,
  demo.deal_agorot, demo.regular_agorot,
  'approved', me.user_id, now(), now(), 'מבצע לדוגמה'
from demo
join public.beers  b on b.slug = demo.beer
join public.stores s on s.slug = demo.store
cross join me;


-- --------------------------------------------------------------------------
-- 3. Pick a Weekly Deal.
--
-- The app never chooses this by itself — a trophy on a deal nobody vouched for
-- is worse than no trophy. This picks the best Goldstar six-pack once, to get
-- you started; after that you change it from the admin panel.
-- --------------------------------------------------------------------------

update public.app_settings
   set weekly_deal_id = (
     select d.id
       from public.deals d
       join public.beers b on b.id = d.beer_id
      where d.status = 'approved' and b.slug = 'goldstar' and d.category = 'sixpack'
      order by d.discount_percent desc
      limit 1
   ),
   weekly_deal_set_at = now()
 where id;


select count(*) || ' demo deals added' as result from public.deals where notes = 'מבצע לדוגמה';
