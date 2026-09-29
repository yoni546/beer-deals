# Beer Deals — instructions for AI agents and contributors

Israeli beer-deals PWA (Hebrew, RTL, mobile-first). Next.js 15 App Router · TypeScript ·
Tailwind v4 · Supabase (Postgres + RLS + anonymous auth) · Web Push. Read
`docs/for-collaborators.md` first; the product audit that shaped the current roadmap is
`docs/PRODUCT-AUDIT-2026-09-29.md`.

## PERMANENT RULE: every meaningful product change ships a release entry

A change is **meaningful** if a user can see it, or it changes prices, deals,
notifications or the database schema. (Not meaningful: comments, refactors with no
behaviour change, tests-only, docs-only, CI-only.)

For every meaningful change, in the **same pull request**:

1. Bump `version` in `package.json`.
   PATCH = fix / copy / data, MINOR = new user-visible capability, MAJOR = data-model or
   navigation rebuild.
2. Add a new entry at the **top** of `src/content/releases.json`:
   Hebrew `title_he` and 1–5 short plain-language `highlights_he`; `showInApp: true`
   unless the release is purely internal. Put developer notes in `internal`.
3. Run `npm run changelog` to regenerate `CHANGELOG.md`. **Never edit `CHANGELOG.md` by
   hand** — it is generated from the JSON.
4. Open the app as an admin, tap **מה חדש**, and confirm your release is the one shown.

`tests/releases.test.ts` (part of `npm test` / `npm run verify` / CI) fails if
`package.json`, `src/content/releases.json` and `CHANGELOG.md` disagree. Do not weaken or
skip that test; fix the release entry instead.

The app has a small **מה חדש** link (Home header and Settings) → `/whats-new`: the latest
update in full, earlier ones collapsed. That screen is fed only by `releases.json`. Since 0.8.0 it is
**for admins only**: the page checks `getViewer().isAdmin` on the server (anyone else gets "not found")
and the link is shown to admins only. Everyone else sees "אהבתם? שתפו לחברים" (`ShareApp`), which
always shares the production address, https://beer-deals.vercel.app.

## Non-negotiables

- **Authorization lives in Postgres.** RLS on every table, explicit per-table `GRANT`s,
  `SECURITY DEFINER` functions that start with `require_admin()` / `require_super_admin()`.
  Hiding a button is a courtesy, not security. Every new table needs grants, policies and
  tests in the style of `tests/security.test.ts` (run as a non-superuser role).
- **Money is integer agorot**, converted from the *string* (`src/lib/money.ts`). Never
  `parseFloat(x) * 100`.
- **Never show a discount % that lacks a verified reference price**, and never present a
  fake price as real. Sample deals exist only in dev/staging (`src/lib/demo.ts`,
  `supabase/seed/dev-demo-deals.sql`); a production server refuses to read them.
- **The service worker never caches navigations** (a stale price in a shop aisle is the one
  unforgivable failure). `/sw.js` is served `no-store`.
- **Never register a Tailwind colour named `base`** (it shadows the `text-base` font size).
- **Service-role keys are server-only.** Never `NEXT_PUBLIC_`, never in a client component,
  never in a file that is committed. Do not paste secrets into chat, docs or scripts.
- **Server/client boundary:** never pass a function (or an object/array containing one) from
  a Server Component to a Client Component — pass data (a string, a slug), or a Server
  Action. This mistake once took `/beer` and `/store` down (`tests/server-client-boundary.test.ts`).
- **Don't drop, truncate or rewrite** `deals`, `beers`, `stores`, `user_favorite_beers`,
  `push_*` without an approved plan, a staging rehearsal and a backup. Migrations are
  additive and reversible where practical.
- **Preserve RTL basics:** `dir="rtl" lang="he"`, `.num` for LTR number isolation, inputs
  ≥ 16px, pinch-zoom left enabled.

## Workflow

- One branch per change; never commit to `main`; open a pull request. CI must be green.
- `npm run verify` before pushing (typecheck + lint + tests + production build). Stop
  `next dev` before `next build` (both write `.next`).
- UI changes: run `npm run e2e` (Playwright at 390×844 and 430×932 against a *local fake
  Supabase* — see `tests/e2e/`) and attach screenshots to the PR. Fix failing behaviour
  with a failing test first.
- **Production data is real people's data.** Do not point experiments, seeds or imports at
  the production Supabase project. Use the local fake for automated tests and the staging
  project (`docs/STAGING.md`) for anything manual.
- Schema changes: add a new numbered file in `supabase/migrations/` (never edit an applied
  one), run `npm run sql:build` to refresh `supabase/RUN_THIS_IN_SUPABASE.sql`, add tests
  in `tests/`. Applying migrations to a hosted project is done by the owner via the
  Supabase SQL editor or CLI; list any migration that still needs applying in the PR.
- Windows checkouts have CRLF line endings; that is normal. Don't "fix" whole files.

## Design

- Use semantic tokens and shared components (the design system: `DESIGN.md`,
  `src/design/`, `src/components/ui/`); no ad-hoc hex values, no emoji as icons.
  Before a UI pull request run `./.claude/skills/impeccable/scripts/impeccable detect --json src`
  (it must print `[]`).
- **PERMANENT PRODUCT RULE: favourite #1 is the app.** The theme is chosen only by
  `getThemeForBeer(favourite #1)`: its bottle on the counter and its palette. Never add a theme
  picker, a manual override, an in-app light/dark switch, or any stored theme preference
  (`tests/design.test.ts` and `tests/e2e/favourite-one.spec.ts` fail if one appears). Beer
  identities are data in `src/design/themes.ts`, not forked components or per-beer stylesheets.
- Bottle photos only with provenance, through `scripts/fetch-bottles.mjs` → `scripts/prepare-bottle.mjs`
  (real product photos, shown as photographed; the owner allowed public product photography on
  2026-09-29). Never redraw or alter label art; never a raw white-background photo.
- Every route has designed empty and error states; loading is the top progress bar
  (`NavigationProgress`). **Do not add `loading.tsx`**: it stalls client-side navigation in
  production builds (`docs/LESSONS.md`, enforced by a test). Touch targets ≥ 44px; text ≥
  12px; contrast ≥ 4.5:1 (3:1 large).

## Data ingestion

- Pipeline: `scripts/ingest/fetch-sample.mjs` → `parse.mjs` (the installed
  israeli-grocery-price-intelligence skill's parser; `lib/promo-supplement.mjs` adds only the one field
  it drops) → `dry-run.mjs` (report) → `run.mjs --target staging` → `verify-staging.mjs`.
  `lib/plan.mjs` is the single place the rules live; `tests/ingest.test.ts` runs them on real excerpts.
- **Only offers everyone can redeem are published.** Club, card, coupon, employee, app-only: recorded,
  held, never shown or announced (`conditions.audience`, `is_universal_offer`, migration 0014).
- Prices are per branch; the retailer of a branch comes from the publisher's Stores file. Never invent a
  chain price. Deposit travels beside the price. Mix-and-match is a `promotion_groups` row.
- **STAGING only** until docs/FINAL-READINESS-REPORT.md says production is cleared. `run.mjs` refuses the
  production project; credentials come only from the git-ignored `.env.staging.local`.
- Never bulk-import without a dry-run diff, an `ingestion_run` id and a rollback path
  (`rollback_ingestion_run`; a rolled-back file can be imported again, migration 0015).
