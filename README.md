# מבצעי בירה — Beer Deals

A mobile-first Hebrew PWA that answers one question in seconds: **which beer is
on sale, how much, and where.**

Send one link. The person opens it, picks their name and four beers, and is
looking at deals. No sign-up, no password, no app store.

- **Setup:** [docs/setup.md](docs/setup.md)
- **Stack:** Next.js 15 (App Router) · TypeScript · Tailwind v4 · Supabase ·
  Web Push

---

## How it is put together

### Everyone is signed in, and nobody signs up

`src/middleware.ts` creates an **anonymous Supabase session** on the first
request. That is the whole trick behind "open the link and use it": every
visitor has a real `auth.uid()` from the first page load, so Row Level Security
can own every rule — your profile, your favourites, your submission — without
anyone ever seeing a login form. Admins sign in with an email and password at
`/admin/login`, which replaces the anonymous session with a named one.

### The database is the permission system

Not one rule that matters lives in React. The pages hide buttons as a courtesy;
the rules are in `supabase/migrations/0003_rls.sql` and in the `SECURITY
DEFINER` functions in `0002_functions.sql`:

| the rule | what actually enforces it |
| --- | --- |
| a submitted deal is never published automatically | the `deals_submit` policy accepts an INSERT only when `status = 'pending'` |
| a report never removes a deal | nothing in the schema connects `deal_reports` to `deals.status` — the absence is the feature |
| users cannot approve or edit deals | there is no UPDATE policy for them; `approve_deal()` calls `require_admin()` |
| only a super admin manages admins | `public.admins` has **no** INSERT policy at all; it is writable only through `grant_admin()` / `revoke_admin()` |
| the discount is never typed by hand | `deals.discount_percent` is a **generated column** |

`tests/security.test.ts` asserts each of those against the real migration files
on an in-memory Postgres, from inside a non-superuser session — because RLS does
not apply to a superuser, and a test that forgets that proves nothing.

### Money

Prices are whole **agorot** in an integer column. The shekel conversion happens
on the *string*, because `parseFloat("19.99") * 100` is `1998.9999999999998`.
See `src/lib/money.ts` — and note that a comma is read as a decimal separator,
since `24,90` typed into a phone must not become ₪2,490.

### Categories never mix

Six-packs, cases and singles are three separate worlds. `parseCategory()` falls
back to *one* category rather than to "all", and `getDealsForBeer()` takes the
category as a required argument. A mixed list sorted by price would always put
a ₪8.90 single above a ₪24.90 six-pack and make the better deal look worse.

### Themes

The Primary Beer — favourite #1, derived by a database trigger — sets four CSS
variables and nothing else. Four colours cannot move a button, which is how the
layout stays identical across every theme. The colours are ours, chosen to
evoke each beer; no logos, no brand palettes, no trade dress.

### Notifications

Only the Primary Beer, never favourites #2–#4. A deal must clear **both**
admin-configured thresholds (minimum discount *and* maximum price), and a
per-person-per-beer cooldown stops a Thursday-evening run of approvals from
becoming five buzzes. `deals.notified_at` means a deal is announced once, even
if it is later edited and re-approved.

---

## Commands

```bash
npm run dev        # local dev server
npm run verify     # typecheck + tests + build
npm test           # the security + money tests (no credentials needed)
npm run icons      # regenerate the PWA icons
npm run vapid      # generate a Web Push key pair (once, ever)
```

## Layout

```
src/
  middleware.ts        anonymous session + token refresh
  app/                 screens; /admin is the moderation side
  components/          deal card, pickers, onboarding, install prompt
  lib/
    money.ts           agorot, and the string-based conversion
    categories.ts      the three worlds
    session.ts         who is asking, in one round trip
    queries.ts         every public read
    actions/           server actions — each one calls a checked RPC
    push/              who gets woken up, and the message they see
supabase/migrations/   the schema, the write API, and RLS
tests/                 the security rules, asserted against the real migrations
```
