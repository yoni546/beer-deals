# The Deal Score

One number, 0–100, for how good a deal really is — built only from measurements
already on record, with fixed weights, so the same offer always scores the same and
any score can be explained from its own row.

Defined in `supabase/migrations/0027_deal_score.sql`. Proven in `tests/deal-score.test.ts`.

---

## The rule that comes before the arithmetic

**No trusted reference price, no score.**

`offers_feed.value_pct` is emitted only when the reference is a chain feed or an
admin, from the same branch or chain-wide, observed within 14 days, and only when
the raw discount falls between 1% and 70% (migration 0017). An offer without one
gets **no row in `offer_scores` at all** — not a zero, not an estimate. The UI shows
such a deal with no score, exactly as it already shows a price with no percentage.

A zero would be a claim. Absence is the truth.

The same applies to `needs_review` (a "discount" above 70%, which is far more often
a bad reference price than a real bargain) and to sample data, which never scores.

## The three components

Each is 0–100 on its own. Each comes from something measured.

### CHAIN — weight 0.25

From `offers_feed.value_pct`: how far below **this chain's own** trusted regular
price the offer is.

```
chain_points = clamp(value_pct / 50 × 100, 0, 100)
```

50% off or better is full marks. It carries the **least** weight of the three,
deliberately: it is measured against a price the same chain set, so a chain that
lifts its shelf price makes its own discount look deeper without changing what a
shopper pays.

### MARKET — weight 0.45

From `offers_feed.market_value_pct` (migration 0022): how far below the **median of
at least two OTHER chains'** lowest current regular prices the offer is.

```
market_points = clamp(market_value_pct / 50 × 100, 0, 100)
```

This is the component no chain can inflate, which is why it carries the most weight.
An offer dearer than the market contributes 0 rather than a negative number — it
drags the score down by being absent from the total, not by being punished twice.

Unavailable when fewer than two other chains stock the pack.

### HISTORY — weight 0.30

Where this price sits against **every price recorded for this exact pack in the last
180 days**, promotional and regular alike, from `price_observations` (the append-only
ledger, including superseded rows).

```
at or below the lowest ever seen  → 100
at or above the median            → 0
between                           → linear
```

This is the "is this actually a good price, or merely a good-looking discount"
component. It needs **at least four observations** before it is allowed to speak.

## Putting them together

Components that are unavailable are left out and the remaining weights are
renormalised, so an offer is never punished for data we do not hold:

```
score = round( Σ(points × weight) / Σ(weight) )
```

**One exception.** An offer with only the CHAIN component — no other chain to compare
against, no history — is **capped at 80**. One self-reported signal is not enough to
call something exceptional. The `basis` column records `capped: true` when this bites.

## Bands

| Score | Band | Hebrew |
|---|---|---|
| 85–100 | `amazing` | מטורף |
| 70–84 | `very_good` | משתלם מאוד |
| 45–69 | `fair` | סביר |
| 0–44 | `weak` | לא מיוחד (until 0.41.0: לא באמת מבצע) |

The design system supplies the colour and the mark; the UI never uses an emoji
(`CLAUDE.md`, enforced by `tests/no-emoji.test.ts`).

## Explaining a score

Every row carries a `basis` object naming each component's input, the points it
earned and the weight it was given:

```json
{
  "chain":   { "value_pct": 35, "points": 70, "weight": 0.25 },
  "market":  { "value_pct": 12, "points": 24, "weight": 0.45 },
  "history": { "lowest_agorot": 2400, "typical_agorot": 4000, "samples": 6,
               "points": 88, "weight": 0.30 },
  "capped":  false
}
```

A person asking "why 94?" can be answered from that, and so can a reviewer asking
whether the number is defensible.

## Why a table, refreshed by the import

`public.refresh_offer_scores()` computes every score and upserts it. It is called at
the end of an ingestion run, and by an admin after a manual change. **Nothing on a
page ever computes a score.**

Migration 0018's header records what happened the last time something recomputed over
the ledger per request: the feeds timed out at roughly 10,600 live promotions and
32,000 regular prices. The HISTORY component reads 180 days of that ledger, which is
heavier still. It belongs in a table.

`offers_feed` is deliberately **not** changed to include the score. Joining it in
would mean replacing the view the whole app reads, whose cost migrations 0018 and 0022
spent two rounds getting down. The app reads `offer_scores` separately — one indexed
read, keyed by the same `offer_key` the feed already emits — and merges the two.

## Housekeeping

Each refresh also **deletes** the score of any offer that has ended or whose reference
has gone stale. A deal must never keep a number it can no longer justify.

## Who may write it

`refresh_offer_scores()` calls `require_price_writer()` — the same guard the price
write path uses (migration 0008): an admin, or the service role. A score is part of
the price picture, so whoever may write a price may write what we think of it.
Everyone may read it.

## What it does not yet use

- **Pack size as such.** `unit_price_per_liter_agorot` exists and is shown in the UI,
  but the score compares a pack against its own history and its own market, which
  already makes the comparison like-for-like. A cross-pack "is a crate better value
  than four six-packs" signal is a separate question and a separate number.
- **Seasonality.** 180 days is a flat window with no weighting for recency or for the
  time of year.
- **Deposit.** Already normalised out of `value_pct` and `market_value_pct` upstream
  (0017), so it cannot show up as a saving here either.
