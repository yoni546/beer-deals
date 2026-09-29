# Ingestion dry run

**2026-09-29, from the feed files fetched on 2026-09-29.** DRY RUN: nothing was written to any database.
Produced by `node scripts/ingest/dry-run.mjs` from files parsed by the installed skill's `parse_price_xml.py` (v1.6.0), plus
`lib/promo-supplement.mjs` for the one field it drops. One branch per retailer; the raw files stay in the git-ignored `.ingest-cache/`.

## Summary

| | |
| --- | ---: |
| Publishers fetched · blocked | 8 · 4 |
| Retailers (chains) covered | 9 |
| Branches covered | 9 |
| Raw shelf rows | 87,033 |
| Beer candidates (beer, non-alcoholic, radler) | 826 |
| … of our beers | 438 |
| … beers the app does not carry | 388 |
| Out of scope (malt drinks, cider) | 87 |
| Canonical SKUs | 62 |
| Resolved products (feed items matched to a SKU) | 140 |
| Unresolved products (review queue) | 272 |
| Regular-price observations | 153 |
| Active universal promotions (single pack) | 16 |
| Mix-and-match (group) promotions published | 2 |
| Restricted promotions filtered (club, card, coupon, employees…) | 61 |
| Promotions held for review (everyone could use them, but a statement was missing or disagreed) | 170 |
| Invalid prices | 6 |
| Duplicate source rows | 0 |
| Barcodes seen at 2+ chains · read differently (held) | 78 · 5 |

## Chains and branches

| Retailer | Publisher (feed chain id) | Branch | Observed (file time, UTC) | Rows | Beer | Ours | Promotions touching beer | Published | Groups | Restricted | Held |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| carrefour | carrefour (7290055700007) | 2 קרפור מרקט אשקלון חאן | 2026-09-29 02:10 | 6148 | 56 | 37 | 11 | 0 | 0 | 0 | 10 |
| yeinot-bitan | carrefour (7290055700007) | 80 יינות ביתן טבעון | 2026-09-29 02:10 | 6823 | 53 | 38 | 14 | 0 | 0 | 0 | 13 |
| ampm | dor-alon (7290492000005) | 401 AM-PMדרך השלום | 2026-09-28 21:05 | 5049 | 104 | 68 | 33 | 2 | 0 | 0 | 31 |
| hatzi-hinam | hatzi-hinam (7290700100008) | 103  | 2026-09-29 13:51 | 9768 | 69 | 35 | 13 | 0 | 1 | 0 | 12 |
| osher-ad | osher-ad (7290103152017) | 3 גבעת שאול | 2026-09-29 11:05 | 7064 | 42 | 32 | 16 | 2 | 0 | 0 | 14 |
| rami-levy | rami-levy (7290058140886) | 2 בזק מחסני מזון | 2026-09-29 09:15 | 11797 | 85 | 50 | 35 | 1 | 0 | 0 | 32 |
| shufersal | shufersal (7290027600007) | 2 שלי ירושלים- אגרון | 2026-09-29 01:31 | 7577 | 69 | 47 | 24 | 6 | 0 | 0 | 18 |
| tiv-taam | tiv-taam (7290873255550) | 2 נתניה | 2026-09-28 21:40 | 21566 | 285 | 84 | 87 | 5 | 1 | 61 | 76 |
| yochananof | yochananof (7290803800003) | 4 בילו | 2026-09-28 21:40 | 11241 | 63 | 47 | 24 | 0 | 0 | 0 | 24 |
| victory | — | — | **FAILED**: laibcatalog.co.il lists chain 7290696200003 but returned no files for it today | | | | | | | | |
| mahsanei | — | — | **FAILED**: laibcatalog.co.il lists chain 7290661400001 but returned no files for it today | | | | | | | | |
| super-yuda | — | — | **BLOCKED**: Super Yuda publishes on Cerberus, but the chain code 'SuperYuda' is refused with the empty password every other chain uses, and the skill does not document its account. Not guessed. | | | | | | | | |
| king-store | — | — | **FAILED**: listed 79 files but none for a branch of ours | | | | | | | | |

## Canonical SKUs

| Beer | Variant | Category | Container | ml | Pack | Retailers | Regular prices seen |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| goldstar | — | beer | bottle | 500 | 1 | ampm, carrefour, osher-ad, rami-levy, shufersal, tiv-taam, yeinot-bitan, yochananof | ₪7.50–₪10.00 |
| goldstar | — | beer | can | 500 | 1 | ampm, carrefour, osher-ad, rami-levy, shufersal, tiv-taam, yeinot-bitan, yochananof | ₪7.90–₪10.90 |
| heineken | — | beer | bottle | 500 | 1 | ampm, carrefour, osher-ad, rami-levy, shufersal, tiv-taam, yeinot-bitan, yochananof | ₪8.90–₪11.00 |
| carlsberg | — | beer | can | 500 | 1 | ampm, carrefour, rami-levy, shufersal, tiv-taam, yeinot-bitan, yochananof | ₪8.90–₪13.50 |
| carlsberg | — | beer | bottle | 500 | 1 | ampm, carrefour, osher-ad, shufersal, yeinot-bitan, yochananof | ₪7.90–₪13.90 |
| heineken | — | beer | can | 500 | 1 | ampm, carrefour, osher-ad, shufersal, tiv-taam, yeinot-bitan | ₪11.90–₪14.90 |
| tuborg-red | — | beer | bottle | 500 | 1 | ampm, carrefour, osher-ad, shufersal, yeinot-bitan, yochananof | ₪7.80–₪13.90 |
| goldstar | — | beer | bottle | 250 | 4 | ampm, carrefour, hatzi-hinam, tiv-taam, yeinot-bitan | ₪24.90–₪28.90 |
| goldstar | — | beer | bottle | 330 | 1 | ampm, carrefour, rami-levy, tiv-taam, yeinot-bitan | ₪6.90–₪9.90 |
| corona | — | beer | can | 500 | 1 | ampm, osher-ad, rami-levy, tiv-taam | ₪11.90–₪16.90 |
| goldstar | לא מסונן | beer | bottle | 250 | 4 | carrefour, hatzi-hinam, tiv-taam, yeinot-bitan | ₪24.90–₪27.90 |
| goldstar | לא מסונן | beer | can | 500 | 1 | carrefour, shufersal, tiv-taam, yeinot-bitan | ₪10.90–₪11.90 |
| stella | — | beer | can | 440 | 1 | ampm, carrefour, yeinot-bitan, yochananof | ₪9.90–₪16.90 |
| carlsberg | — | beer | bottle | 330 | 1 | ampm, rami-levy, tiv-taam | ₪7.80–₪11.90 |
| goldstar | סלואו ברו | beer | can | 500 | 1 | rami-levy, shufersal, tiv-taam | ₪8.90–₪11.90 |
| guinness | — | beer | can | 440 | 1 | ampm, shufersal, tiv-taam | ₪18.90–₪19.90 |
| heineken | — | beer | bottle | 330 | 1 | ampm, rami-levy, yeinot-bitan | ₪8.90–₪10.90 |
| leffe | — | beer | can | 500 | 1 | osher-ad, rami-levy, yochananof | ₪11.90–₪12.90 |
| maccabee | — | beer | bottle | 500 | 1 | rami-levy, shufersal, yeinot-bitan | ₪6.90–₪9.30 |
| malka | בהירה | beer | bottle | 330 | 1 | ampm, rami-levy, yochananof | ₪13.90–₪16.90 |
| paulaner | חיטה | beer | bottle | 500 | 1 | ampm, yeinot-bitan, yochananof | ₪11.90–₪15.90 |
| weihen | — | beer | bottle | 500 | 1 | ampm, carrefour, shufersal | ₪15.90–₪16.90 |
| becks | — | beer | can | 500 | 1 | ampm, tiv-taam | ₪10.90–₪12.90 |
| carlsberg | — | beer | bottle | 330 | 6 | shufersal, tiv-taam | ₪39.90–₪45.90 |
| goldstar | — | beer | bottle | 330 | 6 | shufersal, tiv-taam | ₪36.90–₪43.90 |
| heineken | — | beer | bottle | 250 | 4 | hatzi-hinam, tiv-taam | ₪23.90–₪24.90 |
| heineken | — | beer | bottle | 330 | 6 | shufersal, tiv-taam | ₪39.90–₪47.90 |
| heineken | — | beer | can | 330 | 6 | shufersal, tiv-taam | ₪39.90–₪46.00 |
| malka | חיטה | beer | can | 330 | 1 | ampm, tiv-taam | ₪15.90–₪16.90 |
| paulaner | מינכן הל | beer | can | 500 | 1 | tiv-taam, yeinot-bitan | ₪11.90–₪15.90 |
| tuborg-red | — | beer | bottle | 330 | 6 | shufersal, tiv-taam | ₪39.90–₪45.90 |
| tuborg | — | beer | bottle | 330 | 1 | rami-levy, tiv-taam | ₪7.90–₪9.90 |
| tuborg | — | beer | bottle | 500 | 1 | shufersal, yochananof | ₪7.90–₪10.00 |
| becks | — | beer | bottle | 275 | 1 | ampm | ₪8.90–₪8.90 |
| budweiser | — | beer | bottle | 330 | 1 | ampm | ₪9.50–₪9.50 |
| budweiser | — | beer | can | 500 | 1 | shufersal | ₪11.90–₪11.90 |
| carlsberg | 0.0 | non_alcoholic | bottle | 330 | 6 | tiv-taam | ₪32.90–₪32.90 |
| carlsberg | לומה | beer | bottle | 330 | 6 | tiv-taam | ₪39.90–₪39.90 |
| corona | — | beer | bottle | 355 | 6 | yochananof | ₪39.90–₪39.90 |
| goldstar | לא מסונן | beer | bottle | 500 | 1 | ampm | ₪10.40–₪10.40 |
| guinness | — | beer | bottle | 330 | 1 | tiv-taam | ₪17.50–₪17.50 |
| heineken | 0.0 | non_alcoholic | bottle | 330 | 1 | carrefour | ₪6.30–₪6.30 |
| leffe | — | beer | bottle | 330 | 1 | tiv-taam | ₪8.90–₪8.90 |
| leffe | — | beer | bottle | 330 | 6 | tiv-taam | ₪47.90–₪47.90 |
| leffe | בראון | beer | bottle | 330 | 1 | tiv-taam | ₪8.90–₪8.90 |
| leffe | בראון | beer | bottle | 330 | 6 | tiv-taam | ₪47.90–₪47.90 |
| maccabee | — | beer | bottle | 330 | 1 | tiv-taam | ₪6.50–₪6.50 |
| maccabee | — | beer | can | 500 | 1 | osher-ad | ₪7.90–₪7.90 |
| maccabee | שנדי אפרסק | radler | bottle | 330 | 1 | carrefour | ₪6.90–₪6.90 |
| maccabee | שנדי | radler | bottle | 330 | 1 | carrefour | ₪6.90–₪6.90 |
| malka | אדמונית | beer | bottle | 330 | 1 | ampm | ₪16.90–₪16.90 |
| malka | אדמונית | beer | can | 330 | 1 | tiv-taam | ₪15.90–₪15.90 |
| malka | בהירה | beer | can | 330 | 1 | ampm | ₪16.90–₪16.90 |
| malka | הינדי | beer | can | 330 | 1 | tiv-taam | ₪15.90–₪15.90 |
| malka | חיטה | beer | bottle | 330 | 1 | ampm | ₪16.90–₪16.90 |
| paulaner | — | beer | bottle | 330 | 4 | tiv-taam | ₪45.90–₪45.90 |
| paulaner | מינכן הל | beer | bottle | 500 | 1 | tiv-taam | ₪14.90–₪14.90 |
| shapiro | סטאוט | beer | bottle | 330 | 1 | yeinot-bitan | ₪17.90–₪17.90 |
| stella | — | beer | bottle | 330 | 1 | ampm | ₪10.90–₪10.90 |
| stella | — | beer | bottle | 330 | 6 | tiv-taam | ₪37.90–₪37.90 |
| tuborg | — | beer | bottle | 330 | 6 | tiv-taam | ₪39.90–₪39.90 |
| weihen | ויטוס | beer | bottle | 500 | 1 | carrefour | ₪15.90–₪15.90 |

## Promotions

| Retailer | Promotion | Read as | Basis | Audience | Outcome |
| --- | --- | --- | --- | --- | --- |
| ampm | מבצע בירה הייניקן בקבוק חוזר 2 ב 17.90שח | 2 for ₪17.90 | description + DiscountedPrice | everyone | published |
| ampm | מבצע גולדסטאר לא מסונן ב.חוזר 2 ב 17.9שח | 2 for ₪17.90 | description + DiscountedPrice | everyone | published |
| hatzi-hinam | בירה היינקן/גולדסטאר רביעיות 2ב-35ש"ח | 2 for ₪35.00 | description + DiscountedPrice | everyone | published as a group |
| osher-ad | בירה פחית קורונה 2 ב 16 | 2 for ₪16.00 | description + DiscountedPrice | everyone | published |
| osher-ad | בירה 500 מ ל היינקן 2 ב 17 | 2 for ₪17.00 | description + DiscountedPrice | everyone | published |
| rami-levy | בירה לאגר קרלסברג בק330מל ב6.90 | ₪6.90 | description + DiscountedPrice | everyone | published |
| shufersal | 3ב24.10 פקדון בירה קרלסברג בפחית500מ"ל | 3 for ₪24.10 | description + DiscountedPrice | everyone | published |
| shufersal | 2ב34.40 פקדון בירה גינס פחית 440 מ"ל | 2 for ₪34.40 | description + DiscountedPrice | everyone | published |
| shufersal | 2ב71.40 פקדון בירה הייניקן פח 330*6מ"ל | 2 for ₪71.40 | description + DiscountedPrice | everyone | published |
| shufersal | 2ב61.40 פקדון בירה טובורג רד/גרין 330*6 | 2 for ₪61.40 | description + DiscountedPrice | everyone | published |
| shufersal | 38.10 פקדון גולדסטאר לא מסוננת/מכבי/היינ | ₪38.10 | description + DiscountedPrice | everyone | published |
| shufersal | 2ב66.40 פקדון בירה קרלסברג בק330*6 מ"ל | 2 for ₪66.40 | description + DiscountedPrice | everyone | published |
| tiv-taam | בירה 2 ב 18 | 2 for ₪18.00 | description + DiscountedPrice | everyone | published |
| tiv-taam | בירה 36.9 | ₪36.90 | description + DiscountedPrice | everyone | published |
| tiv-taam | בירה 35.9 | ₪35.90 | description + DiscountedPrice | everyone | published |
| tiv-taam | בירה 39.9 | ₪39.90 | description + DiscountedPrice | everyone | published |
| tiv-taam | בירה 2 ב 18 | 2 for ₪18.00 | description + DiscountedPrice | everyone | published as a group |
| tiv-taam | היינקן 19.9 | ₪19.90 | description + DiscountedPrice | everyone | published |
| carrefour | קופון פיצוי לקוח גולדסטאר 330 מל שישייה | excluded | — | coupon | excluded |
| carrefour | קופון פיצוי לקוח היינקן 330 מל שישייה | excluded | — | coupon | excluded |
| yeinot-bitan | קופון פיצוי לקוח גולדסטאר 330 מל שישייה | excluded | — | coupon | excluded |
| yeinot-bitan | קופון פיצוי לקוח היינקן 330 מל שישייה | excluded | — | coupon | excluded |
| rami-levy | קופון גולדסטאר 330מל שישייה בק במתנה | excluded | — | coupon | excluded |
| rami-levy | קופון הייניקן 330מל בק/ שישייה במתנה | excluded | — | coupon | excluded |
| tiv-taam | קופון מנוהל חדש 50 מעל 249 | excluded | — | coupon | excluded |
| tiv-taam | בירה גרלסבורג 2 ב 15 מועדון | 2 for ₪15.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 12.9 ש"ח מועדון | 2 for ₪12.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה סיארה נאבדה 2 ב 25 מועדון | 2 for ₪25.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 24.9 מועדון | 2 for ₪24.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 3 ב 25.9 מועדון | unmapped | — | club | held: description says 3 for ₪25.90, DiscountedPrice says 3 for ₪25.00 |
| tiv-taam | בירה 2 ב 17.9 מועדון | 2 for ₪17.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 20 מועדון | 2 for ₪20.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 20 מועדון | 2 for ₪20.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 22.9 מועדון | 2 for ₪22.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 3 ב 35.9 מועדון | 3 for ₪35.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 25.9 מועדון | 2 for ₪25.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 28.9 מועדון | 2 for ₪28.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 33.9 מועדון | 2 for ₪33.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 35.9 מועדון | ₪35.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 13.9 מועדון | 2 for ₪13.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 17.9 מועדון | 2 for ₪17.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 25.9 מועדון | 2 for ₪25.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | קופון מנוהל 50 מעל 249 טווח 91763 | excluded | — | coupon | excluded |
| tiv-taam | בירה 2 ב 19.9 מועדון | 2 for ₪19.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 15 מועדון | unmapped | — | club | held: description says 2 for ₪15.00, DiscountedPrice says 2 for ₪14.90 |
| tiv-taam | בירה 16.9 - מועדון | ₪16.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 16.9 - מועדון | 2 for ₪16.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 34.9 - מועדון | unmapped | — | club | held: description says ₪34.90, DiscountedPrice says ₪36.40 |
| tiv-taam | בירה 2 ב 12 - מועדון | 2 for ₪12.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 21.9 מועדון | 2 for ₪21.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 24.9 מועדון | ₪24.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 25 מועדון | 2 for ₪25.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 15.9 - מועדון | 2 for ₪15.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 22 מועדון | 2 for ₪22.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 4 ב 25.9 - מועדון | 4 for ₪25.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 19.90 - מועדון | 2 for ₪19.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 22 - מועדון | 2 for ₪22.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 25.9 - מועדון | 2 for ₪25.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 15.90 - מועדון | ₪15.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 39.90 - מועדון | ₪39.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 3 ב 19.9 מועדון | 3 for ₪19.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 21 מועדון | 2 for ₪21.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 20 מועדון | 2 for ₪20.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 18 מועדון | 2 for ₪18.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 29.9 מועדון | ₪29.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 50 מועדון | 2 for ₪50.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 20 - מועדון | 2 for ₪20.00 | description + DiscountedPrice | club | held: club members only; 2 of its items are packs we could not read |
| tiv-taam | בירה 35.9 - מועדון | ₪35.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 32.9 - מועדון | ₪32.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 32.9 - מועדון | ₪32.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 25 - מועדון | 2 for ₪25.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 22 - מועדון | 2 for ₪22.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 24 - מועדון | 2 for ₪24.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 24 - מועדון | 2 for ₪24.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 42.9 - מועדון | ₪42.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 22.9 - מועדון | 2 for ₪22.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 22.9 - מועדון | 2 for ₪22.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 26.9 - מועדון | 2 for ₪26.90 | description + DiscountedPrice | club | held: club members only; 4 of its items are packs we could not read |
| tiv-taam | בירה 2 ב 30 - מועדון | 2 for ₪30.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 3 ב 18.9 - מועדון | 3 for ₪18.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 14.9 - מועדון | 2 for ₪14.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | רביעיית בירה ב 25.90 - מועדון | ₪25.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה ב 9.90 - מועדון | ₪9.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 16.90 - מועדון | 2 for ₪16.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 16.9 מועדון | 2 for ₪16.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | שישיית בירה 39.9 מועדון | ₪39.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 11.9 מועדון | ₪11.90 | description + DiscountedPrice | club | held: club members only |
| carrefour | בירה מכבי 330 בקבוק שישייה | 2 for ₪65.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| carrefour | גולדסטאר ח פ בקבוק 6*330 מ ל | ₪24.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| carrefour | בירה לאגר שישיה 330 מ ל | ₪35.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| carrefour | בירה סטלה ארטואה שישיה 330 מ ל/קורונה אק | 2 for ₪66.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| carrefour | בירה הייניקן בקבוק ח פ 6*330מ ל | ₪35.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| carrefour | בירה היינקן/גולדסטאר רביעייה 250 מ ל | ₪18.90 | DiscountedPrice only | everyone | held: one price across several packs without a quantity |
| carrefour | בירה קרפור סנשיין/בירה אדומה 330 מ ל | 3 for ₪20.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| carrefour | בירה 6*250 מ לWalbergem | ₪19.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| carrefour | בירה 6*250 מ לBRAUSAER | 2 for ₪30.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yeinot-bitan | בירה מכבי 330 בקבוק שישייה | 2 for ₪67.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yeinot-bitan | בירה סטלה ארטואה שישיה 330 מ ל/קורונה אק | ₪36.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yeinot-bitan | שפירא פייל אייל 330 בקבוק | 2 for ₪27.00 | DiscountedPrice only | everyone | held: the description states no price to confirm it; 1 of its items are packs we could not read |
| yeinot-bitan | גולדסטאר לא מסונן // rostBlackBatchWild | ₪32.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yeinot-bitan | בירה קרפור סנשיין/בירה אדומה 330 מ ל | 3 for ₪20.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yeinot-bitan | בירה פאולנר מינכן הל פחית 500 מ ל | 2 for ₪24.00 | DiscountedPrice only | everyone | held: the description states no price to confirm it |
| yeinot-bitan | בירה 6*250 מ לWalbergem | ₪19.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yeinot-bitan | בירה 6*250 מ לBRAUSAER | 2 for ₪30.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yeinot-bitan | בירה הייניקן בקבוק ח פ 6*330מ ל | ₪36.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yeinot-bitan | שישיית בירה טובורג/קרלסברג 330 מ ל | 2 for ₪75.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yeinot-bitan | בירה היינקן/גולדסטאר רביעייה 250 מ ל | ₪20.00 | DiscountedPrice only | everyone | held: one price across several packs without a quantity |
| yeinot-bitan | גולדסטאר ח פ בקבוק 6*330 מ ל | ₪27.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| ampm | מבצע בירה אלכסנדר/גמס 2 יח ב 27.90 שח | 2 for ₪27.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע 1/6 בירה קורונה/סטלה ב 42.90 שח | ₪42.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע 1/6 בירה לף בלונד/הוגרדן ב 45.90 שח | ₪45.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע בירה קורונה/סטלה בקבוק 2 ב 18.90 שח | 2 for ₪18.90 | description + DiscountedPrice | everyone | held: 2 of its items are packs we could not read |
| ampm | מבצע שישיית בירה קרומבאכר ב 39.90 שח | ₪39.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע מגוון מבירות 440-500 בפחית 3ב32שח | 3 for ₪32.00 | description + DiscountedPrice | everyone | held: 4 of its items are packs we could not read |
| ampm | מבצע בירה טובורג/קרלסברג פחית 2ב 19.90שח | 2 for ₪19.90 | description + DiscountedPrice | everyone | held: 2 of its items are packs we could not read |
| ampm | מבצע 1/6 בירה אסטרייה דאם ב 49.90 שח | ₪49.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע בירה קרלסברג/טובורג 330מל 2ב 18.90 | 2 for ₪18.90 | description + DiscountedPrice | everyone | held: 1 of its items are packs we could not read |
| ampm | מבצע 1/6 בירה קרלסברג ב 42.90 שחLUMA | ₪42.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע בירה שקמה 330 מ ל 2 יח ב 26.90 שח | 2 for ₪26.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע 1/6 בירה באדוויזר ב 34.90 שח | ₪34.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע 1/6 בירה בקס ב 29.90 שח | ₪29.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע בירה בלומון 5.4% כוהל 2ב26שח | 2 for ₪26.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע בירה באדוויזר/בקס פחית 2 ב 20 שח | 2 for ₪20.00 | description + DiscountedPrice | everyone | held: 1 of its items are packs we could not read |
| ampm | מבצע בירה פרנסיסקאנר 500 מ ל 26.902 שח | 2 for ₪26.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| ampm | מבצע בירה בלו מון 330 מ ל 2 ב 22.90 שח | 2 for ₪22.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע בירה לה שוף/מק שוף 2 ב 22.90 שח | 2 for ₪22.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע מכבי/גולדסטאר ב.חוזר 3 ב 22 שח | 3 for ₪22.00 | description + DiscountedPrice | everyone | held: 2 of its items are packs we could not read |
| ampm | מבצע גולדסטאר לא מסונן 330 מל 3 ב 25 שח | 3 for ₪25.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע 1/4 בירה פאולנר בקבוק ב 39.90 שח | ₪39.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע 1/6 בירה גולדסטאר/ ב 44.90 שחSLOW | ₪44.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע 1/6 בירה מכבי/גולדסטאר ב 36.90 שח | ₪36.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע בירה הייניקן שישייה ב 45 שח | ₪45.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע בירה גולדסטאר/מכבי פחית 2 ב 20 שח | 2 for ₪20.00 | description + DiscountedPrice | everyone | held: 3 of its items are packs we could not read |
| ampm | מבצע 1/4 גולדסטאר/הייניקן 2250ב45שח | unmapped | — | everyone | held: description says 50 for ₪45.00, DiscountedPrice says 2 for ₪45.00 |
| ampm | מבצע 1/6בירה קרלסברג/טובורג ב 42.90שח | ₪42.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע בירה מלכה330 מ ל 2 ב 28 שח | 2 for ₪28.00 | description + DiscountedPrice | everyone | held: 1 of its items are packs we could not read |
| ampm | מבצע בירה סאן מיגל אספסיאל 2 ב 16 שח | 2 for ₪16.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע בירה סאן מיגל אספסיאל 500מל 2 ב17.9 | 2 for ₪17.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע 1/4 בירה סאן מיגל אספסיאל ב 24.90שח | ₪24.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | בירה שקמה 2 יח ב-18 ש"ח | 2 for ₪18.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | פחית בירה קרלסברג 2 יח ב-17 ש"ח | 2 for ₪17.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | בירה פאולנר 2 יח ב-22 ש"ח | 2 for ₪22.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | מגוון בירות אלכסדר/ג'מס 2 ב 23 ש"ח | 2 for ₪23.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | בירות הכרם מלכה/נגב/הרצל/אלון 2 ב 26 ש"ח | 2 for ₪26.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | בירה צ'רי שוף 2 ב 20 ש"ח | 2 for ₪20.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | בירה דובל/לה שוף/מק שוף 2 ב 24 ש"ח | 2 for ₪24.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | מגוון בירות הכרם 2 ב 24 ש"ח | 2 for ₪24.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | בירה ליפמנס און דה רוקס 2 ב 18 ש"ח | 2 for ₪18.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | פחית בירה פילזנר 500 מ"ל 3ב19.90 | 3 for ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | פחית בירה צ'סו 568מ"ל 2ב 16.90 | 2 for ₪16.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | מגוון בירות וולפאס 2 ב 19.90 ש"ח | 2 for ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| osher-ad | שישיית בירה סטלה 24.9 מוג 2 | ₪24.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| osher-ad | שישיית בירה גולדסטאר / מכבי 2 ב 55 | 2 for ₪55.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| osher-ad | שישיית בירה טובורג 29.9 מוג 3 | ₪29.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| osher-ad | בירה פחית הוגרדן 2 ב 18 | 2 for ₪18.00 | description + DiscountedPrice | everyone | held: 1 of its items are packs we could not read |
| osher-ad | שישיית בירה קורונה 2 ב 65 | 2 for ₪65.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| osher-ad | בירה מכבי/גולדסטאר 3 ב 20 | 3 for ₪20.00 | description + DiscountedPrice | everyone | held: 1 of its items are packs we could not read |
| osher-ad | בירה מולר 500 מ ל 3 ב 10- | 3 for ₪10.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| osher-ad | בירה קורונה 355 מ ל 2 ב 13 | 2 for ₪13.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| osher-ad | בירה סטלה פחית 2 ב 16- | 2 for ₪16.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| osher-ad | בירה ויינשטפן 2 ב 20 | 2 for ₪20.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| osher-ad | בירה קרומבאכר פחית 2 ב 16 | 2 for ₪16.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| osher-ad | בירה מכבי/גולדסטאר 3 ב 20 | 3 for ₪20.00 | description + DiscountedPrice | everyone | held: 1 of its items are packs we could not read |
| osher-ad | בירה פחית הוגרדן 2 ב 18 | 2 for ₪18.00 | description + DiscountedPrice | everyone | held: 1 of its items are packs we could not read |
| osher-ad | שישיית בירה קורונה 2 ב 65 | 2 for ₪65.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה פילזנר פחית 500 מ ל 2ב13כולל | 2 for ₪13.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה אנגלמן 500-568 מ ל 2ב19 כולל | 2 for ₪19.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה 500 מ ל איגל3ב15.90 כולל | 3 for ₪15.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה קורונה בודד 2ב12.90 כולל | 2 for ₪12.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה ואן פור 500 מ ל 3ב11 כולל | 3 for ₪11.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה מולר 500 מ ל 3ב10 כולל | 3 for ₪10.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | פחית בירה צסו 568 מ ל 2ב16.90 כולל | 2 for ₪16.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה קורונה שישייה 2ב65 כולל | 2 for ₪65.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | פחית בירה 500 מ ל קרלסברג/היינ 3ב25 כולל | 3 for ₪25.00 | description + DiscountedPrice | everyone | held: 1 of its items are packs we could not read |
| rami-levy | שישיית בירה מכבי 6*330 מ ל ב27.50 כולל | ₪27.50 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | גולדסטאר פחית 500 מ ל 2ב13 כולל | 2 for ₪13.00 | description + DiscountedPrice | everyone | held: 1 of its items are packs we could not read |
| rami-levy | בירה מכבי 500 מל 2ב13כולל | 2 for ₪13.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה מלכה 330 מ ל 2ב26 כולל | 2 for ₪26.00 | description + DiscountedPrice | everyone | held: 3 of its items are packs we could not read |
| rami-levy | בירה גולדסטאר 4*250מ ל ב14.90 כולל | ₪14.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | שישיית בירה 6*330 מ ל באדוויזר 2ב65 כולל | 2 for ₪65.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | ויינשטפן 500מל 2ב20 כולל | 2 for ₪20.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה אלכסנדר 330מל 2ב24 כולל | 2 for ₪24.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | קרומבכר פילס בק שישייה ב29.90 כולל | ₪29.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה קורונה/סטלה/קרונבכר/מילר 500מל 2ב16 | 2 for ₪16.00 | description + DiscountedPrice | everyone | held: 2 of its items are packs we could not read |
| rami-levy | בירה לף בלונד/הוגארדן 500מל 2ב18 כולל | 2 for ₪18.00 | description + DiscountedPrice | everyone | held: 1 of its items are packs we could not read |
| rami-levy | בירה שוף/דובל/מרדסו 330מל 2ב19.90 כולל | 2 for ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה פרנסיסקאנר 500מל 2ב23.90 כולל | 2 for ₪23.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה מילר בוק 330מל שישייה ב19.90 מו2 כו | ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | שישיית בירה גולדסטאר 29.90כולל | ₪29.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| rami-levy | שישיית בירה 6*330 מ ל קרלסברג לומה ב35.9 | ₪35.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה טובורג רד/גרין 6*330מ ל ב29.90 כולל | ₪29.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | סטרופארמן בק 330מל שישייה ב19.90 כולל | ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה 6*330 מ ל קרלסברג ב29.90 כולל | ₪29.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה גולדסטאר 4*250מ ל ב14.90 כולל | ₪14.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה הייניקן 4*250מ ל ב15.90כולל | unmapped | — | everyone | held: description says ₪15.90, DiscountedPrice says ₪15.30 |
| rami-levy | בירה שנדי 6*330מ ל ב27.90 כולל | ₪27.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | שישיית גולדסטאר ב24.90 מעל 75 מו2 כולל | ₪24.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 2ב71.40 פקדון בירה סטלה ארטואה 6 * 330 מ | 2 for ₪71.40 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 2ב71.40 פקדון בירה קורונה 355*6 מ"ל | 2 for ₪71.40 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 2ב25.40 פקדון בירה ויינשטפן 500 מ"ל | 2 for ₪25.40 | description + DiscountedPrice | everyone | held: 1 of its items are packs we could not read |
| shufersal | 68.10 פקדון בירה ויינשטפן 330*6 מ"ל | ₪68.10 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 38.10 פקדון קרלסברג לומה 6בק* 330מל | ₪38.10 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 38.10 פקדון בירה אסטרייה דאם330*6מ | ₪38.10 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 2ב66.40 פקדון בירה באדוויזר 330*6 מ"ל | 2 for ₪66.40 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 38.70 פקדון בירה פאולנר 330*4 מ"ל | ₪38.70 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 32.10 פקדון הייניקן 0% אלכוהול330*6 | ₪32.10 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 2ב25.40 פקדון בירה מרפיס סטאוט 500 מ"ל | 2 for ₪25.40 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 2ב24.40 פקדון בירה פאולנר חיטה פחית500 | 2 for ₪24.40 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 3ב14.40 פקדון בירה איגל בקבוק חוזר500מ | 3 for ₪14.40 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 32.10 פקדון מכבי שנדי 330*6 מ"ל | ₪32.10 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 2ב29.40 פקדון בריזר/שפירא אייל 275-330 מ | 2 for ₪29.40 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 3ב31.10 פקדון בירה פייל אייל 568 מ"ל | 3 for ₪31.10 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 2ב24.40 פקדון בירה שוף/דובל/מרדסו/סן ברנ | 2 for ₪24.40 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 28.10 פקדון בירה גולדסטאר/בקס/מכבי 275X6 | ₪28.10 | description + DiscountedPrice | everyone | held: 3 of its items are packs we could not read |
| shufersal | 3ב16.4פקדון בירה מצוננת בקבוק 500 מ"ל | 3 for ₪16.40 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה 31.9 | ₪31.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה 31.9 | ₪31.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה 37.90 | ₪37.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה 35.9 | ₪35.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | ויינשטפן 3 ב 33 | 3 for ₪33.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 22.9 | 2 for ₪22.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה 35.9 | ₪35.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה ב- 34.90 | ₪34.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה 37.9 | ₪37.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 25 | 2 for ₪25.00 | description + DiscountedPrice | everyone | held: 2 of its items are packs we could not read |
| tiv-taam | בירה 2 ב 22 | 2 for ₪22.00 | description + DiscountedPrice | everyone | held: 1 of its items are packs we could not read |
| tiv-taam | בירה 34.9 | ₪34.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 15 | 2 for ₪15.00 | description + DiscountedPrice | everyone | held: 2 of its items are packs we could not read |
| tiv-taam | שישיית בירה 39.9 | ₪39.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | קראביס פטל 2 ב 14 | 2 for ₪14.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 24 | 2 for ₪24.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | שישיית בירה 34.9 | ₪34.90 | description + DiscountedPrice | everyone | held: one price across several packs without a quantity |
| tiv-taam | שישיית בירה 29.9 | ₪29.90 | description + DiscountedPrice | everyone | held: 1 of its items are packs we could not read |
| yochananof | בירה בנדקטינר | 2 for ₪20.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | בירה קרלסברג/הייניקן פחית | 3 for ₪20.00 | DiscountedPrice only | everyone | held: the description states no price to confirm it; 2 of its items are packs we could not read |
| yochananof | בירה לבנה 5.4% בפחית 568 מ"ל | 2 for ₪17.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | בירה פילזנר פחית 500 מ"ל | 3 for ₪20.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | בירה ואן פור/מולר | 3 for ₪11.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | בירה מלכה | 2 for ₪26.00 | DiscountedPrice only | everyone | held: the description states no price to confirm it; 2 of its items are packs we could not read |
| yochananof | בירה שוף/מרדסו/דובל/ליפמנס/בלומון | 2 for ₪20.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | בירה סטלה פחית 440 מ"ל | 2 for ₪16.00 | DiscountedPrice only | everyone | held: the description states no price to confirm it |
| yochananof | הייניקן שישייה | ₪34.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | הייניקן/גולדסטאר רביעייה | ₪14.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | בירה איגל | 2 for ₪11.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | בירה לף בלונד | 6 for ₪30.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | בירה גולדסטאר לא מסונן פחית 500 מ"ל | 2 for ₪15.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | קורונה שישייה | 2 for ₪65.00 | DiscountedPrice only | everyone | held: the description states no price to confirm it |
| yochananof | בירה ויינשטפן 500 מ"ל | 2 for ₪20.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | קרלסברג לא מסונן שישייה | ₪35.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | גולדסטאר/מכבי פחית | 2 for ₪14.00 | DiscountedPrice only | everyone | held: the description states no price to confirm it; 2 of its items are packs we could not read |
| yochananof | שנדי שישייה | ₪27.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | פחית בירה הוגארדן/לף 500 מ"ל | 2 for ₪18.00 | DiscountedPrice only | everyone | held: the description states no price to confirm it; 1 of its items are packs we could not read |
| yochananof | שישיית בירה סטלה | ₪24.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | קרלסברג/טובורג שישייה | ₪29.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | גולדסטאר שישייה | 2 for ₪55.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | בירה גולדסטאר לא מסונן שישייה | ₪29.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | שישיית בירה באדוויזר 330 מ"ל | 2 for ₪65.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |

## Unresolved products (why each one was not priced)

* 138 × container unknown
* 22 × # different items at this branch read as the same pack (…, …) — an unlisted variant
* 19 × pack derived from the total volume … ml
* 18 × container unknown; pack derived from the total volume … ml
* 15 × volume unknown; pack size unknown
* 14 × volume unknown; pack size unknown; container unknown
* 9 × volume unknown; container unknown
* 8 × which alexander beer? the name names no known variant
* 7 × the same barcode reads differently — carrefour: tuborg-red #×# can / yeinot-bitan: tuborg-red #×# can / ampm: tuborg #×# can / rami-levy: tuborg #×# can / shufersal: tuborg #×# can
* 6 × the same barcode reads differently — yeinot-bitan: corona #×# bottle / ampm: corona #×# bottle / osher-ad: corona #×# / rami-levy: corona #×# / tiv-taam: corona #×# / yochananof: c
* 4 × which malka beer? the name names no known variant
* 4 × the same barcode reads differently — carrefour: maccabee שנדי לימון ליים radler #×# / shufersal: maccabee שנדי ליים radler #×# / tiv-taam: maccabee שנדי לימון ליים radler #×# bottl
* 3 × which negev beer? the name names no known variant
* 3 × the same barcode reads differently — rami-levy: paulaner חיטה #×# / shufersal: paulaner חיטה #×# can / tiv-taam: paulaner #×# can
* 3 × # different items at this branch read as the same pack (…, …, …) — an unlisted variant
* 2 × which shapiro beer? the name names no known variant
* 2 × pack size unknown
* 2 × the same barcode reads differently — ampm: paulaner #×# bottle / tiv-taam: paulaner #×# bottle

Examples:

| Retailer | Code | Shelf name | Why |
| --- | --- | --- | --- |
| carrefour | 7290000136554 | בירה היינקן מארז רב | volume unknown; pack size unknown |
| yeinot-bitan | 7290000136554 | בירה היינקן מארז רב | volume unknown; pack size unknown |
| ampm | 7290012921636 | פחית בירה מלכה אדמונ | which malka beer? the name names no known variant |
| ampm | 7290013430250 | בירה אלכסנדר חיטה יש | which alexander beer? the name names no known variant |
| ampm | 7290019398240 | שישייה בירה לף בלונד | volume unknown; container unknown |
| ampm | 7290013430625 | בירה אלכסנדר לאגר | which alexander beer? the name names no known variant |
| ampm | 7290000327105 | גולדסטאר לא מסונן 2 | volume unknown; pack size unknown; container unknown |
| hatzi-hinam | 7290001594568 | בירה קרלסברג פחית | volume unknown; pack size unknown |
| hatzi-hinam | 7290001594858 | בירה טובורג רד שישייה | volume unknown; container unknown |
| hatzi-hinam | 7290001594575 | בירה טובורג רד פחית | volume unknown; pack size unknown |
| hatzi-hinam | 7290012921032 | בירה מלכה אדמונית | volume unknown; pack size unknown; container unknown |
| hatzi-hinam | 7290012921025 | בירה מלכה בהירה | volume unknown; pack size unknown; container unknown |
| hatzi-hinam | 7290012921056 | בירה מלכה חיטה | volume unknown; pack size unknown; container unknown |
| hatzi-hinam | 7290011018368 | בירה ויינשטפן שישייה | volume unknown; container unknown |
| hatzi-hinam | 5000213000359 | בירה גינס בבקבוק | volume unknown; pack size unknown |
| hatzi-hinam | 7290012921049 | בירה מלכה כהה | volume unknown; pack size unknown; container unknown |
| hatzi-hinam | 5000213014905 | בירה גינס פחית | volume unknown; pack size unknown |
| hatzi-hinam | 7290012921063 | בירה מלכה הינדי | volume unknown; pack size unknown; container unknown |
| hatzi-hinam | 7290013276124 | בירה נגב אמבר אייל | volume unknown; pack size unknown; container unknown |
| hatzi-hinam | 7290013276131 | בירה נגב פורטר אלון | volume unknown; pack size unknown; container unknown |
| hatzi-hinam | 4105120623941 | בירה ויינשטפן | volume unknown; pack size unknown; container unknown |
| hatzi-hinam | 5410228267515 | בירה באדוויזר שישייה | volume unknown; container unknown |
| hatzi-hinam | 7290110113476 | בירה קרלסברג ללא אלכוהול - שישייה | volume unknown; container unknown |
| hatzi-hinam | 7290110110369 | בירה קרלסברג לומה LUMA שישייה | volume unknown; container unknown |
| hatzi-hinam | 7290013430250 | בירה אלכסנדר חיטה ישראלית | which alexander beer? the name names no known variant |
| hatzi-hinam | 7290013430403 | בירה אלכסנדר בלייזר - בירה ישראלית | which alexander beer? the name names no known variant |
| hatzi-hinam | 786150000281 | שישיית בירה חזקה לף בראון | volume unknown; container unknown |
| hatzi-hinam | 4105120624412 | בירה ויינשטפן חיטה חזקה מעוננת ויטוס בקבוק | volume unknown; pack size unknown |
| hatzi-hinam | 7290013430090 | בירה אלכסנדר אמברה AMBREE בירה ישראלית | volume unknown; pack size unknown; container unknown |
| hatzi-hinam | 5410228217732 | פחית בירה סטלה ארטואה | volume unknown; pack size unknown |
| hatzi-hinam | 7290013430304 | בירה אלכסנדר גרין GREEN בירה ישראלית | volume unknown; pack size unknown; container unknown |
| hatzi-hinam | 5410228222941 | לף בלונד בירה חזקה פחית | volume unknown; pack size unknown |
| hatzi-hinam | 7290013430144 | בירה אלכסנדר BOCK | which alexander beer? the name names no known variant |
| hatzi-hinam | 4066600611028 | בירה פאולנר מינכן הל בקבוק | volume unknown; pack size unknown |
| hatzi-hinam | 7290001594865 | בירה קרלסברג שישייה | volume unknown; container unknown |
| hatzi-hinam | 41001356 | בירה בקס פחית | volume unknown; pack size unknown |
| hatzi-hinam | 5014379021417 | בירה באדוויזר פחית | volume unknown; pack size unknown |
| hatzi-hinam | 7290013430625 | אלכסנדר בירה ישראלית פסט לאגר | which alexander beer? the name names no known variant |
| hatzi-hinam | 4066600211815 | פחית בירה פאולנר מינכן הל | volume unknown; pack size unknown |
| osher-ad | 7290000136554 | מארז בירה היינקן 5% | volume unknown; pack size unknown; container unknown |

## Invalid prices

* ampm 4100130937163 בירה בקס 6 יחידות 1. ₪36.9: ₪134.18 per litre is implausibly high — likely a multipack whose name lost its pack size
* ampm 7501064191527 בירה קורונה בקבוק שי ₪49.9: ₪140.56 per litre is implausibly high — likely a multipack whose name lost its pack size
* rami-levy 7290110110369 בירה קרלסברג לומה שי ₪37.9: ₪114.85 per litre is implausibly high — likely a multipack whose name lost its pack size
* rami-levy 7290008464734 בירה גולדסטאר SLOWBR ₪34.9: ₪105.76 per litre is implausibly high — likely a multipack whose name lost its pack size
* rami-levy 7290008464703 בירה מכבי ח"פ 330 בק ₪33.9: ₪102.73 per litre is implausibly high — likely a multipack whose name lost its pack size
* tiv-taam 7290067642005 בירה גולדסטאר 10% 330 מ"ל SLOW BREW ₪8.2: ₪4.14 per litre is implausibly low

## Out of scope (kept out on purpose)

* malt: 22 rows
* cider: 65 rows

