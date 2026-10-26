-- ---------------------------------------------------------------------------
-- 0060 — three drinks shops, filled in by hand
--
-- The owner asked for יין בעיר, הרמיטאז׳ and בנא משקאות, 2026-10-25, knowing
-- what it means: none of the three publishes a price file, so nothing imports
-- them and nobody should expect them to fill themselves.
--
-- WHY THEY ARE DIFFERENT FROM EVERY OTHER SHOP HERE. The nineteen chains above
-- are in the price-transparency programme: the law requires them to publish a
-- file, the importer reads it every morning, and a price arrives with a scan, a
-- branch and an observation behind it. These three are drinks shops below that
-- threshold. Their deals will come from the admin screen, which is the same
-- path a person's own submission takes — and they carry the same trust marks as
-- any hand-entered price, because that is what they are.
--
-- SO THEY WILL LOOK EMPTY UNTIL SOMEBODY TYPES, and that is correct rather than
-- broken. A chain with no live deal already shows as having none; these simply
-- start there. Nothing in the app needs to know they are special: a store is a
-- store, and the honesty is in where its prices came from, which the app
-- already says on every line.
--
-- The names are the owner's, with one guess flagged: he wrote "הרימטג", which
-- is almost certainly הרמיטאז׳. If it is a different shop, change the name here
-- — the slug is what everything else holds on to.
--
-- Additive, and idempotent: a slug that is already there is left alone.
-- ---------------------------------------------------------------------------

insert into public.stores (slug, name_he) values
  ('yain-bair',  'יין בעיר'),
  ('hermitage',  'הרמיטאז׳'),
  ('bana',       'בנא משקאות')
on conflict (slug) do nothing;
