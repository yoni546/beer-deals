-- ---------------------------------------------------------------------------
-- 0021 · What kind of pack a SKU is: single, multipack or bottle crate
--
-- "ארגזים" meant "12 or more units" (src/lib/offer-logic.ts, 0.9.x), so a 24-can tray was listed as a crate.
-- A ארגז is a crate of BOTTLES, and calling something one takes positive evidence — never the count alone.
-- The pack's form is therefore stored, not guessed:
--
--   single        one unit
--   multipack     everything else: cans of any count, cartons and shrink-wrapped trays of bottles, and big
--                 packs whose container or form the chain did not state
--   bottle_crate  12+ bottles that the chain's own title calls a ארגז / crate (scripts/ingest/lib/
--                 normalize.mjs, packagingOf), or that an admin explicitly creates as one
--
-- A crate and a carton of the same 24 bottles are different products, so packaging joins the SKU identity.
-- A SKU written without a packaging gets single / multipack from its count (a trigger) — never a crate.
--
-- Backfill: every existing SKU becomes single or multipack, except bottles of 12+ whose source title (an
-- import's source_products row) says ארגז and not carton / shrink / tray — the same rule as the importer.
--
-- Additive (one column, one trigger, the identity widened by that column). The read views are unchanged:
-- the app looks packaging up by sku_id. Rollback: supabase/rollback/0021_sku_packaging.down.sql.
-- ---------------------------------------------------------------------------

alter table public.skus add column packaging text;

create or replace function public.skus_default_packaging()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.packaging is null or (tg_op = 'UPDATE' and new.pack_quantity is distinct from old.pack_quantity and new.packaging <> 'bottle_crate') then
    new.packaging := case when new.pack_quantity <= 1 then 'single' else 'multipack' end;
  end if;
  return new;
end;
$$;

create trigger skus_default_packaging
  before insert or update of pack_quantity, packaging on public.skus
  for each row execute function public.skus_default_packaging();

update public.skus s
   set packaging = case
     when s.pack_quantity <= 1 then 'single'
     when s.container = 'bottle' and s.pack_quantity >= 12 and exists (
       select 1 from public.source_products sp
        where sp.sku_id = s.id
          and sp.raw_name ~ '(^|[[:space:]\-(])ארגז($|[[:space:]\-)0-9])'
          and sp.raw_name !~ '(קרטון|שרינק|מגש)'
     ) then 'bottle_crate'
     else 'multipack'
   end;

alter table public.skus
  alter column packaging set not null,
  add constraint skus_packaging_known check (packaging in ('single', 'multipack', 'bottle_crate')),
  add constraint skus_packaging_matches_count check ((packaging = 'single') = (pack_quantity = 1)),
  add constraint skus_crate_is_bottles check (packaging <> 'bottle_crate' or (container = 'bottle' and pack_quantity >= 12));

alter table public.skus drop constraint skus_identity;
alter table public.skus add constraint skus_identity unique (beer_id, variant, container, volume_ml, pack_quantity, packaging);
