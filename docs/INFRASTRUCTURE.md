# Infrastructure, environments and release checklist

## Environments

| Environment | What it is | Data | Who/what may write |
| --- | --- | --- | --- |
| **Local fake** | `tests/e2e/fake-supabase` — the repo's real migrations on PGlite behind a PostgREST/GoTrue-shaped HTTP server | disposable, reset per spec | automated tests only. Binds to 127.0.0.1. |
| **Staging** | a second Supabase project + a Vercel Preview/Staging deployment. Set-up steps: [STAGING.md](STAGING.md) | sample data allowed (`supabase/seed/dev-demo-deals.sql`) | developers and agents, freely |
| **Production** | the live Supabase project + `beer-deals.vercel.app` | **real people's data** | reviewed migrations applied by the owner; the deployed app |

Rules that keep them apart:

- Nothing experimental runs against production. Automated tests use the local fake;
  manual exploration uses staging.
- A production server (`APP_ENV=production` or Vercel's own `VERCEL_ENV=production`)
  refuses to read sample deals no matter what the database contains
  (`src/lib/demo.ts`). Staging/previews keep showing them.
- The service-role key and VAPID private key exist only in Vercel (per environment) and in
  the owner's password manager. They are never written to a file in this repository.

## Where the database and the functions run (evidence, not assumption)

Every page is rendered on demand and makes several sequential database calls (session
check in middleware, viewer profile, then the page's own queries). So the distance between
the Vercel function and the Supabase database is paid several times per page — it matters
far more than the distance to the user.

**What was measured on 2026-09-29** (from an Israeli connection, against the project
`itpyyexhmvosxcbcagvy`):

| Signal | Result |
| --- | --- |
| Vercel function region (`X-Vercel-Id: fra1::iad1::…`) | edge in Frankfurt, **function in `iad1` (Washington DC)** — Vercel's default when no region is configured. There is no `vercel.json`. |
| DNS of `db.itpyyexhmvosxcbcagvy.supabase.co` | IPv6 `2406:da14:1772:ea01:ecbd:754:3565:ba5f` |
| Amazon's published ranges (`ip-ranges.amazonaws.com`, 2026-09-29-05-37-06) | that address is inside `2406:da14::/35` = **`ap-northeast-1` (Tokyo)** |
| Supabase REST TTFB for a one-row read from Israel | ≈ 330–430 ms warm (TCP to the Cloudflare edge is only ~21 ms) — consistent with a far-away origin |
| Page time to network-idle from Israel | 2.1–4.7 s on every route |

`docs/setup.md` recommends Frankfurt (`eu-central-1`) when creating the project, but the
evidence above points to **Tokyo**. This is strong technical evidence, **not** a
confirmation: an IP-range match tells us where the database host's address is allocated.

### To confirm (owner, 30 seconds)
Supabase dashboard → the project → **Project Settings → General → Region**.
Anything other than Tokyo means this analysis was wrong — tell whoever is working on this
before any region is changed.

### What to change once the region is confirmed
Do **not** change the Vercel region until the dashboard confirms the database region.

| Supabase region | Vercel function region (`regions`) |
| --- | --- |
| `ap-northeast-1` Tokyo | `hnd1` |
| `eu-central-1` Frankfurt | `fra1` |
| `eu-west-1` Ireland | `dub1` |
| `us-east-1` N. Virginia | `iad1` (already the default) |
| `ap-southeast-1` Singapore | `sin1` |

Then either add a `vercel.json`:

```json
{ "regions": ["hnd1"] }
```

or set **Vercel → Project → Settings → Functions → Function Region**. Deploy, then check:

```bash
node scripts/measure-latency.mjs https://beer-deals.vercel.app        # before
# …change the region, redeploy…
node scripts/measure-latency.mjs https://beer-deals.vercel.app        # after
```

**Baseline recorded 2026-09-29** (`--runs 6`, warm, from Israel, function in `iad1`, before
any change — even `/whats-new`, which did not exist yet and returned the 404 page, cost a
second because middleware and the root layout still query the database on every request):

| page | median | min | max |
| --- | --- | --- | --- |
| `/whats-new` (404 on that build) | 1002 ms | 988 | 1396 |
| `/beer/goldstar` | 1534 ms | 1011 | 1833 |
| `/store/rami-levy` | 1217 ms | 1170 | 1634 |
| `/welcome` | 1209 ms | 997 | 1236 |

The script prints the function region from `X-Vercel-Id` and median/min/max time to first
byte per page. Expect the function to sit next to the database and server time to drop
from seconds to a few hundred milliseconds. (Moving the function next to a Tokyo database
makes the *first byte* travel Tokyo→Israel once, instead of the function crossing an ocean
several times.)

### The bigger decision (owner)
Users are in Israel; a Tokyo database is ~200 ms away from them. Supabase cannot move a
project between regions in place. If the region is confirmed as Tokyo, the durable fix is a
new project in **Frankfurt** (`eu-central-1`) with the data restored into it — which is
exactly what the staging project in [STAGING.md](STAGING.md) can be used to rehearse
(create staging in Frankfurt; if it feels right, promote it to production later).

## Shipping release 0.2.0 (the hotfix) — the manual steps

I could not perform these: they need the Supabase and Vercel accounts.

1. **Apply migration `0006_retire_demo_deals.sql`** — Supabase dashboard → SQL Editor →
   paste the file → Run. It retires the sample deals, makes notifications opt-in for real,
   and grants the push sender its privileges. Safe to run twice. Check:
   ```sql
   select count(*) from public.deals where status = 'approved' and notes = 'מבצע לדוגמה'; -- 0
   select notifications_enabled, count(*) from public.profiles group by 1;
   ```
   (Migrations `0001`–`0005` are already applied in production. Nothing else is needed.)
2. **Deploy the app.** After the pull request is merged: `npx vercel deploy --prod`
   (or connect the repository — see below, and every merge deploys).
3. **Verify the live site** (read-only; it only creates the anonymous session every visit
   gets):
   ```bash
   E2E_BASE_URL=https://beer-deals.vercel.app PW_CHANNEL=chrome npx playwright test --project=mobile-390
   ```
4. **Rollback** if needed: Vercel → Deployments → promote the previous deployment. Migration
   `0006` needs no rollback — it only takes fake data out of view. (To bring the sample
   rows back on a *non-production* database, use `supabase/seed/dev-demo-deals.sql`.)

### Connect GitHub → Vercel (one-time, owner)
Vercel → the project → **Settings → Git → Connect Git Repository** → `yoni546/beer-deals`.
Production branch `main`; every pull request then gets a Preview deployment. Give Preview
its own Supabase URL/keys (staging) under **Settings → Environment Variables → Preview**;
never reuse production keys there.

### Environment variables per environment

| Variable | Production | Preview / staging | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | production project | **staging project** | public by design; RLS protects data |
| `NEXT_PUBLIC_SITE_URL` | `https://beer-deals.vercel.app` | the preview/staging origin | push links + auth redirects |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | prod pair | its own pair | one pair per environment; never share a private key |
| `SUPABASE_SERVICE_ROLE_KEY` | production | **staging** | server-only, sensitive |
| `APP_ENV` | optional (`VERCEL_ENV=production` already applies) | `staging` | `production` hides sample deals |
