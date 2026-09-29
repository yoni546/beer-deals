# Ingestion readiness

**Verdict (2026-09-29, release 0.7.0): READY FOR STAGING — the first real ingestion ran there. NOT cleared for
production.** Of the 16 prerequisites from the product audit (§19): **10 READY, 4 PARTIAL, 2 BLOCKED**. The
production write is blocked by things outside the repository (production database access, terms, a device), listed
in `docs/FINAL-READINESS-REPORT.md`.

Legend: **READY** = true and proved (a test, or a rehearsal on staging with real data) · **PARTIAL** = built, but
something essential is missing · **BLOCKED** = needs something only the owner (or legal) can provide.

| # | Prerequisite (audit §19) | Status | Why |
| --- | --- | --- | --- |
| 1 | Staging identical to production; ingestion never targets production first | **READY** | `beer-deals-staging` (`qpjwnxptitnmtsznjvkw`, Tokyo like production) with migrations 0001–0015 (`docs/STAGING.md`). `run.mjs` refuses the production project and reads credentials only from the git-ignored staging file. |
| 2 | The §11 model migrated, with generated types and passing tests | **PARTIAL** | 0014–0015 close the seven feed/schema gaps; applied to staging; `tests/feed-model.test.ts` (22). Not applied to production (no access from here); `src/lib/db/types.ts` is hand-written. |
| 3 | Beer scope and classification | **READY** | Owner decision 2026-09-29: beer, non-alcoholic, radler in; malt, cider out (`product_categories`). Classifier + variants on real rows (`tests/ingest.test.ts`). |
| 4 | Product matching: barcode → alias → review; never guessed | **PARTIAL** | Barcode reconciliation across chains (truncated names refine, contradictions are held); `source_products` is the alias table and review queue (on staging: 140 matched, 269 in review, 462 ignored). Missing: an admin screen to work the review queue. |
| 5 | Chains and branches seeded; categories reclassified | **READY** | Branches are created from each publisher's Stores file with the feed's own codes (`branches.feed_*`); retailer decided per branch (Yeinot Bitan inside Carrefour, AM:PM inside Dor Alon). Blocked chains in §7. |
| 6 | Idempotency | **READY** | Re-running the same day wrote nothing (rehearsed on staging); per-row content hash; one run per file hash. |
| 7 | Write-path isolation | **READY** | Only `record_price(s)` / `record_promotion_group` write; the runner uses the staging service key from its own secret; clients read only views. |
| 8 | Promotion semantics mapped; unknown types held | **READY** | Published only when the description and `DiscountedPrice` agree (151/155); audience from ClubID codes and labels (only "everyone" is shown); multi-buy vs group vs price cut; validity in Israel time. Everything else is held with a reason. |
| 9 | Deposit / VAT / unit price | **READY** | Owner decision: deposit modelled apart (`conditions.deposit`, "+ ₪X פיקדון"), never part of a saving; the reference and the offer are compared with the same deposit treatment (`offers_ranked`). Prices include VAT (the skill). Assumption on record: a promotion price without "פקדון" excludes the deposit like the shelf price. |
| 10 | Sanity gates | **READY** | Database gates (0013/0009) + per-litre plausibility per pack + barcode agreement + a quality gate that fails the run (and skips notifications) when the database refuses anything. |
| 11 | Staleness | **READY** | 0009; file time as `observed_at`. |
| 12 | Dry-run diff; rollback by run id, rehearsed | **READY** | Dry run: `docs/INGESTION-DRY-RUN.md`. Real write: `docs/INGESTION-STAGING-REPORT.md`. Rollback rehearsed on staging with real data (13 rows rejected, shelf emptied, second rollback a no-op), which exposed and fixed a re-import bug (0015). |
| 13 | Automation | **PARTIAL** | `.github/workflows/ingest-staging.yml` (daily, staging only, gated), secrets set; it runs once merged to `main`. Production ingestion is deliberately not automated. |
| 14 | Terms and attribution per chain | **BLOCKED** | Owner / legal: each chain's terms for automated use of its published files, and what attribution the app must show. |
| 15 | Demo data purged; notification pipeline ready | **BLOCKED** | Production: migration 0006 not applied (no access). Pipeline: built and tested, but not proven on a real device (none connected). |
| 16 | Tests with a real file per chain | **PARTIAL** | Real excerpts for 8 publishers in `tests/fixtures/ingest/`; none for Super Yuda, Victory, Mahsanei HaShuk (no file obtainable — §7). |

## What unblocks what

| Who | Action | Unblocks |
| --- | --- | --- |
| Owner | Give this project access to the production Supabase project (or run §1 there), after the go-ahead in `docs/FINAL-READINESS-REPORT.md` | 2, 15, the production import |
| Owner / legal | Each chain's terms and attribution | 14 |
| Owner | Real-device notification checklist (`docs/NOTIFICATIONS.md` §5) | 15 |
| Owner | Super Yuda's feed account; confirm whether Victory and Mahsanei HaShuk still publish (Laibcatalog lists them but serves no files) | 16 |
| Engineering (next) | Admin screen for the review queue (`source_products` where status = 'review') | 4 |

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

## 6. Decisions (owner, 2026-09-29) and what is still open

Decided: non-alcoholic beer and radler are in, malt drinks and cider out; only promotions everyone can redeem are
shown; mix-and-match is a group offer; prices are per branch and a chain shows "החל מ־" the lowest; the deposit is
modelled apart and shown beside the price.

Open: what the app must say about the source of a price, per chain (prerequisite 14); whether a promotion price
without "פקדון" in its text includes the deposit (assumed not, like the shelf price — worth one question to a chain).

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

**Fetched 2026-09-29** (read-only, one beer-selling branch per retailer, `scripts/ingest/fetch-sample.mjs`; publishers
in `scripts/ingest/lib/publishers.mjs`):

| Our store | Publisher / route | Result |
| --- | --- | --- |
| carrefour | Carrefour Israel, direct, 7290055700007 | **SUPPORTED** — ingested to staging |
| yeinot-bitan | inside Carrefour's feed (store 080 "יינות ביתן טבעון", from its UTF-16 Stores file) | **SUPPORTED** — mapped per branch |
| shufersal | direct, 7290027600007 | **SUPPORTED** |
| rami-levy | Cerberus `RamiLevi`, 7290058140886 | **SUPPORTED** |
| yochananof | Cerberus `yohananof`, 7290803800003 | **SUPPORTED** |
| osher-ad | Cerberus `osherad`, 7290103152017 | **SUPPORTED** |
| tiv-taam | Cerberus `TivTaam`, 7290873255550 | **SUPPORTED** |
| ampm | inside Dor Alon's feed, Cerberus `doralon`, 7290492000005, sub-chain "AM:PM" | **SUPPORTED** |
| hatzi-hinam | own site `shop.hazi-hinam.co.il/Prices`, 7290700100008 | **SUPPORTED** |
| king-store | Bina Projects `kingstore.binaprojects.com`, 7290058108879 | reachable; **sells no beer** (0 of 48 branch files list any) |
| victory | Laibcatalog, 7290696200003 | **BLOCKED**: the portal lists the chain but its search returns no files (checked 20–29/09/2026) |
| mahsanei | Laibcatalog, 7290661400001 | **BLOCKED**: same |
| super-yuda | Cerberus | **BLOCKED**: the code `SuperYuda` is refused with the empty password; the account is not documented; not guessed |
| liquor-store, makolet | categories, no publisher | not applicable |

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
