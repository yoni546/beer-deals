# Production go-live checklist — release 0.9.0

Each line points to its step in `docs/PRODUCTION-HANDOFF-YONI.md`, which has the exact commands.

**Staging is `qpjwnxptitnmtsznjvkw`. If the production ref is the same, STOP.**

- [ ] **A** · Logged in to Vercel, Supabase (production account) and GitHub; repository cloned; `npm ci`
- [ ] **B** · Production ref copied from Supabase, and `export PROD_REF=...`
- [ ] **B** · `npx supabase link --project-ref "$PROD_REF"`, then `assert-production.sh` says **OK — linked to PRODUCTION**
- [ ] **B** · `inspect.sql` output saved (before)
- [ ] **C** · **Production backup verified**: C1 (Supabase → Database → Backups: completed, under 24 h old) **or** C2 (four dump files, none empty; needs Docker). Docker is not needed when C1 exists.
- [ ] **D1** · `migration list --linked` read. If Remote is empty or missing some of 0001–0005, reconcile (D2–D3); if it shows anything above 0005, **stop**.
- [ ] **D2** · **Production schema checked against migrations 0001–0005**: `verify-0001-0005.sql` says APPLIED for each, and `later` says none. Any NOT PROVEN: **stop**, send Ori the output.
- [ ] **D3** · **Remote migration history reconciled**: `migration repair <only the missing, proven versions> --status applied --linked`
- [ ] **D3** · **`migration list` shows 0001–0005 applied** on Remote
- [ ] **D4** · **`db push --dry-run` shows ONLY 0006–0018 pending**. If it lists any of 0001–0005: **stop**.
- [ ] **D5** · **Then and only then run `db push`** (backup verified + history reconciled + dry run clean)
- [ ] **D6** · `verify-schema.sql` shows 22 / 22; `inspect.sql` "after": 0001–0018 recorded, profiles and favourites unchanged
- [ ] **E** · Auth: Site URL `https://beer-deals.vercel.app`, anonymous sign-ins **on**, email **on**, rate limit raised
- [ ] **F** · Existing Vercel project connected to `yoni546/beer-deals`, production branch `main`, Node 22
- [ ] **G** · Production env vars set: `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `APP_ENV=production` · `NEXT_PUBLIC_SITE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `NEXT_PUBLIC_VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT`. **Not** `CRON_SECRET`. Nothing points at staging.
- [ ] **H** · `main` deployed
- [ ] **I** · `/api/version` shows 0.9.0 · production · your ref · the `main` commit, and the smoke test is all PASS
- [ ] **J** · GitHub secrets `PRODUCTION_SUPABASE_URL` + `PRODUCTION_SUPABASE_SERVICE_ROLE_KEY` added
- [ ] **J** · Canary: Rami Levy imported with `initial_population` checked, and 0 notifications pending
- [ ] **K** · Smoke test with `--expect-data` passes, and the phone checks pass
- [ ] **L** · Full import (GitHub Actions) with `initial_population` checked
- [ ] **L** · *(can come later; needs Python 3.10+)* Victory, Mahsanei and Hatzi Hinam imported from a computer in Israel
- [ ] **M** · Baseline confirmed: 0 notifications pending
- [ ] **N** · Manual production import runs green for 2–3 days, then Ori adds the schedule
- [ ] **O** · Real-phone test push works, then `CRON_SECRET` goes into Vercel and GitHub, plus the `SITE_URL` variable
- [ ] **P** · Final checks, and results sent to Ori
