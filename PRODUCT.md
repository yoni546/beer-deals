# Product

<!-- impeccable:product-schema 1 -->

> Source of truth for *what the product is*. Visual decisions live in [DESIGN.md](DESIGN.md).
> Facts below come from the owner's written brief (2026-09-29) and the repository. Anything
> marked **(inferred)** was not stated and needs the owner's confirmation. Impeccable's usual
> interview was replaced by that brief because the owner asked for autonomous work.

## Platform

web

(An installable, mobile-first PWA in Hebrew, right-to-left. Mobile web is `web`; it is not a native app.)

## Users

Israeli beer drinkers who buy at supermarkets and want to know, in seconds, **which beer is on
sale, for how much, and where** — and what it costs when nothing is on sale.

- **Situation.** Mostly on a phone, one-handed, often standing in a brightly lit supermarket
  aisle comparing packs — or at home in the evening deciding where to shop. *(inferred from the
  product's core promise: "which beer is on sale, how much, and where")*
- **Each person has four ranked favourite beers.** Favourite #1 matters most: it sets the app's
  look by default and is the only beer that may send a push notification. Favourites #2–#4 shape
  what is shown first.
- **Other people.** A small number of administrators moderate submissions and choose editorial
  picks; the owner runs the project with a second developer.

## Product Purpose

Answer "what's on offer for the beers I care about, where, and is it really a good price?" —
faster and more honestly than walking the aisles or opening four chain apps.

Success is: a user opens the app, immediately sees the best current price for their favourite
beers at each chain, trusts it (it is real, fresh, and for the right pack size), and acts — or
gets a notification, worded like *"New deal at Rami Levy: Goldstar 6×330ml ₪25 instead of
₪37.90"*, when a new deal for their #1 beer appears.

## Positioning

A price-intelligence tool built around the drinker's own ranked favourites, not a generic
grocery-deals feed. What a neighbouring product could not truthfully copy:

- **Pack-accurate.** Goldstar 6×330 ml and Goldstar 6×500 ml are different products; offers are
  compared per pack *and* per litre.
- **Honest about savings.** A percentage is shown only against a trusted reference price; sample
  or unverifiable data is never presented as a real deal.
- **Promotions and regular prices together**, by beer and by supermarket.
- Hebrew, RTL, and Israeli chains first.

## Operating Context

- **Data today:** administrator-approved user submissions (no real prices are live yet; the
  invented sample deals were retired from production). **Soon:** chains' published daily price
  and promotion files, ingested by an automated pipeline. Data has a source, an observed-at time,
  and a validity window; stale data must be visibly stale.
- **Identity:** nobody signs up. Every visitor is an anonymous Supabase user, so favourites and
  settings belong to a browser profile. *(Durability across devices is an open decision.)*
- **Notifications:** Web Push. Android/desktop work in the browser; iPhones require the app to be
  installed to the Home Screen. Real-device delivery has not yet been demonstrated.
- **Environments:** production (real users), staging (`qpjwnxptitnmtsznjvkw`, Tokyo, holding real feed data
  from 9 chains since 2026-09-29), and a local fake for tests.

## Capabilities and Constraints

- Choose and rank four favourite beers; reorder or swap them later in Settings.
- Browse and search **by beer** (all deals for that beer across chains) and **by supermarket**
  (promotions first, regular prices underneath, without an enormous page).
- Sort by price low→high, price high→low, and deal value; compare per pack and per litre.
- A canonical model of brand · variant · container · volume_ml · pack_quantity · chain · branch ·
  regular price · promotion (conditions, dates) · source · observed_at. See `docs/DATA-MODEL.md`.
- **Favourite #1 is the app (permanent rule).** The beer a person ranks first *is* their app: its
  bottle stands on the counter behind everything and the palette is derived from that beer's own
  colours. There is **no theme picker and no manual override** — reordering the favourites is how
  the look changes, and it changes everywhere at once. Light or dark follows the phone's setting.
  A beer without an identity (or before onboarding) gets the neutral house look, never another
  beer's. The bottle is the real product photo — shown as photographed, background removed, never
  redrawn — with its source on record (`src/design/bottle-photos.json`); a beer with no usable photo
  keeps a drawn stand-in. Favourite #1 is also the only beer that may send a notification.
- **What is sold (scope).** Beer, non-alcoholic beer and radler are shown; malt drinks and cider are
  kept out for now. Categories are data (`product_categories`), switched on without code.
- **Only offers everyone can use.** A promotion that needs a club, a specific card or payment method,
  a coupon, an employer, an app account or any other condition is recorded for provenance and never
  shown, ranked, searched or announced.
- **Prices are per branch.** A chain row is the lowest current price among the branches seen, labelled
  "החל מ־" when branches differ, or "בסניף X" when one branch was seen. There is no invented "chain
  price". The feed's own chain / sub-chain / store codes are kept, so a Yeinot Bitan branch published in
  Carrefour's feed is Yeinot Bitan's.
- **Deposit.** Shelf prices exclude the bottle deposit (₪0.30 a container); it is shown beside the
  price ("+ ₪1.80 פיקדון") and never counts as a saving.
- **"Any N of these for ₪X"** is one group offer across several packs, shown as such — never a
  per-pack price the chain did not publish.
- **Beer for home (0.8.0).** People buy beer to take home: six-packs and small packs first, then
  cases, single cans and bottles last. Home shows **packs and cases only** — never a single — ordered:
  the person's own beers, then true six-packs, cases, eights and fours, other packs. With nothing to
  show it says "אין כרגע מבצעי שישיות או ארגזים לבירות שלך".
- **Three categories, and only three:** שישיות (2–11 units: 4, 6 and 8 are the real ones), ארגזים
  (12 or more), בודדים (1). There is no "מארזים". Every product still says what it is, with its real count:
  רביעייה · 4×330 מ״ל, שישייה · 6×330 מ״ל, שמינייה · 8×500 מ״ל, ארגז · 24×330 מ״ל — a four is never
  called a שישייה. Inside שישיות the default order is 6, then 8, then 4, unless the person picks a price
  sort. Beer and chain pages go שישיות → ארגזים → בודדים, and inside each, deals everyone can use first,
  then regular prices; a kind with nothing is left out.
- **Where a deal runs (0.9.0).** A promotion seen at one branch is not the chain's. Every deal says only what
  was checked: **בכל הרשת** only when the chain itself says so, or every branch its Stores file lists was checked
  in the same scan and every one lists the promotion; **בסניפים משתתפים** when some of several checked branches
  list it ("12 מתוך 18 סניפים שנבדקו" in the sheet); **<branch> בלבד** when exactly one of several checked does;
  otherwise it says what was seen ("נצפה בכל 7 הסניפים שנבדקו", "נצפה בסניף X") or "זמינות לפי סניף". A branch that
  failed, whose file is stale, or that published nothing yet is *not checked* — never counted as lacking a deal.
  The same promotion at many branches is one deal; tapping its line lists the branches. Eligibility (open to
  everyone) and scope (where) are separate: a universal deal can run at one branch.
- **What's New is for the people who run the app** (admins; checked on the server). Every meaningful
  change still ships a release entry (see `CLAUDE.md`). Everyone else gets "אהבתם? שתפו לחברים",
  which shares the production address.
- Technical constraints that must be preserved: Row Level Security as the permission system;
  money in integer agorot; the service worker never caches pages (a stale price in an aisle is
  the one unforgivable failure); the discount is never typed by hand and never shown without a
  trusted reference.
- Terminology: *מבצע* (promotion/deal), *מחיר רגיל* (regular price), *שישייה / ארגז / בודד*
  (legacy pack categories), *רשת* (chain), *סניף* (branch), *הבירה הראשית* (favourite #1).

## Brand Commitments

- Name: **מבצעי בירה** ("Beer Deals"). No existing logo or brand assets. *(no invented ones)*
- Voice: plain, direct, friendly Hebrew (e.g. "אהלן"); not corporate, not slangy.
- **Binding design constraints from the owner:** distinctive, polished, intentional, premium, fun,
  modern and clearly about beer — but not childish, not pub-menu kitsch, not generic SaaS cards, not
  "gradient + glass cards = design", not "AI slop". The current brown/yellow look is to be replaced
  structurally, not recoloured.
- Never redraw, recreate or alter a beer's label art, logo or trade dress. Real product photos are
  shown exactly as photographed (the owner's decision of 2026-09-29), with their source recorded.

## Evidence on Hand

- Real price data exists on **staging** only (first ingestion 2026-09-29, `docs/INGESTION-STAGING-REPORT.md`);
  production has none yet. Do not fabricate prices, savings, stores' offers or claims.
- 22 beers and 15 chains are seeded (`supabase/migrations/0004_seed.sql`), and an invented dev/staging
  catalogue exists (`supabase/seed/dev-catalog.sql`, flagged `is_sample`) for building and testing.
- The audit, with screenshots of the previous UI: `docs/PRODUCT-AUDIT-2026-09-29.md`.

## Product Principles

1. **Truth before persuasion.** A price or a saving appears only when it can be trusted; missing
   data shows as missing, never as a plausible fake.
2. **The drinker's four beers come first**, in their own order — the app is organised around them.
3. **Comparable by default.** Different packs are never compared as if equal; per-pack and per-litre
   are both one tap away.
4. **One hand, one glance, bad light.** The answer is legible in a bright aisle in under a second,
   with touch targets a thumb can hit.
5. **Identity through atmosphere, not trade dress.** Each beer changes how the app *feels*, never how
   it *works*.

## Accessibility & Inclusion

- WCAG AA: text contrast ≥ 4.5:1 (large text ≥ 3:1) in every theme and in both light and dark.
- Touch targets ≥ 44 px; meaningful text ≥ 12 px; pinch-zoom stays enabled.
- Right-to-left first; numbers and mixed Hebrew/Latin strings stay correctly ordered.
- Never rely on colour alone; honour `prefers-reduced-motion`.
