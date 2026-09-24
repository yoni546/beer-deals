-- ---------------------------------------------------------------------------
-- Beer Deals — catalogue seed.
--
-- The theme colours are ours. They are chosen to *evoke* each beer — the amber
-- of a lager, the green glass of an import, the deep red of a stout — and are
-- not sampled from anyone's brand guidelines, and no logo or trade dress is
-- reproduced anywhere in this app. The layout is byte-for-byte identical across
-- every theme; only these four variables change.
--
-- Safe to re-run: every insert is idempotent on the slug.
-- ---------------------------------------------------------------------------

insert into public.beers (slug, name_he, name_en, theme_base, theme_surface, theme_accent, theme_ink, sort_order) values
  ('goldstar',   'גולדסטאר',      'Goldstar',        '#1a1206', '#2a1e0c', '#e0a52b', '#fdf6e6',  1),
  ('maccabee',   'מכבי',          'Maccabee',        '#0d1408', '#172312', '#8cc63f', '#f2f7ea',  2),
  ('heineken',   'היינקן',        'Heineken',        '#04140b', '#0b2415', '#3fb96a', '#e9f7ee',  3),
  ('carlsberg',  'קרלסברג',       'Carlsberg',       '#06140e', '#0d2419', '#4cae7a', '#e8f5ee',  4),
  ('corona',     'קורונה',        'Corona',          '#0f1a26', '#17293a', '#f2c14e', '#eef5fb',  5),
  ('tuborg',     'טובורג',        'Tuborg',          '#06121c', '#0c2130', '#37b7d8', '#e7f5fa',  6),
  ('stella',     'סטלה ארטואה',   'Stella Artois',   '#1a1305', '#2a200b', '#d9b551', '#fbf6e8',  7),
  ('becks',      'בקס',           'Beck''s',         '#0a1408', '#132312', '#5faa46', '#edf6ea',  8),
  ('tuborg-red', 'טובורג אדום',   'Tuborg Red',      '#1a0a0a', '#2a1212', '#d9534f', '#fbecec',  9),
  ('paulaner',   'פאולנר',        'Paulaner',        '#12100a', '#221d12', '#c8a45c', '#f7f2e8', 10),
  ('weihen',     'ויינשטפן',      'Weihenstephaner', '#0a0f1a', '#121a2a', '#7c9fd4', '#eaf0f9', 11),
  ('erdinger',   'ארדינגר',       'Erdinger',        '#0d1016', '#171c26', '#9bb0cc', '#eef1f6', 12),
  ('guinness',   'גינס',          'Guinness',        '#0c0a08', '#1a1613', '#c8952f', '#f7f1e6', 13),
  ('leffe',      'לף',            'Leffe',           '#160f08', '#261a0e', '#c98b3c', '#f8efe3', 14),
  ('desperados', 'דספרדוס',       'Desperados',      '#1a1404', '#2b220a', '#e3c22e', '#fbf7e2', 15),
  ('budweiser',  'באדוויזר',      'Budweiser',       '#160709', '#260d11', '#c9322f', '#fbeaea', 16),
  ('shapiro',    'שפירא',         'Shapiro',         '#141008', '#241c0f', '#b98b3e', '#f6f0e5', 17),
  ('alexander',  'אלכסנדר',       'Alexander',       '#0a0e14', '#121822', '#6f8fb3', '#ecf1f6', 18),
  ('malka',      'מלכה',          'Malka',           '#150b12', '#26141f', '#c25b8e', '#f9ecf3', 19),
  ('negev',      'נגב',           'Negev',           '#171208', '#281f10', '#cf9a3a', '#f8f2e6', 20),
  ('bazelet',    'בזלת',          'Bazelet',         '#0c0d10', '#181a20', '#8b90a0', '#eff0f3', 21),
  ('somersby',   'סאמרסבי',       'Somersby',        '#151206', '#26220c', '#d8c14a', '#f9f6e6', 22)
on conflict (slug) do update
  set name_he       = excluded.name_he,
      name_en       = excluded.name_en,
      theme_base    = excluded.theme_base,
      theme_surface = excluded.theme_surface,
      theme_accent  = excluded.theme_accent,
      theme_ink     = excluded.theme_ink,
      sort_order    = excluded.sort_order;

-- Chains, not branches — a deal at רמי לוי is a deal at רמי לוי.
insert into public.stores (slug, name_he) values
  ('rami-levy',    'רמי לוי'),
  ('shufersal',    'שופרסל'),
  ('yochananof',   'יוחננוף'),
  ('victory',      'ויקטורי'),
  ('osher-ad',     'אושר עד'),
  ('yeinot-bitan', 'יינות ביתן'),
  ('tiv-taam',     'טיב טעם'),
  ('mahsanei',     'מחסני השוק'),
  ('carrefour',    'קרפור'),
  ('hatzi-hinam',  'חצי חינם'),
  ('super-yuda',   'סופר יודה'),
  ('king-store',   'קינג סטור'),
  ('ampm',         'AM:PM'),
  ('liquor-store', 'חנות אלכוהול'),
  ('makolet',      'מכולת שכונתית')
on conflict (slug) do update set name_he = excluded.name_he;
