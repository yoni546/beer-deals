-- ---------------------------------------------------------------------------
-- 0062 — Salach Dabach and Paz Yellow
--
-- Both have been in the publisher list since 0.8.0 marked blocked, on the note
-- that their accounts "require a password; the public empty-password login is
-- refused". The password half was true and the conclusion was not: the chains
-- publish those passwords on gov.il, as the law requires, beside every other
-- chain's. Nobody had read that page.
--
-- VERIFIED 2026-10-25, with the published credentials:
--
--   סלח דבאח   57 files   3 Stores lists, 30 promotions
--   פז ילו    980 files   3 Stores lists, 488 promotions
--
-- The owner asked for them "without branches — every deal at every branch".
-- They do not need that, and it would be worse: both publish a Stores file
-- every morning, the newest from the day before this was written, so their
-- deals get the same per-branch evidence as every other chain. A deal that
-- really is chainwide will be read as chainwide by promotion_scope (0017)
-- because the branches say so, rather than because we assumed it.
--
-- Two stores and two feeds. Nothing else: the importer already knows how to
-- read this platform, and the chain codes in the publisher config match the
-- files exactly.
--
-- Additive and idempotent.
-- ---------------------------------------------------------------------------

insert into public.stores (slug, name_he) values
  ('salach-dabach', 'סלח דבאח'),
  ('yellow',        'ילו')
on conflict (slug) do nothing;

insert into public.sources (slug, name, kind, trust) values
  ('feed-salach-dabach', 'Salach Dabach price feed', 'chain_feed', 80),
  ('feed-yellow',        'Paz Yellow price feed',    'chain_feed', 80)
on conflict (slug) do nothing;
