-- ---------------------------------------------------------------------------
-- 0029 — a deal's attached photo must be a photo.
--
-- `deals.image_url` is submitted by anyone (every visitor gets an anonymous
-- session) and is rendered to a MODERATOR as a clickable link. It was validated
-- as `z.string().optional()` — anything at all.
--
-- The exploit is short: submit a perfectly valid deal with
-- image_url = 'javascript:fetch(...)', wait for an admin to click "view the
-- attached photo". That scheme executes in the current document regardless of
-- target="_blank", which is script execution inside a super-admin's session —
-- and grant_admin is one server-action call from there. `data:text/html` and a
-- look-alike host are the quieter versions of the same thing.
--
-- Fixed in three places, because this one is worth belt and braces:
--   1. the submission schema now pins the value to this project's own public
--      bucket (src/lib/actions/deals.ts);
--   2. the admin panel renders the link only when it parses as https
--      (src/components/admin/DealActions.tsx);
--   3. here, so that no code path — a future import, a script, a hand-written
--      PostgREST call that satisfies the RLS policy — can store one either.
--
-- NOT VALID is deliberate: it applies to every INSERT and UPDATE from now on,
-- which is the whole point, without failing the migration on historical rows
-- nobody has audited. Those rows are still rendered safely by (2). To tighten it
-- later, review what is there and run
--   alter table public.deals validate constraint deals_image_url_is_https;
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deals_image_url_is_https') then
    alter table public.deals
      add constraint deals_image_url_is_https
      check (image_url is null or image_url like 'https://%')
      not valid;
  end if;
end
$$;

comment on column public.deals.image_url is
  'A photo of the shelf label, in this project''s own public bucket. Rendered to moderators as a link, so it is https-only at the table, in the submission schema and at the render (0029).';
