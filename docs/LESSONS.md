# Lessons learned (engineering notes)

Short, dated notes on things that cost real time. Each says what was seen, how it was
narrowed down, and what the code does about it now.

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
