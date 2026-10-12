-- ---------------------------------------------------------------------------
-- 0034 — managing the beers, from the panel.
--
-- WHAT WAS THERE. `beers_admin_write` (0003) is `for all` with `is_admin()`, so
-- an administrator has always been able to INSERT, UPDATE and DELETE a beer by
-- hand through PostgREST. There was no screen, no audit entry, and no guard
-- against the two edits that quietly break things:
--
--   DELETING A BEER. `user_favorite_beers` and `deals` reference it, so a delete
--     either fails on a foreign key or takes somebody's favourite with it. The
--     rest of this system deactivates instead and keeps the record (deals,
--     admins, the weekly pick). Beers now do the same: the DELETE policy is
--     gone, and `is_active = false` is the way out.
--
--   CHANGING A SLUG. The slug is the URL of /beer/<slug>, the key of the beer's
--     visual identity in src/design/themes.ts, and the filename of its bottle
--     photo. Changing it in the database alone silently takes away the beer's
--     whole appearance and breaks every link anybody shared. It is refused here
--     rather than merely discouraged.
--
-- WHAT AN ADMIN CANNOT DO FROM HERE, deliberately: give a beer its look. A
-- beer's identity (its palette and its bottle) is CODE -- `BEER_IDENTITIES` in
-- src/design/themes.ts -- and a photo is a reviewed asset with provenance
-- (CLAUDE.md). A colour picker in the panel would be a second source of truth
-- for the one thing this product is built around, and a photo field would be an
-- invitation to paste a hotlink. So the screen REPORTS which beers have neither,
-- and that is a list of work for a deploy, not a form.
--
-- DEACTIVATING IS NOT REMOVING. A beer that is switched off disappears from the
-- lists people choose from and from new prices -- and anybody who already picked
-- it keeps it, including as favourite #1, with its own look. That is the rule
-- 0014 set when Somersby turned out to be a cider, and it is why getBeerBySlug
-- reads every row rather than the list offered for choosing.
-- ---------------------------------------------------------------------------

-- The delete goes. Everything else about the old policy stays, split so the
-- missing verb is visible rather than implied.
drop policy if exists beers_admin_write on public.beers;

create policy beers_admin_insert on public.beers
  for insert to authenticated with check (public.is_admin());

create policy beers_admin_update on public.beers
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- No delete policy, for anybody. A beer is deactivated, never destroyed: deals
-- and other people's favourites point at it.
revoke delete on public.beers from authenticated;

-- --------------------------------------------------------------------------
-- What the screen needs to show, and what it needs to WARN about.
--
-- The counts are the whole point. "Switch this beer off" is a different decision
-- when four hundred people have it as their number one than when nobody has
-- chosen it, and the panel has never been able to tell the difference.
-- --------------------------------------------------------------------------

create or replace function public.admin_beers()
returns table (
  id            uuid,
  slug          text,
  name_he       text,
  name_en       text,
  category      text,
  sort_order    integer,
  is_active     boolean,
  brand_name_he text,
  variant       text,
  -- How many people chose it at all, and how many put it first. Favourite #1 is
  -- the app (PRODUCT.md), so those are not the same number.
  chosen_by     integer,
  first_for     integer,
  -- What would stop being reachable through it.
  live_offers   integer,
  packs         integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select b.id, b.slug, b.name_he, b.name_en, b.category, b.sort_order, b.is_active,
         br.name_he as brand_name_he,
         b.variant,
         (select count(*)::integer from public.user_favorite_beers f where f.beer_id = b.id),
         (select count(*)::integer from public.user_favorite_beers f where f.beer_id = b.id and f.rank = 1),
         (select count(*)::integer from public.offers_feed o where o.beer_id = b.id),
         (select count(*)::integer from public.skus k where k.beer_id = b.id and k.is_active)
    from public.beers b
    join public.brands br on br.id = b.brand_id
   order by b.is_active desc, b.sort_order, b.name_he;
end;
$$;

revoke execute on function public.admin_beers() from public, anon;
grant execute on function public.admin_beers() to authenticated;

-- --------------------------------------------------------------------------
-- Switching one off, and on again.
-- --------------------------------------------------------------------------

create or replace function public.admin_set_beer_active(p_beer_id uuid, p_active boolean)
returns public.beers
language plpgsql
security definer
set search_path = public
as $$
declare
  row    public.beers;
  before boolean;
  first_for integer;
begin
  perform public.require_admin();

  select b.is_active into before from public.beers b where b.id = p_beer_id;
  if before is null then
    raise exception 'beer not found' using errcode = 'P0002';
  end if;

  select count(*)::integer into first_for
    from public.user_favorite_beers f
   where f.beer_id = p_beer_id and f.rank = 1;

  update public.beers set is_active = p_active where id = p_beer_id returning * into row;

  -- How many people this was the app FOR, recorded at the moment it was switched
  -- off. The number changes afterwards, and the question "how many did this
  -- affect?" can only be answered from here.
  perform public.record_admin_action(
    case when p_active then 'beer.activate' else 'beer.deactivate' end,
    'beer', p_beer_id::text,
    jsonb_build_object('slug', row.slug, 'name_he', row.name_he, 'first_for', first_for)
  );

  return row;
end;
$$;

revoke execute on function public.admin_set_beer_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_beer_active(uuid, boolean) to authenticated;

-- --------------------------------------------------------------------------
-- Editing the things that are safe to edit.
--
-- The slug is not among them: see the header. Nor is the identity, which is code.
-- --------------------------------------------------------------------------

create or replace function public.admin_update_beer(
  p_beer_id    uuid,
  p_name_he    text,
  p_name_en    text,
  p_category   text,
  p_sort_order integer
)
returns public.beers
language plpgsql
security definer
set search_path = public
as $$
declare
  row    public.beers;
  before public.beers;
begin
  perform public.require_admin();

  select * into before from public.beers where id = p_beer_id;
  if before.id is null then
    raise exception 'beer not found' using errcode = 'P0002';
  end if;

  if nullif(trim(p_name_he), '') is null or nullif(trim(p_name_en), '') is null then
    raise exception 'שם הבירה בעברית ובאנגלית לא יכול להיות ריק.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.product_categories c where c.slug = p_category) then
    raise exception 'קטגוריה לא מוכרת.' using errcode = '22023';
  end if;

  update public.beers
     set name_he    = trim(p_name_he),
         name_en    = trim(p_name_en),
         category   = p_category,
         sort_order = p_sort_order
   where id = p_beer_id
  returning * into row;

  perform public.record_admin_action('beer.edit', 'beer', p_beer_id::text, jsonb_strip_nulls(jsonb_build_object(
    'slug', row.slug,
    'name_he', case when before.name_he is distinct from row.name_he
                    then jsonb_build_array(before.name_he, row.name_he) end,
    'name_en', case when before.name_en is distinct from row.name_en
                    then jsonb_build_array(before.name_en, row.name_en) end,
    'category', case when before.category is distinct from row.category
                     then jsonb_build_array(before.category, row.category) end,
    'sort_order', case when before.sort_order is distinct from row.sort_order
                       then jsonb_build_array(before.sort_order, row.sort_order) end
  )));

  return row;
end;
$$;

revoke execute on function public.admin_update_beer(uuid, text, text, text, integer) from public, anon;
grant execute on function public.admin_update_beer(uuid, text, text, text, integer) to authenticated;

-- A slug change is refused by the database, not only by the form: a script, a
-- hand-written PostgREST call and a future migration all go through here.
create or replace function public.beers_slug_is_forever()
returns trigger
language plpgsql
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception
      'אי אפשר לשנות מזהה (slug) של בירה — הוא הכתובת של הדף, המפתח של העיצוב שלה ושם קובץ התמונה.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists beers_slug_is_forever on public.beers;
create trigger beers_slug_is_forever
  before update of slug on public.beers
  for each row execute function public.beers_slug_is_forever();

-- --------------------------------------------------------------------------
-- Adding one.
--
-- A new beer arrives with no identity and no bottle photo, and that is a complete,
-- working state: it gets the house look and an unlabelled bottle, which is already
-- what the app does for a beer it does not know (tests/e2e/favourite-one.spec.ts).
-- Giving it its own look is a change to src/design/themes.ts and a reviewed photo --
-- a deploy, not a form field.
-- --------------------------------------------------------------------------

create or replace function public.admin_add_beer(
  p_slug       text,
  p_name_he    text,
  p_name_en    text,
  p_brand_slug text,
  p_category   text default 'beer',
  p_variant    text default null
)
returns public.beers
language plpgsql
security definer
set search_path = public
as $$
declare
  brand uuid;
  row   public.beers;
begin
  perform public.require_admin();

  if p_slug !~ '^[a-z0-9-]+$' then
    raise exception 'מזהה הבירה (slug) יכול להכיל אותיות אנגליות קטנות, ספרות ומקפים בלבד.' using errcode = '22023';
  end if;
  if nullif(trim(p_name_he), '') is null or nullif(trim(p_name_en), '') is null then
    raise exception 'שם הבירה בעברית ובאנגלית לא יכול להיות ריק.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.product_categories c where c.slug = p_category) then
    raise exception 'קטגוריה לא מוכרת.' using errcode = '22023';
  end if;

  select id into brand from public.brands where slug = p_brand_slug;
  if brand is null then
    raise exception 'מותג לא מוכר. צריך להוסיף אותו קודם.' using errcode = 'P0002';
  end if;

  -- A brand has at most one beer per variant, and one "plain" beer (0007). Adding a
  -- second plain beer to a brand is almost always somebody meaning a variant --
  -- "Tuborg Red" is a variant of Tuborg, not a brand -- so the refusal says that
  -- rather than quoting an index name at them.
  if exists (
    select 1 from public.beers b
     where b.brand_id = brand
       and coalesce(b.variant, '') = coalesce(nullif(trim(p_variant), ''), '')
  ) then
    raise exception
      'למותג הזה כבר יש בירה כזאת. אם זו גרסה אחרת (למשל ״אדום״ או ״ללא אלכוהול״), הוסיפו שם לגרסה.'
      using errcode = '23505';
  end if;

  insert into public.beers (slug, name_he, name_en, brand_id, variant, category, sort_order)
  values (p_slug, trim(p_name_he), trim(p_name_en), brand, nullif(trim(p_variant), ''), p_category,
          -- At the end of the list. Where it actually belongs is a judgement, made
          -- by editing it afterwards, and defaulting to "last" never reorders
          -- somebody else's beers behind their back.
          coalesce((select max(b.sort_order) + 10 from public.beers b), 100))
  returning * into row;

  perform public.record_admin_action('beer.add', 'beer', row.id::text, jsonb_strip_nulls(jsonb_build_object(
    'slug', row.slug, 'name_he', row.name_he, 'name_en', row.name_en,
    'category', row.category, 'variant', row.variant
  )));

  return row;
end;
$$;

revoke execute on function public.admin_add_beer(text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_add_beer(text, text, text, text, text, text) to authenticated;

-- The brands an admin can attach a beer to.
create or replace function public.admin_brands()
returns table (slug text, name_he text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return query select b.slug, b.name_he from public.brands b order by b.name_he;
end;
$$;

revoke execute on function public.admin_brands() from public, anon;
grant execute on function public.admin_brands() to authenticated;

-- The categories a beer can be in, by name.
--
-- Read through a function rather than from the table: `product_categories` has a
-- read POLICY for anon and authenticated (0014) and no table GRANT, so that policy
-- has never actually let anybody read it. Widening the grant to serve one admin
-- form would be the wrong way round -- the panel needs the names, not the public.
create or replace function public.admin_product_categories()
returns table (slug text, name_he text, in_scope boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return query
  select c.slug, c.name_he, c.in_scope from public.product_categories c order by c.sort_order, c.slug;
end;
$$;

revoke execute on function public.admin_product_categories() from public, anon;
grant execute on function public.admin_product_categories() to authenticated;
