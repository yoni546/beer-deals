-- ---------------------------------------------------------------------------
-- 0063 — six beers the chains sell and the catalogue did not carry
--
-- MEASURED, production, 2026-10-25. 1,158 priced rows were discarded with "a
-- beer the app does not carry", across 1,026 different names — a long tail of
-- craft and import, two to nine rows each. There is no quick win in it, and
-- these six are the ones that earn their place: each appears at four or more of
-- the chains we read, which is the same bar migration 0016 used.
--
--   סאן מיגל        20 rows   manufacturer "סאן מיגל"
--   ביטבורגר        21 rows   "מבשלת ביטבורגר"
--   ג'מס / גמס      36 rows   "אביר הבר" — two spellings of one beer
--   וולפאס אנגלמן   24 rows   an Israeli brewery
--   דובל            14 rows   "מבשלת דובל", "דובל מורטגט"
--   שופרהופר        12 rows   "ראדברגר גרופ"
--
-- TWO OF THE OWNER'S SEVEN ARE NOT HERE, and the data is why.
--
--   פילזנר is a STYLE. 30 rows across TEN different manufacturers — Pilsner
--   Urquell, "cesu alus", a Polish brewer. Matching on it would merge ten
--   brewers into one beer, and every price under it would be a lie about which
--   beer it is. (Pilsner Urquell itself is 2 rows: not worth its own entry.)
--
--   ניו אינגלנד is also a style — a New England IPA. The brewer on those rows
--   is וולפאס אנגלמן, which is why that brewery is in the list above instead:
--   24 rows against the style's 8, and it is a thing rather than a category.
--
-- The English names of the two Israeli breweries are transliterations and are
-- flagged for the owner to correct. The slug is what everything else holds on
-- to, so a name can be fixed without touching anything that refers to it.
--
-- Additive and idempotent. A beer is only visible once the importer recognises
-- its name (scripts/ingest/lib/normalize.mjs) and has a look to draw it with
-- (src/design/themes.ts); both land with this.
-- ---------------------------------------------------------------------------

insert into public.brands (slug, name_he, name_en) values
  ('san-miguel',   'סאן מיגל',       'San Miguel'),
  ('bitburger',    'ביטבורגר',       'Bitburger'),
  ('schofferhofer','שופרהופר',       'Schöfferhofer'),
  ('james',        'ג''מס',          'James'),
  ('duvel',        'דובל',           'Duvel'),
  ('wolfaus',      'וולפאס אנגלמן',  'Wolfaus Engelman')
on conflict (slug) do nothing;

insert into public.beers (slug, name_he, name_en, theme_base, theme_surface, theme_accent, theme_ink, sort_order, brand_id)
select v.slug, v.name_he, v.name_en, v.base, v.surface, v.accent, v.ink, v.sort_order, br.id
  from (values
    ('san-miguel',   'סאן מיגל',      'San Miguel',       '#15090a', '#261315', '#d9453c', '#fbeeee', 35),
    ('bitburger',    'ביטבורגר',      'Bitburger',        '#071410', '#0f241c', '#c9a64b', '#eef6f1', 36),
    ('schofferhofer','שופרהופר',      'Schöfferhofer',    '#0e1017', '#1a1d28', '#d8b24a', '#f0f1f6', 37),
    ('james',        'ג''מס',         'James',            '#140d07', '#24180e', '#c98b3a', '#f8f0e6', 38),
    ('duvel',        'דובל',          'Duvel',            '#0d0f14', '#181b24', '#c8202e', '#eef0f5', 39),
    ('wolfaus',      'וולפאס אנגלמן', 'Wolfaus Engelman', '#120a16', '#201327', '#a86fd0', '#f3ecf8', 40)
  ) as v(slug, name_he, name_en, base, surface, accent, ink, sort_order)
  join public.brands br on br.slug = v.slug
on conflict (slug) do nothing;
