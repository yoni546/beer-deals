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
- **Environments:** production (real users), staging (to be created), and a local fake for tests.

## Capabilities and Constraints

- Choose and rank four favourite beers; reorder or swap them later in Settings.
- Browse and search **by beer** (all deals for that beer across chains) and **by supermarket**
  (promotions first, regular prices underneath, without an enormous page).
- Sort by price low→high, price high→low, and deal value; compare per pack and per litre.
- A canonical model of brand · variant · container · volume_ml · pack_quantity · chain · branch ·
  regular price · promotion (conditions, dates) · source · observed_at. See `docs/DATA-MODEL.md`.
- **Theme:** follows favourite #1 automatically, with a manual override in Settings. Themes evoke
  each beer's identity **without** copying label art, logos or trade dress.
- **What's New:** a small, unobtrusive entry, the latest update, and recent history; every
  meaningful change ships a release entry (see `CLAUDE.md`).
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
- Never reproduce beer brands' label art, logos or trade dress.

## Evidence on Hand

- No real deal or price data yet. Do not fabricate prices, savings, stores' offers or claims.
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
