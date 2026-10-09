# V2 on staging — the runbook

What to run, in what order, on **staging only** (`beer-deals-staging`, ref
`qpjwnxptitnmtsznjvkw`). Nothing here touches production. Production is a separate
pass, after this one is clean: `docs/V2-DEPLOYMENT-PREP.md` §6.

Everything that needs a key runs **on your machine**, not here: the keys live only in
the git-ignored `.env.staging.local`, and they are not to be pasted into chat.

---

## Step 0 — what is applied right now

`docs/STAGING.md` says 0001–0018 as of 2026-09-29, and the 0.9.0 ingestion work moved
it further. Before applying anything, read the ledger. Supabase SQL editor, staging
project:

```sql
select version from supabase_migrations.schema_migrations order by version;
```

Send me that list. If it ends at `0023`, step 1 is exactly 0024–0042. If it ends
earlier, the gap is bigger than this document assumes and I want to see it before you
run anything.

---

## Step 1 — apply the migrations

**The CLI is the right path**, because it applies only what is missing and records
what it did:

```bash
npx supabase link --project-ref qpjwnxptitnmtsznjvkw   # asks for the DB password
npx supabase db push --dry-run                          # READ THIS OUTPUT
npx supabase db push
```

The dry run prints the list of files it is about to apply. **Check that it names only
`0024`–`0042` and nothing older** before you let the real push go. If it wants to
re-run something old, stop and tell me.

If the CLI is not an option, the paste path is the SQL editor, **one migration file at
a time, in numeric order**, from `supabase/migrations/`. Do not paste
`RUN_THIS_IN_SUPABASE.sql` — that file is the whole schema from scratch and is for a
fresh project only.

---

## Step 2 — verify, from outside

One command, no secret needed (the publishable key is what every browser already
gets):

```bash
node scripts/check-environment.mjs \
  --url https://qpjwnxptitnmtsznjvkw.supabase.co \
  --anon-key <staging publishable key> \
  --expect staging
```

It prints 38 checks and exits non-zero if any fails. It verifies each V2 migration by
what it DID, not by its number:

- the new tables and columns answer a read (0026, 0027, 0030, 0031, 0037);
- the three tables nobody may read through the API refuse a visitor — the audit log,
  the name-change ledger, the submission blocks (0032, 0033, 0035);
- every new function exists and **refuses an ordinary user** (0025, 0027, 0031, 0032,
  0034, 0036, 0037, 0038, 0039, 0040, 0041, 0042);
- `is_admin()` answers false for a visitor, after 0040 tightened it;
- the audit log refuses a write even asked directly;
- and there is still no manual theme picker on `profiles`.

Send me the output. A failure names the migration.

Then, in the SQL editor, the catalogue side — fifteen functions:

```sql
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in ('refresh_offer_scores','report_offer','offer_standings','admin_audit',
                   'record_admin_action','admin_beers','admin_submitters','admin_coverage',
                   'watch_beer','contributor_trust','promotion_branches_near',
                   'is_moderator','admin_people','admin_people_by_city','admin_highlights')
 order by proname;
```

---

## Step 3 — give the Deal Score something to show

`offer_scores` is empty until it is computed once. Staging already holds every branch
of 15 retailers, so this will fill properly:

```sql
select public.refresh_offer_scores();
```

It returns the number of rows written. **If it returns 0**, no offer in staging has a
trusted reference price — which is a real answer, not a failure, and I would want to
know it.

---

## Step 4 — the app against staging

```bash
set -a; . ./.env.staging.local; set +a
NEXT_DIST_DIR=.next-staging npx next build
NEXT_DIST_DIR=.next-staging npx next start -p 3300
```

(Then revert `tsconfig.json` and `next-env.d.ts`, which the build rewrites —
`docs/STAGING.md`.)

Open <http://localhost:3300> and walk the four screens. What is new since you last
looked at staging, and what I would check first:

| Screen | What V2 put there |
|---|---|
| `/` | the score on the headline deal, "נמצא על ידי" when there is a name, "המחיר שחיכיתם לו" if you follow a beer |
| `/beer/<slug>` | follow-at-my-price, "עדיין קיים / נגמר" on each line, the branch list by distance |
| `/settings` | town and radius, the beers you follow, your standing |
| `/hunters` | the leaderboard and the scoring rules in the page itself |
| `/admin` | "מה גדול עכשיו", and the tabs: people, coverage, beers, audit |

Two things will say "we do not know", and that is correct until geocoding runs:
"הכי קרוב אליי" and every branch distance. If they say anything else, that is a bug
and I want to hear about it.

To see the admin panel you need a row in `admins` for your own staging user. The
roster is written only by `grant_admin()`, which needs a super admin — so on a
database with none, the first one is inserted by the owner:

```sql
-- your own user id: Authentication → Users, after you have opened the app once
insert into public.admins (user_id, level) values ('<your staging user id>', 'super_admin')
on conflict (user_id) do update set level = 'super_admin';
```

To exercise the new role (0040), make a second anonymous user a `moderator` the same
way and confirm it sees the queue and the reports but **not** people, settings or the
admin roster.

---

## Step 5 — the real-data check

```bash
E2E_STAGING=1 E2E_BASE_URL=http://localhost:3300 PW_CHANNEL=chrome \
  npx playwright test
```

That is `tests/e2e/staging-real-data.spec.ts` at 390×844 and 430×932 against staging's
actual catalogue — the one suite that can catch "it works on the fake and not on real
data".

---

## What I need back from you

1. the migration list from step 0;
2. the checker's output from step 2;
3. the number `refresh_offer_scores()` returned;
4. anything on a screen in step 4 that looked wrong.

With those four I can tell whether production is a go, and fix anything that is not.
