# The catalogue and price model

Migrations `0007`–`0010`. Additive: every table, column, view and function that existed
before is unchanged and still works. Rationale and the problems this fixes are in
[PRODUCT-AUDIT-2026-09-29.md](PRODUCT-AUDIT-2026-09-29.md) §3 and §11.

## Vocabulary

| Word | Table | Meaning |
| --- | --- | --- |
| **brand** | `brands` | Goldstar, Tuborg. |
| **beer** | `beers` (+`brand_id`, `variant`) | A brand and, optionally, a variant: `tuborg` and `tuborg-red` share the Tuborg brand. **This is what a user "favourites"** and what themes attach to. Unchanged FKs. |
| **SKU** | `skus` | One sellable product: *container* · *volume_ml* · *pack_quantity* of a beer. Goldstar 6×330 ml can and Goldstar 6×500 ml can are different rows. Unique on those physical facts. |
| **barcode** | `sku_barcodes` | Many GTINs / chain codes → one SKU. A barcode maps to exactly one SKU; a chain-internal code is scoped to its chain. |
| **chain** | `stores` (+`kind`) | Unchanged. `kind` says `chain`, `independent`, or `category` ("liquor store", "neighbourhood shop" are categories, not chains). |
| **branch** | `branches` | Optional. A price with no branch applies chain-wide. |
| **source** | `sources` | Where a price came from: `chain_feed`, `admin`, `user_submission`, `scraper`, `import`. `sample-data` marks invented dev/staging data. |
| **run** | `ingestion_runs` | One row per import, so a bad run can be undone as a unit. |
| **observation** | `price_observations` | One price seen at one time, at one place, from one source. Regular prices **and** promotions. Append-only. |
| **offer** | `offers_feed` (view) | What the app reads: promotions in force now, with unit price, a verified saving, a market comparison — plus legacy deals during the transition. |

```
brands ─< beers ─< skus ─< price_observations >─ stores ─< branches
             │        └─< sku_barcodes              │  └─ sources ─< ingestion_runs
             └─< user_favorite_beers (unchanged)     └─ conditions / valid_from / valid_to / observed_at
deals (legacy, frozen) ───────────────────────────────────────────────────────────┐
price_observations ──> regular_prices_current, promotions_current ──> offers_ranked ─┴─> offers_feed
```

## The rules

1. **A product is identified by physical facts.** `skus` is unique on
   `(beer_id, container, volume_ml, pack_quantity)`. Brand name never implies sameness.
2. **The ledger is append-only.** A price change is a new row; the old one becomes
   `superseded` (and points at its successor). Rows cannot be edited or deleted — not even by
   a superuser (`price_observations_guard`). Only `status` may move, and history never comes
   back to life. To undo a bad import, mark its rows `rejected` by `run_id`.
3. **One write path.** `record_price()` (and `record_prices()` for batches) validate,
   compute multi-buy prices, ignore replays and supersede. Nobody has INSERT/UPDATE/DELETE
   on the table — only administrators and the service role may *call* the functions.
4. **Out-of-order data is safe.** Back-filling an older observation stores it as history; it
   never replaces the current price.
5. **Replays are free.** The same `(source, content_hash)` returns the stored row.
6. **Regular price ≠ promotion ≠ each other's reference.** They coexist; the promotion never
   replaces the regular price. Several promotions on one SKU at one chain coexist (each has
   an `identity_key`: the chain's promo id, or a hash of its terms).
7. **Multi-buy** (`"2 for ₪45"`): `conditions.multi_buy = {qty:2, total_agorot:4500}` is the
   truth; `price_agorot` is the per-pack price `ceil(total/qty)` (= 2250). A CHECK constraint
   keeps the two from ever disagreeing, even if the function is bypassed.
8. **Conditions are structured**: `min_qty`, `max_qty`, `multi_buy`, `club`, `coupon`,
   `note_he`. Validity is `valid_from`/`valid_to`; a promotion with **no end date** is only
   shown for 7 days after it was last seen. "Unknown" never becomes "forever".

## When a saving is shown — and when it is not

`value_pct` is **only** produced when all of these hold:

- there is a current **regular** price for the *same SKU at the same chain* (branch-specific
  first, else chain-wide);
- it was seen within the last **14 days**;
- its source is a **chain feed** or an **administrator** (`reference_trust` = `feed` /
  `moderated`; a raw user report is `unverified` and never counts);
- the promotion really is cheaper;
- and the saving is **≤ 70 %** — beyond that it is far more likely a bad barcode or unit than a
  bargain, so `needs_review = true` and no percentage is shown.

Otherwise `value_pct` is `NULL` and the UI shows the price alone: no strikethrough, no "you
save". `market_value_pct` is a second, independent number against the **median regular price
at other chains** (needs ≥ 2 other chains), which a chain cannot inflate. `unit_price_per_liter_agorot`
makes different packs comparable. The percentage is never stored and never computed in the UI.

## Recording prices

```sql
-- one price (as an admin, or with the service role)
select * from public.record_price(
  p_sku_id := '…', p_store_id := '…', p_kind := 'promotion',
  p_price_agorot := 2500, p_observed_at := now(), p_source_slug := 'rami-levy-feed',
  p_promo_type := 'price_cut', p_valid_to := now() + interval '4 days',
  p_natural_key := 'promo-12345',          -- the chain's promotion id
  p_content_hash := 'sha256:…',            -- makes a replay a no-op
  p_run_id := '…');

-- a multi-buy: omit the price, give the terms
select * from public.record_price(
  p_sku_id := '…', p_store_id := '…', p_kind := 'promotion', p_observed_at := now(),
  p_source_slug := 'admin', p_promo_type := 'multi_buy',
  p_conditions := '{"multi_buy": {"qty": 2, "total_agorot": 4500}}');

-- a batch (ingestion): each item is applied on its own; bad ones are reported by position
select public.record_prices('rami-levy-feed', '[{ "sku_id": "…", "store_id": "…", "kind": "regular",
                                                  "price_agorot": 3790, "observed_at": "…" }, …]', '<run id>');
--   → {"accepted": 1998, "rejected": 2, "errors": [{"index": 17, "code": "P0002", "message": "unknown or inactive sku"}]}
```

## Reading

```ts
const { data } = await supabase
  .from("offers_feed")
  .select("*")
  .eq("beer_slug", "goldstar")
  .order("unit_price_per_liter_agorot", { ascending: true });   // type: Offer (src/lib/db/types.ts)
```

`regular_prices_current` lists the latest regular price per SKU × chain × branch (with
`is_sample`). Both views are `security_invoker`: RLS on the ledger is what hides unpublished
(`held`) rows — the public sees `live` only.

## The legacy bridge

`deals` (a pack *category* and a typed-in regular price) keeps working — user submissions and
the moderation queue are unchanged. `offers_feed` unions approved legacy deals in as
`origin = 'legacy'` (no SKU, `reference_trust = 'moderated'`, because an administrator approved
the price). Retiring `deals` is a separate, later, reviewed step.

## Hardening shipped alongside (0010)

- `profiles`: a user may update only `first_name` and `notifications_enabled`; `primary_beer_id`
  and `onboarded_at` belong to the database (`save_preferences()` is now `SECURITY DEFINER`).
- `save_push_subscription()` re-parents an endpoint to whoever holds the device now, so a
  browser whose site data was cleared can subscribe again.

## Sample data

`supabase/seed/dev-catalog.sql` (and `dev-demo-deals.sql`) refuse to run unless the operator
sets `app.allow_demo_seed = 'yes'`. Rows recorded under the `sample-data` source are flagged
`is_sample`; a production server never shows them (`src/lib/demo.ts`).

## Rollback

The exact `drop` statements for 0007–0009 are at the end of `0009_offers_read_model.sql`.
0010 is reverted by re-granting table-wide `update` on `profiles` and restoring the old
function bodies (both are in git history).

## Deliberately not here yet

Publishing user-submitted *catalogue* offers (the `held` → `live` moderation step), branch-level
UI, price-drop alerts, and retiring `deals`. The ledger and functions already support them.
