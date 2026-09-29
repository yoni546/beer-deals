-- ===========================================================================
-- DEV / STAGING ONLY — sample deals with invented prices.
--
-- These are not real prices. They exist so a fresh local or staging database has
-- something on screen. They were once run against production by mistake (as
-- part of MAKE_ME_ADMIN.sql) and shown to real users as real deals; that is why
-- this file now refuses to run unless you say, explicitly, that it is safe.
--
-- To run it against a NON-production database, in the same SQL session:
--
--     set app.allow_demo_seed = 'yes';
--
-- and then the contents of this file. Requires at least one super admin (see
-- MAKE_ME_ADMIN.sql) so the approvals are attributed to a real user.
--
-- The production app also refuses to display rows carrying this note
-- (src/lib/demo.ts), so a mistaken run cannot show them to the public again.
-- ===========================================================================

do $$
begin
  if coalesce(current_setting('app.allow_demo_seed', true), '') <> 'yes' then
    raise exception
      'Refusing to insert sample deals. This file is for local/staging databases only. '
      'If this is definitely not production, run  set app.allow_demo_seed = ''yes'';  first, in the same session.';
  end if;
end
$$;

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
  -- notified_at = now(): nobody should get a push about a deal that does not exist.
  'approved', me.user_id, now(), now(), 'מבצע לדוגמה'
from demo
join public.beers  b on b.slug = demo.beer
join public.stores s on s.slug = demo.store
cross join me
-- Safe to run twice: one approved deal per beer + shop + pack.
on conflict (beer_id, store_id, category) where status = 'approved' do nothing;

select count(*) || ' sample deals present' as result from public.deals where notes = 'מבצע לדוגמה';
