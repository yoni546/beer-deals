-- ===========================================================================
-- DEV / STAGING ONLY — a small invented catalogue with prices.
--
-- Realistic SHAPES, invented NUMBERS: several packs of one beer at the same
-- chain, regular prices at four chains, a plain price cut, a club price, two
-- multi-buys, and one promotion with no regular price to compare against (so
-- the app must show it without a percentage). Everything is recorded under the
-- 'sample-data' source, which the read views flag `is_sample` and which a
-- production server refuses to show (src/lib/demo.ts).
--
-- Run it on a NON-production database, in the same SQL session:
--
--     set app.allow_demo_seed = 'yes';
--
-- and then the contents of this file. Safe to run twice (it skips what exists).
-- ===========================================================================

do $$
begin
  if coalesce(current_setting('app.allow_demo_seed', true), '') <> 'yes' then
    raise exception
      'Refusing to insert sample catalogue data. This file is for local/staging databases only. '
      'If this is definitely not production, run  set app.allow_demo_seed = ''yes'';  first, in the same session.';
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- SKUs. The key "beer|container|volume|pack" is only used inside this file.
-- --------------------------------------------------------------------------

insert into public.skus (beer_id, container, volume_ml, pack_quantity, display_he)
select b.id, v.container::public.container_type, v.ml, v.pack, v.label
  from (values
    ('goldstar',  'can',    330, 6,  'גולדסטאר 6×330 מ״ל פחית'),
    ('goldstar',  'can',    500, 6,  'גולדסטאר 6×500 מ״ל פחית'),
    ('goldstar',  'bottle', 330, 6,  'גולדסטאר 6×330 מ״ל בקבוק'),
    ('goldstar',  'bottle', 330, 24, 'גולדסטאר 24×330 מ״ל בקבוק'),
    ('maccabee',  'can',    330, 6,  'מכבי 6×330 מ״ל פחית'),
    ('maccabee',  'can',    500, 6,  'מכבי 6×500 מ״ל פחית'),
    ('heineken',  'can',    330, 6,  'היינקן 6×330 מ״ל פחית'),
    ('heineken',  'bottle', 330, 6,  'היינקן 6×330 מ״ל בקבוק'),
    ('corona',    'bottle', 330, 6,  'קורונה 6×330 מ״ל בקבוק'),
    ('tuborg',    'can',    500, 6,  'טובורג 6×500 מ״ל פחית'),
    ('carlsberg', 'can',    500, 4,  'קרלסברג 4×500 מ״ל פחית')
  ) as v(slug, container, ml, pack, label)
  join public.beers b on b.slug = v.slug
on conflict (beer_id, variant, container, volume_ml, pack_quantity) do nothing;

-- --------------------------------------------------------------------------
-- Regular prices (agorot for the whole pack), seen an hour ago.
-- --------------------------------------------------------------------------

insert into public.price_observations
  (sku_id, store_id, kind, price_agorot, observed_at, identity_key, source_id, natural_key, status)
select k.id, st.id, 'regular', v.price, now() - interval '1 hour', 'regular', src.id, null, 'live'
  from (values
    ('goldstar|can|330|6',  'rami-levy',  3790), ('goldstar|can|330|6',  'shufersal',  3990),
    ('goldstar|can|330|6',  'yochananof', 3890), ('goldstar|can|330|6',  'victory',    3690),
    ('goldstar|can|500|6',  'rami-levy',  4990), ('goldstar|can|500|6',  'shufersal',  5190),
    ('goldstar|can|500|6',  'yochananof', 5090),
    ('goldstar|bottle|330|24', 'rami-levy', 13900), ('goldstar|bottle|330|24', 'shufersal', 14500),
    ('maccabee|can|330|6',  'rami-levy',  3690), ('maccabee|can|330|6',  'shufersal',  3890),
    ('maccabee|can|330|6',  'victory',    3590),
    ('heineken|can|330|6',  'rami-levy',  5490), ('heineken|can|330|6',  'shufersal',  5290),
    ('heineken|can|330|6',  'yochananof', 5590),
    ('corona|bottle|330|6', 'rami-levy',  5990), ('corona|bottle|330|6', 'shufersal',  6190),
    ('tuborg|can|500|6',    'shufersal',  4290), ('tuborg|can|500|6',    'yochananof', 4190),
    ('carlsberg|can|500|4', 'rami-levy',  3490)
  ) as v(sku_key, store_slug, price)
  join (select s.id, b.slug || '|' || s.container || '|' || s.volume_ml || '|' || s.pack_quantity as key
          from public.skus s join public.beers b on b.id = s.beer_id) k on k.key = v.sku_key
  join public.stores  st  on st.slug  = v.store_slug
  join public.sources src on src.slug = 'sample-data'
 where not exists (
   select 1 from public.price_observations o
    where o.sku_id = k.id and o.store_id = st.id and o.kind = 'regular' and o.source_id = src.id
 );

-- --------------------------------------------------------------------------
-- Promotions. price_agorot is per pack; a multi-buy carries its terms in
-- `conditions` and its per-pack price is ceil(total / qty), as the table demands.
-- --------------------------------------------------------------------------

insert into public.price_observations
  (sku_id, store_id, kind, price_agorot, observed_at, valid_from, valid_to, promo_type, conditions, identity_key, source_id, natural_key, status)
select k.id, st.id, 'promotion',
       case when v.promo = 'multi_buy'
            then ceil((v.conditions #>> '{multi_buy,total_agorot}')::numeric / (v.conditions #>> '{multi_buy,qty}')::int)::int
            else v.price end,
       now() - interval '1 hour', now() - interval '1 day', now() + make_interval(days => v.days),
       v.promo::public.promo_type, v.conditions || '{"note_he": "מבצע לדוגמה"}'::jsonb,
       'sample-' || v.n, src.id, 'sample-' || v.n, 'live'
  from (values
    (1,  'goldstar|can|330|6',   'rami-levy',  'price_cut',  2500,  4, '{}'::jsonb),
    (2,  'goldstar|can|330|6',   'shufersal',  'club_price', 2990,  6, '{"club": "שופרסל פלוס"}'::jsonb),
    (3,  'goldstar|can|500|6',   'rami-levy',  'multi_buy',  null,  3, '{"multi_buy": {"qty": 2, "total_agorot": 8000}}'::jsonb),
    (4,  'goldstar|bottle|330|24',  'rami-levy',  'price_cut',  8900,  5, '{}'::jsonb),
    (5,  'maccabee|can|330|6',   'victory',    'price_cut',  2690,  2, '{}'::jsonb),
    (6,  'heineken|can|330|6',   'shufersal',  'price_cut',  3990,  5, '{}'::jsonb),
    (7,  'corona|bottle|330|6',  'rami-levy',  'price_cut',  4290,  3, '{}'::jsonb),
    (8,  'tuborg|can|500|6',     'shufersal',  'multi_buy',  null,  7, '{"multi_buy": {"qty": 3, "total_agorot": 10500}}'::jsonb),
    (9,  'carlsberg|can|500|4',  'rami-levy',  'price_cut',  2490,  2, '{}'::jsonb),
    -- No regular price is known for this SKU at this chain: shown without a percentage.
    (10, 'heineken|can|330|6',   'victory',    'price_cut',  3690,  4, '{}'::jsonb)
  ) as v(n, sku_key, store_slug, promo, price, days, conditions)
  join (select s.id, b.slug || '|' || s.container || '|' || s.volume_ml || '|' || s.pack_quantity as key
          from public.skus s join public.beers b on b.id = s.beer_id) k on k.key = v.sku_key
  join public.stores  st  on st.slug  = v.store_slug
  join public.sources src on src.slug = 'sample-data'
 where not exists (
   select 1 from public.price_observations o
    where o.sku_id = k.id and o.store_id = st.id and o.source_id = src.id and o.identity_key = 'sample-' || v.n
 );

select count(*) || ' sample observations present' as result
  from public.price_observations o join public.sources s on s.id = o.source_id where s.slug = 'sample-data';
