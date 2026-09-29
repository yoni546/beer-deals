# Working on this together

Getting the app running on a second machine, and staying out of each other's way.

## 1. Get the code

```bash
git clone https://github.com/yoni546/beer-deals.git
cd beer-deals
npm install
```

## 2. Create `.env.local`

This file is **not** in git, deliberately — it is the one file that must never
be. Create it in the project root and paste this in:

```
NEXT_PUBLIC_SUPABASE_URL="https://itpyyexhmvosxcbcagvy.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="sb_publishable_V191xWujPuNhdjSbzRot7g_V95eaF9k"
NEXT_PUBLIC_SITE_URL="http://localhost:3100"
```

Those two values are safe to share: the URL is public, and the publishable key
carries no privileges of its own — every row it can reach is decided by Row
Level Security in Postgres. The keys that *are* secrets
(`SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY`) are not needed to develop,
and are not in this file.

## 3. Run it

```bash
npm run dev
```

<http://localhost:3100>. Port 3100 rather than 3000, because another project on
the owner's machine uses 3000.

**Do not develop against the live database.** Until the staging project exists
(see [STAGING.md](STAGING.md)) the only project these credentials point at is the
production one, so a deal approved on your laptop is approved for every real user.
The app now says so: any non-production environment connected to the production
database shows a red warning bar. Prefer, in this order:

1. `npm run e2e` / `npm test` — a local fake Supabase, no network, no risk;
2. the **staging** project, once created ([STAGING.md](STAGING.md));
3. the live database only for read-only checking, and never `/admin` actions.

## 4. Before you commit

```bash
npm run verify
```

Typecheck, then the tests, then a production build. The tests run the real
migration files against an in-memory Postgres and assert the security rules from
the outside — no credentials, no network, a couple of seconds.

**Stop the dev server first.** `next dev` and `next build` both write `.next`,
and running them together produces a confusing `<Html> should not be imported`
error that has nothing to do with your change.

## Working at the same time

Two people pushing to `main` will collide eventually. The cheap habit that
avoids most of it:

```bash
git pull --rebase       # before you start, and before you push
```

For anything bigger than a small fix, a branch costs nothing:

```bash
git checkout -b what-youre-doing
# ... work, commit ...
git push -u origin what-youre-doing
```

Then open a pull request on GitHub. The other person can see the change before
it reaches the live site. CI runs typecheck, lint, tests, the production build and
the Playwright suite on every pull request.

## The release rule

Every meaningful change — anything a user can see, or that touches prices, deals,
notifications or the schema — must bump `package.json`'s version, add an entry at the
top of `src/content/releases.json`, and regenerate `CHANGELOG.md` with
`npm run changelog`. A failing test enforces it. Full text in [CLAUDE.md](../CLAUDE.md).

## Testing without touching production

`npm run e2e` builds the app and runs it against a **local fake Supabase**
(`tests/e2e/fake-supabase`): the real migrations on an in-memory Postgres, behind a
PostgREST/auth-shaped server. Real row level security, no network, no credentials, and no
way to hurt the live database. Use `E2E_DEV=1 npm run e2e` (dev server) for quicker
iteration and `PW_CHANNEL=chrome` to use an installed Chrome instead of downloading
Playwright's browser.

## Things worth knowing before you change them

These are the places where the obvious edit is the wrong one. Each is explained
in a comment at the point it matters — this is just the map.

| where | what |
| --- | --- |
| `src/middleware.ts` | Creates an **anonymous** Supabase session on the first request. That is what makes "open the link and use it" work with no sign-up, and it is what gives RLS an `auth.uid()` to scope everything to. |
| `supabase/migrations/0003_rls.sql` | The permission system. Not one rule that matters is in React. Hiding a button is a courtesy; the policy is the boundary. |
| `src/lib/money.ts` | Prices are whole **agorot** in an integer. The conversion happens on the *string*: `parseFloat("19.99") * 100` is `1998.9999999999998`. A comma is a decimal separator — `24,90` must not become ₪2,490. |
| `src/lib/categories.ts` | Six-packs, cases and singles never mix. `parseCategory()` falls back to one category rather than "all", because a mixed list sorted by price always puts a ₪8.90 single above a ₪24.90 six-pack. |
| `src/app/admin/(panel)/` | The `(panel)` route group exists so the admin layout does **not** wrap `/admin/login`. The layout redirects non-admins to that page; if it wrapped it too, arriving would redirect to arriving. `tests/routes.test.ts` guards this. |
| `src/app/globals.css` | Do not register a Tailwind theme colour named `base`. `--color-base` generates a `text-base` **colour** utility that shadows the built-in `text-base` **font-size** utility, and headings silently render in the page background colour. |
| `deals.discount_percent` | A generated column. Users never type a discount and no code path can make it disagree with the two prices. |

## Deploying

The live site is <https://beer-deals.vercel.app>, on the owner's Vercel account.
Pushing to GitHub does not deploy by itself yet. The step-by-step (connecting the
repository, environment variables per environment, where the functions run relative
to the database, and how to verify a deployment) is in
[INFRASTRUCTURE.md](INFRASTRUCTURE.md).
