# Setup

Everything here is done once. After it, `npm run dev` gives you a working app
and `npx vercel deploy --prod` gives you the link you can send on WhatsApp.

## 1. Create the Supabase project

<https://supabase.com/dashboard> → **New project**.

- **Region:** pick one in **Europe (Frankfurt / eu-central-1)**. It is the
  closest Supabase region to Israel — roughly 60ms away, against 200ms+ for
  Asia-Pacific. Every page in this app is server-rendered against the database,
  so that gap is felt on every screen. The region cannot be changed later
  without moving the project.
- **Database password:** press *Generate a password* and save it in your
  password manager. This app never uses it — the schema is applied by pasting
  SQL in the dashboard — but you cannot see it again afterwards.
- **Enable Data API:** leave it **on**. It is the API `supabase-js` talks to.
- **Automatically expose new tables:** turn it **off**. `0003_rls.sql` grants
  each table exactly the verbs it needs; with this on, any table added later is
  handed to the API before anyone has decided it should be.
- **Enable automatic RLS:** turn it **on**. Every table in the migrations
  already enables RLS explicitly, so this changes nothing today — it is a net
  under any table added later, which arrives locked instead of open.

## 2. Turn on anonymous sign-ins

**Authentication → Sign In / Providers → Anonymous sign-ins → enable.**

This is not optional. Every visitor gets an anonymous Supabase session on their
first request, and that is what makes "open the link and use it" work without a
sign-up form. It is also what gives Row Level Security a `auth.uid()` to hang
every rule on — without it there is no identity to scope favourites,
submissions or notifications to.

While you are there, under **Rate Limits**, the default anonymous sign-in limit
(30/hour per IP) is fine for a WhatsApp launch. Raise it only if you see
sign-ins failing.

## 3. Apply the schema

**SQL Editor → New query.** Paste and run each file in `supabase/migrations/`
**in order**:

1. `0001_schema.sql` — tables, constraints, triggers
2. `0002_functions.sql` — role checks and the write API
3. `0003_rls.sql` — Row Level Security and the storage bucket
4. `0004_seed.sql` — the beer and store catalogue

Each one is safe to re-run except `0001`, which creates types and will complain
that they already exist.

> These are applied by pasting rather than by `supabase db push` on purpose:
> `db push` needs the database password, and the migration history in the
> dashboard will not know about files applied this way. If you later start using
> the CLI, run `supabase migration repair` first.

## 4. Fill in `.env.local`

Copy `.env.example` to `.env.local` and fill in:

| variable | where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → Data API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API Keys → anon / publishable |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API Keys → service_role |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` locally, the real origin in production |

The service role key bypasses Row Level Security completely. It is used for
exactly one job — reading other people's push subscriptions in order to send a
notification — and it must never be given a `NEXT_PUBLIC_` prefix.

## 5. Generate the push keys

```bash
npm run vapid
```

Paste the three lines it prints into `.env.local`. Generate these **once**:
changing them later invalidates every existing subscription, and every user has
to switch notifications back on.

## 6. Make yourself the Super Admin

Admins sign in with a real email and password; everyone else is anonymous.

1. Supabase → **Authentication → Users → Add user → Create new user**. Use your
   own email, set a password, and tick *Auto Confirm User*.
2. Copy the new user's UUID.
3. SQL Editor:

   ```sql
   insert into public.admins (user_id, level)
   values ('paste-the-uuid-here', 'super_admin');
   ```

Then open `/admin/login` in the app and sign in with that email and password.
From there you can add other admins by email — but only a super admin can, and
that rule is enforced by `grant_admin()` in the database, not by the button
being hidden.

## 7. Run it

```bash
npm run dev
```

Open <http://localhost:3000>. You should get the onboarding: name, four beers,
then the home screen themed after whichever beer you ranked first.

## 8. Deploy

```bash
npx vercel deploy --prod
```

Set the same environment variables in the Vercel project (Settings →
Environment Variables), with `NEXT_PUBLIC_SITE_URL` pointing at the deployed
origin. Push notifications require HTTPS, so they will not work on
`http://localhost` beyond the browser's own localhost exemption — test them on
the deployed URL.

## Checking it works

```bash
npm run verify   # typecheck + tests + build
```

The tests apply the real migration files to an in-memory Postgres and assert
the security rules from the outside: that a submitted deal cannot publish
itself, that a report cannot remove a deal, that a regular admin cannot create
another admin. They need no credentials and no network.
