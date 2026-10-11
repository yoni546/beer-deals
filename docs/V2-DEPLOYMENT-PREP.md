# V2 — what has to happen before this branch goes live

Branch `feature/beer-deals-v2`, releases 0.10.0 → 0.32.1. Everything that did not need your
accounts is done. This is the part that does.

**Nothing here has been run against production.** No deploy, no production database write, no
production secret touched. The branch has never been merged to `main`.

Follow `docs/PRODUCTION-HANDOFF-YONI.md` for the mechanics you already know — proving which project
is production, the backup, the `assert-production.sh` guard before every command that changes it.
This document only covers what is new.

---

## 1. Twenty migrations, in order

`0024` through `0043`. They are additive: new tables, new columns that are nullable, new functions.
None drops a table, rewrites a row, or changes an existing column's type.

Apply them to **staging first**, in numeric order, and run `npm run verify` against the repo
afterwards. Then production, same order.

| | What it adds | Needs |
|---|---|---|
| 0024 | A person may keep between one and four beers | — |
| 0025 | The admin dashboard's numbers, `deactivated_at`, the admin roster read | — |
| 0026 | Branch coordinates, home town and radius, `km_between`, `branches_within_km` | A geocoding provider, later — see §3 |
| 0027 | The Deal Score (`offer_scores`, `refresh_offer_scores`) | Run `refresh_offer_scores()` once after the first import |
| 0028 | Branch coverage inside `admin_overview` | — |
| 0029 | `deals_image_url_is_https` (NOT VALID — see below) | — |
| 0030 | `contributors`: the public name, with trigger-maintained tallies | — |
| 0031 | `offer_feedback`: "still there" / "gone", on any offer | — |
| 0032 | The admin audit log, append-only | — |
| 0033 | Rate limits on submissions, feedback and the public name | — |
| 0034 | Managing beers; the DELETE policy on `beers` is dropped | — |
| 0035 | `submission_blocks`: stopping one account from submitting | — |
| 0036 | `admin_coverage()` | — |
| 0037 | `watchlist` + `watch_beer` / `unwatch_beer` | — |
| 0038 | The trust ladder, shared by the tally and the panel | — |
| 0039 | `promotion_branches_near()` | — |
| 0040 | The `moderator` role: a new `admin_level` value, `is_moderator()`, and a **tightened** `is_admin()` | — |
| 0041 | `admin_people()` and `admin_people_by_city()` | — |
| 0042 | `admin_highlights()` — the dashboard's "what is big now" | — |
| 0043 | Takes back the privileges Supabase grants by default, and stops it granting more | **Apply this one even if you apply nothing else** |

**0043 is not optional and is not new work.** Staging, on 2026-10-11, answered the
verification with `anon` — the role every visitor's browser arrives as — holding SELECT,
INSERT, DELETE and TRUNCATE on `admin_actions`, the append-only audit log. No migration
grants that; every Supabase project is created with default privileges that hand each new
table to the API roles. **Production has the same hole, on every table added since the
project was created**, and it is older than this branch. RLS kept the contents unreachable
through the API, but TRUNCATE ignores RLS, and the two layers we describe everywhere were
one. Verified on staging: 164 anon write privileges before, 0 after.

**0040 narrows `is_admin()`.** Before it, `is_admin()` was true for any row in `admins`; after it,
only for `level in ('admin','super_admin')`. Nothing loses access, because no moderator exists until
you grant one — but it means every permission added later is closed to moderators by default, and
the twelve places a moderator *should* reach were re-opened by name. Read `tests/roles.test.ts`
before changing it.

**0029 is deliberately `NOT VALID`.** It applies to every insert and update from now on, which is
the point, without failing the migration on historical rows nobody has audited. After you have
looked at the existing `deals.image_url` values, tighten it:

```sql
alter table public.deals validate constraint deals_image_url_is_https;
```

**0034 removes the ability to delete a beer, for everybody.** That is intended: `user_favorite_beers`
and `deals` reference beers, so a delete either fails on a foreign key or takes somebody's favourite
with it. Beers are deactivated now, like deals, admins and the weekly pick.

### Verifying, after applying

```sql
-- every new function is present and callable
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in ('refresh_offer_scores','report_offer','offer_standings','admin_audit',
                   'record_admin_action','admin_beers','admin_submitters','admin_coverage',
                   'watch_beer','contributor_trust','promotion_branches_near',
                   'is_moderator','admin_people','admin_people_by_city','admin_highlights')
 order by proname;   -- expect 15 rows

-- the audit log refuses to be edited
insert into public.admin_actions (actor, action, subject_kind) values (gen_random_uuid(),'x.y','z');
--   expect: permission denied for table admin_actions
```

---

## 2. No new secrets

Nothing in 0024–0043 needs an environment variable that is not already in
`docs/PRODUCTION-GO-LIVE-CHECKLIST.md`.

One that is already on the list matters more now: **`CRON_SECRET`**. Since 0.11.2 the ingestion run
calls `POST /api/cache/revalidate` with it, which is how a new import reaches the screens instead of
waiting out a five-minute cache. Without it the endpoint answers 503 and prices appear up to five
minutes late. That is a delay, not a failure — but it is worth setting before the first import.

---

## 3. Geocoding is an owner decision, still open

`branches.latitude` is null for every branch. The columns, the constraint and the distance
functions are in place; what is missing is a provider.

Until one runs:

- "הכי קרוב אליי" says it cannot measure, rather than showing an order it cannot justify;
- the branch list under a deal says *"we do not yet have the branches' locations"*;
- the coverage screen shows `0` located branches for every chain.

All three are honest states that already work. To change them, see `docs/GEOCODING.md` and run

```bash
node scripts/ingest/geocode.mjs --target staging          # dry run, prints what it would write
node scripts/ingest/geocode.mjs --target staging --apply
```

Staging first. There is no map screen, and `docs/GEOCODING.md` records why.

---

## 4. Four beers still have no bottle photo

Desperados, 1664 Blanc (`kronenbourg`), Miller, and Amstel — Amstel has no row at all yet. They get
the house palette and an unlabelled bottle, which is a complete working state, and
`/admin/beers` lists them so it is not rediscovered each time somebody notices.

Adding one is `scripts/fetch-bottles.mjs` → `scripts/prepare-bottle.mjs`, plus an identity in
`src/design/themes.ts`. Both are a deploy, not a form: a photo needs provenance and an identity is
code. That is deliberate (CLAUDE.md).

---

## 5. Two dependency advisories, knowingly left

`npm audit --omit=dev` reports `next` (moderate) and `postcss` (high). npm offers one fix for
either: `next@16.4.0`, a breaking major. Section 7 of `docs/V2-AUDIT-2026-10-07.md` records the
actual exposure — neither is reachable in this deployment's shape — and why a framework major
belongs to its own piece of work rather than to the end of a feature branch.

---

## 6. Order of operations

1. Merge `feature/beer-deals-v2` to `main`. **Confirm first whether merging triggers a deploy**: if
   Vercel is connected to `main`, it does, and the migrations must be applied BEFORE the merge.
2. Staging: migrations 0024–0043, then `npm run verify`, then click through the app.
3. Production: backup (handoff §C), then 0024–0043 in order, then the verification queries above.
4. `select public.refresh_offer_scores();` once, so the Deal Score has something to show.
5. Deploy, then `node scripts/smoke-production.mjs`.
6. Optional, later and independently: geocoding, the bottle photos, the Next 16 upgrade.
