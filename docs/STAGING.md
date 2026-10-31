# Staging environment

A second, disposable copy of the whole stack — its own Supabase project, its own
Vercel deployment, its own keys — where anything can be tried, seeded and broken
without touching real users. Everything in the repository that can be prepared for
it already is (migrations, seeds, CLI config, a checker); creating the project needs
an account with a browser, so this file is the exact runbook.

## Current state (2026-09-29): staging EXISTS

| | |
| --- | --- |
| Project | `beer-deals-staging`, ref **`qpjwnxptitnmtsznjvkw`**, created with the Supabase CLI |
| Account / organisation | the Supabase account this machine's CLI is logged into (organisation "GanzaxPhotography") — **not** the account that owns production (`itpyyexhmvosxcbcagvy`) |
| Region | **`ap-northeast-1` (Tokyo)** — the same region production's database address points to, so staging measures what production does. (The Frankfurt move below remains the durable fix for Israeli users; see INFRASTRUCTURE.md.) |
| Schema | migrations **0001–0018** applied (`supabase db push`) |
| Auth | anonymous sign-ins on (`supabase config push`, site URL `http://127.0.0.1:3100` — no emails are sent) |
| Data | **every branch** of 15 retailers (release 0.9.0 scan, 2026-09-30) — `docs/RETAILER-COVERAGE.md`; no sample seed |
| Keys | only in the git-ignored `.env.staging.local` on the machine that created it (URL, anon, service role, DB password, its own VAPID pair and CRON_SECRET), and as GitHub secrets `STAGING_SUPABASE_URL` / `_ANON_KEY` / `_SERVICE_ROLE_KEY` |
| Real-data checks | with the app on :3300 against staging: `E2E_STAGING=1 E2E_BASE_URL=http://localhost:3300 PW_CHANNEL=chrome npx playwright test` (390×844 and 430×932, `tests/e2e/staging-real-data.spec.ts`), and `node scripts/ingest/coverage.mjs --ui http://localhost:3300` → `docs/RETAILER-COVERAGE.md` |
| App against it | `set -a; . ./.env.staging.local; set +a; NEXT_DIST_DIR=.next-staging npx next build && NEXT_DIST_DIR=.next-staging npx next start -p 3300` (then revert `tsconfig.json` / `next-env.d.ts`, which the build rewrites) |
| Ingestion | `node scripts/ingest/fetch-sample.mjs && node scripts/ingest/parse.mjs && node scripts/ingest/run.mjs --target staging && node scripts/ingest/verify-staging.mjs`; daily: `.github/workflows/ingest-staging.yml` (from `main`) |
| Not done | a **Vercel staging/preview deployment** (needs the Vercel account — §4), so the staging notification worker has no URL to ring yet |

> **The minimum you must still do by hand:** §4 (Vercel preview → staging keys). Sections 1–3 are done.

## 0. Decisions already made

| | Choice | Why |
| --- | --- | --- |
| Region | **Frankfurt (`eu-central-1`)** | Closest Supabase region to Israel. The live project appears to be in Tokyo ([INFRASTRUCTURE.md](INFRASTRUCTURE.md)); making staging Frankfurt lets you compare speeds *and* rehearse the eventual move. |
| Sample data | allowed | `supabase/seed/*.sql` — refuse to run on production, flagged `is_sample`, hidden by a production server. |
| Keys | its own, never copied | A staging leak must not be a production incident. |
| Real user data | never copied | Use the seeds. |

## 1. Create the Supabase project (owner)

<https://supabase.com/dashboard> → **New project**

| Setting | Value |
| --- | --- |
| Name | `beer-deals-staging` |
| Region | Europe (Frankfurt / `eu-central-1`) |
| Database password | *Generate*, save it in your password manager (you need it for the CLI in §2) |
| Enable Data API | on |
| Automatically expose new tables | **off** (migrations grant exactly what is needed) |
| Enable automatic RLS | **on** |

Then **Authentication → Sign In / Providers → Anonymous sign-ins → enable.** (Every visitor is
an anonymous user; nothing works without it — the checker in §5 verifies it.)

Copy from **Project Settings → API Keys**: the project **URL** and ref, the **publishable
(anon)** key, and the **service_role** key. The service_role key bypasses row-level security:
it goes only into Vercel's environment variables (§4) — never a file, never chat.

## 2. Apply the schema

Either way, the result is identical (migrations `0001`–`0013`).

**A · CLI (recommended; repeatable)**
```bash
npx supabase login                         # opens the browser once
npx supabase link --project-ref <staging ref>     # asks for the database password
npx supabase db push --dry-run             # shows what will run
npx supabase db push                       # applies 0001 … 0013 in order
```
**B · paste**: `npm run sql:build` (the file is generated, not stored in git), then SQL editor →
New query → paste `supabase/RUN_THIS_IN_SUPABASE.sql` → Run (fresh project only).

**Only if a database was built from the early draft of `0011`** (it added a manual theme picker's
columns before that picker was removed — favourite #1 alone decides the look now). Check first:
`select column_name from information_schema.columns where table_name = 'profiles' and column_name in ('theme_override', 'appearance');`
If that returns rows, remove them (they only ever held a picker choice):
```sql
alter table public.profiles drop column if exists theme_override, drop column if exists appearance;
```

## 3. Seed staging (optional but useful)

SQL editor, one script at a time, **each starting with the confirmation line**:

```sql
set app.allow_demo_seed = 'yes';
-- …paste supabase/seed/dev-catalog.sql (SKUs, regular prices, promotions, multi-buys)…
```

To also have an admin and legacy sample deals: create your admin user (Authentication → Users →
Add user, auto-confirm), run `supabase/MAKE_ME_ADMIN.sql` (edit the email), then
`set app.allow_demo_seed = 'yes';` + `supabase/seed/dev-demo-deals.sql`.

## 4. Vercel (owner, once)

1. **Connect the repository**: Project → Settings → Git → Connect `yoni546/beer-deals`.
   Production branch stays `main`; every pull request now gets a Preview deployment.
2. **Give Preview its own database**: Settings → Environment Variables → add each of these
   for the **Preview** environment only:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | staging URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | staging service_role key (mark **Sensitive**) |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | a **new** pair: `npm run vapid` |
   | `NEXT_PUBLIC_SITE_URL` | the stable staging URL (below) |
   | `APP_ENV` | `staging` |

3. **A stable staging URL**: push a long-lived branch named `staging`; Vercel gives it a fixed
   preview domain (Project → Domains shows it), which you can also alias to
   `beer-deals-staging.vercel.app`. Merge feature branches into `staging` to try them together.

The Production environment keeps its own values. **Never** put production keys in Preview.

## 5. Verify

```bash
node scripts/check-environment.mjs \
  --url https://<staging ref>.supabase.co --anon-key <staging publishable key> \
  --site https://<staging site> --expect staging
```
It prints ✓/✗ for: reachable · anonymous sign-ins · every migration (0001–0013) · profile
columns protected · notifications off by default · the site's routes and function region.
Then the browser-level smoke: `E2E_BASE_URL=https://<staging site> npx playwright test`.

A staging page shows a small `STAGING` badge; if it were ever pointed at the production database
it would show a red warning bar instead ([`src/components/EnvironmentBadge.tsx`](../src/components/EnvironmentBadge.tsx)).

## 6. Working locally against staging (never production)

`.env.local` (git-ignored) with the **staging** URL / publishable key / service key and
`APP_ENV=staging`, then `npm run dev`. With no hosted database at all: `npm run e2e` runs the app
against the local fake ([tests/e2e/fake-supabase](../tests/e2e/fake-supabase)).

## 7. Shipping a schema change

1. New numbered file in `supabase/migrations/`, tests, `npm run sql:build`.
2. **Staging first**: `supabase db push` → `check-environment.mjs` → click through the change.
3. Then production, following `docs/PRODUCTION-HANDOFF-YONI.md` §C–§D. Its first migrations were applied by hand,
   so the CLI history may lack `0001`–`0005`. **Never mark them applied without proof:**
   `scripts/production/verify-0001-0005.sql` checks each one's objects first, and only versions it proves are
   repaired. Then `db push --dry-run` must list only the new files, and only then `db push`.
4. Run the checker with `--expect production`.

## 8. Rules

- No production keys in Preview/staging, no staging keys in Production.
- Seeds and imports run on staging first; the seed files refuse to run without an explicit
  confirmation, and a production server will not display sample data even if one slips in.
- Do not copy production data into staging (it is people's data). Use the seeds.
