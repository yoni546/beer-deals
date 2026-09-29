-- 0016 — more beers and more chains (release 0.8.0). Additive only.
--
-- 1. Twelve beers the chains sell widely and the catalogue did not carry. Their rows were read and then
--    discarded as "a beer the app does not carry" — and with them every promotion that named them
--    (docs/RETAILER-COVERAGE.md has the before/after counts). Each is sold at four or more of the chains
--    we read, or carries public promotions at several.
-- 2. Four chains found on the same public price-transparency portal as Rami Levy and Yochananof
--    (Keshet Taamim, Fresh Market, Stop Market, Politzer), with their feed sources.
-- 3. Their sources for the ingestion runs.
--
-- The theme_* columns are the legacy per-beer colours (0001); the app's look comes from
-- src/design/themes.ts. Rollback: delete the rows by slug (nothing references them until an import).

-- 1. Brands, then beers (a beer belongs to a brand: 0007) ------------------------------------------

insert into public.brands (slug, name_he, name_en) values
  ('krombacher',   'קרומבכר',        'Krombacher'),
  ('eagle',        'איגל',           'Eagle'),
  ('kronenbourg',  '1664',           'Kronenbourg 1664'),
  ('miller',       'מילר',           'Miller'),
  ('staropramen',  'סטארופרמן',      'Staropramen'),
  ('chouffe',      'לה שוף',         'La Chouffe'),
  ('kasteel',      'קסטיל',          'Kasteel'),
  ('hoegaarden',   'הוגרדן',         'Hoegaarden'),
  ('franziskaner', 'פרנציסקאנר',     'Franziskaner'),
  ('estrella',     'אסטרייה דאם',    'Estrella Damm'),
  ('blue-moon',    'בלו מון',        'Blue Moon'),
  ('benediktiner', 'בנדיקטינר',      'Benediktiner')
on conflict (slug) do nothing;

insert into public.beers (slug, name_he, name_en, theme_base, theme_surface, theme_accent, theme_ink, sort_order, brand_id)
select v.slug, v.name_he, v.name_en, v.base, v.surface, v.accent, v.ink, v.sort_order, br.id
  from (values
    ('krombacher',   'קרומבכר',       'Krombacher',        '#07140c', '#0f2417', '#c9a64b', '#eef6f0', 23),
    ('eagle',        'איגל',          'Eagle',             '#170a07', '#27130e', '#d4a13a', '#fbefe9', 24),
    ('kronenbourg',  '1664 בלאנק',    'Kronenbourg 1664 Blanc', '#07101f', '#0f1c33', '#8fb6ea', '#eaf1fb', 25),
    ('miller',       'מילר',          'Miller',            '#0b0f1a', '#141a2b', '#d23b36', '#edf0f7', 26),
    ('staropramen',  'סטארופרמן',     'Staropramen',       '#0c140b', '#152415', '#cf3b32', '#eef5ec', 27),
    ('chouffe',      'לה שוף',        'La Chouffe',        '#0b1219', '#142030', '#d9423a', '#ecf2f8', 28),
    ('kasteel',      'קסטיל',         'Kasteel',           '#150a0d', '#261318', '#caa04c', '#f8ecef', 29),
    ('hoegaarden',   'הוגרדן',        'Hoegaarden',        '#0a111a', '#131e2c', '#9cc3e6', '#edf3f9', 30),
    ('franziskaner', 'פרנציסקאנר',    'Franziskaner',      '#0b0f16', '#151b26', '#d6ae52', '#eef1f6', 31),
    ('estrella',     'אסטרייה דאם',   'Estrella Damm',     '#160b07', '#26140d', '#e0b64a', '#fbefe8', 32),
    ('blue-moon',    'בלו מון',       'Blue Moon',         '#08101c', '#101c30', '#e98d3c', '#eaf0f9', 33),
    ('benediktiner', 'בנדיקטינר',     'Benediktiner',      '#0a0e18', '#131a2a', '#c9a54e', '#edf0f7', 34)
  ) as v(slug, name_he, name_en, base, surface, accent, ink, sort_order)
  join public.brands br on br.slug = v.slug
on conflict (slug) do nothing;

-- 2. Chains --------------------------------------------------------------------------------------

insert into public.stores (slug, name_he) values
  ('keshet-taamim', 'קשת טעמים'),
  ('fresh-market',  'פרשמרקט'),
  ('stop-market',   'סטופ מרקט'),
  ('politzer',      'פוליצר')
on conflict (slug) do nothing;

-- 3. Their feeds ---------------------------------------------------------------------------------

insert into public.sources (slug, name, kind, trust) values
  ('feed-keshet',      'Keshet Taamim price feed',  'chain_feed', 80),
  ('feed-freshmarket', 'Fresh Market price feed',   'chain_feed', 80),
  ('feed-stop-market', 'Stop Market price feed',    'chain_feed', 80),
  ('feed-politzer',    'Politzer price feed',       'chain_feed', 80)
on conflict (slug) do nothing;
