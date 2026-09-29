# Ingestion readiness

**Verdict (2026-09-29, re-evaluated with the installed skill and a real dry run): NOT READY. Do not import
supermarket data.** Of the 16 prerequisites from the product audit (§19): **4 READY, 7 PARTIAL, 4 BLOCKED,
1 NOT REQUIRED yet** (automation, deliberately not started). What changed since 0.5.1: the skill
`israeli-grocery-price-intelligence` is installed and was used on **real feed files from six chains**; the
classifier, pack parser, barcode reconciliation and promotion reader now exist as a **dry run** that writes
only a report (`docs/INGESTION-DRY-RUN.md`). Nothing touches any database.

Legend: **READY** = true in the repository and proved by a test · **PARTIAL** = built, but something essential is
missing · **BLOCKED** = needs something only the owner (or legal) can provide · **NOT REQUIRED** = not needed before the
first, manual, staging-only run.

| # | Prerequisite (audit §19) | Status | Why |
| --- | --- | --- | --- |
| 1 | Staging database identical to production; ingestion never targets production first | **BLOCKED** | `docs/STAGING.md` is ready; the owner has to create the Supabase project. The dry run needs no database; the first real write does. |
| 2 | The §11 model migrated, with generated types and passing tests | **PARTIAL** | Migrations 0007–0013 pass their tests; not applied to any hosted database (owner); `src/lib/db/types.ts` is hand-written. The dry run found **7 schema gaps** (listed in `docs/INGESTION-DRY-RUN.md`): mix-and-match promotions, feed publisher → store mapping, no source-product / alias table, chain-wide vs branch price, among others. |
| 3 | Beer scope and classification rules | **PARTIAL** | **Built and tested on real rows** (`scripts/ingest/lib/normalize.mjs`, `tests/ingest.test.ts`): 573 beer rows found among 65,393; look-alikes rejected (נסטלה, גינסנג, a CORONA-branded wine, deposits, empty crates). Missing: the owner's scope decision on non-alcoholic / malt / cider / radler (51 rows held as out of scope). |
| 4 | Product matching: barcode → alias → candidate + human review; never guessed | **PARTIAL** | Barcode logic built: only valid GTINs match across chains; 69 barcodes seen at 2+ chains; readings that agree fill each other's gaps; **4 barcodes read differently at different chains, and all their rows are held**. Missing: the alias table and the review queue (schema + admin screen). |
| 5 | Chains and branches seeded; categories reclassified | **PARTIAL** | Chains seeded; branches not (they come from each chain's Stores file, which the skill covers; not yet fetched). Feed identities verified for 6 chains (§7); 8 of our 15 stores have no usable feed yet. |
| 6 | Idempotency | **READY** | `unique (source_id, content_hash)`; one run per `(source_id, file_hash)` (`tests/ingestion-safety.test.ts`). The dry run de-duplicates on the feed's own key (chain, sub-chain, store, item code): 0 duplicates in the real files. |
| 7 | Write-path isolation | **READY** (database) | Only `record_price(s)` writes prices, for admins and the service role (`tests/catalog.test.ts`). The dry run imports no Supabase client, reads no key and opens no connection (enforced by `tests/ingest.test.ts`). The writing runner does not exist yet (§5). |
| 8 | Promotion semantics mapped; unknown types held | **PARTIAL** | Checked against real files: a promotion is publishable only when its description and the item's `DiscountedPrice` (the total for `MinQty` units) **agree; 151 of 155 do**, and the gap in "פקדון" descriptions is exactly ₪0.30 per container. 91 in-force beer promotions would publish; every other one is held. Missing: decisions on mix-and-match (75 promotions span several packs) and payment-method offers ("אשראי"); the skill's parser drops `DiscountedPrice` for this layout (§8). |
| 9 | Deposit / VAT / unit-price rules decided | **PARTIAL** | Now evidenced: the skill documents prices as VAT-inclusive (18%); shelf prices exclude the deposit (a separate "פקדון" item); promotion totals include it. The owner has to decide how the app shows it. |
| 10 | Sanity gates | **READY** | Database gates (0013, 0009) plus a dry-run gate: a price per litre outside ₪8–₪70 means the pack was misread. 3 real rows caught (truncated six-pack names priced ₪33.90–₪37.90, read as singles). |
| 11 | Staleness policy | **READY** | 0009 + tests. The dry run uses the **file timestamp** as `observed_at`: the feed's `update_date` is the last price change and runs back to 2015. |
| 12 | Dry-run diff; rollback by run id, rehearsed once | **PARTIAL** | **Dry run built** (`scripts/ingest/dry-run.mjs` → `docs/INGESTION-DRY-RUN.md`) and run on real files. Rollback built and tested on synthetic data. Missing: a diff against the *current database* (needs staging) and one real rollback rehearsal. |
| 13 | Automation | **NOT REQUIRED** yet | By design: no GitHub Action and no schedule until 1–12 pass. |
| 14 | Terms and attribution per chain | **BLOCKED** | Owner / legal. The feeds are public by law; each chain's publication terms and required attribution are not confirmed. |
| 15 | Demo data purged; notification pipeline ready | **BLOCKED** | Owner: apply 0006 to production; run the real-device checklist (`docs/NOTIFICATIONS.md` §5). |
| 16 | Tests with one real file per chain | **BLOCKED** (6 of 13 feed chains done) | Six real excerpts in `tests/fixtures/ingest/` (feeds of 2026-09-29, public price data, ~276 KB) drive `tests/ingest.test.ts`. Still missing for Super Yuda, Victory, Mahsanei HaShuk, Hatzi Hinam, King Store, AM:PM and Yeinot Bitan. |

## What unblocks what

| Who | Action | Unblocks |
| --- | --- | --- |
| Owner | Create the staging Supabase project; apply migrations 0006–0013 to staging, then production | 1, 2, 12 (diff + rehearsal), 15 |
| Owner | Decide: non-alcoholic / malt / cider / radler scope; mix-and-match; chain-wide vs branch price; how the deposit is shown; payment-method offers | 3, 8, 9, schema gaps |
| Owner / legal | Each chain's publication terms and attribution | 14 |
| Owner | Real-device notification checklist | 15 |
| Engineering (next) | Alias table + review queue; feed publisher / sub-chain → store mapping; Stores files → branches; mix-and-match storage once decided; the correct Super Yuda feed code | 2, 4, 5, 8, 16 |

## 1. The first import, when the time comes

1. Staging only. `start_ingestion_run(source, sha256-of-file)` — if it answers `already_imported`, stop.
2. **Dry run**: parse → classify → match → map promotions → apply the gates in memory → write a diff
   (new SKUs, changed prices, unmatched items, held rows, rows per chain) as a CI artifact. Nothing is written.
3. A human reads the diff. Only then: `record_prices` in batches tagged with the run id; `finish_ingestion_run`.
4. Look at the app on staging; look at Admin → held rows. If anything is wrong:
   `select rollback_ingestion_run('<run id>', 'reason')` — and check the shelves are back.
5. Rehearse the rollback once on staging on purpose. Only then repeat against production, one chain at a time.

## 2. Beer scope and classification (prerequisite 3)

*In scope*: a product a shopper would call beer — lager, ale, stout, wheat, IPA, radler/shandy **only** if
labelled beer-based (decide with the owner: default **exclude** radler and cider), malt beer.
*Out of scope by default*: non-alcoholic beer and "0.0" (a separate product family; **owner decision**),
cider, hard seltzer, spirits, gift packs and multi-brand mixed packs, glasses and accessories.
Anything ambiguous goes to `needs_review`, never into a SKU.

Parsing a shelf item into a SKU, in order of trust:
1. Barcode (GTIN) in `sku_barcodes` → that SKU.
2. Otherwise from the item name and unit fields: **container** (פחית = can, בקבוק = bottle, חבית/קג = keg),
   **volume** (`330 מ״ל`, `0.5 ל׳`, `500ml`, `נפח` fields), **pack quantity** (`6X330`, `שישיה`, `24 יח׳`,
   `מארז`, `UnitQty` / `Quantity` fields). If any of the three cannot be read with confidence → `needs_review`.
3. A pack size is never inferred from the price. 6×330 and 6×500 are different SKUs.
4. Internal item codes are not GTINs: a code that is not 8/12/13/14 digits with a valid check digit is treated as a
   chain-internal code and never matched across chains.

## 3. Matching policy (prerequisite 4)

Barcode first; then an alias table (chain + item name → SKU, created only by a human); then fuzzy candidates
(normalised Hebrew/English name, volume and pack must agree exactly) shown to a reviewer with a confidence score.
Below the threshold, or with more than one candidate, an item is **unmatched** and is counted in the run's report.
It is never guessed into a SKU, and never dropped silently.

## 4. Promotion mapping (prerequisite 8) — checked against real files, 2026-09-29

| Feed idea | Stored as |
| --- | --- |
| Plain reduced price for the item | `promo_type = price_cut`, `price_agorot` |
| "N for ₪X" (minimum quantity with a total) | `multi_buy`, `conditions.multi_buy = {qty, total_agorot}`; the per-pack price is derived, never trusted |
| Club members only | `club_price`, `conditions.club` |
| Needs a coupon | `coupon`, `conditions.coupon = true` |
| Minimum / maximum quantity | `conditions.min_qty` / `max_qty` |
| Start / end date and time | `valid_from` / `valid_to` (Israel local time → UTC) |
| Applies to some branches only | one observation per branch (`branch_id`) |
| Anything else (gift, "buy X get Y") | `other` **and held** (`status = 'held'`) for review |

## 5. The runner's secret (prerequisite 7)

The runner uses the service-role key, kept only as a secret of the CI job that runs it — never in Vercel's
public environment, never in a file, never in a client bundle. It can call only what the migrations grant the
service role (`record_price(s)`, `start/finish/rollback_ingestion_run`, reads); everything else is closed to it too.

## 6. Open decisions (owner)

* Include non-alcoholic beer? radler? (§2)
* Does each chain's published shelf price include the bottle deposit? VAT? (prerequisite 9)
* Which chains first? (Suggest one chain, one week, staging only.)
* What must the app say about the source of a price, per chain? (prerequisite 14)

## 7. The installed skill and what the real feeds look like

**Skill**: `israeli-grocery-price-intelligence` **v1.6.0** (2026-08-27) from `skills-il/food-and-dining`, installed at project
scope in `.claude/skills/israeli-grocery-price-intelligence/` (hash in `skills-lock.json`) and discoverable by Claude Code (valid
`SKILL.md` front matter; listed among the available skills). Contents: `SKILL.md` (+ Hebrew), `references/chain-feeds.md`,
`references/domain-checklist.md`, `scripts/parse_price_xml.py`, `evidence.json`, `CHANGELOG.md`.
**Dependencies**: Python 3 standard library only (checked with 3.12 and 3.14). **Credentials**: none; Cerberus chains log in with
the chain code and an empty password. **Allowed tools**: python, curl, grep, sed, WebFetch.

**Source types** it documents: Shufersal (direct, signed expiring URLs), Carrefour (direct, inline file list), Cerberus
(`url.publishedprices.co.il`: Rami Levy, Yochananof, Osher Ad, Tiv Taam, Dor Alon, Keshet, Freshmarket, Super Cofix…), Super-Pharm,
Bina Projects (King Store, Good Pharm…), Hatzi Hinam (own site), Laibcatalog (Victory, Mahsanei HaShuk; marked unconfirmed). File
kinds: Stores, Price / PriceFull, Promo / PromoFull; two file-name shapes; one file per store; gzip.

**Assumptions and limitations it states**: RewardType codes are unsourced conventions; club ids differ by layout; prices include
18% VAT; 729-prefix barcodes are Israeli GTINs and store-brand items use internal codes; deltas (Price / Promo) must be reconciled
against the last full file; `UnitOfMeasure` is unreliable; it recommends an MCP server (`supermarket-prices`) that is not
installed and not needed here.

**Fetched 2026-09-29** (read-only, one store per chain, `scripts/ingest/fetch-sample.mjs`):

| Our store | Feed | Result |
| --- | --- | --- |
| carrefour | direct, chain id 7290055700007 | OK |
| shufersal | direct, 7290027600007 | OK |
| rami-levy | Cerberus `RamiLevi`, 7290058140886 | OK |
| yochananof | Cerberus `yohananof`, 7290803800003 | OK |
| osher-ad | Cerberus `osherad`, 7290103152017 | OK |
| tiv-taam | Cerberus `TivTaam`, 7290873255550 | OK |
| super-yuda | Cerberus; the code `SuperYuda` is refused | **not fetched**: the correct code is unknown and was not guessed |
| yeinot-bitan | a banner inside Carrefour's feed | needs the publisher → store mapping |
| victory, mahsanei | Laibcatalog (unconfirmed in the skill) | not attempted |
| hatzi-hinam, king-store | own site / Bina Projects | not attempted |
| ampm | not in the skill | unknown |
| liquor-store, makolet | categories, no feed | not applicable |

**Field compatibility** (skill output → our model):

| Field | In the feed / skill output | Our model | Status |
| --- | --- | --- | --- |
| Retailer / chain | `chain_id` (GS1 GLN) | `stores` (slug) | mapping needed (publisher ≠ banner) |
| Branch / store | `store_id`, `sub_chain_id` | `branches.external_ref` | fits; branches not seeded |
| Source product id | `item_code` | `raw` only | fits in `raw`; alias table missing |
| Barcode | `item_code` when a valid GTIN | `sku_barcodes` | fits; internal codes stay per chain |
| Raw title | `item_name` (cut at ~20 characters at 4 chains) | `raw` | fits |
| Brand | `manufacturer` (often "לא ידוע") | `beers` / `brands` | read from the name, not the field |
| Variant | in the name only | `beers.variant` | not read yet |
| Container | in the name only (ח"פ is one-way, not a can) | `skus.container` | read; filled across chains by barcode |
| Volume, pack quantity | name + `quantity` (the total; the skill drops its unit) | `skus.volume_ml`, `pack_quantity` | read; each checked against the other |
| Regular price | `price` | regular `price_observations` | fits (agorot) |
| Promotion price | description + `DiscountedPrice` (dropped by the skill) | promotion row | fits with the supplement (§8) |
| Multi-buy | `MinQty` + total | `multi_buy`, `conditions.multi_buy` | fits |
| Member / club-only | `club_only` | `club_price`, `conditions.club` | fits |
| Promotion dates | `start` / `end`, Israel local time | `valid_from` / `valid_to` | fits (converted, summer time included) |
| Source timestamp | file-name stamp | `observed_at` | fits (not `update_date`) |
| Store-specific prices | one file per store | `branch_id` | fits |
| Chain-wide prices | none | what the app shows | **decision needed** |
| Stale records | full vs delta files | 0009 staleness | fits; delta reconciliation not built |
| Duplicate source rows | (chain, sub-chain, store, code) | `content_hash`, run file hash | fits; none seen |

## 8. The one gap in the skill

`parse_price_xml.py` emits `discounted_price` only for the Cerberus-style layout. All six chains fetched use the
Shufersal-style layout (`<ChainID>` root), and all six **do** publish `<DiscountedPrice>` per promotion item. Rather than replace
the skill's parser, `scripts/ingest/lib/promo-supplement.mjs` reads that one field from the same file and merges it in under the
skill's own name. Report it upstream and remove the supplement once the skill emits the field. The same goes for `UnitQty` (the
unit of `Quantity`), which the dry run works around by magnitude.

## 9. Running the dry run

```bash
node scripts/ingest/fetch-sample.mjs
```

Then, for each downloaded `.gz` in `.ingest-cache/<day>/<chain>/`:

```bash
python .claude/skills/israeli-grocery-price-intelligence/scripts/parse_price_xml.py --chain <chain> --input <file.gz> --output <file>.json
```

```bash
node scripts/ingest/dry-run.mjs
```

It writes `docs/INGESTION-DRY-RUN.md` and `.ingest-cache/<day>/dry-run.json`, nothing else. `scripts/ingest/make-fixtures.mjs`
refreshes the test excerpts.
