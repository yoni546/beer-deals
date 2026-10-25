-- ---------------------------------------------------------------------------
-- 0061 — Super Yuda has a feed after all
--
-- The chain has been listed as blocked since 0.8.0, on the note that its
-- Cerberus account "requires a password; the public empty-password login is
-- refused". Both halves of that were wrong, and the owner asking why there were
-- no Super Yuda deals is what made anybody look.
--
--   1. The login was never refused. It answers 302 with or without the password.
--      What came back was ONE entry at the root — a FOLDER named "Yuda" — and a
--      listing with no files in it reads exactly like an empty account.
--      Inside that folder: 422 files, 200 of them promotions, the newest from
--      that morning (verified 2026-10-25).
--
--   2. The chain code here had two digits transposed: 7290058148776 for
--      7290058177776. So even a correct listing would have matched nothing, and
--      the first fault hid the second.
--
-- The password is the one the chain publishes by law on gov.il, alongside every
-- other chain's. It is not a secret, it is a published term of access, and it
-- lives in the publisher config with the username that was already there.
--
-- This migration is only the source row the importer writes against — trust 80,
-- the same as every other chain feed, because it is the same kind of evidence.
--
-- Additive and idempotent.
-- ---------------------------------------------------------------------------

insert into public.sources (slug, name, kind, trust) values
  ('feed-super-yuda', 'Super Yuda price feed', 'chain_feed', 80)
on conflict (slug) do nothing;
