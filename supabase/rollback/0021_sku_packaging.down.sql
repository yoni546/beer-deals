-- Rollback of 0021_sku_packaging.sql.
-- Refuses if a crate and a non-crate SKU share the old identity (two SKUs would collide): resolve those first.
alter table public.skus drop constraint skus_identity;
alter table public.skus add constraint skus_identity unique (beer_id, variant, container, volume_ml, pack_quantity);
drop trigger if exists skus_default_packaging on public.skus;
drop function if exists public.skus_default_packaging();
alter table public.skus
  drop constraint if exists skus_crate_is_bottles,
  drop constraint if exists skus_packaging_matches_count,
  drop constraint if exists skus_packaging_known,
  drop column packaging;
