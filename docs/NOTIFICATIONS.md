# Notifications

**Status (2026-09-29): built and tested against a fake push service; NOT yet verified on a real
phone.** Nothing below may be described as "working" in release notes until §5 has been done on real
devices and the results written into the table at the bottom.

## 1. How a notification happens

```
price_observations INSERT (a live promotion)         ┐  database triggers (migration 0012)
deals UPDATE → approved (legacy user submission)     ┴→ notification_events   the outbox, one row per piece of news
                                                              │
   POST /api/notifications/run  ← GitHub Actions every 10 min, and right after an admin approves a deal
                                                              ▼
   src/lib/push/worker.ts   reads pending events, renders each from `offers_feed`, applies src/lib/push/rules.ts
                                                              ▼
   web-push (src/lib/push/sender.ts)  →  notification_deliveries   one row per person per event, for every attempt
```

Everything that decides is pure and tested: `rules.ts` (who is worth interrupting), `message.ts` (the text
and the link). The worker is written against an injected database client and an injected transport, so the
whole flow runs in `tests/notifications-worker.test.ts` with the repo's real migrations and no network.

## 2. The rules

| Rule | Where | Notes |
| --- | --- | --- |
| The deal must still be running | event | `expires_at` = the promotion's `valid_to`, else 24 h. |
| It must carry a **verified** saving | event | `offers_feed.value_pct` is null unless the reference price is trusted (same pack, same chain, seen in the last 14 days, from a chain feed or an admin). No verified saving ⇒ no push, however cheap the price looks. |
| Saving ≥ minimum **and** price ≤ cap | event | Admin settings (`app_settings`): default 25 % and ₪30. |
| Only the **primary** beer (favourite #1) | person | #2–#4 shape the app, never the phone. |
| Notifications on, and a device registered | person | |
| Cooldown per beer | person | Default 20 h. |
| Daily cap | person | Default 2 per Israeli calendar day. |
| Quiet hours | person | Default 22:00–08:00 Israel time. **Defers**, does not drop: a promotion still running at 08:00 is sent then. Equal start and end = no quiet hours. |

Idempotency: `notification_events.dedupe_key` (pack, chain, promotion kind, price, start date) makes a
re-observed promotion the same news; `unique (event_id, user_id)` on deliveries makes a second message to
the same person impossible. Sample data (`sample-data` source, or a legacy deal with the sample note)
never enqueues.

Failure handling: 404/410 from the push service ⇒ the device is deleted; other 4xx ⇒ final `failed`;
5xx/network ⇒ `retry`, at most 3 attempts, then `failed`. A person is `sent` if at least one of their devices accepted.

## 3. Setting it up (per environment — production and staging have separate values)

| Variable | Where | What |
| --- | --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Vercel | One key pair per environment: `npm run vapid`. Changing the pair invalidates every existing subscription. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel | Server only. The worker is the one place that needs it. |
| `CRON_SECRET` | Vercel **and** GitHub | 16+ random characters. The endpoint is closed (503) without it. |
| repository variable `SITE_URL` | GitHub → Settings → Secrets and variables → Actions | Deployed origin, no trailing slash. |
| repository secret `CRON_SECRET` | same | Same value as in Vercel. |

Apply migration `0012_notification_pipeline.sql` (see `docs/STAGING.md` for the order; staging first).
The scheduled workflow (`.github/workflows/notifications.yml`) only runs from the default branch, so it
starts the day this is merged to `main`. Until then the worker runs only when an admin approves a legacy
deal, or when someone calls the endpoint by hand:

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" "$SITE_URL/api/notifications/run"
```

The response is counts only (`events`, `sent`, `skipped`, `deferred`, `retried`, `failed`, `devicesRemoved`).

## 4. Looking at what happened

* **Admin → התראות** (super admin): the rules, and the last 50 attempts — kind, status, reason, devices reached
  (`ok/total`), attempt number, HTTP status. Recipients are shown as the first 8 characters of their id.
* **Settings → שלחו לי התראת בדיקה** (visible once notifications are on): a real push to *your own* devices
  through the same transport. At most 5 per hour. It is the smoke test of a phone.
* Reasons you will see: `cooldown`, `daily_cap`, `push_error`, `subscription_gone`; event outcomes
  `sent`, `below_threshold`, `over_price_cap`, `no_verified_saving`, `no_recipients`, `all_skipped`, `stale`, `expired`.

## 5. Proving it on real devices (not done)

For **each** device below, in order. Record date, OS/browser version, and pass/fail in the table.

1. Open the deployed site (use staging first). Onboard; make the beer you will test favourite #1.
2. Settings → turn notifications on → accept the browser prompt. Confirm the switch reads "התראות פעילות".
3. Confirm a `push_subscriptions` row exists (Supabase → Table editor) for this profile.
4. Tap **שלחו לי התראת בדיקה** → the notification arrives within ~10 s → tapping it opens Settings.
5. Insert a test promotion for your #1 beer with a trusted regular price and ≥ 25 % saving (staging only, via
   `record_price`), then ring the worker (`curl` above, or wait for the schedule). Notification arrives within 60 s,
   reads *מבצע חדש ב… / beer pack · price במקום reference · −N%*, and tapping it opens `/beer/<slug>`.
6. Ring the worker again → nothing new arrives (idempotent).
7. Turn notifications off in Settings → repeat step 5 with a new promotion → nothing arrives.
8. Check Admin → התראות shows each attempt with the right status.

| Device | Browser / OS | Installed to Home Screen | Date | Result |
| --- | --- | --- | --- | --- |
| Android phone | Chrome | no | — | **not run** |
| Android phone | Chrome | yes | — | **not run** |
| iPhone (iOS ≥ 16.4) | Safari → Home Screen app | **required** on iOS | — | **not run** |
| Desktop | Chrome | n/a | — | **not run** |
| Desktop | Edge | n/a | — | **not run** |

Known open question (audit §13.4): on iOS the Home-Screen app has its own storage, so opening it creates a new
anonymous user; turning notifications on *inside* the installed app is what matters. Treat iOS push as unknown until row 3 is filled in.
