# Final readiness report — release 0.7.0 (2026-09-29)

Branch `rebuild/beer-deals-v1` (draft PR yoni546/beer-deals#1). Started this pass at `9c891e2`; `main` had not
moved (`c5910f1`). Nothing was force-pushed, no history rewritten, `main` untouched.

**In one paragraph.** The app is finished to production quality *inside the repository*, and it has been proved
against **real supermarket data on a staging database**. It is **not yet live with real prices**: the production
database belongs to a Supabase account this machine cannot open, so production migrations, the production import and
a production deployment are the owner's steps (exact list at the end). Everything the brief asked for that did not
need that access is done, tested and committed.

## Status by area

| Area | Status | Evidence |
| --- | --- | --- |
| Favourite #1 is the app (permanent rule) | **Done** | `getThemeForBeer(#1)` only; no picker, override or light/dark switch (tests fail if one appears). Light/dark follows the phone. |
| Real bottle images | **Done for 19 of 21 identities** | 17 retailer pack shots (found by the barcode the feeds carry) + 1 Commons photo, background removed, nothing redrawn, provenance per file (`src/design/bottle-photos.json`, `scripts/fetch-bottles.mjs`). Desperados and Bazelet: no usable photo, drawn stand-ins. |
| Theme library | **Done** | 21 identities from packaging colours; Maccabee corrected to its current blue label; contrast ≥ 4.5:1 over any bottle pixel proved per beer and mode. |
| Favourites UX | **Done** | Drag (touch/mouse), keyboard buttons, replace, one atomic save, #1 marked as look + notifications; the app follows immediately, no stale bottle (`favourite-one.spec`). |
| Home | **Done** | Your four beers first, the one verified best deal, group offers on your beers, then the best others. |
| Category scope | **Done** | Beer, non-alcoholic, radler in; malt, cider out — `product_categories`, switchable without code. |
| Regular prices + deals | **Done** | Beer and chain pages: "מבצעים עכשיו" then "מחירים רגילים"; sort price ↑ / ↓ / best verified saving; per litre secondary; packs never compared as one. |
| Offers for everyone only | **Done** | Club / card / payment / coupon / employee / app-only offers are recorded but never shown, ranked, searched or announced (`is_universal_offer`, 0014; 20+ tests). |
| Mix-and-match | **Done** | `promotion_groups`: one offer across several packs, per-pack figure only as "יוצא ₪X לאריזה". |
| Chain vs branch | **Done** | Per-branch prices; chain rows say "בסניף X" or "החל מ־"; the feed's own codes kept; retailer per branch from the Stores file. |
| Deposit | **Done** | Apart from the price ("+ ₪1.80 פיקדון"), never a saving, compared on equal terms. |
| Feed/schema mismatches | **Done** | All seven closed by 0014; 0015 fixes re-import after rollback (found on staging). |
| Ingestion skill | **Done** | v1.6.0 installed and used; a supplement reads only the `DiscountedPrice` it drops, tested on real excerpts. |
| Retailer coverage | **10 supported**, 3 blocked, 1 no beer | See "Chains" below. |
| Staging | **Done** | `qpjwnxptitnmtsznjvkw` (Tokyo), migrations 0001–0015, anonymous sign-ins, real data. |
| First real ingestion (staging) | **Done** | See "Staging ingestion" below. |
| Ingestion QA on staging | **Done** | The app (production build) against staging: 100 page views (5 beers × light/dark × 390/430 × 5 pages), 0 problems; manual review of real products. |
| Notifications | **Done in code** / **not device-proven** | #1 only, verified saving, new only, universal only, once per person, quiet hours; a lost-notification bug fixed. |
| Real-device testing | **BLOCKED BY DEVICE** | No phone connected (no `adb`). iPhone Safari: not tested. |
| Region + performance | **Configured, not yet measured after** | Before: 2.1–5.3 s median TTFB, function `iad1`, database Tokyo. `vercel.json` → `hnd1`. After: needs a deploy. |
| Daily automation | **Built for staging** | `.github/workflows/ingest-staging.yml`, gated; secrets set; runs once merged. Production: not enabled. |
| Production migrations / data | **BLOCKED (access)** | Production project not reachable from here. |
| Branch protection | **BLOCKED (owner)** | This GitHub account has write, not admin. |

## Chains

Supported (fetched, parsed, ingested to staging): **Carrefour, Yeinot Bitan** (inside Carrefour's feed),
**Shufersal, Rami Levy, Yochananof, Osher Ad, Tiv Taam, AM:PM** (inside Dor Alon's feed), **Hatzi Hinam** — 9
retailers, plus **King Store** reachable but selling no beer (0 of 48 branch files).
Blocked: **Victory**, **Mahsanei HaShuk** (Laibcatalog lists them, returns no files), **Super Yuda** (Cerberus
account unknown; not guessed). Categories without a publisher: liquor stores, makolet.

## Staging ingestion (2026-09-29, one branch per retailer)

87,033 shelf rows → 821 beer candidates (435 of our beers) → **62 canonical SKUs**, 140 resolved products, 269 in the
review queue → **153 regular prices**, **16 universal single-pack promotions** and **2 mix-and-match offers**
published; 61 restricted promotions filtered; the rest held with a reason; 6 invalid prices, 0 duplicates. 10
branches of 9 retailers. Idempotency, rollback and re-import rehearsed. Full report: `docs/INGESTION-STAGING-REPORT.md`.

## Tests at the end of this pass

Typecheck ✅ · lint ✅ · unit/database tests **495+** ✅ (31 files) · production build ✅ · Playwright on the local fake
(390×844, 430×932, incl. axe WCAG A/AA) ✅ · Impeccable detector `[]` ✅ · visual matrix against staging ✅. CI runs the
same on the pushed branch.

## What only the owner can do — exactly

1. **Confirm the production database region.** Supabase dashboard → project `itpyyexhmvosxcbcagvy` → Project
   Settings → General → **Region**. If it says *Northeast Asia (Tokyo)*, `vercel.json` (`hnd1`) is right; if not, tell
   me before merging.
2. **Back up production.** Dashboard → Database → Backups (or `supabase db dump` with the production password) — keep
   the file.
3. **Apply migrations 0006–0015 to production.** Either give this project's CLI access to that account
   (`npx supabase login` with the account that owns `itpyyexhmvosxcbcagvy`, then I run `supabase link` + `db push
   --dry-run` for you to read), or paste `supabase/RUN_THIS_IN_SUPABASE.sql`'s 0006–0015 part in the SQL editor. All
   are additive.
4. **Anonymous sign-ins** must stay on in production (Authentication → Sign In / Providers).
5. **Merge the PR and deploy** (Vercel → Deployments, or connect GitHub → Vercel: Project → Settings → Git →
   Connect `yoni546/beer-deals`, production branch `main`). Then run `node scripts/measure-latency.mjs
   https://beer-deals.vercel.app --runs 5` for the "after" numbers.
6. **Vercel preview = staging:** Project → Settings → Environment Variables → *Preview*: the staging URL, anon key,
   service-role key, VAPID pair, `CRON_SECRET`, `APP_ENV=staging` (values are in `.env.staging.local` on the machine
   that created staging — copy them from there, never through chat).
7. **Branch protection on `main`:** GitHub → Settings → Branches → Add rule → `main` → *Require a pull request* +
   *Require status checks*: **Typecheck · lint · tests · build** and **End-to-end (Playwright, mobile)** (the CI jobs `verify` and `e2e`).
8. **Production ingestion go-ahead:** after 1–5, and after you have looked at staging (`docs/STAGING.md`), say so;
   the first production import is one chain, run by `run.mjs` once it is given a production target on purpose.
9. **Each chain's terms and attribution** (legal): what the app must display about the source of prices.
10. **Real-device notifications:** run `docs/NOTIFICATIONS.md` §5 on an Android phone (Chrome) and an iPhone (Safari,
    installed to the Home Screen), and fill in its table.
11. **Super Yuda / Victory / Mahsanei HaShuk:** ask the chains (or the Competition Authority list) for their current
    publishing portal; Super Yuda's Cerberus account name.
12. **Bottle photos:** 17 are retailer pack shots (not freely licensed; used by your decision). Replace any with a
    brand-supplied or licensed photo by editing `scripts/fetch-bottles.mjs` and re-running it.
