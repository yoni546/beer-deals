# Lessons learned (engineering notes)

Short, dated notes on things that cost real time. Each says what was seen, how it was
narrowed down, and what the code does about it now.

## 2026-10-31 — A scheduled task nobody has triggered is a guess

**Seen.** The weekly local import of the three geo-blocked chains (docs/WEEKLY-IMPORT.md)
was registered in the Windows Task Scheduler and reported `Ready`. Triggering it by hand
found two faults in a row, neither of which the registration showed.

**One: it will not run on battery.** The task sat in `Queued` and never started.
`schtasks /query /v` says why — "Stop On Battery Mode, No Start On Batteries", which is
Windows' default for a new task. The machine is a laptop, so that is the normal state on a
Sunday morning, and the task would simply never have run. Fixed with
`-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`.

**Two: PowerShell counts a warning as a failure.** The script piped the import's output
with `2>&1` under `$ErrorActionPreference = "Stop"`. PowerShell 5.1 wraps each stderr line
of a native program in an error record, so the first of the 39 routine "barcode … already
belongs to another SKU — left as it is, review it" warnings ended the pipeline and killed a
healthy write half-way through, leaving an ingestion run `running` for ever. (0067 closes
such a run after four hours, and what it wrote stays valid, so nothing was lost.) The two
calls now drop to `Continue` and the exit code alone decides. `[Console]::OutputEncoding`
is set to UTF-8 in the same place, or the Hebrew chain names arrive as mojibake.

**The rule.** Register nothing without firing it once and reading its log. Both faults
were invisible from the registration and both were total.
## 2026-10-26 — The slowness is the Tokyo hop, and prefetch cannot hide it

**Seen.** The owner: "between pages it takes ages to load, the deals page and the beers page
and the first page too, and no animation is running." Measured from Israel against production,
warm, one request at a time:

| what | TTFB |
| --- | --- |
| a static file (`/manifest.webmanifest`) | ~0.25 s |
| `/settings` — reads almost nothing | ~0.85 s |
| `/beer` | ~0.85 s |
| `/store` | ~0.86 s |

**The cause is geography, and the proof is that the numbers do not vary with the page.** The
settings screen is as slow as the deals screen. `X-Vercel-Id: fra1::hnd1` — static files are
served from Frankfurt, every dynamic page is routed on to Tokyo, where `vercel.json` pins the
functions to be beside the database (ap-northeast-1). That hop is ~600 ms of the ~850, paid by
every page whatever it renders, and no amount of query tuning touches it.

**What was tried and reverted: prefetching the four TabBar links.** The idea was sound — the
hop cannot be removed, but it could be paid while somebody reads rather than after they tap —
and the TabBar is the one place the old "prefetch fan-out" objection does not apply (four links,
not a chain page's ~340 row anchors). It does not work, because **Next will not render a
`force-dynamic` route for a prefetch**:

```
curl -H "RSC: 1"                            .../beer   ->  14,591 bytes
curl -H "RSC: 1" -H "Next-Router-Prefetch: 1" .../beer  ->     159 bytes
```

Those 159 bytes are an empty tree with no page in it. So the prefetch is a wasted request, the
client router cache has nothing to store, `experimental.staleTimes.dynamic` has nothing to keep
fresh, and the tap pays the full round trip regardless. An e2e test written to prove the win
instead disproved it: three runs, three failures — twice the prefetch never produced a usable
payload at all. `prefetch={false}` on the TabBar is correct and stays.

**What would actually fix it**, in order of effect:
1. **Move the database to eu-central-1** and re-pin `vercel.json` to `fra1`. Israel→Frankfurt is
   ~60 ms against ~250 ms to Tokyo; this is the only change that also speeds up the FIRST page,
   which has nothing to prefetch. Supabase cannot change a project's region in place — it means a
   new project, a restore, new URL and keys, and a couple of hours down. Owner's decision.
2. A static shell that streams its data would let a tap paint instantly, but that needs either
   `loading.tsx` (stalls navigation here — see the 2026-09-29 entry) or PPR, and every route is
   `force-dynamic` because the session is read in the layout.

**Do not** re-enable prefetch anywhere while the routes are `force-dynamic`. It buys nothing and
costs a request per link.

## 2026-09-29 — `loading.tsx` stalls client-side navigation (Next.js 15.5.26)

**Seen.** After adding route-level `loading.tsx` files, every e2e spec that taps a link
which changes only the query string (`/` → `/?sort=price_asc`) failed against the
**production build**, while the same specs passed against `next dev`. In the browser the tap
did nothing: the URL never changed, no error was logged, and the network panel showed the
RSC request (`/?sort=price_asc&_rsc=…`) answered `200 text/x-component` and then
`net::ERR_ABORTED` (cancelled by the renderer, not by `AbortController`). Links to other
paths appeared to work only because Next falls back to a full page load.

**Narrowed down.** Not the service worker, not compression (`compress: false`), not the
custom `distDir`, not the middleware, not the client widgets in the layout, not the data
layer, not `generateViewport`, not real Chrome vs Playwright's Chromium. Removing the
`loading.tsx` files fixed it. A bare Next app (async layout reading cookies + one dynamic
page + `loading.js`) with a **small** page navigated fine; the same app with a page of a few
hundred rows (~50 KB of Flight payload) stalled exactly the same way, and stopped stalling
when `loading.js` was removed. So: *`loading.tsx` in front of a large dynamic page, production
build*. Not investigated further upstream.

**What the code does now.**
- No `loading.tsx` anywhere under `src/app` (`tests/no-loading-boundary.test.ts` fails if one
  appears).
- The loading state is `src/components/ui/NavigationProgress.tsx`: a thin bar along the top
  edge (and a spoken "טוענים…") that starts on a same-origin link tap and stops when the path
  or query changes. The previous page stays on screen until the new one is ready.
- The regression is covered by the e2e specs that tap sort/filter chips and the bottom bar;
  they must run against a **production build** (CI does; `E2E_DEV=1` hides this class of bug).

**If you want to try `loading.tsx` again**, upgrade Next first, then run the whole e2e suite
without `E2E_DEV`, and check that `tests/e2e/redesign.spec.ts › sorting lives in the URL` passes.

## 2026-09-29 — What the real price feeds taught (first ingestion, staging)

- **The skill's parser drops `DiscountedPrice`** for the Shufersal/Carrefour-style layout, which all
  nine publishers use (Cerberus chains included — the root element is `ChainID`). Without it a
  promotion's price exists only in free text. `scripts/ingest/lib/promo-supplement.mjs` reads that
  one field; everything else stays the skill's.
- **Two statements of a promotion price must agree** (description vs `DiscountedPrice` for `MinQty`
  units); 151 of 155 did. Shufersal's "2ב71.40 פקדון" descriptions quote the price without the ₪0.30
  deposit per container, while `DiscountedPrice` includes it — the gap is exactly 30 agorot × containers.
- **Names are cut at ~20 characters** at several chains ("גולדסטאר לא מסו", "SLOW B", "פחי"). A short
  name may be *less specific* than another chain's full name for the same barcode, but never evidence
  against it (`reconcileBarcodes`). Full-length names that disagree (Carrefour's "טובורג רד" vs five
  chains' plain Tuborg for one barcode) are held for a human.
- **ClubID codes** are 0 all / 1 club / 2 card / 3 other, but labels disagree with codes (Carrefour tags
  "מועדון קרפור אשראי" with 0). Read both; in doubt, restricted.
- **`update_date` is the last price change** (back to 2015), not the observation: use the file time.
- **A publisher is not a retailer.** Carrefour's feed carries a branch still trading as Yeinot Bitan;
  Dor Alon's carries AM:PM (its sub-chain "AM:PM"). Decide per branch from the Stores file.
- **Some chains sell no beer at all** (King Store: 0 of 48 branch files list any). Not a failure.
- **Rollback + re-import was broken** until migration 0015: idempotency matched the content hash of the
  rows the rollback had rejected, so the re-import silently wrote nothing. Rehearse rollbacks for real.
- **Generated columns vs a whole-row guard trigger:** in a BEFORE UPDATE trigger, generated columns of
  NEW are not computed yet, so `to_jsonb(new) <> to_jsonb(old)` fires on every status change. Exclude
  them from the comparison (they are derived from columns that are still compared).
- **The public feed dedupes a chain promotion across branches** — so anything that looks an offer up by
  one branch's observation id (the notification worker) must use `offers_ranked`, not `offers_feed`.

## 2026-09-29 — Working against staging

- A production build against staging (`NEXT_DIST_DIR=.next-staging`) rewrites `tsconfig.json` and
  `next-env.d.ts` to include its own folder: revert both before committing.
- Supabase rate-limits anonymous sign-ins (about 30 an hour per IP). A QA script that opens a fresh
  browser context per screenshot runs into it; reuse one visitor per scenario.
- `supabase config push --project-ref <staging>` applies `supabase/config.toml` (anonymous sign-ins on);
  it shows the diff first. Never run it against production without reading that diff.

## 2026-09-30 — Scanning every branch (0.9.0)

- **A sample is not coverage.** One branch per chain proved the pipeline; it said nothing about where a
  promotion runs. Scope is now measured against branches checked in the same scan (migration 0017).
- **A branch lists only the items it stocks, and a chain issues one deal under several ids.** The same
  promotion lists 3 items at some Tiv Taam branches and 4 at others; Mahsanei, Keshet and Rami Levy publish one
  deal under a different id per group of branches. The identity is: identical terms (kind, price, audience,
  written terms, end DAY) AND a shared item or id, connected across the chain — never the item list, the id or
  the price alone.
- **One chain writes one promotion two ways.** Keshet's 1153220 is "2026-10-03" + end_hour at some branches
  and "2026-10-03T23:59:00.000" with id "0001153220" at others. Compare dates as days, ids and codes without
  leading zeros — 111 duplicate lines on staging came from raw string comparison.
- **A replayed record keeps its old time.** A promotion's content hash lacked the file's time (a regular
  price's has it), so the next day's file would have replayed every unchanged promotion with yesterday's
  observed_at and close_missing_promotions would have closed them all. Every record carries its file's time;
  a same-file `--reprocess` rewrites nothing, so a changed identity reaches the database with each branch's
  next file (within the day), not on a re-run.
- **"Only here" needs every branch checked.** With 2 of 71 Mahsanei branches read, "X בלבד" was a false claim;
  `promotion_scope` gives single_branch only when every known branch was checked.
- **Where a branch lists a promotion is evidence even when our own check held its copy** (a shelf price that
  did not confirm it at that branch). Occurrences are recorded for every public listing, published or not.
- **Sources rotate at midnight.** Laib Catalog (Victory, Mahsanei HaShuk), Carrefour's day folder and some
  Cerberus accounts (Osher Ad) list nothing, or only the Stores file, until the chain publishes the new day.
  Right after midnight that is "not published yet", never "no promotions"; the inventory comes from the last
  Stores file read.
- **Shufersal's listing pages answer in ~20 s each**; read them in parallel and download with the listed
  signed links (valid ~30 min), re-listing a store only if its link expired. Per-file re-listing took 2 min a
  branch.
- **Rami Levy serves some files as ZIP under a ".gz" name**; Keshet's account also holds another chain's old
  files. Unpack ZIPs; take only files of the publisher's own chain code.
- **Rolling back a full-scan run exceeds the API statement timeout** (10,000+ rows). Run
  `begin; set local role service_role; set local statement_timeout = 0; select public.rollback_ingestion_run(...); commit;`
  with `npx supabase db query --linked` (staging). Even that gives up on a 15,000-row run (the management
  API's own request limit): **before production daily ingestion, make rollback work in batches** (reject a
  run's rows N at a time, then restore) — tracked in docs/INGESTION-READINESS.md.
- **"ארגז" is not 24.** Crates hold 12, 20 or 24; read the count from the name, the volume or the barcode. The
  ₪19.90–₪25.90 "ארגז גולדסטאר" rows are the empty returnable crate, and a 5 L total is a keg, not 20×250.
