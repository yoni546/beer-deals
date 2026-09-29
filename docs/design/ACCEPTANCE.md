# Audit acceptance criteria — where each stands (2026-09-29)

The 35 criteria of `docs/PRODUCT-AUDIT-2026-09-29.md` §18, checked against the branch
`rebuild/beer-deals-v1` at release 0.7.0. **Met** = proved by a named automated test in CI. **Partly** = built, but
not exactly as worded or not fully covered. **Not met** = not done, with the reason. Nothing is marked met on the
strength of a manual look alone.

| # | Criterion (short) | Status | Evidence / gap |
| --- | --- | --- | --- |
| 1 | `/beer`, `/store` 200; every route non-5xx at both viewports | Met | `hotfix.spec › B-01 every route answers…` |
| 2 | Search finds Goldstar for `גולד`, `גולדסטר`, `gold`, niqqud variants; zero-result state offers a next action | Met | `format-search.test.ts`, `hotfix.spec › search…`, `redesign.spec › Home search` (the empty state has a "clear the search" button). |
| 3 | No public read returns a demo row | Met | `hotfix.spec › B-02`, `demo.test.ts`, `dev-seed.test.ts` (seeds refuse to run unflagged) |
| 4 | Goldstar 6×330 and 6×500 live at one chain together | Met | `catalog.test.ts` |
| 5 | A regular price and a promotion coexist | Met | `catalog.test.ts`; `redesign.spec › beer page` |
| 6 | Append-only ledger; price change = new row | Met | `catalog.test.ts`, `ingestion-safety.test.ts` |
| 7 | A promotion past `valid_to` disappears | Met | `catalog.test.ts` (relative clock, not a frozen one) |
| 8 | Conditions round-trip; UI shows chips | Met | `catalog.test.ts`; `redesign.spec` ("2 ב־₪80") |
| 9 | `value_pct` NULL without a verified reference; > 70 % held | Met | `catalog.test.ts`; `redesign.spec › a promotion with no trusted regular price…` |
| 10 | RLS: forged `primary_beer_id` rejected; endpoint re-parenting; new tables follow the convention | Met | `hardening.test.ts`, `security.test.ts`, `notifications-security.test.ts` |
| 11 | Home first screen: number-one beer, search, bottom nav | Met | `redesign.spec › …all on the first screen` (390×844 and 430×932) |
| 12 | Favourites' offers in rank order A→D, then others | Met | `offer-logic.test.ts` (grouping/ranking); `redesign.spec › the four beers are keys in order` |
| 13 | Deal rows are links; no dead ends | Met | `hotfix.spec › a line on the tape leads to its beer and its store` |
| 14 | Beer page: SKU groups, price ↑/↓/value + per-litre, "מחירים רגילים" | Met | `redesign.spec › beer page…`, `offer-logic.test.ts` |
| 15 | Store page: promotions first, regular prices second (searchable), ≤ 15 rows before "show all" | Partly | One page: "מבצעי בירה עכשיו" then "מחירי בירה רגילים" (`redesign.spec`), folds after 6 beers, jump links, one sort for both. The regular part has no search box of its own (Home search reaches a beer). |
| 16 | No cross-pack comparison without unit normalisation | Met | `offer-logic.test.ts` (mixed packs) |
| 17 | Freshness on Home, Beer, Store | Met | `Freshness` on all three; `redesign.spec` |
| 18 | Reorder favourites by drag **and** buttons; swap; atomic save; #1 changes theme | Met | Drag by a grip (pointer events, `touch-action: none`), up/down buttons, remove/add, announced ranks, one atomic save; the app follows the new #1 without a reload (`favourite-one.spec › dragging…`, `› keyboard…`, `› changing #1 to Heineken…`). |
| 19 | Theme automatic; follows the person across reload/devices; correct first paint, no flash | Met (rule changed) | The audit's "override" is **removed by product decision**: favourite #1 alone decides the look. It is stored with the favourites, so it follows the person; the server's HTML already carries the beer's stylesheet and bottle (`favourite-one.spec › … on the first paint` reads the raw HTML). |
| 20 | ≥ 21 presets; contrast tests; presets ≥ ΔE 12 apart | Partly | 21 beer identities + the house look; contrast for every beer in both modes, plus a proof that all counter text keeps ≥ 4.5:1 over any bottle pixel (`design.test.ts`). Distinctness uses Oklab distance of accent + counter + label ≥ 8, not the audit's ΔE 12. |
| 21 | No brand logos or label art | Met (rule changed) | **Owner decision 2026-09-29:** real product photos are used, shown exactly as photographed (background removed, nothing redrawn), provenance per file (`bottle-photos.test.ts › the real bottle photos on record`). Nothing is drawn or recreated from a label. |
| 22 | Toggle reflects real state across the permission matrix; rejected `subscribe()` never reaches the error boundary | Met | `push-client.test.ts`, `hotfix.spec › notification settings` |
| 23 | Push URL resolves to the intended page | Met | `push-message.test.ts`, `service-worker.test.ts`, beer page e2e |
| 24 | Message text matches §13.3 incl. "במקום" only when verified | Met | `push-message.test.ts` |
| 25 | Dedupe, cooldown, daily cap, quiet hours tested; a delivery row for every attempt | Met | `push-rules.test.ts`, `notifications-worker.test.ts` |
| 26 | Device matrix executed and recorded | **Not met** | Needs real phones. `docs/NOTIFICATIONS.md` §5; its table is empty on purpose. |
| 27 | Release test passes; CI fails on disagreement | Met | `releases.test.ts` in CI |
| 28 | "מה חדש" on Home and Settings; dot only when unseen; latest expanded, earlier collapsed; version in Settings | Met | `whats-new.spec`, `whats-new.test.tsx` (all earlier releases are collapsed, not only five) |
| 29 | No control < 44×44 px; no text < 12 px | Met (public screens) | `quality.spec › no screen scrolls sideways, every control…` on 10 screens. The admin panel is not scanned. |
| 30 | axe: 0 serious/critical on Home, Beer, Store, Settings in every theme | Partly | axe WCAG A/AA on 10 screens in light and dark; contrast rule in 5 themes (house, heineken, stella, guinness, tuborg-red) × 2 modes. Contrast is proved for **all** themes by computation (`design.test.ts`), not by axe. |
| 31 | No horizontal overflow at 360/390/430/768; LTR-isolated numbers | Met | `quality.spec` at all four widths; `.num` isolation |
| 32 | Performance: LCP p75 ≤ 2.5 s, TTFB ≤ 600 ms, function region == DB region, skeleton on every data route | **Not met** | Live site measured 2026-09-29: 2.8–5.8 s to first byte, function in `iad1` while the database is in Tokyo. `vercel.json` now pins `hnd1` (Tokyo) — takes effect on the next deploy; the "after" measurement needs that deploy (owner). Production's region is evidence-based (its IP is in AWS Tokyo), not dashboard-confirmed (`docs/INFRASTRUCTURE.md`). **Skeletons were tried and abandoned:** route-level `loading.tsx` stalls client navigation in this app's production build (`docs/LESSONS.md`); the loading state is a top progress bar. |
| 33 | Loading, empty and error states designed for every route | Met (with #32's exception) | Progress bar; empty states in every list; `error.tsx`, `not-found.tsx`; `redesign.spec › an unknown beer…` |
| 34 | No emoji as icons; Impeccable critique with no P0/P1; before/after screenshots | Met | `no-emoji.test.ts`; detector output `[]` (CLAUDE.md asks for it before a UI PR); `docs/design/CRITIQUE.md`; `docs/design/screens/` (after) and `docs/audit-2026-09-29/` (before) |
| 35 | CI required checks on `main` | **Not met** (owner) | CI runs typecheck, lint, tests, build, Playwright + axe. Branch protection is a GitHub setting only the owner can change. |

**Score:** 29 met · 3 partly · 3 not met (device matrix, performance, branch protection) — the three not-met
items all need something outside the repository (a phone; a deployment; the repository owner's settings).
