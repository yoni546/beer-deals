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

---

## What this pass actually found (2026-10-11/12)

Written down because none of it was visible from the tests, and all of it will
be true again on the next environment.

### 1. The platform grants what the schema assumes nobody has

`anon` held SELECT, INSERT, DELETE and TRUNCATE on `admin_actions`. No migration
grants that; every Supabase project is created with default privileges that hand
each new table to the API roles. RLS kept the contents unreachable, but TRUNCATE
ignores RLS, and the two layers this project describes everywhere were one.
Migration 0043 takes it back and stops the default; `tests/sql/bootstrap.sql`
now starts from the platform's defaults so the sweep asks the same question of
every table added from here on.

**Production carries the same hole.** It is older than this branch.

### 2. The SQL editor does not say when a paste arrives short

A 182 KB paste was submitted as its first 4,471 characters, and Postgres blamed
an unterminated dollar quote at the opening `$$` thousands of characters
earlier. Two more attempts cut at different points. What settled it was asking
the owner to paste back what he had: 23% of the file.

The fix was not chunking — the chunks failed too. It was a copy that cannot be
cut: a page with a copy button per part, and a last line in each part that
prints its own name, so "no error" can never be mistaken for "it all arrived".

### 3. A masked value copies as bullets

The preview deployment could not sign anyone in. The reason, once the screen was
made to show it: `character at index 8 has a value of 8226`. 8226 is `•`, and
`eyJhbGci` is exactly eight characters — the environment variable held Supabase's
masked *display* of the key, not the key.

Copy a key with the dashboard's copy button. A value that starts right and ends
in dots is not a short key, it is a different string.

### 4. Deployments from another commit author are blocked on a Hobby plan

Vercel refuses to deploy commits whose author is not the account owner, and says
so only in the Redeploy dialog: *"Hobby teams do not support collaboration."*
Pushes from this session carry a different author, so a preview build for them
is not guaranteed.

### 5. Production's database is over the free-plan limit

`beer tnd beer`: **548.07 MB against a 0.5 GB limit**. Not caused by this work —
the daily import of fifteen retailers grows the price ledger — but Supabase
restricts a project that exceeds it, and the owner should decide between pruning
old price history and a paid plan before it decides for him.

### 6. The feature that was never going to work on its own (0045)

`branches.latitude` has been there since 0026 and empty since 0026 — 0 rows of
1,160 — because the Stores file carries a city and never a coordinate, and the
geocoder in `scripts/ingest/` refuses by default on purpose. So "הכי קרוב אליי"
has shipped, correctly, as a screen that explains it cannot measure anything.

The owner found it by using the app, which is the only way it was going to be
found: every test of it asserts the honest refusal, and they all passed.

Migration 0045 places each branch at its town's centre, recorded as
`geocode_precision = 'locality'` and worded on screen as "מרכז העיר". That is a
floor, not the answer: a street-level geocode still overrides it, because
`place_branches_by_town()` only ever fills a branch with no position. The same
gap existed for the person — a town they TYPED saved no point — and
`save_location` now fills it from the same table.

Nominatim cannot be run from this container at all: the agent proxy refuses
`nominatim.openstreetmap.org` with 403. A street-level pass has to be run from
the owner's own machine.

### 7. 0.33.0 shipped without an e2e run, and e2e was the only thing that knew

41 specs failed on the next run. Not the new work: `seedRealCatalog()`
re-attributes price sources AFTER the seed has filled `offers_catalog` (0044),
so the stored feed described a catalogue that no longer existed and every chain
offer vanished from every screen. `tests/e2e/helpers.ts` now exports
`rebuildFeed()` and calls it there.

0.33.0 was a data-model change, so `npm run e2e` was skipped under the
"UI changes" rule in CLAUDE.md. **A change to a read model the screens depend on
is a UI change.** The unit suite — 1,024 tests — was green throughout.
