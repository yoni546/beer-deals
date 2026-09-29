# Beer Deals — Product & Technical Audit

|  |  |
| --- | --- |
| **Date** | 2026-09-29 |
| **Repo** | `yoni546/beer-deals` (private) — default branch `main` |
| **Audited commit** | `c5910f132b9474f038b03acb20c0ab427adcd997` ("Add a guide for the second developer") |
| **Audit branch** | `audit/beer-deals-product-audit-2026-09-29` (local, not pushed) |
| **Checkpoint tag** | `pre-beer-deals-rebuild-2026-09-29` → `c5910f1` (local, not pushed) |
| **Live site tested** | <https://beer-deals.vercel.app> (production) |
| **Scope** | Audit only. No product code, schema, dependency or config was changed. The only additions are this file and `docs/audit-2026-09-29/`. |

Every claim below is tied to a file/line, a command that was run, or a live Playwright observation. Where something could **not** be verified, it is marked **UNVERIFIED** and section 20 lists exactly what is missing.

Status vocabulary: **WORKING · PARTIAL · STUB · BROKEN · MISSING · UNKNOWN** (UNKNOWN = needs live verification I could not perform).

---

## 1. Executive summary

**The app is a well-engineered *security shell* around a product that is not yet functional.** The database permission model, money handling and RLS tests are genuinely strong. But on production today the two core discovery flows are broken, the only data is fake, notifications cannot be trusted, and the data model cannot represent what the product is meant to become.

### The five things that matter most

| # | Finding | Evidence |
| --- | --- | --- |
| **1** | **"Search by beer" and "Search by supermarket" return HTTP 500 in production — and always have.** A Server Component passes a function (`hrefFor`) to a Client Component. Deal cards link nowhere, so those two pickers are the *only* in-app way to reach any beer or store page. | Live: `/beer` → 500, `/store` → 500. Reproduced locally on HEAD: `Functions cannot be passed directly to Client Components … hrefFor={function hrefFor}`. `src/app/beer/page.tsx:28`, `src/app/store/page.tsx:15`, `src/components/Picker.tsx:1`. Present since the first commit `278416e`. |
| **2** | **Production contains 15 deals and every one is a demo row labelled "מבצע לדוגמה" ("sample deal").** 15 of 22 beers have no deal at all. Real users see fake prices under a "🏆 מבצע השבוע" trophy. | Live inventory of 66 beer×pack pages (`docs/audit-2026-09-29/screens/10-home.jpg`). Source: `supabase/MAKE_ME_ADMIN.sql:65-95`. |
| **3** | **The notification chain is broken at three separate points, and was never verified end-to-end.** (a) tapping a push opens a 404 (`/beer/<uuid>` but the route takes a slug); (b) the Settings toggle shows "active" for users who never subscribed, so the first tap *turns it off*; (c) if the browser refuses `pushManager.subscribe()`, the whole Settings page crashes into the error screen. | (a) `src/lib/push/notify.ts:153` vs `src/app/beer/[slug]/page.tsx:27` — live `/beer/5f36acd2-…` → 404. (b) `0001_schema.sql:93` + `PushToggle.tsx:39,116` — live. (c) `PushToggle.tsx:75-81` no try/catch — live. |
| **4** | **The data model cannot hold the product.** "Goldstar 6×330ml" and "Goldstar 6×500ml" at the same chain *cannot coexist* (a unique index on beer+store+3-value category). There is no regular-price concept, no dates, no source, no history, no conditions. A deal *must* have a regular price strictly higher than the deal price. | Proven on the repo's own migrations in an in-memory Postgres (`docs/audit-2026-09-29/schema-probe.mjs`, results A2, D1, F1, G1). `0005_one_deal_per_shelf.sql:32-34`, `0001_schema.sql:25,145-152`. |
| **5** | **Visual identity is a single dark-brown/amber look; the "theme per favourite" is four hex colours, and Goldstar's theme is visually identical to the default.** The home screen is two giant buttons plus a list of identical cards. | ΔE(Goldstar preset vs default) = 2.5 / 5.5 / 0.0 (base/surface/accent). 10 of 21 parsed presets have an amber/gold accent; several pairs have ΔE < 6. Screens `10-home.jpg`, `12-beer-goldstar-sixpack.jpg`. |

### What is genuinely good (keep it)

- **Authorization lives in Postgres, not React.** RLS + `SECURITY DEFINER` functions with `require_admin()`; a submitted deal can only be inserted `pending`; reports cannot remove deals; only super-admins touch `admins`. 25 tests assert this against the real migrations on PGlite, as a non-superuser.
- **Money is integer agorot with string-based parsing** (`src/lib/money.ts`), with tests for the classic `19.99 × 100` float trap and `24,90` comma handling.
- **Anonymous-session onboarding is real:** first request creates a Supabase anonymous user (`src/middleware.ts:35-45`); verified live (cookie `sb-…-auth-token`, expires 2027-11).
- **PWA basics work:** manifest 200, all icons 200, SW activates and controls the page, `Cache-Control: no-store` on `/sw.js`, offline fallback renders (`screens/41-offline.jpg`), and navigations are deliberately never cached.
- **Toolchain is green:** `tsc --noEmit` ✓, `eslint src` ✓, 37/37 vitest ✓, `next build` ✓.

### Verdict

Do **not** start a visual redesign on top of this. Sequence must be: **(0)** guardrails — the release/What's-New rule, CI and a staging database (so even the hotfix follows the permanent rule and is tested off-production) → **(1)** hotfix the five P0 defects as the first release under that rule → **(2)** migrate the data model (expand-only) → **(3)** design system + IA redesign → **(4)** rebuild notifications and verify on real devices → **(5)** ingestion. Details in §15.

---

## 2. Current architecture

| Concern | Reality (verified) |
| --- | --- |
| Framework | Next.js **15.5.26** App Router, React **19.1**, TypeScript 5.9 strict. `package.json` says `next ^15.5.4`; lockfile resolved 15.5.26. |
| Package manager | **npm** (`package-lock.json`); Node `>=20.11` (audited on Node 24.19). |
| Routing | App Router, 15 routes, **all dynamic** (`ƒ` in `next build`; every page has `export const dynamic = "force-dynamic"`). Route group `src/app/admin/(panel)` exists so the admin layout does not wrap `/admin/login` (guarded by `tests/routes.test.ts`). |
| Styling | Tailwind **v4** (`@tailwindcss/postcss`), utility classes only; theme colours via 4 CSS variables on `<html>`; **no component primitives** (the same `rounded-2xl bg-[color:var(--surface)] ring-1 ring-white/10` string is repeated across ~10 files). One font: Heebo (`next/font/google`, 400/500/700/900). |
| Components | 12 plain React components in `src/components`, 4 in `src/components/admin`. Server Components by default; client components only for interaction (`Picker`, `Onboarding`, `PreferencesEditor`, `PushToggle`, `SubmitDealForm`, admin actions). |
| State management | None client-side beyond `useState`/`useActionState`. URL query (`?c=`, `?tab=`) is the state for pack tabs. No store, no cache layer. |
| Auth | Supabase Auth. **Everyone is an anonymous user** (created in middleware); admins sign in by email+password at `/admin/login` (`AdminLogin.tsx`), replacing the anonymous session. Role = row in `public.admins`. |
| Supabase | `@supabase/ssr` (server+browser clients), `@supabase/supabase-js`. Server client is request-scoped; a service-role client (`src/lib/supabase/admin.ts`) exists **only** for the push sender. DB types are **hand-written** (`src/lib/db/types.ts`), not generated. |
| Env vars | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; server-only `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`.env.example`, `src/lib/env.ts`). `env.ts` throws at import if the two required public vars are missing → a misconfigured deploy fails hard, not softly. |
| Deployment | Manual `npx vercel deploy --prod` (docs/setup.md §8). **No `vercel.json`, no GitHub→Vercel link, no GitHub Actions** (`.github/` absent; GitHub API: 0 deployments, 0 PRs, 0 issues). Which commit is live is **UNKNOWN**. Live headers: `X-Vercel-Id: fra1::iad1::…` → edge in Frankfurt, **function in iad1 (US-East)**. |
| DB migrations | 5 SQL files in `supabase/migrations/`, applied **by pasting into the dashboard SQL editor** (no Supabase CLI history). `supabase/RUN_THIS_IN_SUPABASE.sql` is a hand-concatenated copy — verified byte-identical to 0001–0005 today, but sync is manual. `docs/setup.md` §3 lists only 0001–0004 (omits 0005). |
| Seed / scripts | `0004_seed.sql` (22 beers, 15 stores), `supabase/MAKE_ME_ADMIN.sql` (makes an admin **and inserts 15 demo deals**), `scripts/seed-demo-deals.mjs` (same demo set, second copy), `scripts/generate-icons.mjs`, `scripts/generate-vapid.mjs`. |
| PWA / SW | `public/sw.js` (108 lines): precache offline page + icons; cache-first for `/icons/` and `/_next/static/`; **navigations never cached**; `push` and `notificationclick` handlers. `RegisterServiceWorker` registers on `load`. Manifest is static (`theme_color #17130b`, does not follow the user's theme). **No `favicon.ico`** (404). |
| Notifications | `web-push` + VAPID; sender `src/lib/push/notify.ts` is invoked **only** from the `approveDeal` server action (`src/lib/actions/admin.ts:32`). |
| Scheduled jobs | **None.** |
| CI | **None.** `npm run verify` = typecheck + test + build (lint is *not* part of it). |
| Tests | Vitest 3: `security.test.ts` (25, DB/RLS), `money.test.ts` (10, includes the message builder), `routes.test.ts` (2). **Zero** UI, E2E, push-targeting or server-action tests. |
| Analytics / observability | **None** (no analytics, no error reporting; server errors are only `console.error`). |
| Versioning / changelog | `package.json` version `0.1.0`, never bumped. No `CHANGELOG.md`, no release data, no in-app version display. |
| Project instructions | **None** — no `CLAUDE.md`, `AGENTS.md`, or `.cursorrules`. `docs/for-collaborators.md` is the only guide (and has a "things worth knowing before you change them" table that this audit preserves in §17). |
| Git | Remote branches: `main`, and **`redesing`** (typo; identical to `main` at `c5910f1`, no unique commits). |

Verification commands run (all from the repo root, dependencies via `npm ci`, lockfile untouched):

```
npx tsc --noEmit        → clean
npx eslint src          → clean
npx vitest run          → 3 files, 37 tests passed
next build              → OK (all 15 routes dynamic; middleware 93.8 kB)
```

---

## 3. Current database model

### 3.1 Tables (as migrated)

```
auth.users ──┬─ profiles (1:1, created by trigger)
             │     first_name, primary_beer_id*, notifications_enabled (default TRUE),
             │     onboarded_at
             │        └─ user_favorite_beers (profile_id, rank 1..4, beer_id)  PK(profile_id,rank), UNIQUE(profile_id,beer_id)
             ├─ admins (user_id, level: admin|super_admin)
             ├─ push_subscriptions (user_id, endpoint UNIQUE, p256dh, auth, user_agent)
             ├─ push_log (user_id, deal_id, beer_id, sent_at)
             └─ deal_reports (deal_id, reported_by, reason, status)

beers  (id, slug, name_he, name_en, theme_base/surface/accent/ink, sort_order, is_active)      -- 22 rows
stores (id, slug, name_he, is_active)                                                            -- 15 rows, "chains, not branches"
deals  (id, beer_id, store_id, category ENUM(sixpack|case|single),
        deal_price_agorot, regular_price_agorot, discount_percent GENERATED,
        image_url, notes<=280, status ENUM(pending|approved|rejected|inactive),
        created_by, approved_by, created_at, approved_at, updated_at, notified_at)
app_settings (single row: weekly_deal_id, notify_min_discount_percent=25,
              notify_max_price_agorot=3000, notify_cooldown_hours=20,
              weekly_deal_preferred_beer_slug='goldstar')
view deals_public (approved deals ⨝ beers ⨝ stores, security_invoker)
storage bucket deal-images (public, 5 MB, jpeg/png/webp/heic)
* primary_beer_id is derived from favourite rank 1 by trigger sync_primary_beer()
```

### 3.2 Answers to the required questions

| Question | Answer (with source) |
| --- | --- |
| What represents a **beer**? | `public.beers` row = a *brand-level name* (`goldstar`, `tuborg`, `tuborg-red`). It carries **no** volume, container, pack, ABV, style, brand/variant split. It is also the *theme carrier* (4 colour columns) — identity and presentation are fused in one table. (`0001_schema.sql:44-56`) |
| What represents a **retail product / SKU**? | **Nothing.** The closest thing is `deals.category` — a 3-value enum `sixpack \| case \| single` (`0001:25`). A "sixpack" says nothing about 330 vs 500 ml, can vs bottle. |
| What represents a **supermarket**? | `public.stores`. Documented as **chains, "There is deliberately no branch table"** (`0001:63-65`). The seed mixes retail chains with non-chains: `liquor-store` "חנות אלכוהול" and `makolet` "מכולת שכונתית" (`0004_seed.sql:59-61`). |
| A **store/branch**? | Not representable. |
| A **regular price**? | Not an entity. `deals.regular_price_agorot` is a required column *of a deal* and must be **strictly greater** than the deal price (`deals_price_is_a_discount`, `0001:147`). A non-promotional price row cannot be inserted (probe **D1**: `23514 deals_price_is_a_discount`). |
| A **promotion**? | A `deals` row. |
| **Promotion dates**? | **None.** No `valid_from/valid_to`. Only `created_at`, `approved_at`. A deal lives until a human sets `inactive`; a "עד יום שישי" limit can exist only inside the free-text `notes` (≤280 chars). |
| Many observations per SKU over time? | **No.** One mutable row. `admin_update_deal()` overwrites prices in place (probe **F1/F2**: 1 row before and after, no history). `set_deal_status('inactive')` also nulls `approved_by/approved_at` (probe **G1**), erasing who vouched for it. Migration `0005` did the same to historical duplicates. |
| Regular price coexisting with a promotion? | Only as the "was" price inside one deal row. There is no independent regular price to compare against or verify. |
| Can pack size *and* volume be represented? | **No.** Probe **A2**: approving "Goldstar 6×500" at Rami Levy after "Goldstar 6×330" fails with `23505` because of `deals_one_approved_per_shelf_idx (beer_id, store_id, category) WHERE status='approved'` (`0005:32-34`). Probe **D2**: any other pack (`twelvepack`) is rejected by the enum. |
| Conditions (2-for-X, club-only, min quantity)? | **No structure.** Only the 280-char `notes`. |
| Is history preserved? | **Overwritten.** See above. `notified_at` and `push_log` are the only append-style records. |
| How are favourites linked to users? | `user_favorite_beers(profile_id → profiles.id, beer_id → beers.id, rank 1..4)`; PK `(profile_id, rank)` + `UNIQUE(profile_id, beer_id)`; written atomically via `save_preferences(name, uuid[4])` (`0002:84-123`). Rank 1 → `profiles.primary_beer_id` by trigger. Live-verified (theme vars switched after onboarding). **Favourites are per anonymous auth user, i.e. per browser cookie jar.** |
| How are notifications linked to users? | `push_subscriptions.user_id → auth.users` (one row per device endpoint) + `profiles.notifications_enabled` + `profiles.primary_beer_id`. Sender selects `profiles WHERE primary_beer_id = deal.beer_id AND notifications_enabled`, then their subscriptions (`notify.ts:91-125`). |

### 3.3 Schema problems that must be fixed *before any price ingestion*

| ID | Problem | Why it blocks ingestion | Evidence |
| --- | --- | --- | --- |
| S-1 | No SKU concept (brand/variant/container/volume/pack). | Chain feeds are per-barcode SKUs; nothing to attach them to. | `deals.category` enum |
| S-2 | `deals_one_approved_per_shelf_idx` on `(beer_id, store_id, category)`. | Two real SKUs of one beer at one chain (very common) collide. | probe A2 |
| S-3 | Deal requires `deal < regular`. No regular-price rows. | Half the product (regular prices) is unrepresentable; promos with unknown/equal reference price are rejected. | probe D1 |
| S-4 | No observation history; in-place edits; provenance nulled on take-down. | Cannot show price trends, cannot audit a bad import, cannot roll back a run. | probes F, G |
| S-5 | No `source`, `observed_at`, `valid_from/to`, external ids, ingestion-run id. | Cannot dedupe, expire, attribute or roll back imported data. | `deals` columns |
| S-6 | No branch dimension; `stores` mixes chains and non-chains. | Chain feeds are per-store-file; prices differ by branch/format. | `0001:63-65`, seed |
| S-7 | `discount_percent` is a **stored generated column** computed from a user-entered "regular" price. | Bakes an unverifiable "original" price into a persisted savings claim (see §10.5 on fake savings). | `0001:150-152` |
| S-8 | Theme colours stored on `beers`. | Fine for 4 colours; cannot host a token system, and couples catalog rows to presentation. | `0001:49-52` |
| S-9 | `profiles` has a table-wide UPDATE grant. | A user can write `primary_beer_id` / `onboarded_at` directly (probe **C2** succeeded) → notification targeting and theme can be forged/desynced. | `0003:35,91` |
| S-10 | `save_push_subscription` upserts on `endpoint` as `SECURITY INVOKER`. | Same browser + new anonymous id ⇒ `42501` (probe **B2**); subscription can never move to the new identity. | `0002:410-417`, `0003:190-192` |
| S-11 | `notifications_enabled` defaults `TRUE`. | UI claims "active" with no subscription (live-verified). | `0001:93` |

No destructive migration is proposed in this audit. §11 gives an expand-only path.

---

## 4. Feature status matrix

| # | Feature (from product intent) | Status | Evidence / note |
| --- | --- | --- | --- |
| 1 | Anonymous "open link and use" session | **WORKING** | Live: `/` → 307 → `/welcome`, cookie set. `middleware.ts:35-45` |
| 2 | Onboarding: name + 4 ranked favourites | **PARTIAL** | Saves and reaches home (live). But step 3 is unusable (B-06) and step 2→3 advance ignores save result (B-07). |
| 3 | Favourites stored with unique rank, #1 = Primary | **WORKING** | Live + `security.test.ts` "preferences" |
| 4 | Edit favourites in Settings | **PARTIAL** | Same tap-to-rank UI, prefilled (`PreferencesEditor.tsx`). Reordering = clear & re-pick; no reorder gesture. |
| 5 | Favourite deals prioritised in main feed | **MISSING** | Home feed = admin's weekly deal + "latest 6 by `approved_at`" (`page.tsx:24-25`, `queries.ts:182-194`). Live (audit user's favourites: Goldstar, Maccabee, Heineken, Corona): Tuborg — not a favourite — is the first "now" card and Carlsberg sits above Heineken (#3); order is approval time only. Favourites only reorder the `/beer` picker (broken) and feed the store "mine" tab. |
| 6 | Favourite #1 = default visual theme | **PARTIAL** | Mechanism works (`--base=#1a1206…` after ranking Goldstar first). But 4 flat colours; Goldstar ≈ default. |
| 7 | Manual theme override | **MISSING** | No UI, no column, no cookie. |
| 8 | Push when new deal for favourite #1 | **BROKEN → UNVERIFIED** | Targeting logic exists (`notify.ts`); click-through 404; toggle lies; subscribe crash; end-to-end delivery never observed. §13 |
| 9 | **Search by beer** | **BROKEN** | `/beer` 500. Direct `/beer/goldstar` **WORKING**. |
| 10 | **Search by supermarket** | **BROKEN** | `/store` 500. Direct `/store/rami-levy` **WORKING**. |
| 11 | Beer view: all deals for a beer across stores | **PARTIAL** | Works per pack tab, promotions only, price asc only, pack size ambiguous. |
| 12 | Store view: all beer deals in the store | **PARTIAL** | Tabs "הכי משתלם"/"הבירות שאני אוהב" × 3 pack tabs. Discount-desc only. |
| 13 | Store view: regular non-promo prices | **MISSING** | Not in schema. |
| 14 | Sorting: price ↑ / ↓ / discount % | **MISSING** as a user control | Hard-wired: beer page price asc (`queries.ts:65`), store page discount desc (`:87`). |
| 15 | Distinguish Goldstar 330 / 500 / 6×330 | **MISSING** | S-1, S-2, probe A2/D2 |
| 16 | Promotion conditions & dates | **MISSING** | Free-text `notes` only |
| 17 | User deal submission | **WORKING** | Live: validation + live discount preview verified (`screens/43-submit-preview.jpg`). Insert path covered by tests; **not** exercised on prod on purpose (would pollute the moderation queue). Photo is uploaded but **never displayed** to users (only an admin link, `DealActions.tsx:73`). |
| 18 | Admin moderation / reports / weekly deal / thresholds | **WORKING (by tests)** / **UNKNOWN live** | No admin credentials; `/admin` correctly redirects anonymous users to `/admin/login`. |
| 19 | Regular prices + promotions data model | **MISSING** | §3 |
| 20 | Real deal data | **STUB** | 15/15 demo rows |
| 21 | PWA install | **PARTIAL** | Manifest, icons, SW ✓. `beforeinstallprompt` path untestable headless. Step-3 install screen unreachable (B-06). No favicon. |
| 22 | Offline behaviour | **WORKING** | Live: offline → "אין חיבור לאינטרנט" (`screens/41-offline.jpg`) |
| 23 | Loading states | **MISSING** | No `loading.tsx`/Suspense/skeletons; blank 2–4.5 s waits. |
| 24 | Error states | **PARTIAL** | One generic `error.tsx`; `not-found.tsx` OK. Core routes 500 into it. |
| 25 | Hebrew / RTL | **WORKING** | `dir=rtl lang=he`, `.num` LTR isolation, no horizontal overflow at any tested width. |
| 26 | What's New / versioning / changelog | **MISSING** | §14 |
| 27 | CI / scheduled automation | **MISSING** | — |
| 28 | Analytics / error monitoring | **MISSING** | — |

---

## 5. Bugs / broken behaviour

Severity: **P0** = core promise broken now · **P1** = will bite the rebuild or a subset of users · **P2** = polish.

| ID | Sev | Bug | Where | Verified |
| --- | --- | --- | --- | --- |
| **B-01** | P0 | `/beer` and `/store` → 500. `hrefFor={(slug)=>…}` (a function) is passed from a Server Component into the `"use client"` `Picker`; React cannot serialise it. `next build` passes because it is a runtime render error. | `src/app/beer/page.tsx:28`, `src/app/store/page.tsx:15`, `src/components/Picker.tsx:1,26-33` | Live 500 ×2; local repro on HEAD with the audit user's session |
| **B-02** | P0 | Production shows demo data as real ("מבצע לדוגמה"), incl. the 🏆 weekly deal. | `supabase/MAKE_ME_ADMIN.sql:65-95` (+ `scripts/seed-demo-deals.mjs`) | Live inventory: 15/15 |
| **B-03** | P0 | Push click-through → 404. Payload URL is `/beer/${deal.beer_id}` (UUID), route resolves **slug**. | `src/lib/push/notify.ts:153` vs `src/app/beer/[slug]/page.tsx:27`, `queries.ts:36` | Live: `/beer/5f36acd2-…` → 404 |
| **B-04** | P0 | Toggle shows "התראות פעילות 🔔" for a user with **no subscription** (DB default `true`), so the first tap runs `turnOff()`, sets `false`, and the user must tap again to actually subscribe. | `0001_schema.sql:93`; `PushToggle.tsx:39,116` | Live (permission granted, `getSubscription()` = null, toggle "active"; first click → "off") |
| **B-05** | P0 | `turnOn()` has no error handling. If `pushManager.subscribe()` throws (Chrome incognito, push blocked, iOS not installed, FCM unreachable) the rejection escapes the transition and the **whole Settings page is replaced by the global error screen**. | `PushToggle.tsx:60-98` | Live: incognito context → `AbortError` → "משהו השתבש" (`screens/32-settings-notif-turnon.jpg`) |
| **B-06** | P1 | Onboarding step 3 (install + notifications explanation) is shown for ~1–3 s, then the app navigates to `/`. The action calls `revalidatePath("/","layout")`; the re-render of `/welcome` hits `if (viewer.isOnboarded) redirect("/")`. Users cannot read the last step. | `src/lib/actions/profile.ts:47`, `src/app/welcome/page.tsx:11`, `Onboarding.tsx:156-181` | Live timing trace (step-3 text at ~1.1 s, `/` at ~3 s; aborted `POST /welcome`) |
| **B-07** | P1 | The submit button advances to step 3 with `setTimeout(()=>setStep(3),0)` **regardless of the save result**; the error message renders only inside step 2 (now hidden). On a failed save the user sees "אהלן … " then `router.replace("/")` → bounced back to `/welcome`. | `Onboarding.tsx:137-143,173-178` | Code-verified; failure path not forced live |
| **B-08** | P1 | Re-subscribing a device under a *new* anonymous user (cookies cleared, new profile) fails with an RLS `42501`; the endpoint is stuck on the old user. | `0002_functions.sql:410-417`, `0003_rls.sql:190-192` | PGlite probe **B2** |
| **B-09** | P1 | Serverless function runs in **iad1** while docs say the DB is in Frankfurt; each page does middleware `getUser()` + 2–4 sequential queries across the Atlantic. Cold navigations measured 2.1–4.7 s from Israel. | `X-Vercel-Id: fra1::iad1`; `docs/setup.md` §1 | Live headers + timings (every route measured: 2.1–4.7 s to `networkidle`, cold and warm alike) |
| **B-10** | P1 | One-approved-deal-per-(beer,store,category) makes multi-SKU impossible. | `0005_one_deal_per_shelf.sql:32-34` | Probe **A2** |
| **B-11** | P1 | A user can forge `primary_beer_id` / `onboarded_at` on their own profile. | `0003_rls.sql:35,91-92` | Probe **C2** |
| **B-12** | P2 | `/favicon.ico` → 404 (console noise on every page, no tab icon). Middleware even lists it as an exclusion. | no `src/app/icon`/`favicon.ico`; `middleware.ts:57` | Live `curl` 404 |
| **B-13** | P2 | `notificationclick` calls `client.navigate()` on *any* open window incl. uncontrolled ones (can throw; hijacks an unrelated tab) with no `.catch`. | `public/sw.js:96-106` | Code-verified |
| **B-14** | P2 | Docs drift: `setup.md` §3 omits migration 0005; `README` "Categories never mix" is a rule the new model must replace. | `docs/setup.md` | Code-verified |
| **B-15** | P2 | Deal photos are collected/uploaded but never shown publicly. | `SubmitDealForm.tsx`, only consumer `DealActions.tsx:73` | grep |

### Console/network noise seen live
`Failed to load resource: 404` on every page (= favicon), `A preload … cross-world service worker resource mismatch` warnings on `/beer`, `/store` (font/CSS preloads not used after the SW takes control), and the two 500s. No other JS errors.

---

## 6. Technical debt relevant to the rebuild

1. **No staging environment.** `docs/for-collaborators.md`: *"There is no separate dev database, so a deal approved locally is approved for everyone on the live site."* Any rebuild or ingestion experiment touches production data. (During this audit a local dev server was pointed at prod, read-only, for the same reason.)
2. **Hand-applied migrations + a hand-concatenated mirror file** (`RUN_THIS_IN_SUPABASE.sql`). No migration history table; drift is guaranteed eventually. Adopt the Supabase CLI (`migration repair` first, as setup.md already warns).
3. **Hand-written DB types** with `as unknown as` casts (`admin-queries.ts`, `session.ts`, `notify.ts`). A schema migration will silently desync them. Generate types.
4. **No UI/E2E/notification tests, no CI.** `verify` omits lint. Nothing stops B-01-class regressions (a green build shipped a 500 on the primary flow).
5. **Demo data has three homes** (`MAKE_ME_ADMIN.sql`, `seed-demo-deals.mjs`, the `notes = 'מבצע לדוגמה'` marker convention) and is stamped `notified_at = now()` so nobody is pushed about it — a workaround that a real pipeline must not inherit.
6. **Presentation tokens live in a data table** (`beers.theme_*`) with no validation; measured contrast is inconsistent (see §7).
7. **No component primitives / design tokens.** One class string per look, repeated. Emoji used as icons everywhere. Any redesign would be a repo-wide find/replace without a primitive layer.
8. **Hard-coded Hebrew strings in components** and Goldstar special-casing in schema (`weekly_deal_preferred_beer_slug default 'goldstar'`, `0001:263`) and admin logic.
9. **Every route `force-dynamic` + middleware auth round-trip on every request** (matcher covers all but static assets, `middleware.ts:57`). Fine for correctness, poor for latency (B-09); no cacheable public catalogue pages.
10. **Dead/unused:** `getBestDealPerBeer` (`queries.ts:93`, 0 callers), `PickerItem.accent` (unused prop), `image_url` public path, `.claude/launch.json` is the only Claude config.
11. **Notification sender semantics that ingestion will break:** `notified_at` is stamped on *every* skip path (below threshold, no recipients, all on cooldown, no subscriptions — `notify.ts:87,98,115,128,181`). For a manual approval that is sensible ("this deal had its chance"); for a daily import it means a deal first seen when nobody had subscribed can never notify a later subscriber. Also the sender runs synchronously inside the approve server action (Vercel timeout exposure) and only there.
12. **Anonymous identity = cookie.** Clearing site data, switching browser, or (on iOS) opening the installed PWA versus Safari yields a *different* user → favourites, theme and push subscription silently reset. There is no recovery path. **UNVERIFIED on a real iPhone** — must be tested before betting the notification feature on it.
13. **Stray lockfile warning** (`C:\Users\origa\package-lock.json` makes Next infer the wrong workspace root). Environment-specific; `outputFileTracingRoot` would silence it.


---

## 7. Current UX/UI problems

Review lenses: the published *craft-floor* and *critique* rubrics of **Impeccable** (`pbakaus/impeccable`, Apache-2.0, read from source at commit `114ea1d`), the installed `frontend-design` skill, and the token-layering guidance on [designsystems.one](https://www.designsystems.one/) (primitive → semantic → component tokens). Impeccable itself was **not installed** into this repo: its installer writes `.claude/`, `PRODUCT.md`, `DESIGN.md` and `.impeccable/` into the project, which would change the repo during an audit-only phase. Installing it is step 1 of Phase 3 (§15).

Measured facts come from Playwright on production (390×844 @2x unless noted).

| ID | Problem | Evidence |
| --- | --- | --- |
| U-1 | **Emoji are the icon system and the logo** (🍺 mark, 🛒 ⚙️ 🛠️ 🏆 🍻 📦 🔔). They render per-OS (the settings gear is a purple system emoji on Windows Chrome), cannot be themed, and read as a template. Impeccable ban: *"Unicode glyphs or emoji standing in for an icon system."* | `screens/01-welcome-step1.jpg`, `10-home.jpg` |
| U-2 | **One look for everything: near-black brown + amber.** Default `#17130b/#231d12/#e0a52b`; 10 of 21 parsed presets have an amber/gold accent; closest pairs (leffe~shapiro ΔE 3.9, paulaner~shapiro 4.7, goldstar~negev 5.2, goldstar~stella 6.3) are indistinguishable on a phone. **Goldstar's preset is the default theme** (ΔE 2.5 / 5.5 / 0.0), so the flagship "favourite #1 theme" changes *nothing visible* for the most likely #1. Card vs page contrast is ≤ 1.18:1 in every preset — cards are separated only by a 10 % white ring. | `h-themes.mjs` output (§8.4), `12-beer-goldstar-sixpack.jpg` |
| U-3 | **Home spends its first viewport on navigation chrome.** Two 90-px full-width buttons + a "send us a deal" link occupy y≈100–340 of 844; the first deal card starts at y≈405 and is the admin's weekly deal, not "my beers". There is no persistent nav, so switching beer↔store means going back to Home. | `10-home.jpg`, `5-m430-home.jpg` |
| U-4 | **A wall of identical cards** (`DealCard`): same shape, same weight, same amber; 7 in a row on Home. The price (30 px amber) and the discount badge (amber block) compete; there is no beer or store identity; nothing on the card is tappable (dead end — no link to the beer or store page). | `10-home.jpg`, `DealCard.tsx` |
| U-5 | **Repeated low-value chrome on every card:** an underlined "דווח שהמבצע נגמר" link (93×25 px hit area, 11 px, 45 % opacity) on all 7 cards; strikethrough regular price at 12 px / 60 % opacity; the "מבצע לדוגמה" note. Noise ≫ signal. | Playwright small-target scan |
| U-6 | **Type scale is compressed and too small where it matters.** Home uses 10 px ×7 and 11 px ×7 text nodes (badge caption, report link), 12 px ×35. One family (Heebo) at four weights; no display voice, no Hebrew-specific typographic character; numbers are the same face as prose. | `metrics()` font-size census |
| U-7 | **Secondary text fails contrast.** Text is faded with `opacity-45…65` over the surface colour. Measured: ink at 45 % on surface = **3.9–4.15 : 1** across presets (needs 4.5 : 1 for body text); Budweiser preset button text (`base` on `accent`) = 3.7 : 1, accent-on-surface 3.5 : 1. | `h-themes.mjs` |
| U-8 | **Touch targets under 44 px:** settings gear 40×40, back chevron 40×40, pack tabs and store tabs 40 px high, report link 93×25, "חזרה" text button 36 px high. | Playwright scan |
| U-9 | **Settings is a 1500-px scroll.** The full 22-beer grid is shown *under* a 4-slot summary that duplicates the same data; reordering requires clearing and re-picking (documented in `PreferencesEditor.tsx` header); notification copy contradicts itself ("התראות פעילות" and "ההתראות חסומות ברמת הדפדפן" at once); no theme control, no version, no what's-new. | `20-settings.jpg` |
| U-10 | **Empty states are grey text boxes** ("אין כרגע מבצע מאושר על גינס בשישיות") with no next action. With 15/22 beers empty this is the *most common* state a user sees. | `15-beer-guinness-empty.jpg`, `19-store-makolet-empty.jpg` |
| U-11 | **No loading states.** No `loading.tsx`, Suspense or skeletons anywhere; each navigation is a blank 2–4.5 s wait (B-09). | file listing; timings §8.2 |
| U-12 | **Error handling is one generic screen** ("משהו השתבש") shown for 500s, crash-on-subscribe, etc.; it names neither problem nor recovery. | `11-beer-picker.jpg`, `32-settings-notif-turnon.jpg` |
| U-13 | **Pack tabs hide the comparison the user cares about.** By design there is no "All" (a documented rule to avoid comparing ₪8.90 singles to ₪24.90 sixpacks), so the user cannot see best price per litre across formats. The fix is unit-price normalisation (§10.5), not tabs. | `CategoryTabs.tsx` |
| U-14 | **Desktop = the phone column centred on a 1280-px canvas** (448 px content, no overflow). Acceptable for a phone-first product, but wasted; tablet identical. | `5-desktop-home.jpg`, `5-tablet-home.jpg` |
| U-15 | **Flat background, no atmosphere, no motion authored anywhere** (only a 400 ms background-colour ease). Nothing says "beer" beyond the emoji. | all screens |
| U-16 | **Onboarding is functional but joyless and repetitive**: a name field, then 22 same-size tiles; the four "slot" pills duplicate the ranking already shown as badges. The most important choice (#1 = your theme + your notifications) gets one sentence. | `02b`, `03b` |
| U-17 | **No affordance for the product's differentiator.** "Best deal", "cheapest across chains", "new today", "ends soon", "for you" — none exist as concepts in the UI. | `page.tsx` |

**RTL / Hebrew verdict:** direction, language, number isolation and mixed Hebrew/Latin strings render correctly at every viewport; no horizontal overflow at 390/430/768/1280. The back chevron is `›` (correct for RTL). This part is done well and must be kept (§17).

**Against the target ("distinctive, premium, fun, beer-related, modern; not pub-kitsch, not generic SaaS cards, not gradient+glass"):** the current product fails on *distinctiveness* (U-1, U-2, U-4, U-15) and *utility* (U-3, U-17), not on polish. Re-colouring would fix neither — the structure (two buttons + identical cards + emoji) is the problem, which is why the redesign is specified as an IA and component change (§10), not a palette change.

---

## 8. Playwright findings

### 8.1 Method
- **Tooling:** no Playwright MCP exists in this environment. I installed `playwright-core@1.63` in the audit scratchpad (outside the repo — `package.json` untouched) and drove the machine's installed **Google Chrome** (no browser download). Scripts and raw output were kept out of the repo; only curated screenshots and the schema probe are committed.
- **Viewports:** 390×844 @2x and 430×932 @2x (mobile, touch, `isMobile`), then 768×1024 and 1280×800. Locale `he-IL`, timezone `Asia/Jerusalem`.
- **Session:** fresh context (no cookies) → Supabase anonymous user → onboarded as **"AUDIT-BOT"** (favourites Goldstar, Maccabee, Heineken, Corona) → state reused for all later runs.
- **Deliberately not done on production:** submitting a deal, filing a report, admin login/actions, sending pushes. (Validation paths were exercised; they reject before any insert.)

### 8.2 Route results (mobile 390×844, onboarded user)

| Route | HTTP | ms to `networkidle` | Result |
| --- | --- | --- | --- |
| `/` (first visit, no cookie) | 307 → `/welcome` 200 | 4679 | Anonymous session created |
| `/` (onboarded) | 200 | 4488 | Weekly + 6 latest, all demo |
| **`/beer`** | **500** | 2671 | **Error screen (B-01)** |
| `/beer/goldstar` (+`?c=case`, `?c=single`) | 200 | 2506–2718 | 3 / 1 / 1 demo deals |
| `/beer/guinness` | 200 | 2515 | Empty state |
| **`/store`** | **500** | 2630 | **Error screen (B-01)** |
| `/store/rami-levy` (+`tab=mine`) | 200 | 2518 / 2710 | Mine tab: 1 deal + 3 "no deal" |
| `/store/makolet` | 200 | 2120 | Empty state |
| `/settings` | 200 | 2207 | See B-04 |
| `/submit` | 200 | 2894 | Validation + live preview OK |
| `/admin/login` | 200 | 2222 | Form |
| `/admin` (anon) | 200 (after redirect) | 4251 | → `/admin/login` ✓ |
| `/this-page-does-not-exist`, `/beer/does-not-exist` | 404 | 2104 / 3452 | Branded 404 ✓ |
| `/beer/<beer uuid>` (push target) | **404** | — | **B-03** |
| `/beer/goldstar?c=<script>` | 200 | — | Falls back to sixpack ✓ (`parseCategory`) |
| `/favicon.ico` | 404 | — | B-12 |

Layout scan: `overflowX=false` on every route at every viewport; `dir=rtl lang=he` everywhere.

### 8.3 Behaviour tests

| Test | Result |
| --- | --- |
| Onboarding step 1→2→3, rank Goldstar>Maccabee>Heineken>Corona | Saved; theme vars changed to the Goldstar preset (`--base=#1a1206 …`). Step 3 visible ≈1.1 s then redirected to `/` (**B-06**). Aborted `POST /welcome` + aborted `GET /?_rsc=` in the failed-request log. |
| Favourite priority in feed | **Absent** (see matrix #5). |
| Notification toggle, permission `granted`, no subscription | Shows "active"; first tap → "off" (**B-04**). |
| `pushManager.subscribe()` in Playwright's (incognito) context | Chrome: *"does not support the Push API in incognito mode"* → `AbortError` → **whole page becomes the error screen** (**B-05**). |
| Same, in a persistent (non-incognito) headless profile | No subscription created within 12 s, no error — headless Chrome has no reachable push service. **End-to-end subscribe is UNVERIFIED** and needs a real Android/iOS device (§13.6). |
| Service worker | Registered, `activated`, controls the page after reload. |
| Offline (`setOffline(true)` then navigate) | Offline page ✓ (`41-offline.jpg`). |
| Submit form: deal ₪40 vs regular ₪39.90 | Server returns "מחיר המבצע צריך להיות נמוך מהמחיר הרגיל." No insert. Comma input `24,90` + `39.9` → live preview "38%- הנחה" ✓ |
| Search box filtering (`Picker`) | **Cannot be exercised** — the page that hosts it 500s. Logic read from source: substring match on Hebrew label or English alias, no niqqud/geresh normalisation, no fuzzy match, stores have no alias. |
| Live catalogue inventory | 66 beer×pack pages, 0 non-200, **15 deal cards, 15 marked "מבצע לדוגמה"**; deals per beer: goldstar 5, heineken 3, maccabee 2, corona 2, carlsberg 1, tuborg 1, stella 1; 15 beers zero. Chains covered: 9 of 15. |

### 8.4 Theme census (computed from `0004_seed.sql`; 21 of 22 rows parsed — Beck's has an escaped quote my regex skipped)

| Metric | Result |
| --- | --- |
| ink on base | 16.0–17.6 : 1 (fine) |
| accent on surface | 3.5 (budweiser) – 9.0 (desperados); **budweiser 3.5, malka 4.3, tuborg-red 4.4** below 4.5 for small text |
| button text (`base` on `accent`) | budweiser **3.7**, malka 4.8, tuborg-red 4.9 |
| ink @45 % on surface | 3.93–4.15 (all fail 4.5) |
| ink @60 % on surface | 5.8–6.4 (pass) |
| card-vs-page (`base` vs `surface`) | ≤ 1.18 : 1 in every preset (max); 4 of 21 are below 1.10 |
| amber/gold-ish accents | goldstar, corona, stella, paulaner, guinness, leffe, desperados, shapiro, negev, somersby (10/21) |

---

## 9. Screenshots / evidence index

All in [`docs/audit-2026-09-29/screens/`](audit-2026-09-29/screens/) (JPEG, 2x). Reproduce the data-model claims with `node docs/audit-2026-09-29/schema-probe.mjs` from the repo root (uses the repo's own `@electric-sql/pglite`, no network).

| File | Shows |
| --- | --- |
| `01-welcome-step1.jpg` | Onboarding step 1 (emoji logo, empty viewport) |
| `02b-welcome-step2-empty-full.jpg`, `03b-welcome-step2-picked-full.jpg` | Ranking UI, 22 tiles |
| `10-home.jpg` | Home: two buttons, weekly deal, 7 identical demo cards (full page) |
| `11-beer-picker.jpg` | **`/beer` 500** error screen (same for `/store`) |
| `12-beer-goldstar-sixpack.jpg` | Beer page, three cards |
| `15-beer-guinness-empty.jpg`, `19-store-makolet-empty.jpg` | Empty states |
| `18-store-ramilevy-mine.jpg` | Store "my beers" tab |
| `20-settings.jpg` | Settings (contradictory notification copy, duplicate beer grid) |
| `21-submit.jpg`, `43-submit-preview.jpg` | Submit form, live discount preview |
| `30-settings-notif-before.jpg` | Toggle "active" with no subscription |
| `32-settings-notif-turnon.jpg` | **Settings crashed by failed subscribe** |
| `40-push-target-404.jpg` | Push target `/beer/<uuid>` → 404 |
| `41-offline.jpg` | Offline fallback |
| `5-m430-home.jpg`, `5-tablet-home.jpg`, `5-desktop-home.jpg` | 430 / 768 / 1280 responsive behaviour |

---

## 10. Proposed product architecture

> Everything in §10–§14 is a **proposal to be validated**, not a decision. Where a choice is a hypothesis, it says so.

### 10.0 Navigation model
Replace "Home with two buttons" with a **persistent 4-item bottom bar**: **דילים (Deals) · בירות (Beers) · סופרים (Stores) · אני (Me/Settings)**. Deal cards become links (to the beer-at-chain view). Search is a first-class control on the Beers and Stores tabs (and a global ⌕ on Deals). Drawing icons from one real icon set (not emoji). Admin stays outside the bar (`/admin`).

### 10.1 Home / Deals
Above the fold at 390×844, top to bottom:

```
┌──────────────────────────────┐
│ מה חדש•        (small)   ⚙   │  ← What's New control (§14), no greeting hero
│ ── הבירות שלי ─────────────── │
│ [1 גולדסטאר  ₪25 · רמי לוי ]  │  ← #1 tile wider, themed; best CURRENT offer
│ [2 מכבי ₪—][3 …][4 …]        │  ← rank 2-4 compact; "אין מבצע" quietly
│ ── הכי משתלם עכשיו ────────── │  ← ONE hero deal (computed, §10.5)
│ ┌ big price · pack · chain ─┐ │
│ └───────────────────────────┘ │
│ chips: [הכל][המועדפות שלי]     │  ← sticky filter/sort row starts here
│        [מיון: הנחה ▾]          │
└──────────────────────────────┘
```

- **Prioritise favourites** with an explicit rule: section 1 = deals on my 4 beers ordered by *my rank*, then by value; section 2 = "other deals" ordered by value. Rank 1 is visually dominant; ranks 2–4 are not notification targets (unchanged product rule).
- **"Best deal" communication:** one hero, chosen by computed *verified value* (§10.5), replacing the manual weekly deal as the default; the admin "weekly deal" survives as an *editorial override slot* (it is an existing, tested feature — §17).
- **Avoid the wall of cards:** group by beer (a beer strip with its cheapest offer, expandable to chains) rather than one card per (beer,chain,pack); only the hero and rank-1 use large cards; everything else is a dense list row (price left, chain, pack, unit price). Limit the first paint to ~8 rows then "show all".
- **Freshness:** a global "עודכן לפני X" (last successful ingestion) and per-deal "נראה לאחרונה" replace the invisible staleness of today.

### 10.2 Beer page
```
[← ] גולדסטאר                       (beer theme accent, brand strip)
[ מבצעים ] [ מחירים רגילים ]        ← segmented, deals first
pack chips: [הכל] [6×330 פחית] [6×500 בקבוק] [24×330] …   sort: [הנחה ▾ | מחיר ↑ | מחיר ↓]
── 6 × 330 מ״ל פחית ─────────────
  ₪25.00   רמי לוי    במקום ₪37.90 (−34%)  ⓘ מועדון
  ₪29.90   שופרסל     …
── 6 × 500 מ״ל בקבוק ────────────
  …
```
- **Group by SKU** (container·volume·pack), never mix packs inside a group; a header states the pack in plain language. A toggle switches the whole page to **₪ per litre** so different packs are comparable.
- Promotions first; the **"מחירים רגילים"** segment is a price-comparison table (chain × SKU, freshest observation, "עודכן"). Default sort in a group: effective price ascending; "הנחה" sorts by *verified* value.
- Each row shows conditions as chips ("2 ב־₪45", "חברי מועדון", "עד 12.10").

### 10.3 Store (supermarket) page
- Header: chain name (typographic, no logos), freshness, branch selector *only if* branch data exists.
- **Two segments, one page:** `מבצעים` (default, top) and `כל המחירים`. Promotions render as a compact list ≤ ~12 rows with "show all"; **regular prices are never rendered inline under promotions** — they live in the second segment as a searchable, brand-grouped list (collapsed brand sections, in-page search, sticky brand index), so the page never becomes huge.
- Filter chips: `המועדפות שלי`, pack type, brand. Sort: value / price ↑ / price ↓ (same control as everywhere).
- "הבירות שלי" stays as a filter chip instead of a separate tab; missing favourites appear as one quiet line ("אין מבצע על מכבי, קורונה") rather than N empty cards.

### 10.4 Search
- One search sheet, two scopes (`בירות | סופרים`) plus recent searches. **Normalise Hebrew** (strip niqqud, unify geresh/gershayim, ה'/ה׳, ignore final-letter forms) and match Hebrew *or* English *or* known aliases (`גולדסטאר/גולדסטר/goldstar`); rank prefix > word > substring; tolerate one edit for words ≥ 5 letters.
- Filters (bottom sheet, applied as chips): pack, container (can/bottle), volume, brand, "has deal now", chain (multi). Results show the *best current offer* inline so search doubles as price lookup.
- Mobile: results in a full-height list under a fixed 48-px input; thumb-zone filter/sort buttons; 44-px rows; keyboard `inputMode=search`, `enterkeyhint=search`.

### 10.5 Deal value (safe discount calculation)
Never store a percentage. Never show one that depends on an unverified "original" price.

1. **Effective price** of an offer = shelf/promo price for the pack; for a multi-buy ("2 ב־₪45") = `total ÷ qty` **only when the user's cart would have qty** — display both ("₪22.50 ליחידה בקנייה של 2").
2. **Reference price** = the most recent **regular** `price_observation` for the *same SKU at the same chain* (branch if known) whose `observed_at` is ≤ **14 days** before the promo's observation and whose source is a **chain feed** (not a user typo).
3. `value_pct = round((reference − effective) / reference × 100)` is shown **only if** a reference exists **and** `0 < value_pct ≤ 70`. Above 70 % it is *held for review* (bad barcode/unit mismatch is the usual cause). Otherwise show the price alone, no badge.
4. **Second, independent metric — "market" comparison:** `effective` vs the **median regular price of the same SKU across the other chains**. Labelled distinctly ("זול ב־12 % מהממוצע ברשתות"). This cannot be gamed by a chain inflating its own "before" price.
5. **Per-litre value:** `unit_price = effective ÷ (volume_ml × pack_count / 1000)`. Sorting across mixed packs uses `unit_price`; within one SKU group it uses `effective`.
6. Missing/old reference ⇒ no percentage, no strikethrough, no "you save". The badge is computed in a SQL view, so it cannot drift from the prices it derives from (this preserves the *intent* of today's generated column — §17 — while removing the unverifiable input).

### 10.6 Settings (final structure)
1. **הבירות שלי** — 4 ranked rows with drag-handle reorder (plus up/down buttons for a11y), tap a row to swap that beer; rank 1 badge "הבירה הראשית: עיצוב + התראות".
2. **התראות** — one master switch that reflects *real* state (permission + subscription + profile flag); per-rank scope (default: #1 only), min discount, quiet hours, "send test notification"; explicit states: *off / needs permission / blocked in browser / unsupported (iOS: install first)*.
3. **מראה** — `אוטומטי (לפי הבירה הראשית)` (default) or pick any theme; live preview.
4. **התקנה** — install prompt (Android one-tap / iOS 3 steps), shown only when not installed.
5. **מה חדש** — link + current version.
6. **על האפליקציה / כניסת מנהלים** (small).

### 10.7 What we keep from today's flows
Tap-to-rank is kept as a fallback for a11y, name field optional (not required), onboarding shortened to: pick 4 → confirm order → done (optional install/notification prompts appear later, in context, not as a last step that can be skipped by a redirect).

---

## 11. Proposed canonical beer / SKU / price / promotion model

### 11.1 Principles
1. **A product is identified by physical facts, not by brand name.** `Goldstar` (brand) ≠ `Goldstar Unfiltered` (variant) ≠ `Goldstar 6×330 ml can` (SKU).
2. **Observations are append-only.** "Current price" is a *view* over observations.
3. **Regular price and promotion are the same kind of fact** (a price seen at a time, at a place, from a source) with different `kind` and optional conditions.
4. **Provenance on every row:** source, external reference, `observed_at`, ingestion run.
5. **Expand → migrate → contract.** No table dropped or rewritten in the first phases.

### 11.2 Entities (illustrative DDL — not applied anywhere)

```sql
-- Existing `beers` stays and is *reinterpreted* as "product family" = brand + variant
-- (it already separates tuborg / tuborg-red). Add columns; keep slug, FK targets, favourites intact.
alter table beers
  add column brand_slug     text,            -- 'goldstar'  (grouping; nullable at first)
  add column variant        text,            -- 'unfiltered' | 'red' | '0.0' | null
  add column style          text,            -- 'lager' …
  add column abv            numeric(3,1),
  add column theme_slug     text;            -- points at design system preset (§12)

create type container_type as enum ('bottle','can','keg','draft','other');
create type price_kind     as enum ('regular','promotion');
create type promo_type     as enum ('price_cut','multi_buy','club_price','coupon','gift','other');
create type source_kind    as enum ('chain_feed','admin','user_submission','scraper','import');

-- The sellable unit.
create table skus (
  id            uuid primary key default gen_random_uuid(),
  beer_id       uuid not null references beers(id) on delete restrict,
  container     container_type not null,
  unit_ml       integer not null check (unit_ml between 100 and 50000),
  pack_count    integer not null default 1 check (pack_count between 1 and 60),
  total_ml      integer generated always as (unit_ml * pack_count) stored,
  display_he    text not null,                 -- 'גולדסטאר 6×330 מ״ל פחית'
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (beer_id, container, unit_ml, pack_count)   -- identity = physical facts
);
create table sku_barcodes (                     -- many GTINs / chain codes → one SKU
  barcode  text primary key,                    -- GTIN-13 or chain-internal code
  sku_id   uuid not null references skus(id) on delete cascade,
  is_gtin  boolean not null default true
);

-- `stores` stays = retail CHAIN (rename later via view, not now). Add real chain hygiene + branches.
alter table stores add column kind text not null default 'chain'
  check (kind in ('chain','independent','category'));          -- 'liquor-store','makolet' become 'category'
create table branches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  external_ref text,                            -- chain's store id in the feed
  name_he text, city text, lat numeric(8,5), lng numeric(8,5),
  unique (store_id, external_ref)
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null, kind source_kind not null, trust smallint not null default 50
);
create table ingestion_runs (                   -- one row per import; enables rollback + audit
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id),
  started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null default 'running', stats jsonb not null default '{}'
);

-- Append-only ledger.
create table price_observations (
  id            bigint generated always as identity primary key,
  sku_id        uuid not null references skus(id),
  store_id      uuid not null references stores(id),
  branch_id     uuid references branches(id),           -- null = chain-wide
  kind          price_kind not null,
  price_agorot  integer not null check (price_agorot > 0),   -- shelf price for the whole pack
  observed_at   timestamptz not null,
  valid_from    timestamptz,                            -- promotions (and dated regular changes)
  valid_to      timestamptz,
  promo_type    promo_type,                             -- promotions only
  conditions    jsonb not null default '{}',            -- {min_qty, max_qty, multi_buy:{qty,total_agorot}, club:'…', coupon:true, note_he:'…'}
  source_id     uuid not null references sources(id),
  run_id        uuid references ingestion_runs(id),
  external_ref  text,                                   -- file name / promo id for idempotency
  raw           jsonb,                                  -- original record for audit
  status        text not null default 'live' check (status in ('live','held','rejected','superseded')),
  created_by    uuid references auth.users(id),
  check (kind = 'promotion' or (promo_type is null and valid_to is null)),
  check (valid_to is null or valid_from is null or valid_to > valid_from)
);
create unique index price_obs_idem on price_observations (source_id, external_ref) where external_ref is not null;
create index price_obs_lookup on price_observations (sku_id, store_id, kind, observed_at desc);

-- Read model the app uses (security_invoker), mirrors today's deals_public idea:
--   current_regular(sku, store[, branch])  = latest live 'regular' observation
--   current_offers(sku, store[, branch])   = live 'promotion' rows where now() between valid_from and valid_to
--   offers_ranked (…, effective_agorot, unit_price, reference_agorot, value_pct, market_value_pct, freshness)
```

Notes:
- **Favourites still reference `beers.id`** — no change to `user_favorite_beers`, the trigger, or `save_preferences()`. A favourite is a *product family* (brand+variant), never a pack.
- **Goldstar example:** one `beers` row (`goldstar`), SKUs `(can,330,6)`, `(can,330,24)`, `(bottle,500,1)`, `(can,500,6)`, …; plus a separate family `goldstar-unfiltered`. The two colliding rows from probe A2 are two SKUs and two observations — no unique index conflict.
- **Multi-buy ("2 ב־₪45")** = `promo_type='multi_buy'`, `conditions.multi_buy={qty:2,total_agorot:4500}` is the authoritative record, and `price_agorot` stores the *effective per-pack price* (`ceil(total ÷ qty)` = 2250) so ordinary sorting works; the view exposes both and the UI must say "בקנייה של 2".
- **Club-only** = `conditions.club='<name>'`; UI shows a chip, and value ranking can down-weight club-only unless the user opts in.
- **History:** a price change is a *new* row; the old one is `superseded`, never updated or deleted. Take-down never nulls the approver (the audit trail is the row's `created_by`/`run_id`).
- **Existing `deals` rows:** freeze the table (keep policies/tests/admin queue working during transition). The 15 demo rows are **not migrated** — they are removed from public reads (B-02). Real user submissions later map to `price_observations` with `source.kind='user_submission'`, `status='held'` until moderated.
- **RLS:** `price_observations` writable only by `service_role` (ingestion) and by `SECURITY DEFINER` moderation functions; public `select` only through the view; keep the "grant exactly the verbs needed" convention (§17).

### 11.3 Migration path (all expand-only)
1. `0006_expand_catalog.sql` — additive columns, new enums/tables, empty. Regenerate types.
2. Backfill `beers.brand_slug/variant` (22 rows, by hand) and `stores.kind` (mark `liquor-store`, `makolet` as `category`).
3. Create `sources` (`admin`, `user_submission`, per-chain feeds) and the read views. Point new UI reads at views behind a flag.
4. Admin tool to create SKUs and map barcodes (needed before ingestion, §19).
5. Cut reads over; freeze `deals`; only then consider (separate, reviewed) contraction of `deals`/`0005` index.

Rollback at every step = drop the new objects; nothing existing is altered except additive columns.

---

## 12. Proposed theme system

### 12.1 Goals & constraints
Follow favourite #1 automatically; allow a manual override; be **inspired by** beer identity (glass, liquid, light, era, packaging *mood*) **without** copying label art, logos or trade dress; keep **one** component/layout system; every theme passes contrast.

### 12.2 Three token layers (designsystems.one model)
```
Layer 1 PRIMITIVES   per-theme raw values, in OKLCH (perceptually even; contrast is computable)
                     --hue, --chroma-accent, --l-surface-0..3, --l-text-1..3, --tex-opacity …
Layer 2 SEMANTIC     what components consume — identical names in every theme
                     --bg  --surface-1  --surface-2  --line
                     --text-1 --text-2 --text-3
                     --accent  --on-accent   --deal  --on-deal   --focus
                     --glow (shadow tint)   --atmosphere (background layers)
Layer 3 COMPONENT    --card-bg: var(--surface-1)  --price-color: var(--deal)  …  (per component, no hex)
```
- A theme is **data**: one small object of primitives per beer (`src/design/themes/goldstar.ts`) validated by a script. A generator derives Layer 2 from Layer 1 with **guaranteed contrast** (text-2 ≥ 4.5:1 on surface-1; `on-accent` ≥ 4.5:1; deal colour ≥ 3:1 large / 4.5:1 small). A theme that fails does not build.
- Applied as `<html data-theme="goldstar">`; one static CSS file defines all themes as `[data-theme="…"] { …primitives… }`; **no per-beer stylesheets, no per-beer components.** Tailwind reads only Layer 2/3 names (`bg-surface-1`, `text-text-2`), replacing the repeated `bg-[color:var(--surface)] ring-1 ring-white/10` strings. (Keep the documented rule: **never register a Tailwind colour called `base`** — `globals.css:15-24`.)
- **Atmosphere** is the only place themes get richer than colour: background = layered gradients (a soft "lit-glass" radial + liquid-tone wash) and an optional ≤ 8 KB pre-rendered grain PNG at ≤ 6 % opacity; a per-theme `--display-tracking`/optical weight if the display face supports it. Structure (spacing, radii, layout) is never theme-dependent.
- **Deal highlight** has its own semantic colour (`--deal`) separate from `--accent`, fixing U-4 (price and badge no longer fight).

### 12.3 Selection logic
```
effectiveTheme = profile.theme_override         // 'goldstar' | … | null
              ?? favourites[rank 1].theme_slug   // automatic (default)
              ?? 'house'                         // neutral brand default
```
- Stored in `profiles.theme_override text null` (validated against the preset list) and mirrored to a first-party cookie `bd_theme` so the **server renders the right theme on first paint** (today `layout.tsx:51-57` computes it from a DB read on every request). `themeColor` for the browser chrome and the manifest `theme_color` follow the same value (manifest can stay static; use `<meta name="theme-color">`).
- Settings shows all presets as swatch cards with live preview; "אוטומטי" is the default and is shown as such.

### 12.4 Example preset (illustrative, to be designed — hypothesis)
| Theme | Mood source (not label art) | Direction |
| --- | --- | --- |
| `goldstar` | dark amber glass, warm bar light, gold-on-brown | deep umber bg, lit-glass radial from top-start, honey accent, cream text |
| `heineken` | green bottle glass, cold-chain green | ink-green bg, cool-lit gradient, fresh green accent |
| `guinness` | black body, cream head | true-neutral black bg, cream accent, restrained atmosphere |

Today's 22 palettes are reusable only as *starting* primitives: 10/21 are amber-ish and several pairs are indistinguishable, so each needs a distinct hue/lightness/atmosphere brief. Legal guardrail: no logos, wordmarks, bottle silhouettes or label reproductions in assets; palette/mood only (consistent with the existing comments in `0004_seed.sql:1-9`).

### 12.5 Typography & voice (hypotheses to test in Phase 3)
Move off default-Heebo-for-everything. Evaluate: a Hebrew display face with print/shelf-label character for prices and headings (candidates: *Rubik*, *Secular One*, *Suez One*, *Frank Ruhl Libre* for contrast) + a neutral Hebrew UI face (*Assistant* or *Heebo* for body). **Prices are the hero object:** render as shelf-edge tags — large shekel figure with superscript agorot (`₪25⁰⁰`), tabular figures, the pack spec in a smaller, quieter line. This is subject-specific (Israeli shelf labels), not a generic SaaS metric card. Use real icons (one library or authored SVG), no emoji.

---

## 13. Proposed notification architecture

### 13.1 What exists and what is proven
| Layer | Exists | Proven |
| --- | --- | --- |
| Permission + subscribe UI (`PushToggle`) | yes | **No** — B-04, B-05; subscribe never completed in automation |
| Service worker `push`/`notificationclick` | yes | Registered & active (live); handlers not exercised |
| Subscription storage (`push_subscriptions` + RPC) | yes | Tests don't cover it; probe B2 shows a failure mode |
| VAPID public key in production | yes (87-char key present in the RSC payload) | private key / subject presence **UNKNOWN** |
| Sender `notifyAboutDeal` | yes | Never observed live; no unit test on targeting/thresholds/cooldown |
| Targeting (`primary_beer_id` + `notifications_enabled`) | yes | Column forgeable (B-11); default `true` (B-04) |
| Trigger | `approveDeal` action only | Cannot fire for imported data |
| Click-through | yes | **Broken** (B-03) |

**Conclusion: do not claim notifications work.** Code exists; no end-to-end delivery has been demonstrated.

### 13.2 Target design
```
price_observations INSERT (kind=promotion, status=live, new or materially changed)
        │  DB trigger / ingestion step writes
        ▼
notification_events (dedupe_key = user|sku_family|chain|promo_ext_ref)   ← outbox, idempotent
        │  scheduled worker (Vercel Cron / GitHub Action / Supabase Edge Function), every 5–15 min
        ▼
  match → rules (rank-1 favourite, min value_pct, max price, quiet hours, cooldown, per-user prefs)
        ▼
  render message → web-push (per subscription, TTL 12h) → notification_deliveries (status, http_status, error)
        ▼
  410/404 ⇒ delete subscription; 5xx ⇒ retry with backoff (max 3); never re-send a dedupe_key
```
Key changes from today:
- **Decouple from admin approval**; trigger on data, so daily ingestion and manual moderation feed the same pipeline.
- **`notified_at` on the deal is replaced by per-recipient delivery rows**, fixing the "deal seen when nobody subscribed never notifies later" flaw (§6 #11) while keeping the *once-per-deal-per-person* guarantee.
- **Thresholds use `value_pct` (verified) and per-litre/price caps**, never an unverified "was" price. No verified reference ⇒ no push.
- Cooldown remains per person **per beer family**; add global daily cap (e.g. 2) and quiet hours (default 22:00–08:00 Asia/Jerusalem, plus optional Shabbat/holiday quiet window).

### 13.3 Message (target format)
Title: `מבצע חדש ברמי לוי` · Body: `גולדסטאר 6×330 מ״ל ₪25 במקום ₪37.90` (+ ` · −34%` only when verified).
`data.url = /beer/<slug>?sku=<sku_id>&store=<chain_slug>` (**slug, not UUID**), `tag = sku|store` so repeats replace rather than stack. The pure builder stays in `src/lib/push/message.ts` and gets unit tests for missing name/regular price/multi-buy wording.

### 13.4 Subscription & identity fixes
- `save_push_subscription`: make it a `SECURITY DEFINER` function that **re-parents** an existing endpoint to `auth.uid()` (a device belongs to whoever holds it now) — fixes B-08.
- Column-level privileges (or a `security definer` setter) so users cannot write `primary_beer_id`/`onboarded_at` — fixes B-11.
- `notifications_enabled` default `false`; UI state derived from *(permission === granted) ∧ (subscription exists) ∧ (flag)*; tap semantics always match what is shown (B-04). Wrap `subscribe()` in try/catch with specific messages (B-05).
- Identity durability (open question, needs device testing): offer optional "save my profile" (Supabase *link anonymous user to email/OAuth*) and a short transfer code, because clearing cookies or opening the iOS home-screen app (separate storage from Safari) creates a new user. Until verified on a real iPhone, treat iOS push as **UNKNOWN**.

### 13.5 Observability
Every send writes a delivery row; an admin "notifications" tab shows last 50 events with outcome; a **"send test push to me"** button exists in Settings and is the E2E smoke test.

### 13.6 How to prove it works (must be done on real devices)
Android Chrome (installed and not), iPhone iOS ≥ 16.4 **installed to Home Screen**, desktop Chrome/Edge. For each: opt in → see a `push_subscriptions` row → approve/ingest a test promotion for rank-1 beer → receive within 60 s → tap → land on the right beer/SKU page → opt out → nothing arrives. Record the result in the release notes.

---

## 14. Proposed "What's New" / versioning / changelog architecture

### 14.1 Single source of truth
`content/releases.ts` (typed array, newest first) is the **only** hand-edited release record. Everything else is derived or verified from it:

```ts
export type Release = {
  version: string;            // semver, equals package.json "version" for the newest entry
  date: string;               // ISO yyyy-mm-dd
  title_he: string;
  highlights_he: string[];    // 1–5 short user-facing bullets (shown in app)
  kind: ("feature" | "fix" | "data" | "design")[];
  showInApp: boolean;         // false for internal-only releases
  internal?: string[];        // dev notes → CHANGELOG.md only
};
export const releases: Release[] = [ /* newest first */ ];
```
- `CHANGELOG.md` is **generated** from `releases.ts` (`npm run changelog`) — never hand-edited — and CI fails if it is stale (`npm run changelog:check`).
- `package.json` `version` is bumped in the same commit; `next.config.ts` exposes it as `NEXT_PUBLIC_APP_VERSION`.
- **Enforcement (this is what makes the rule permanent):** `tests/releases.test.ts` (vitest, already in `npm run verify`) asserts (1) `releases[0].version === package.json.version`, (2) schema validity (zod), (3) versions strictly descending semver, (4) `CHANGELOG.md` matches generated output, (5) every `showInApp` entry has ≥ 1 Hebrew highlight. A change that forgets the changelog cannot pass `verify` or CI.

### 14.2 In-app experience
- **Entry point:** a small text-plus-dot control "מה חדש" in the Deals header (and a row in Settings). The dot shows when `localStorage.lastSeenVersion < releases[0].version`; also mirrored to `profiles.last_seen_release` so it survives device changes once identity is durable.
- **Surface:** a bottom sheet (not a modal takeover, not shown automatically on load) with the **latest release** expanded (title, date, bullets) and **"עדכונים קודמים"** listing the last 5 collapsed; a full `/whats-new` route with the whole history for deep links (used by push/marketing).
- Version string (`v0.2.0`) in Settings footer.

### 14.3 Versioning policy
SemVer with product meaning: **PATCH** = fix / copy / data change users may notice; **MINOR** = new user-visible capability; **MAJOR** = the model/IA rebuild (the redesign phase ships as `1.0.0`). Internal-only work (refactor, CI, docs, tests) does not require a release entry unless it changes behaviour.

### 14.4 The permanent repository rule
Add `CLAUDE.md` (see **Appendix A** for the exact text) and reference it from `docs/for-collaborators.md`. Because `CLAUDE.md` alone can be forgotten, the *test in §14.1 is the real guard*; the instruction file tells agents what to do, the test refuses the merge if they don't. Bootstrap: the very first Phase 1 commit adds `CLAUDE.md`, `content/releases.ts` (v0.2.0 = "hotfix release"), the generator, the test and the What's-New sheet, so the rule is satisfiable from day one.

---

## 15. Recommended implementation phases

Each phase ends with a shippable, versioned release (per the rule in §14) and a hard exit gate. No phase begins until the previous gate is green.

| Phase | Scope | Exit gate | Version |
| --- | --- | --- | --- |
| **0 · Guardrails** (≈1 day) | `CLAUDE.md` (App. A) · `content/releases.ts` + changelog generator + `tests/releases.test.ts` + minimal What's-New sheet · GitHub Actions (`tsc`, `eslint`, `vitest`, `next build`, Playwright smoke on the Vercel preview) · connect GitHub→Vercel · **staging Supabase project** (or Supabase branching) + `supabase` CLI adopted (`migration repair`, generated types) · Vercel `regions` aligned to the DB (verify DB region first) · branch protection on `main` (needs repo owner) | A PR that omits a release entry fails CI; preview deploys run the smoke test; staging DB reproducible from migrations | 0.1.x → **0.2.0** |
| **1 · Hotfix release** (1–2 days) | B-01 (pass a `basePath` string, not a function, to `Picker`) · B-02 (decide with owner: remove demo rows from public reads; split demo insert out of `MAKE_ME_ADMIN.sql`) · B-03 (push URL uses the slug) · B-04/B-05 (truthful toggle, try/catch, inline errors) · B-06/B-07 (onboarding: no auto-redirect from step 3; advance only after `ok`) · B-12 favicon · B-13 SW click handling · docs drift (B-14). Add Playwright smoke: every route × {390, 430} returns non-5xx | Smoke suite green on staging and prod; `/beer` & `/store` 200 | **0.2.1** |
| **2 · Data model (expand-only)** (≈1 wk) | §11 migrations `0006+`; generated DB types; RLS + column-privilege fixes (B-08, B-11); SKU/barcode admin tool; `offers` views; PGlite tests including probe A2/D1/F flipped to passing; freeze `deals` | Probe scenario "6×330 and 6×500 both live at one chain" passes; history preserved; all old tests still green | **0.3.0** |
| **3 · Design system + IA** (2–3 wks) | Install Impeccable, run `init`/`document` to produce `PRODUCT.md`/`DESIGN.md`; token layers + theme generator (§12); primitives (Button, Chip, Row, Sheet, Tabs, PriceTag, Icon); bottom-nav IA (§10); Home, Beer, Store, Search, Settings, What's New; loading/empty/error states; favourites reorder; theme override | All §18 AC-C, AC-D, AC-F, AC-G items | **1.0.0** |
| **4 · Notifications rebuild** (≈1 wk + device time) | §13 outbox/worker/delivery log/quiet hours/test-push; real-device matrix | §13.6 matrix recorded pass on Android, iOS-installed, desktop | 1.1.0 |
| **5 · Ingestion** (see §19) | Pilot 1 chain in dry-run on staging → diff review → 3 chains → all → scheduled daily (GitHub Actions cron) with alerting | Prerequisites in §19 met; dry-run diff reviewed by a human; rollback rehearsed | 1.2.0+ |
| **6 · Hardening** | Public catalogue caching (ISR/`revalidateTag` on ingestion), analytics & error tracking, load test, accessibility audit, legal check on alcohol content/age gate | AC-G performance & a11y budgets | 1.x |

Concurrency note: phases 2 and 3 can overlap **only** after the §11 read views exist (UI codes against views, not tables).

---

## 16. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| **Shared production DB is also the dev DB** (`for-collaborators.md`) — a migration or import mistake hits real users; two developers collide | High | High | Phase 0 staging DB; migrations only via CLI + PR; ingestion writes only with a run id (rollback) |
| **Anonymous identity is a cookie** — favourites/theme/push reset on cookie clear, browser change, or iOS Safari→installed-PWA switch | High (iOS UNVERIFIED) | High for the notification value prop | Test on a real iPhone first; offer optional account linking + transfer code (§13.4); design onboarding to happen *inside* the installed PWA on iOS |
| **Product-matching errors in ingestion** (wrong SKU ⇒ wrong price shown as a "deal") | High | High (trust) | Barcode-first matching, alias table, review queue, confidence gates, value cap/hold (§10.5), dry-run diffs |
| **Fake savings** from unreliable "original" prices | Medium | High (reputational/legal) | Verified-reference rule, market-median metric, no % without reference (§10.5) |
| **Big-bang redesign on an untested UI** | Medium | High | Phases 0–2 first; Playwright smoke as a required check; screenshots in every PR |
| **Web Push reality:** iOS needs Home-Screen install; Chrome incognito unsupported (observed); FCM/APNs latency; permission-denied is terminal | High | Medium | Truthful state machine (§10.6), in-app fallback (badge/in-app inbox), "send test push", device matrix |
| **Legal/regulatory:** alcohol advertising/marketing rules and age expectations in Israel; use of chains' published price data (public under the price-transparency regime, but attribution/terms should be reviewed) | Unknown | Potentially high | Owner to obtain legal advice before public launch; add 18+ notice/gate if advised; show source + timestamp on prices |
| **Performance:** iad1↔Frankfurt round-trips, fully dynamic pages | High (measured) | Medium | Align regions; cache public catalogue; parallelise queries; skeletons |
| **Vendor/build drift:** Next 15 → server/client boundary errors compile fine and fail at runtime (B-01) | Medium | Medium | Smoke test per route in CI; lint rule/test for function props across the boundary |
| **Shared Tailwind gotcha** (`--color-base` shadows `text-base`) | Low | Medium | Keep the documented rule; token layer avoids the name |
| **Secrets hygiene:** service-role key and VAPID private key exist only in Vercel/local env; real admin email is committed in `MAKE_ME_ADMIN.sql:14` (private repo) | Low | Medium | Move admin bootstrap to a documented one-liner; rotate keys if the repo ever becomes public |
| **Scope creep into "AI slop" redesign** (palette swap only) | Medium | Medium | §12/§18 require structural changes and measurable acceptance, not taste |

---

## 17. Things that must NOT be changed casually

These are deliberate, tested, and correct. Preserve the *guarantee* even when the mechanism changes.

| Item | Why / where |
| --- | --- |
| **Authorization in the database** — RLS on every table; explicit per-table `GRANT`s; `SECURITY DEFINER` functions each starting with `require_admin()`/`require_super_admin()`; "automatic RLS" on for the project | `0002`, `0003`; `docs/setup.md` §1. Any new table (e.g. `price_observations`) must follow the same pattern and get tests. |
| **A submitted deal can only be inserted `pending`**; users have no UPDATE/DELETE; reports never change deal status; `admins` has no INSERT policy | `0003_rls.sql:140-158`, `security.test.ts` |
| **Audit attribution** — `deals_approved_is_attributed` check, `approved_by/at` | `0001:170-172` (see B/S-4: fix the *take-down* nulling, keep the constraint's intent) |
| **Money = integer agorot, parsed from the string** | `src/lib/money.ts`; never `parseFloat(x)*100`; `24,90` = ₪24.90; `1,299` rejected |
| **Server-side re-validation of every write** (zod in actions + DB constraints) | `lib/actions/*` |
| **Anonymous-session middleware** (real `auth.uid()` for every visitor) and `getUser()` not `getSession()` | `middleware.ts` |
| **Service worker never caches navigations** (stale prices in an aisle is the one unforgivable failure) and `/sw.js` served `no-store` | `public/sw.js`, `next.config.ts` |
| **`(panel)` route group** keeps the admin layout off `/admin/login` (redirect-loop guard) + `tests/routes.test.ts` | `src/app/admin/` |
| **Service-role client used only by the push sender / ingestion**, imported only from server code (`server-only`); never `NEXT_PUBLIC_` | `lib/supabase/admin.ts`, `lib/env.ts` |
| **Do not register a Tailwind colour named `base`** | `globals.css:15-24` |
| **RTL foundations** — `dir=rtl lang=he`, `.num` LTR isolation, 16 px minimum inputs (iOS zoom), zoom allowed (`maximumScale: 5`) | `layout.tsx`, `globals.css` |
| **Notifications only for the Primary Beer by default; threshold AND cooldown; once per deal per person** | Product rule; preserve as per-user defaults in the rebuilt sender |
| **Editorial Weekly Deal is human-chosen** | `queries.ts:152-158`, `weekly/page.tsx` — keep as an override slot |
| **PGlite-based migration tests running the real SQL as a non-superuser** | `tests/helpers/db.ts` — the best asset in the repo; extend, don't replace |
| **Favourites schema** (`user_favorite_beers` PK/UNIQUE, `save_preferences` atomicity, `sync_primary_beer` trigger) | Add columns around it; do not restructure |
| **`docs/for-collaborators.md` "stop the dev server before build"** and port 3100 convention | avoids the `<Html>` build error |
| **Destructive changes**: no `drop`/`truncate`/rewrite of `deals`, `beers`, `stores`, `user_favorite_beers`, `push_*` without an approved plan, a staging rehearsal and a backup | this audit's rule for Phases 2+ |

---

## 18. Exact acceptance criteria for the redesign phase (Phase 3 → 1.0.0)

All checks are automated where marked ⚙ (Playwright/Vitest/CI) and must be green on the preview URL at **390×844 and 430×932** (plus 360×800 and 768×1024 for layout).

**A · Regression & availability**
1. ⚙ `/beer` and `/store` return 200 for anonymous and onboarded users; every route in the app map returns non-5xx in a crawl at both mobile viewports.
2. ⚙ Search: typing `גולד`, `גולדסטר`, `gold` and a niqqud/geresh variant each surface Goldstar first; selecting a result opens the right page; zero-result state offers a next action.
3. ⚙ No public read returns a row with `notes = 'מבצע לדוגמה'`; a CI check greps seed/migration files for demo inserts outside `supabase/seed/dev-only`.

**B · Data model** (Vitest on PGlite)
4. Goldstar 6×330 can and 6×500 bottle can be simultaneously live at the same chain (probe A2 returns OK).
5. A regular price is storable without a promotion; a regular price and a promotion for the same SKU/chain coexist and both render.
6. A price change inserts a new observation and marks the old `superseded`; price columns cannot be `UPDATE`d; take-down keeps provenance.
7. A promotion past `valid_to` disappears from offers with no manual step (test with a fixed clock).
8. Conditions round-trip: multi-buy (2 ב־₪45 → effective ₪22.50), club-only, min-qty; UI shows them as chips.
9. `value_pct` is `NULL` when there is no verified reference, when the reference is > 14 days old or non-feed, and is *held* when > 70 %; strikethrough/"you save" never render for `NULL`.
10. RLS tests updated: forged `primary_beer_id`/`onboarded_at` rejected; endpoint re-parenting works; new tables follow the grant/policy convention.

**C · Discovery UX**
11. Home at 390×844: within the first viewport, without scrolling, the user sees the rank-1 beer's best current offer (or a designed "no deal yet") **and** the search entry **and** the bottom nav.
12. ⚙ For a seeded user with favourites [A,B,C,D], Home section 1 lists favourites' offers in rank order A→D, then other deals (Playwright asserts DOM order).
13. Deal rows/cards are links to the beer-at-chain view; no dead-end cards.
14. Beer page groups by SKU with plain-language pack headers, offers sort controls **price ↑ / price ↓ / value** (and per-litre toggle), and a "מחירים רגילים" segment.
15. Store page shows promotions first (with "show all"), regular prices in a second searchable segment; page height stays bounded (no > 15 rows before a "show all").
16. No cross-pack comparison without unit-price normalisation; sort order verified by test data containing mixed packs.
17. Freshness ("עודכן לפני …") visible on Home, Beer and Store.

**D · Settings & theme**
18. Favourites can be reordered by drag and by up/down buttons, swapped individually, saved atomically; changing #1 changes the theme without reload artefacts.
19. Theme: default = automatic (favourite #1); manual override persists across reload, across devices for the same profile, and renders correctly on the **first server paint** (no flash; ⚙ screenshot diff).
20. Every theme preset passes token contrast tests: body ≥ 4.5:1, large ≥ 3:1, `on-accent` ≥ 4.5:1, focus ring ≥ 3:1 (build fails otherwise). At least 21 presets; no two presets closer than ΔE 12 on (bg, surface, accent) mean.
21. No brand logos/label art in assets (repo check on `public/` + design review).

**E · Notifications**
22. ⚙ Toggle always reflects real state and its tap does what it says (mocked permission/subscription matrix: default, granted+none, granted+sub, denied, unsupported); a rejected `subscribe()` shows an inline message and never reaches the error boundary.
23. ⚙ Push payload URL resolves 200 to the intended beer/SKU page (unit test on the builder + Playwright navigation).
24. Message text matches §13.3 including chain, pack spec, price and "במקום ₪X" only when verified.
25. Dedupe, cooldown, daily cap and quiet-hours have unit tests; delivery rows are written for every attempt.
26. **Device matrix (§13.6) executed and recorded** for Android Chrome, iOS ≥ 16.4 installed, desktop.

**F · What's New / versioning**
27. ⚙ `tests/releases.test.ts` passes; CI fails when `package.json` version, `releases.ts` and `CHANGELOG.md` disagree.
28. A small "מה חדש" control is present on Home and Settings; a dot appears only when an unseen release exists; opening shows the latest release expanded and the previous five collapsed; `/whats-new` shows full history; the app version is shown in Settings.

**G · Quality floor**
29. ⚙ Zero interactive elements under 44×44 px (the scan used in this audit returns `[]`); no meaningful text under 12 px.
30. ⚙ axe-core: 0 serious/critical violations on Home, Beer, Store, Settings in every theme.
31. ⚙ No horizontal overflow at 360/390/430/768; numbers/prices stay LTR-isolated; Hebrew/English mixed strings render correctly.
32. Performance (mobile, Slow-4G emulation, preview URL): Home LCP p75 ≤ 2.5 s, TTFB ≤ 600 ms from Israel; function region == DB region; skeleton on every data route.
33. Loading, empty and error states exist and are designed for every route (each names the problem and the recovery).
34. Visual review: no emoji used as icons; a written Impeccable `critique` pass with no P0/P1 items; before/after screenshots attached to the PR.
35. CI required checks on `main`: typecheck, lint, vitest, build, Playwright smoke, axe.

---

## 19. Prerequisites for `israeli-grocery-price-intelligence` ingestion

**Skill availability:** the skill named `israeli-grocery-price-intelligence` is **not installed** in this environment and does not appear in the skill catalogue search (searched: local `~/.claude/skills`, plugins, SearchSkills). It must be provided/installed before Phase 5; this audit cannot assess its behaviour. Publicly listed related tooling (candidate references, unreviewed): [ronilitman/grocery-price-scrapers](https://github.com/ronilitman/grocery-price-scrapers), [Segalil/israeli-supermarket-prices](https://github.com/Segalil/israeli-supermarket-prices), [`@skills-il/supermarket-prices-mcp`](https://www.npmjs.com/package/@skills-il/supermarket-prices-mcp).

**Data-source facts to design for** (from public sources, to be confirmed against real files in the pilot): under Israel's 2014 price-transparency law, chains with ≥ 3 stores publish XML price and promotion files (incremental plus daily *PriceFull/PromoFull* per store), gzip-compressed, sometimes windows-1255, with **schema variations between chains**; `item_code` is usually a GTIN but can be a chain-internal code ([sources](https://pypi.org/project/israeli-prices/0.2.0/), [scraper notes](https://github.com/ronilitman/grocery-price-scrapers)). Consequences: barcode matching is necessary but not sufficient; per-chain parsers/fixtures are required.

Prerequisites (each must be true **before** the first real import):

1. **Staging database** identical to prod schema; ingestion never targets prod until a staging dry-run diff is approved.
2. **§11 model migrated** (SKUs, barcodes, branches, sources, ingestion_runs, price_observations, views) with generated types and passing tests (AC 4–10).
3. **Beer scope & classification rules** written down: which items are "beer" (exclude non-alcoholic? malt? cider/radler? gift packs?), container/volume/pack parsing from item names/units (`UnitQty`, quantity fields), GS1 prefix handling, and a `needs_review` bucket for anything ambiguous.
4. **Product-matching pipeline:** barcode → `sku_barcodes`; else alias table; else fuzzy candidate + **human review queue**; confidence thresholds; unmatched items counted and reported, never guessed into a SKU.
5. **Chains and branches seeded** (`stores.kind`, `branches.external_ref`) and `liquor-store`/`makolet` reclassified as categories, not chains.
6. **Idempotency:** `(source_id, external_ref)` unique index; file hash per run; re-running the same file is a no-op.
7. **Write path isolation:** a dedicated ingestion role/secret (service role only in the runner, never in the browser bundle or Vercel public env); RLS keeps clients read-only on observations.
8. **Promotion semantics mapped** (min qty, multi-buy totals, club/coupon flags, start/end datetime, per-branch applicability) into `conditions`/`valid_*`; unknown promo types held for review.
9. **Deposit/VAT/unit-price rules** decided (does the feed price include the bottle deposit? confirm per chain) and encoded in the normaliser.
10. **Sanity gates:** reject/hold prices ≤ 0, > 10× the SKU median, value_pct > 70 %, sudden > 40 % day-over-day moves; per-run anomaly report.
11. **Staleness policy:** offers expire at `valid_to`; regular prices older than N days are shown with an "לא עודכן" marker and excluded from the reference-price rule (§10.5).
12. **Dry-run mode** producing a human-readable diff (new SKUs, changed prices, unmatched items, held rows) as a CI artifact; **rollback** by `run_id` (mark rows `rejected`), rehearsed once.
13. **Automation** (later): GitHub Actions cron with `concurrency` group, timeouts, retries with backoff, secrets from Actions, failure alerts (issue/Telegram/email), run log artifact; disabled until steps 1–12 pass. Not part of the first import.
14. **Terms & attribution:** confirm each chain's publication terms; show source and `observed_at` in the UI.
15. **Demo data purged** (B-02) so real and sample rows can never be confused; notification pipeline (§13) ready *before* the first scheduled import, otherwise the first real day of data will either spam or be silently skipped.
16. **Tests with real fixtures:** one anonymised real file per chain checked into `tests/fixtures/ingest/`; parser + matcher + gates have Vitest coverage.

---

## 20. What I could not verify, and what this audit touched

### 20.1 Not verified (needs credentials, a device, or the owner)
- **Admin flows on production** (queue, edit, approve, reports, weekly deal, thresholds): no admin credentials. Covered by 25 DB tests only.
- **Real push delivery** end-to-end, VAPID *private* key and `SUPABASE_SERVICE_ROLE_KEY` presence in Vercel, iOS/Android behaviour, the `beforeinstallprompt` path.
- **Which commit is deployed** (no CI/deploy link) — behaviour observed live matches HEAD for B-01 (reproduced locally on HEAD too).
- **Supabase project region/config** (docs claim Frankfurt/eu-central-1; the function ran in iad1 so a mismatch is likely but the DB region itself is unverified), anonymous-sign-in rate limits, "automatic RLS" setting.
- Whether B-07 (failed save at onboarding) reproduces — code-verified only.
- Search-box behaviour (page 500s) — read from source only.

### 20.2 Side effects of this audit on shared systems
- **Production Supabase:** one **anonymous test user** named `AUDIT-BOT` (profile + 4 favourites) was created by onboarding. Two more *unnamed* anonymous profiles exist from `curl` header checks (any first request creates one — middleware). Its `notifications_enabled` flag was toggled and ended `false`. **No push subscription, deal, report or submission was created.** A local dev server (later stopped) and the Playwright runs used that same user's session read-only.
- **Local/GitHub:** local branch `audit/beer-deals-product-audit-2026-09-29` and local tag `pre-beer-deals-rebuild-2026-09-29` created; **nothing pushed**; nothing committed (files are untracked). `npm ci` created `node_modules/` and builds created `.next/` (both git-ignored). `package.json`/`package-lock.json` unchanged.
- **Outside the repo:** `playwright-core` and scripts live in the session scratchpad; a shallow clone of Impeccable is in the scratchpad (not installed anywhere).

Optional cleanup, to be run by an admin in the Supabase SQL editor (review with the `select` first):
```sql
select id, first_name, created_at from public.profiles where first_name = 'AUDIT-BOT';
delete from auth.users where id in (select id from public.profiles where first_name = 'AUDIT-BOT');
-- unnamed anonymous profiles from 2026-09-29 08:00–09:00 UTC are empty rows and harmless; leave them unless you want them gone.
```

### 20.3 Open questions for the owner
1. Remove the 15 demo deals from production now (recommended), or keep them until real data lands? (Public app currently shows fake prices.)
2. Confirm the Supabase region, and permission to set the Vercel function region to match.
3. Who owns the `redesing` remote branch (identical to `main`); should the rebuild branch be based on it?
4. Approval to add a staging Supabase project and a GitHub→Vercel connection.
5. Legal review owner for alcohol-related content and price-data usage before public launch.
6. Should favourites #2–#4 ever notify (opt-in), or is "Primary Beer only" permanent?

### 20.4 To keep this audit: commands
```bash
git add docs/PRODUCT-AUDIT-2026-09-29.md docs/audit-2026-09-29
git commit -m "Add product and technical audit (2026-09-29)"
git push -u origin audit/beer-deals-product-audit-2026-09-29
git push origin pre-beer-deals-rebuild-2026-09-29   # optional: share the checkpoint tag
```

---

## Appendix A — proposed `CLAUDE.md` (ready to add in Phase 0; **not** added now)

```markdown
# Beer Deals — instructions for AI agents and contributors

## PERMANENT RULE: every meaningful product change ships a release entry
A change is **meaningful** if a user can see it, or it changes prices/deals/notifications/schema.
(Not meaningful: comments, refactors with no behaviour change, tests-only, docs-only, CI-only.)

For every meaningful change, in the SAME pull request:
1. Bump `version` in `package.json` — PATCH = fix/data/copy, MINOR = new capability, MAJOR = model/IA rebuild.
2. Add a new entry at the TOP of `content/releases.ts` (Hebrew `title_he` + 1–5 short `highlights_he`;
   `showInApp: true` unless purely internal).
3. Run `npm run changelog` to regenerate `CHANGELOG.md`. Never edit `CHANGELOG.md` by hand.
4. Open the app, tap "מה חדש", and confirm the new release is the one shown.
`npm run verify` fails if steps 1–3 are skipped (tests/releases.test.ts). Do not weaken that test.

## Non-negotiables
- Authorization lives in Postgres (RLS + SECURITY DEFINER + explicit GRANTs). Never rely on hidden buttons.
  Every new table needs grants, RLS, and tests in tests/security.test.ts style (run as a non-superuser).
- Money is integer agorot. Convert from the *string* via src/lib/money.ts. Never parseFloat(x)*100.
- Never show a discount % that lacks a verified reference price (docs/PRODUCT-AUDIT-2026-09-29.md §10.5).
- Never cache navigations in the service worker.
- Never register a Tailwind colour named `base`.
- Service-role keys are server-only. Never NEXT_PUBLIC_.
- Do not drop/truncate/rewrite deals, beers, stores, user_favorite_beers, push_* without an approved plan.

## Workflow
- One branch per change; never commit to main; open a PR. Stop `next dev` before `next build`.
- Run `npm run verify` and the Playwright smoke before pushing. Attach 390×844 screenshots for UI changes.
- Use the STAGING Supabase project for anything experimental. Production data is real users' data.
- Migrations go in supabase/migrations via the CLI; regenerate DB types; add tests.

## Design
- Use semantic tokens (see DESIGN.md / src/design); no hard-coded hex, no emoji as icons.
- Themes are data presets; never fork components or CSS per beer.
- Every route has loading, empty and error states. Touch targets ≥ 44 px; text ≥ 12 px; RTL first.

## Data ingestion
- Never bulk-import without a dry-run diff, an ingestion_run id, and a rollback path.
```

## Appendix B — schema probe results (`node docs/audit-2026-09-29/schema-probe.mjs`)

| Probe | Scenario | Result |
| --- | --- | --- |
| A1 | Approve Goldstar 6×330 @ Rami Levy | OK |
| **A2** | Approve Goldstar 6×500 @ Rami Levy (same beer/store/category) | **ERROR 23505** "כבר יש מבצע מאושר על הבירה הזו, באותה חנות ובאותו מארז" |
| B1 / **B2** | User 1 saves endpoint E / user 2 (same browser, new anon id) saves E | OK / **ERROR 42501** RLS USING violation; row stays with user 1 |
| C1 | Fresh profile defaults | `notifications_enabled = true`, `primary_beer_id = null` |
| **C2** | User writes own `primary_beer_id` + `onboarded_at` directly | **OK (accepted)** |
| **D1** | Insert a deal where deal price == regular price | **ERROR 23514** `deals_price_is_a_discount` |
| D2 | Insert unknown pack (`twelvepack`) | ERROR 22P02 invalid enum |
| E1–E5 | Columns of `deals`, `beers`, `stores`, `deals_public`; tables in `public` | No dates, source, sku, volume, pack, branch; 10 tables total |
| F1 / F2 | Admin edits an approved deal's price | Overwritten in place; 1 row before and after (no history) |
| G1 | `set_deal_status('inactive')` | `approved_by` and `approved_at` set to NULL |
| H1–H3 | Seed | 22 beers; `tuborg` and `tuborg-red` are separate rows; `liquor-store`, `makolet` are "stores" |
