# Production handoff — release 0.9.0 (for Yoni)

This is the only document you need. Follow it top to bottom; tick the short version as you go
(`docs/PRODUCTION-GO-LIVE-CHECKLIST.md`). Everything that did not need your accounts is done: the code is on
`main` (release 0.9.0, merge commit `e04d09c` and the handoff commit after it), every test is green, and the
staging project holds a full, verified copy of the real data.

**What is not done yet, because only your accounts can do it:**

- the production database: backup, reconciling the migration history (0001–0005 were applied by hand), migrations
  0006–0018, the first import;
- the Vercel project behind `beer-deals.vercel.app`: Git connection, settings, deployment.

**The two databases. Never mix them up.**

| | Supabase project ref |
|---|---|
| STAGING (test copy) | `qpjwnxptitnmtsznjvkw` |
| PRODUCTION (real users) | `<PRODUCTION_SUPABASE_REF>`: you read it in step B; it is never the staging one |

**If at any point the two refs are the same, STOP.** Every command that changes production is preceded by
`bash scripts/production/assert-production.sh "$PROD_REF" &&`. That guard prints both identities and refuses
unless the Supabase CLI is linked to the ref you typed, and that ref is not staging.

**If a result differs from what is written here, stop and send Ori the command and its output.** Do not improvise.
Nothing in this document deletes data.

---

## A. What you need

1. **Accounts:**
   - the Vercel account that owns the `beer-deals.vercel.app` project;
   - the Supabase account that owns the production project;
   - admin access to GitHub `yoni546/beer-deals` (to add secrets).
2. **A computer with Git and Node.js 22.** That is all you need for steps B–K: the backup (if the Supabase platform
   backup exists), migrations, Auth, Vercel, deployment, and the imports through GitHub Actions.

   Two tools are needed later, and only for one step each. Neither blocks the database or the deployment:

   | Tool | Needed for | Not needed for |
   |---|---|---|
   | **Docker Desktop** | **only** backup option C2 (`supabase db dump`), and only if the Supabase platform has no backup for you (C1) | migrations, Vercel, deployment, imports |
   | **Python 3.10+** | **only** importing from your own computer (step J route 2, and the Israel-local import of Victory, Mahsanei and Hatzi Hinam in step L): `scan.mjs` runs the price-file parser, which is written in Python | migrations, Vercel, deployment, and imports through GitHub Actions (the runner installs its own Python) |
3. **A copy of the repository**, using a terminal (on Windows: Git Bash):

   ```bash
   git clone https://github.com/yoni546/beer-deals.git
   ```

   ```bash
   cd beer-deals && npm ci
   ```

4. **Log in to Supabase and Vercel from this folder:**

   ```bash
   npx supabase login
   ```

   ```bash
   npx vercel login
   ```

## B. Prove which project is production

1. Supabase dashboard → the production project (the one the live site uses, **not** `beer-deals-staging`) →
   Project Settings → General. Copy the **Reference ID**, and note the **Region**.
2. Put it in your terminal. Do this in every new terminal window, replacing the placeholder with the ref:

   ```bash
   export PROD_REF=<PRODUCTION_SUPABASE_REF>
   ```

3. Link the CLI to it. It asks for the database password (Project Settings → Database, reset it there if
   nobody has it):

   ```bash
   npx supabase link --project-ref "$PROD_REF"
   ```

4. Prove it. It must end with `OK — linked to PRODUCTION`:

   ```bash
   bash scripts/production/assert-production.sh "$PROD_REF"
   ```

5. Record what production holds today. This is read-only and prints counts only:

   ```bash
   npx supabase db query --linked -f scripts/production/inspect.sql
   ```

   Keep the output: it is the "before" picture. Expect:
   - `latest_migration` / `migrations_recorded`: `0005` and `0001,…,0005`. But `no history table`, `empty`, or a
     shorter list is also possible, because the first tables were pasted in by hand. Step D handles every case.
   - profiles, favourites and legacy deals from the old app;
   - `null` for the tables the new schema adds.

## C. Back up production (before anything changes)

You need **one** verified backup before step D. C1 is enough when your plan has it; you do not need Docker then.

### C1. Supabase platform backup (preferred; nothing to install)

1. Supabase dashboard → the production project → left menu **Database** → **Backups**.
2. **Scheduled backups** tab: paid plans (Pro and up) list one backup per day. Check that:
   - the newest one is from the **last 24 hours**;
   - its status is completed;
   - on Pro, a **Download** button is shown. Download it and keep the file outside the repository; it is real people's
     data.
3. **Point in Time** tab: if point-in-time recovery is on, note the earliest and latest restorable times.
4. Record the backup's date and time, the plan name, and the production ref.

Supabase makes these backups automatically; there is no button to take one now. A restore returns the database to
that moment, so anything written after it would be lost. Before launch, that is only anonymous visits, which is
acceptable.

**If the Backups page says your plan has no backups (Free plan), or the newest one is older than 24 hours**, C1 is
not enough. Use C2, or upgrade the project to Pro first so a daily backup exists, and wait for it to appear.

### C2. Your own dump (only if C1 is not available; needs Docker Desktop)

Install Docker Desktop, start it, and wait until it says it is running. Every file lands in `backups/`, which git
ignores: it is real people's data, so never commit or share it.

```bash
bash scripts/production/assert-production.sh "$PROD_REF" && mkdir -p backups && export STAMP=$(date +%Y%m%d-%H%M)
```

```bash
npx supabase db dump --linked -f "backups/prod-$STAMP-schema.sql"
```

```bash
npx supabase db dump --linked --data-only -f "backups/prod-$STAMP-data.sql"
```

```bash
npx supabase db dump --linked --data-only --schema auth -f "backups/prod-$STAMP-auth.sql"
```

```bash
npx supabase db dump --linked --role-only -f "backups/prod-$STAMP-roles.sql"
```

Check the copy is real. No file may be empty, and the data file must contain the favourites and profiles:

```bash
ls -l backups/ && grep -c "user_favorite_beers\|profiles" "backups/prod-$STAMP-data.sql"
```

**Do not go on to step D without a verified backup (C1 or C2).** Record which one, its time, and the production ref.

## D. Apply the database migrations

The repository has 18 migrations, named by version `0001` … `0018` (the files `supabase/migrations/0001_schema.sql`
… `0018_read_model_at_scale.sql`). Release 0.9.0 needs all 18.

Production was first built partly by pasting SQL into the Supabase dashboard. So **0001–0005 may be in the database
without being in the CLI's migration history.** If the history does not have them, `db push` would try to run
0001–0005 again and fail on objects that already exist. **Do not run `db push` until D1–D4 are done.**

### D1. Read the migration history

```bash
npx supabase migration list --linked
```

Look at the *Remote* column:

| What Remote shows | Go to |
|---|---|
| exactly `0001`–`0005` | D4 (nothing to reconcile) |
| nothing, or only some of `0001`–`0005` | D2 |
| anything above `0005`, or versions that are not in the *Local* column | **STOP.** Send Ori the output. |

`inspect.sql` from step B says the same in one line: `migrations_recorded` is `no history table`, `empty`, or the
list of versions.

### D2. Prove 0001–0005 are really in the database (read-only)

```bash
npx supabase db query --linked -f scripts/production/verify-0001-0005.sql
```

It checks, one migration at a time, the objects that migration creates:

| Migration | What is checked |
|---|---|
| `0001` | 4 types, 10 tables, 3 functions, 5 triggers, 5 indexes (27 checks) |
| `0002` | the `deals_public` view, 14 functions, the public read grant (16 checks) |
| `0003` | row security on the 10 tables, the 22 table policies, the `deal-images` bucket, its 3 policies (4 checks) |
| `0004` | the 22 seeded beers and 15 seeded shops, by slug (2 checks) |
| `0005` | the one-approved-deal-per-shelf index, and the `approve_deal` that explains a duplicate (2 checks) |

It prints one row per migration, and a last row, `later`, that looks for objects of 0007–0018.

- A row that says **`APPLIED — may be marked applied`** proves that migration was applied by hand.
- A row that says **`NOT PROVEN`** lists what is missing. **Do not mark that version applied.** Stop and send Ori
  the whole output: the database does not match the migration, and running it again or marking it would both be
  wrong.
- The `later` row must say **`none (as expected)`**. If it says `LATER OBJECTS EXIST`, more was pasted by hand than
  0001–0005. **Stop** and send Ori the output.

### D3. Record the proven migrations in the history

Only for versions that D2 marked `APPLIED` **and** that D1 showed missing from *Remote*. Normally that is all five,
in one command:

```bash
bash scripts/production/assert-production.sh "$PROD_REF" && npx supabase migration repair 0001 0002 0003 0004 0005 --status applied --linked
```

If *Remote* already had some of them, list only the missing ones. For example, if Remote showed 0001–0003, run
`... migration repair 0004 0005 --status applied --linked`.

`migration repair --status applied` writes only to the migration history table. It runs none of the migration and
changes no data, so it is safe to repeat. Then read the history again:

```bash
npx supabase migration list --linked
```

*Remote* must now show exactly `0001`–`0005`. If not, stop and send Ori the output.

### D4. Dry run: only 0006–0018 may remain

```bash
bash scripts/production/assert-production.sh "$PROD_REF" && npx supabase db push --dry-run
```

It lists what it would apply. **It must be exactly `0006` … `0018` (13 migrations).** **If it lists any of
0001–0005, STOP:** do not push; send Ori the output.

(0006 is safe even if parts of it were once pasted by hand: its header says "safe to re-run", and D2's `later` row
has already shown that nothing from 0007 on exists.)

### D5. Apply, only now

Only after the backup (C) is verified, *Remote* shows 0001–0005, and the dry run lists only 0006–0018:

```bash
bash scripts/production/assert-production.sh "$PROD_REF" && npx supabase db push
```

These migrations only add tables, views, functions and rows. 0006 retires the 15 invented "מבצע לדוגמה" deals the
old app once seeded; they become `inactive`, and are not deleted.

### D6. Verify

```bash
npx supabase db query --linked -f scripts/production/verify-schema.sql
```

It must print `passed = total = 22` with `missing` empty. Then take the "after" picture:

```bash
npx supabase db query --linked -f scripts/production/inspect.sql
```

- `latest_migration` should be `0018`, and `migrations_recorded` should list `0001` … `0018`;
- `legacy_sample_deals_still_shown` should be `0`;
- profiles and favourites should match the "before" picture from step B.

**Rollback, only if something is wrong after 0017/0018:** `supabase/rollback/0018_read_model_at_scale.down.sql`,
then `supabase/rollback/0017_branch_scope.down.sql`. Both were rehearsed on staging. Earlier migrations only add
things; the backup from step C is the way back. Ask Ori before using either.

## E. Supabase Auth settings

The app signs every visitor in **anonymously** (`src/middleware.ts`, on their first page), and admins with
**e-mail + password** (`/admin/login`). It uses no OAuth, no magic links and no confirmation e-mails, so **it needs no
redirect / callback URLs**.

Supabase → Authentication:

1. **URL Configuration:**
   - **Site URL:** `https://beer-deals.vercel.app`
   - **Redirect URLs:** keep whatever is there. You may add `https://beer-deals.vercel.app/**`. Do not add
     `localhost` or any staging address.
2. **Sign In / Providers:**
   - **Allow anonymous sign-ins: ON.** Without it every visitor sees "לא הצלחנו להתחבר".
   - **Email: ON** (admin login).
3. **Rate Limits:** make sure *anonymous sign-ins per hour* is high enough for launch. Every new visitor is one
   anonymous sign-in, so raise it from the low default before sharing the link widely.
4. **Admins:** your admin account must exist in *this* project with its admin role (the same way as before;
   `supabase/MAKE_ME_ADMIN.sql` if needed). That is how you open **מה חדש**.

## F. Connect the existing Vercel project to GitHub

Use the **existing** project. Do not create a new one.

1. Vercel dashboard → find the project whose **Domains** include `beer-deals.vercel.app`.
2. Settings → **Git** → **Connect Git Repository** → GitHub → `yoni546/beer-deals`. Allow the Vercel GitHub app
   access to that repository if asked.
3. Production branch: Settings → **Environments → Production → Branch Tracking** (older dashboards: Settings → Git
   → Production Branch) → **`main`**.
4. Settings → **Build and Deployment**:
   - Framework Preset: **Next.js**
   - Root Directory: *empty* (the repository root is the app)
   - Build Command: default (`next build`)
   - Install Command: default
   - Output Directory: default
   - Node.js Version: **22.x**

   `vercel.json` pins the region to `hnd1` (Tokyo, next to the database). If the production database's region
   (step B) is not Tokyo, tell Ori before deploying.

**From now on, every push to `main` deploys production automatically**, and every pull request gets a preview
deployment. The day-to-day flow becomes: branch → pull request → CI green → merge → Vercel deploys `main`.

## G. Vercel environment variables

Vercel → Settings → **Environment Variables**. Names are exact; values come from the places below and never from
`.env.staging.local`.

| Name | Public or server | Needed | What it is | Where you get the value | Vercel scope |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | **yes** (the build fails without it) | the production database address | Supabase → Project Settings → Data API → Project URL (`https://<PRODUCTION_SUPABASE_REF>.supabase.co`) | Production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | **yes** | the public key; Row Level Security decides what it can read | Supabase → Project Settings → API Keys → `anon` / publishable | Production |
| `APP_ENV` | server | **yes** | must be exactly `production`: no staging badge, sample deals refused | type `production` | Production |
| `NEXT_PUBLIC_SITE_URL` | public | **yes** | the site's own address (links in notifications, page metadata) | type `https://beer-deals.vercel.app` | Production |
| `SUPABASE_SERVICE_ROLE_KEY` | **SERVER ONLY — never `NEXT_PUBLIC_`** | yes for notifications (pages run without it) | bypasses all row security; used only to send push | Supabase → Project Settings → API Keys → `service_role` / secret | Production |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | public | yes for notifications | Web Push public key | run `npm run vapid` once; use a **new pair for production** | Production |
| `VAPID_PRIVATE_KEY` | **SERVER ONLY — never `NEXT_PUBLIC_`** | yes for notifications | the private half of that pair | the same `npm run vapid` output | Production |
| `VAPID_SUBJECT` | server | yes for notifications | a contact address for push services | `mailto:` plus your e-mail | Production |
| `CRON_SECRET` | **SERVER ONLY — never `NEXT_PUBLIC_`** | **NOT YET: leave it unset until step O** | the notification worker's password; without it the worker is closed (503) and nothing can be sent | step O | Production |

- **Set automatically by Vercel:** `VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA`. `/api/version` reports the latter, so
  you can see what is deployed.
- **Never on Vercel:** `NEXT_DIST_DIR` and `PW_CHANNEL`, which are for local tests only.
- **Preview scope (optional, recommended):** for pull-request previews to build, give them the **staging** values:
  the staging URL and anon key, and `APP_ENV=staging`. They show a "staging" badge.

**Check before you deploy:** `NEXT_PUBLIC_SUPABASE_URL` contains your production ref and **not**
`qpjwnxptitnmtsznjvkw`, and `APP_ENV` is `production`.

## H. Deploy `main`

1. Vercel → Deployments → **Create Deployment** → branch `main` (or push any commit to `main`).
2. When it is Ready, compare its commit with `main` on GitHub. They must be the same:

   ```bash
   git ls-remote https://github.com/yoni546/beer-deals.git refs/heads/main
   ```

## I. Check what is deployed

Replace `<MAIN_SHA>` with the commit from step H:

```bash
curl -s https://beer-deals.vercel.app/api/version
```

It must show all of these:
- `"version":"0.9.0"`
- `"environment":"production"`
- `"supabaseRef":"<your production ref>"`
- `"commit":"<MAIN_SHA>"`

Then the automatic smoke test. It opens the site as **one** visitor: it creates one anonymous user and writes nothing
else.

```bash
node scripts/smoke-production.mjs --commit <MAIN_SHA> --supabase-ref "$PROD_REF"
```

Before the import the pages are empty ("אין כרגע מבצעים"), which is fine. An error screen is not. Every line must say PASS.

## J. Canary: import Rami Levy only

Notifications cannot go out during any of this: the worker has no `CRON_SECRET` (step G), and the first imports are
marked as the **baseline** (step M).

**Route 1: GitHub Actions (recommended; nothing to install)**

1. GitHub → Settings → Secrets and variables → Actions → **New repository secret**, twice:
   - `PRODUCTION_SUPABASE_URL` = `https://<PRODUCTION_SUPABASE_REF>.supabase.co`
   - `PRODUCTION_SUPABASE_SERVICE_ROLE_KEY` = the production service-role key

   Never reuse the `STAGING_*` secrets.
2. Actions → **Price ingestion (PRODUCTION, manual)** → **Run workflow**, with:
   - `confirm_ref` = your production ref
   - `publishers` = `rami-levy`
   - `initial_population` = **checked**
3. Wait for green (about 10 minutes). The last steps print how many notifications were marked as baseline.

**Route 2: from your computer (needs Python 3.10+; install it only if you choose this route)**

Create `.env.production.local` in the repository folder. It is git-ignored; write it by hand, never copy the staging
file. It holds three lines:

```bash
printf 'NEXT_PUBLIC_SUPABASE_URL=https://%s.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=%s\nAPP_ENV=production\n' "$PROD_REF" '<PRODUCTION_SERVICE_ROLE_KEY>' > .env.production.local
```

Then run these three commands in order (scan, write, baseline):

```bash
node scripts/ingest/scan.mjs --publishers rami-levy
```

```bash
node scripts/ingest/run.mjs --target production --confirm-ref "$PROD_REF" --publishers rami-levy
```

```bash
node scripts/ingest/baseline-notifications.mjs --target production --confirm-ref "$PROD_REF" --apply
```

`run.mjs` refuses unless:
- the file says `APP_ENV=production`;
- its address is the ref you typed;
- that ref is not staging.

**What a good canary looks like.** On staging (2026-09-30), Rami Levy had:
- 99 of 99 branches read;
- about 4,800 regular price rows (86 pack × chain lines on its page);
- 55 public promotions (48 in participating branches, 7 in a single branch, 0 chainwide);
- 2,658 branch listings;
- 3 four-pack and 21 six-pack products;
- no cases.

Today's source can differ a little; a large difference is a reason to stop and ask. Then:

```bash
npx supabase db query --linked -f scripts/production/inspect.sql
```

`notifications_pending` must be **0**, and `import_runs_open` must be **0**.

## K. Production smoke test (after the canary)

1. Automatic:

   ```bash
   node scripts/smoke-production.mjs --commit <MAIN_SHA> --supabase-ref "$PROD_REF" --expect-data
   ```

2. **By hand on your phone** (and at a narrow desktop window):
   - [ ] **First visit:** opening the site shows welcome, onboarding works, and you pick four beers.
   - [ ] **Home:** packs and cases only (no single bottles); your favourite beers first; the colours follow favourite #1.
   - [ ] **רמי לוי** (Supermarkets tab): six-packs first, then deals, then regular prices; every deal says where it runs
     (בסניפים משתתפים / "<branch> בלבד"). Tapping it lists the branches. Never בכל הרשת unless every branch lists it.
   - [ ] **Goldstar page:** שישיות / ארגזים / בודדים sections, and no line twice under the same pack.
   - [ ] **Mix-and-match** reads "קונים כמה, בוחרים מהמבצע".
   - [ ] **Settings:** "אהבתם? שתפו לחברים" shares `https://beer-deals.vercel.app`. There is no מה חדש link.
   - [ ] **Admin:** log in at `/admin/login`, and **מה חדש** shows 0.9.0. Log out, and `/whats-new` is "not found".
   - [ ] **Layout:** no "staging" badge anywhere, and no page wider than the screen.

## L. Full import (all supported chains)

Only after J and K pass.

- **Route 1:** Actions → **Price ingestion (PRODUCTION, manual)** → Run workflow with `confirm_ref` = your ref,
  `publishers` = *empty*, `initial_population` = **checked**. It takes 30–60 minutes.
- **Route 2:** the same three commands as step J, without `--publishers rami-levy`.

**Expect, compared with staging (2026-09-30):**

| | Staging |
|---|---:|
| Branches known | 1,122 |
| Branches read | 1,100 |
| Regular price rows | ~45,700 |
| Promotion rows | ~16,200 |
| Canonical promotions | 594 (38 chainwide · 488 participating · 57 single-branch · 11 unknown) |
| Branch listings | ~21,800 |
| Pack products | 65 four-packs · 303 six-packs · 0 eight-packs |
| Case products | 2 (32 branch prices) |

**Two known limits of GitHub Actions** (they come from the sources, not the code):

- **Victory, Mahsanei HaShuk and Hatzi Hinam refuse GitHub's servers** ("fetch failed" / HTTP 403, seen on
  2026-09-30). On route 1 they are reported FAILED and imported nothing. Run route 2 once, from a computer in
  Israel, for those three. **This is the one step that needs Python 3.10+ on your computer.** It can wait: the site,
  the database and every other chain work without it, and these three chains simply show no prices until it is done.

  ```bash
  node scripts/ingest/scan.mjs --publishers victory,mahsanei,hatzi-hinam
  ```

  ```bash
  node scripts/ingest/run.mjs --target production --confirm-ref "$PROD_REF" --publishers victory,mahsanei,hatzi-hinam
  ```

  ```bash
  node scripts/ingest/baseline-notifications.mjs --target production --confirm-ref "$PROD_REF" --apply
  ```

- **Fresh Market's Stores file is not listed at the source today.** On a fresh machine or runner its branch list is
  unknown until the chain lists the file again. The report says so; nothing breaks.

**Chains that stay out:**
- Super Yuda, Salach Dabach and Yellow need passwords the chains have not published (BLOCKED);
- יין בעיר and הרמיטאז' publish no feed;
- King Store's files list no beer.

Then: `inspect.sql` (as in step J), and the smoke test with `--expect-data`.

## M. Notification baseline

The first imports made every current promotion look "new". The `initial_population` option (route 1), or
`baseline-notifications.mjs --apply` (route 2), marked them all as handled (`outcome = baseline`): nobody is told
about deals that were already on the shelf. Future imports queue only genuinely new promotions. Confirm it; it must
say `pending notification events: 0`:

```bash
node scripts/ingest/baseline-notifications.mjs --target production --confirm-ref "$PROD_REF"
```

(Route 1 users without the local file: `inspect.sql` → `notifications_pending` = 0.) **Every later import runs with
`initial_population` unchecked.**

## N. Production ingestion workflow

`.github/workflows/ingest-production.yml`:
- **manual only**; there is no schedule;
- one run at a time;
- fails on its first step without the `PRODUCTION_*` secrets, or with a ref that does not match them;
- never resets, rolls back or rings the notification worker.

1. Run it by hand (Actions → Run workflow, `initial_population` unchecked) once a day for 2–3 days. Check each run is
   green and `inspect.sql` looks sane.
2. Then ask Ori to add the daily schedule. That is a small reviewed change; its test deliberately forbids a schedule
   until then.

Any bad run can be undone: every write belongs to one `ingestion_runs` row. Use this with the run id from the log:

```bash
bash scripts/production/assert-production.sh "$PROD_REF" && npx supabase db query --linked "begin; set local role service_role; set local statement_timeout = 0; select public.rollback_ingestion_run('<RUN_ID>', 'reason'); commit;"
```

A run of a whole chain can exceed the Supabase API's own time limit (seen on staging with 15,000 rows). If it does,
ask Ori: batched rollback is the one open item in `docs/INGESTION-READINESS.md`.

## O. Notifications: turn on only after a real phone test

**Do not set `CRON_SECRET` anywhere until all of these are true:**
- migrations are applied;
- the full import is done;
- the baseline shows 0 pending;
- a real-device test push works.

1. **Real phone test** (Android Chrome; iPhone Safari installed to the Home Screen, iOS 16.4+). This needs the VAPID
   variables from step G, not `CRON_SECRET`:
   1. Open the site and onboard.
   2. Settings → turn notifications on → accept.
   3. Tap **שלחו לי התראת בדיקה**. The notification must arrive within ~10 seconds, and tapping it opens Settings.
   4. Record the result in `docs/NOTIFICATIONS.md` §5.
2. **Then turn the worker on:**
   1. Generate one secret:

      ```bash
      node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
      ```

   2. Put it in Vercel as `CRON_SECRET` (Production), and redeploy.
   3. In GitHub, add a repository **secret** `CRON_SECRET` with the same value, and a repository **variable**
      `SITE_URL` = `https://beer-deals.vercel.app`.
   4. The existing 10-minute workflow (`notifications.yml`) starts ringing the worker. From then on, a genuinely new
      qualifying deal for someone's favourite #1 is announced.

## P. Final launch checklist

- [ ] `/api/version` shows 0.9.0, production, your production ref, and the `main` commit.
- [ ] The smoke test with `--expect-data` passes.
- [ ] The phone checks in K pass.
- [ ] `inspect.sql`:
  - [ ] migrations through 0018;
  - [ ] `notifications_pending` 0;
  - [ ] `import_runs_open` 0;
  - [ ] profiles and favourites as before.
- [ ] Backup files kept safely, outside the repository.
- [ ] Vercel builds `main` automatically; production env vars are set, and none point at staging.
- [ ] Notifications: either still off, or on after a passing real-device test (O).
- [ ] Tell Ori the production ref, the time of each step, and anything that differed. Ori records them in
  `docs/FINAL-READINESS-REPORT.md` (the ref only, never a key).
