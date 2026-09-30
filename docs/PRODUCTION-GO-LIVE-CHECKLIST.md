# Production go-live checklist — release 0.9.0

Each line points to its step in `docs/PRODUCTION-HANDOFF-YONI.md`, which has the exact commands.

**Staging is `qpjwnxptitnmtsznjvkw`. If the production ref is the same, STOP.**

- [ ] **A** · Logged in to Vercel, Supabase (production account) and GitHub; repository cloned; `npm ci`
- [ ] **B** · Production ref copied from Supabase, and `export PROD_REF=...`
- [ ] **B** · `npx supabase link --project-ref "$PROD_REF"`, then `assert-production.sh` says **OK — linked to PRODUCTION**
- [ ] **B** · `inspect.sql` output saved (before)
- [ ] **C** · Backup: dashboard backup noted, and four dump files in `backups/`, none empty
- [ ] **D** · `migration list` shows 0001–0005 on Remote (anything else: stop, send Ori the output)
- [ ] **D** · `db push --dry-run` lists exactly 0006–0018
- [ ] **D** · `db push` done, and `verify-schema.sql` shows 22 / 22
- [ ] **D** · `inspect.sql` output saved (after): profiles and favourites unchanged
- [ ] **E** · Auth: Site URL `https://beer-deals.vercel.app`, anonymous sign-ins **on**, email **on**, rate limit raised
- [ ] **F** · Existing Vercel project connected to `yoni546/beer-deals`, production branch `main`, Node 22
- [ ] **G** · Production env vars set: `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `APP_ENV=production` · `NEXT_PUBLIC_SITE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `NEXT_PUBLIC_VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT`. **Not** `CRON_SECRET`. Nothing points at staging.
- [ ] **H** · `main` deployed
- [ ] **I** · `/api/version` shows 0.9.0 · production · your ref · the `main` commit, and the smoke test is all PASS
- [ ] **J** · GitHub secrets `PRODUCTION_SUPABASE_URL` + `PRODUCTION_SUPABASE_SERVICE_ROLE_KEY` added
- [ ] **J** · Canary: Rami Levy imported with `initial_population` checked, and 0 notifications pending
- [ ] **K** · Smoke test with `--expect-data` passes, and the phone checks pass
- [ ] **L** · Full import with `initial_population` checked; Victory, Mahsanei and Hatzi Hinam imported from a computer in Israel
- [ ] **M** · Baseline confirmed: 0 notifications pending
- [ ] **N** · Manual production import runs green for 2–3 days, then Ori adds the schedule
- [ ] **O** · Real-phone test push works, then `CRON_SECRET` goes into Vercel and GitHub, plus the `SITE_URL` variable
- [ ] **P** · Final checks, and results sent to Ori
