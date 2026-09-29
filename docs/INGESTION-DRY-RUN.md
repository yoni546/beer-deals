# Ingestion dry run

**2026-09-29, from the feed files fetched on 2026-09-29.** DRY RUN: nothing was written to any database.
Produced by `node scripts/ingest/dry-run.mjs` from files parsed by the installed skill's `parse_price_xml.py` (v1.6.0), plus
`lib/promo-supplement.mjs` for the one field it drops. One branch per retailer; the raw files stay in the git-ignored `.ingest-cache/`.

## Summary

| | |
| --- | ---: |
| Publishers fetched · blocked | 12 · 6 |
| Retailers (chains) covered | 15 |
| Branches covered | 16 |
| Raw shelf rows | 175,784 |
| Beer candidates (beer, non-alcoholic, radler) | 1852 |
| … of our beers | 1150 |
| … beers the app does not carry | 702 |
| Out of scope (malt drinks, cider) | 158 |
| Canonical SKUs | 178 |
| Resolved products (feed items matched to a SKU) | 948 |
| Unresolved products (review queue) | 112 |
| Regular-price observations | 1027 |
| Active universal promotions (single pack) | 307 |
| Mix-and-match (group) promotions published | 70 |
| Restricted promotions filtered (club, card, coupon, employees…) | 78 |
| Promotions held for review (everyone could use them, but a statement was missing or disagreed) | 169 |
| Invalid prices | 1 |
| Duplicate source rows | 2 |
| Barcodes seen at 2+ chains · read differently (held) | 160 · 9 |

## Chains and branches

| Retailer | Publisher (feed chain id) | Branch | Observed (file time, UTC) | Rows | Beer | Ours | Promotions touching beer | Published | Groups | Restricted | Held |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| carrefour | carrefour (7290055700007) | 2 קרפור מרקט אשקלון חאן | 2026-09-29 02:10 | 6148 | 56 | 45 | 11 | 4 | 2 | 0 | 3 |
| yeinot-bitan | carrefour (7290055700007) | 80 יינות ביתן טבעון | 2026-09-29 02:10 | 6823 | 53 | 44 | 14 | 6 | 3 | 0 | 3 |
| carrefour | carrefour (7290055700007) | 416 בעיר שדרות B (1340) | 2026-09-29 21:00 | 11213 | 84 | 69 | 15 | 6 | 4 | 0 | 3 |
| ampm | dor-alon (7290492000005) | 401 AM-PMדרך השלום | 2026-09-29 21:05 | 5045 | 106 | 87 | 33 | 17 | 9 | 0 | 7 |
| fresh-market | freshmarket (7290876100000) | 2 פרשמרקט הנדיב | 2026-09-29 21:10 | 10697 | 74 | 57 | 20 | 9 | 7 | 0 | 4 |
| hatzi-hinam | hatzi-hinam (7290700100008) | 103  | 2026-09-29 19:53 | 9768 | 69 | 48 | 13 | 4 | 4 | 0 | 5 |
| keshet-taamim | keshet (7290785400000) | 14 פולג | 2026-09-29 21:10 | 17649 | 379 | 127 | 140 | 45 | 12 | 17 | 83 |
| mahsanei | mahsanei (7290661400001) | 97 97 אינטרנט | 2026-09-29 03:04 | 12456 | 103 | 78 | 81 | 54 | 0 | 0 | 26 |
| osher-ad | osher-ad (7290103152017) | 3 גבעת שאול | 2026-09-29 11:05 | 7064 | 42 | 40 | 16 | 6 | 7 | 0 | 3 |
| politzer | politzer (7291059100008) | 2 ויתקין | 2026-09-28 21:10 | 13409 | 99 | 83 | 30 | 16 | 4 | 0 | 8 |
| rami-levy | rami-levy (7290058140886) | 2 בזק מחסני מזון | 2026-09-29 21:10 | 11780 | 88 | 68 | 36 | 20 | 6 | 0 | 8 |
| shufersal | shufersal (7290027600007) | 2 שלי ירושלים- אגרון | 2026-09-29 01:31 | 7577 | 69 | 59 | 24 | 17 | 1 | 0 | 6 |
| stop-market | stop-market (7290639000004) | 2 ארנה | 2026-09-28 22:00 | 15328 | 225 | 108 | 25 | 3 | 5 | 0 | 16 |
| tiv-taam | tiv-taam (7290873255550) | 2 נתניה | 2026-09-28 21:40 | 21566 | 285 | 132 | 87 | 13 | 5 | 61 | 48 |
| victory | victory (7290696200003) | 93 חריש | 2026-09-29 02:11 | 8020 | 56 | 49 | 35 | 28 | 0 | 0 | 7 |
| yochananof | yochananof (7290803800003) | 4 בילו | 2026-09-28 21:40 | 11241 | 64 | 56 | 24 | 17 | 4 | 0 | 3 |
| victory | — | — | **FAILED**: laibcatalog.co.il lists no files for chain 7290696200003 | | | | | | | | |
| mahsanei | — | — | **FAILED**: laibcatalog.co.il lists no files for chain 7290661400001 | | | | | | | | |
| king-store | — | — | **FAILED**: listed 0 files; none of the branches tried (up to 4) lists any beer | | | | | | | | |
| super-yuda | — | — | **BLOCKED**: Super Yuda's Cerberus account (yuda_ho) requires a password; the public empty-password login is refused. Needs the chain's published credentials. | | | | | | | | |
| salach-dabach | — | — | **BLOCKED**: Salach Dabach's Cerberus account (SalachD) requires a password; the public empty-password login is refused. | | | | | | | | |
| yellow | — | — | **BLOCKED**: Paz Yellow's Cerberus account (Paz_bo) requires a password; the public empty-password login is refused. | | | | | | | | |

## Canonical SKUs

| Beer | Variant | Category | Container | ml | Pack | Retailers | Regular prices seen |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| tuborg-red | — | beer | bottle | 330 | 6 | ampm, carrefour, fresh-market, hatzi-hinam, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan, yochananof | ₪29.90–₪52.90 |
| carlsberg | — | beer | bottle | 330 | 6 | ampm, carrefour, fresh-market, hatzi-hinam, keshet-taamim, osher-ad, politzer, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan, yochananof | ₪34.80–₪52.90 |
| carlsberg | — | beer | can | 500 | 1 | ampm, carrefour, fresh-market, hatzi-hinam, keshet-taamim, mahsanei, politzer, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan, yochananof | ₪8.90–₪14.90 |
| carlsberg | לומה | beer | bottle | 330 | 6 | ampm, carrefour, fresh-market, hatzi-hinam, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, shufersal, tiv-taam, victory, yeinot-bitan, yochananof | ₪34.90–₪55.50 |
| corona | — | beer | bottle | 355 | 6 | ampm, carrefour, fresh-market, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan, yochananof | ₪37.90–₪49.90 |
| goldstar | — | beer | can | 500 | 1 | ampm, carrefour, fresh-market, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan, yochananof | ₪7.90–₪10.90 |
| goldstar | לא מסונן | beer | bottle | 330 | 6 | ampm, carrefour, fresh-market, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan, yochananof | ₪29.90–₪48.90 |
| heineken | — | beer | bottle | 330 | 6 | ampm, carrefour, fresh-market, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan, yochananof | ₪34.90–₪48.90 |
| heineken | — | beer | can | 500 | 1 | ampm, carrefour, fresh-market, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan, yochananof | ₪9.90–₪14.90 |
| krombacher | חיטה | beer | can | 500 | 1 | ampm, carrefour, fresh-market, hatzi-hinam, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan | ₪9.90–₪14.90 |
| goldstar | — | beer | bottle | 330 | 6 | ampm, carrefour, fresh-market, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, shufersal, tiv-taam, victory, yeinot-bitan, yochananof | ₪31.90–₪44.90 |
| goldstar | לא מסונן | beer | can | 500 | 1 | ampm, carrefour, fresh-market, keshet-taamim, mahsanei, politzer, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan, yochananof | ₪8.90–₪11.90 |
| krombacher | — | beer | can | 500 | 1 | ampm, carrefour, fresh-market, hatzi-hinam, keshet-taamim, mahsanei, politzer, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan | ₪9.90–₪14.90 |
| maccabee | — | beer | can | 500 | 1 | ampm, carrefour, fresh-market, keshet-taamim, mahsanei, politzer, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan, yochananof | ₪7.50–₪10.50 |
| maccabee | 7.9% | beer | can | 500 | 1 | ampm, carrefour, fresh-market, keshet-taamim, mahsanei, osher-ad, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan, yochananof | ₪7.90–₪10.90 |
| stella | — | beer | bottle | 330 | 6 | ampm, carrefour, fresh-market, keshet-taamim, mahsanei, osher-ad, politzer, shufersal, stop-market, tiv-taam, victory, yeinot-bitan, yochananof | ₪29.90–₪49.90 |
| weihen | — | beer | bottle | 500 | 1 | ampm, carrefour, fresh-market, hatzi-hinam, mahsanei, osher-ad, politzer, rami-levy, shufersal, stop-market, tiv-taam, victory, yochananof | ₪11.80–₪16.90 |
| goldstar | — | beer | bottle | 250 | 4 | ampm, carrefour, fresh-market, hatzi-hinam, mahsanei, osher-ad, politzer, rami-levy, tiv-taam, victory, yeinot-bitan, yochananof | ₪24.90–₪28.90 |
| goldstar | — | beer | bottle | 500 | 1 | ampm, carrefour, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, shufersal, tiv-taam, victory, yeinot-bitan, yochananof | ₪7.50–₪10.00 |
| goldstar | סלואו ברו | beer | can | 500 | 1 | ampm, carrefour, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan | ₪8.90–₪11.90 |
| heineken | — | beer | bottle | 250 | 4 | ampm, carrefour, fresh-market, hatzi-hinam, keshet-taamim, mahsanei, osher-ad, politzer, tiv-taam, victory, yeinot-bitan, yochananof | ₪23.90–₪28.90 |
| heineken | — | beer | bottle | 500 | 1 | ampm, carrefour, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, shufersal, tiv-taam, victory, yeinot-bitan, yochananof | ₪8.90–₪11.00 |
| heineken | 0.0 | non_alcoholic | bottle | 330 | 6 | carrefour, fresh-market, keshet-taamim, mahsanei, politzer, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan, yochananof | ₪32.00–₪38.70 |
| paulaner | חיטה | beer | bottle | 500 | 1 | ampm, carrefour, fresh-market, keshet-taamim, mahsanei, osher-ad, shufersal, stop-market, tiv-taam, victory, yeinot-bitan, yochananof | ₪11.70–₪15.90 |
| carlsberg | — | beer | bottle | 500 | 1 | ampm, carrefour, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, shufersal, victory, yeinot-bitan, yochananof | ₪7.90–₪13.90 |
| goldstar | סלואו ברו | beer | bottle | 330 | 6 | ampm, carrefour, fresh-market, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, tiv-taam, victory, yeinot-bitan | ₪34.90–₪49.90 |
| maccabee | 7.9% | beer | bottle | 330 | 6 | ampm, carrefour, keshet-taamim, mahsanei, osher-ad, rami-levy, shufersal, stop-market, tiv-taam, victory, yeinot-bitan | ₪29.90–₪41.90 |
| tuborg-red | — | beer | bottle | 500 | 1 | ampm, carrefour, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, shufersal, victory, yeinot-bitan, yochananof | ₪7.80–₪13.90 |
| becks | — | beer | other | 275 | 6 | ampm, fresh-market, keshet-taamim, mahsanei, politzer, shufersal, stop-market, tiv-taam, victory, yochananof | ₪29.90–₪40.90 |
| budweiser | — | beer | bottle | 330 | 6 | ampm, fresh-market, hatzi-hinam, keshet-taamim, mahsanei, politzer, rami-levy, shufersal, tiv-taam, yochananof | ₪34.90–₪42.90 |
| carlsberg | — | beer | bottle | 330 | 1 | ampm, carrefour, fresh-market, keshet-taamim, mahsanei, rami-levy, stop-market, tiv-taam, victory, yochananof | ₪6.90–₪11.90 |
| carlsberg | 0.0 | non_alcoholic | bottle | 330 | 6 | carrefour, hatzi-hinam, keshet-taamim, mahsanei, politzer, rami-levy, stop-market, tiv-taam, victory, yeinot-bitan | ₪28.90–₪38.70 |
| chouffe | צ'רי | beer | bottle | 330 | 1 | ampm, fresh-market, hatzi-hinam, keshet-taamim, mahsanei, politzer, rami-levy, shufersal, stop-market, tiv-taam | ₪13.90–₪17.90 |
| corona | — | beer | can | 500 | 1 | ampm, fresh-market, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, stop-market, tiv-taam, victory | ₪10.90–₪16.90 |
| hoegaarden | — | beer | can | 500 | 1 | ampm, fresh-market, hatzi-hinam, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, stop-market, yochananof | ₪11.90–₪17.90 |
| krombacher | — | beer | bottle | 330 | 6 | ampm, carrefour, fresh-market, keshet-taamim, mahsanei, osher-ad, politzer, rami-levy, shufersal, victory | ₪29.90–₪47.40 |
| maccabee | 7.9% | beer | bottle | 500 | 1 | ampm, carrefour, keshet-taamim, mahsanei, politzer, rami-levy, shufersal, victory, yeinot-bitan, yochananof | ₪7.30–₪9.90 |
| miller | — | beer | can | 500 | 1 | ampm, carrefour, fresh-market, hatzi-hinam, keshet-taamim, politzer, rami-levy, stop-market, tiv-taam, victory | ₪9.90–₪16.90 |
| stella | — | beer | can | 440 | 1 | ampm, carrefour, hatzi-hinam, keshet-taamim, mahsanei, osher-ad, stop-market, victory, yeinot-bitan, yochananof | ₪9.90–₪16.90 |
| goldstar | — | beer | bottle | 330 | 1 | ampm, carrefour, fresh-market, keshet-taamim, politzer, rami-levy, tiv-taam, victory, yeinot-bitan | ₪6.90–₪9.90 |
| goldstar | לא מסונן | beer | bottle | 250 | 4 | ampm, carrefour, fresh-market, hatzi-hinam, mahsanei, osher-ad, rami-levy, tiv-taam, yeinot-bitan | ₪24.90–₪28.90 |
| hoegaarden | — | beer | bottle | 330 | 6 | ampm, fresh-market, mahsanei, osher-ad, politzer, rami-levy, stop-market, tiv-taam, yochananof | ₪39.90–₪59.90 |
| tuborg-red | — | beer | bottle | 330 | 1 | ampm, carrefour, fresh-market, keshet-taamim, politzer, rami-levy, stop-market, tiv-taam, victory | ₪7.00–₪11.90 |
| tuborg | — | beer | bottle | 330 | 6 | ampm, carrefour, keshet-taamim, mahsanei, politzer, rami-levy, stop-market, tiv-taam, yochananof | ₪34.80–₪52.90 |
| alexander | בלונד | beer | other | 330 | 1 | ampm, carrefour, mahsanei, politzer, rami-levy, stop-market, tiv-taam, yochananof | ₪12.90–₪16.90 |
| heineken | — | beer | bottle | 330 | 1 | ampm, carrefour, keshet-taamim, mahsanei, rami-levy, stop-market, victory, yeinot-bitan | ₪8.90–₪11.10 |
| maccabee | — | beer | bottle | 330 | 6 | carrefour, keshet-taamim, mahsanei, rami-levy, shufersal, stop-market, victory, yeinot-bitan | ₪33.90–₪39.90 |
| malka | בהירה | beer | bottle | 330 | 1 | ampm, fresh-market, hatzi-hinam, rami-levy, shufersal, stop-market, tiv-taam, yochananof | ₪13.90–₪16.90 |
| malka | חיטה | beer | bottle | 330 | 1 | ampm, fresh-market, hatzi-hinam, keshet-taamim, politzer, shufersal, stop-market, tiv-taam | ₪13.90–₪16.90 |
| staropramen | — | beer | can | 500 | 1 | ampm, carrefour, fresh-market, keshet-taamim, rami-levy, stop-market, tiv-taam, yeinot-bitan | ₪9.90–₪14.90 |
| weihen | — | beer | other | 330 | 6 | carrefour, hatzi-hinam, keshet-taamim, mahsanei, politzer, shufersal, tiv-taam, victory | ₪59.90–₪78.70 |
| benediktiner | — | beer | bottle | 500 | 1 | ampm, fresh-market, keshet-taamim, politzer, stop-market, tiv-taam, yochananof | ₪11.90–₪14.90 |
| blue-moon | — | beer | bottle | 330 | 1 | ampm, keshet-taamim, politzer, shufersal, stop-market, tiv-taam, yochananof | ₪9.90–₪16.90 |
| blue-moon | — | beer | can | 500 | 1 | ampm, hatzi-hinam, keshet-taamim, mahsanei, politzer, stop-market, tiv-taam | ₪12.90–₪15.90 |
| budweiser | — | beer | can | 500 | 1 | ampm, fresh-market, hatzi-hinam, mahsanei, politzer, shufersal, stop-market | ₪9.90–₪12.50 |
| chouffe | — | beer | bottle | 330 | 1 | fresh-market, hatzi-hinam, keshet-taamim, politzer, shufersal, stop-market, tiv-taam | ₪14.50–₪16.90 |
| eagle | — | beer | bottle | 500 | 1 | carrefour, mahsanei, politzer, rami-levy, shufersal, yeinot-bitan, yochananof | ₪5.50–₪8.30 |
| eagle | — | beer | can | 500 | 1 | carrefour, fresh-market, keshet-taamim, mahsanei, osher-ad, politzer, tiv-taam | ₪5.90–₪9.30 |
| eagle | זהב | beer | can | 500 | 1 | carrefour, fresh-market, keshet-taamim, mahsanei, politzer, tiv-taam, yeinot-bitan | ₪6.90–₪9.30 |
| krombacher | חיטה | beer | bottle | 500 | 1 | carrefour, keshet-taamim, mahsanei, politzer, rami-levy, victory, yochananof | ₪9.90–₪13.90 |
| leffe | — | beer | can | 500 | 1 | hatzi-hinam, keshet-taamim, mahsanei, osher-ad, rami-levy, stop-market, yochananof | ₪11.90–₪14.90 |
| leffe | בראון | beer | bottle | 330 | 6 | ampm, hatzi-hinam, politzer, rami-levy, stop-market, tiv-taam, yochananof | ₪39.90–₪59.90 |
| maccabee | — | beer | bottle | 500 | 1 | ampm, carrefour, keshet-taamim, politzer, rami-levy, victory, yochananof | ₪6.90–₪8.90 |
| maccabee | 7.9% | beer | bottle | 330 | 1 | ampm, carrefour, fresh-market, keshet-taamim, rami-levy, stop-market, tiv-taam | ₪6.60–₪9.90 |
| miller | בוק | beer | bottle | 330 | 6 | carrefour, fresh-market, keshet-taamim, politzer, rami-levy, stop-market, tiv-taam | ₪35.90–₪47.90 |
| paulaner | מינכן הל | beer | bottle | 500 | 1 | carrefour, fresh-market, hatzi-hinam, keshet-taamim, mahsanei, stop-market, tiv-taam | ₪12.90–₪15.90 |
| paulaner | מינכן הל | beer | can | 500 | 1 | carrefour, hatzi-hinam, keshet-taamim, rami-levy, stop-market, tiv-taam, yeinot-bitan | ₪11.50–₪15.90 |
| shapiro | פייל אייל | beer | other | 330 | 1 | ampm, carrefour, mahsanei, shufersal, stop-market, tiv-taam, yeinot-bitan | ₪14.50–₪17.90 |
| becks | — | beer | can | 500 | 1 | ampm, hatzi-hinam, keshet-taamim, politzer, stop-market, tiv-taam | ₪9.90–₪12.90 |
| benediktiner | דונקל | beer | other | 500 | 1 | fresh-market, keshet-taamim, politzer, stop-market, tiv-taam, yochananof | ₪11.90–₪13.90 |
| chouffe | מק שוף | beer | bottle | 330 | 1 | ampm, keshet-taamim, mahsanei, politzer, stop-market, tiv-taam | ₪13.90–₪17.90 |
| eagle | חזקה | beer | can | 500 | 1 | carrefour, keshet-taamim, mahsanei, politzer, tiv-taam, yeinot-bitan | ₪6.90–₪9.00 |
| kronenbourg | — | beer | bottle | 330 | 6 | hatzi-hinam, keshet-taamim, osher-ad, shufersal, tiv-taam, yochananof | ₪39.90–₪63.90 |
| leffe | — | beer | bottle | 330 | 6 | ampm, carrefour, politzer, stop-market, tiv-taam, yochananof | ₪39.90–₪59.90 |
| malka | אדמונית | beer | bottle | 330 | 1 | ampm, hatzi-hinam, politzer, shufersal, stop-market, tiv-taam | ₪13.90–₪16.90 |
| staropramen | — | beer | bottle | 500 | 1 | carrefour, hatzi-hinam, keshet-taamim, rami-levy, stop-market, tiv-taam | ₪9.90–₪13.30 |
| stella | — | beer | bottle | 330 | 1 | ampm, carrefour, keshet-taamim, osher-ad, politzer, stop-market | ₪7.90–₪10.90 |
| alexander | אמבר | beer | other | 330 | 1 | carrefour, hatzi-hinam, mahsanei, stop-market, tiv-taam | ₪12.90–₪15.90 |
| goldstar | — | beer | other | 330 | 6 | carrefour, keshet-taamim, mahsanei, rami-levy, stop-market | ₪35.90–₪38.90 |
| goldstar | לא מסונן | beer | other | 330 | 1 | ampm, carrefour, politzer, stop-market, tiv-taam | ₪7.20–₪9.90 |
| guinness | — | beer | bottle | 330 | 1 | hatzi-hinam, mahsanei, shufersal, stop-market, tiv-taam | ₪14.00–₪17.50 |
| kasteel | רובוס | beer | other | 330 | 1 | ampm, keshet-taamim, osher-ad, shufersal, tiv-taam | ₪12.90–₪14.90 |
| kasteel | רוז' | beer | other | 330 | 1 | ampm, keshet-taamim, osher-ad, shufersal, tiv-taam | ₪12.90–₪14.90 |
| maccabee | שנדי אפרסק | radler | bottle | 330 | 6 | carrefour, shufersal, tiv-taam, yeinot-bitan, yochananof | ₪31.90–₪42.70 |
| malka | הינדי | beer | other | 330 | 1 | ampm, hatzi-hinam, politzer, stop-market, tiv-taam | ₪13.90–₪16.90 |
| negev | אמבר | beer | other | 330 | 1 | hatzi-hinam, politzer, shufersal, stop-market, tiv-taam | ₪13.90–₪16.90 |
| tuborg | — | beer | bottle | 500 | 1 | carrefour, keshet-taamim, shufersal, victory, yochananof | ₪7.90–₪11.30 |
| alexander | גרין | beer | other | 330 | 1 | hatzi-hinam, mahsanei, stop-market, tiv-taam | ₪12.90–₪15.90 |
| becks | 0.0 | non_alcoholic | other | 275 | 6 | keshet-taamim, politzer, stop-market, tiv-taam | ₪26.90–₪35.90 |
| benediktiner | לאגר | beer | other | 500 | 1 | keshet-taamim, stop-market, tiv-taam, yochananof | ₪11.90–₪13.50 |
| franziskaner | — | beer | bottle | 500 | 1 | ampm, hatzi-hinam, rami-levy, tiv-taam | ₪12.50–₪16.90 |
| heineken | — | beer | can | 330 | 6 | mahsanei, shufersal, stop-market, tiv-taam | ₪34.90–₪46.00 |
| hoegaarden | — | beer | bottle | 330 | 1 | carrefour, keshet-taamim, stop-market, victory | ₪9.80–₪9.90 |
| kronenbourg | רוזה | beer | bottle | 330 | 6 | ampm, hatzi-hinam, keshet-taamim, tiv-taam | ₪44.90–₪60.90 |
| leffe | — | beer | bottle | 330 | 1 | keshet-taamim, stop-market, tiv-taam, yochananof | ₪8.90–₪10.00 |
| leffe | בראון | beer | bottle | 330 | 1 | ampm, keshet-taamim, stop-market, tiv-taam | ₪8.90–₪11.90 |
| malka | אדמונית | beer | other | 750 | 1 | keshet-taamim, politzer, stop-market, tiv-taam | ₪29.90–₪34.90 |
| paulaner | — | beer | bottle | 500 | 1 | keshet-taamim, mahsanei, stop-market, tiv-taam | ₪12.90–₪14.90 |
| shapiro | סטאוט | beer | bottle | 330 | 1 | carrefour, mahsanei, stop-market, yeinot-bitan | ₪14.90–₪17.90 |
| staropramen | — | beer | bottle | 330 | 6 | carrefour, keshet-taamim, rami-levy, tiv-taam | ₪39.90–₪42.90 |
| benediktiner | — | beer | can | 500 | 1 | keshet-taamim, stop-market, tiv-taam | ₪9.90–₪11.90 |
| benediktiner | — | beer | other | 330 | 1 | keshet-taamim, stop-market, tiv-taam | ₪8.90–₪9.90 |
| benediktiner | 0.0 | non_alcoholic | other | 500 | 1 | keshet-taamim, stop-market, tiv-taam | ₪9.90–₪11.50 |
| benediktiner | דונקל | beer | can | 500 | 1 | keshet-taamim, stop-market, tiv-taam | ₪9.90–₪11.90 |
| benediktiner | לאגר | beer | can | 500 | 4 | keshet-taamim, politzer, tiv-taam | ₪34.90–₪39.30 |
| carlsberg | לומה | beer | other | 330 | 1 | carrefour, keshet-taamim, stop-market | ₪8.00–₪9.90 |
| estrella | — | beer | other | 330 | 6 | fresh-market, shufersal, tiv-taam | ₪44.90–₪59.90 |
| franziskaner | דונקל | beer | bottle | 500 | 1 | hatzi-hinam, politzer, tiv-taam | ₪12.90–₪14.90 |
| goldstar | לא מסונן | beer | bottle | 250 | 1 | ampm, fresh-market, keshet-taamim | ₪6.90–₪12.90 |
| kasteel | טריפל | beer | bottle | 330 | 1 | mahsanei, rami-levy, tiv-taam | ₪12.90–₪13.90 |
| kasteel | רוז' | beer | can | 330 | 1 | rami-levy, shufersal, tiv-taam | ₪12.90–₪14.90 |
| maccabee | — | beer | bottle | 330 | 1 | ampm, keshet-taamim, tiv-taam | ₪5.90–₪9.50 |
| maccabee | שנדי | radler | other | 330 | 6 | keshet-taamim, tiv-taam, yochananof | ₪31.90–₪34.90 |
| malka | חיטה | beer | can | 330 | 1 | ampm, stop-market, tiv-taam | ₪14.90–₪16.90 |
| malka | סטאוט | beer | other | 330 | 1 | hatzi-hinam, stop-market, tiv-taam | ₪14.10–₪15.90 |
| negev | אלון | beer | other | 330 | 1 | hatzi-hinam, stop-market, tiv-taam | ₪14.90–₪16.10 |
| weihen | דונקל | beer | bottle | 500 | 1 | keshet-taamim, stop-market, tiv-taam | ₪12.90–₪14.90 |
| becks | — | beer | bottle | 275 | 1 | ampm, keshet-taamim | ₪6.90–₪8.90 |
| benediktiner | — | beer | can | 500 | 4 | keshet-taamim, tiv-taam | ₪37.90–₪39.30 |
| benediktiner | — | beer | other | 330 | 6 | keshet-taamim, tiv-taam | ₪49.90–₪53.90 |
| benediktiner | — | beer | other | 5000 | 1 | keshet-taamim, tiv-taam | ₪109.90–₪119.90 |
| benediktiner | דונקל | beer | can | 500 | 4 | keshet-taamim, tiv-taam | ₪37.90–₪39.30 |
| benediktiner | לאגר | beer | can | 500 | 1 | keshet-taamim, tiv-taam | ₪9.90–₪11.50 |
| blue-moon | — | beer | bottle | 330 | 4 | keshet-taamim, tiv-taam | ₪39.90–₪55.60 |
| budweiser | — | beer | bottle | 330 | 1 | ampm, rami-levy | ₪6.90–₪9.50 |
| budweiser | — | beer | other | 500 | 1 | keshet-taamim, tiv-taam | ₪10.90–₪15.10 |
| budweiser | דארק | beer | can | 500 | 1 | keshet-taamim, tiv-taam | ₪8.90–₪9.20 |
| chouffe | — | beer | bottle | 750 | 1 | keshet-taamim, stop-market | ₪29.90–₪29.90 |
| chouffe | מק שוף | beer | bottle | 750 | 1 | keshet-taamim, stop-market | ₪29.90–₪29.90 |
| chouffe | צ'רי | beer | bottle | 750 | 1 | keshet-taamim, stop-market | ₪29.90–₪29.90 |
| corona | — | beer | other | 355 | 6 | mahsanei, osher-ad | ₪39.90–₪41.90 |
| erdinger | — | beer | other | 500 | 1 | keshet-taamim, tiv-taam | ₪11.90–₪12.50 |
| goldstar | לא מסונן | beer | bottle | 500 | 1 | ampm, politzer | ₪8.40–₪10.40 |
| heineken | 0.0 | non_alcoholic | bottle | 330 | 1 | carrefour, keshet-taamim | ₪6.00–₪6.90 |
| kasteel | בריסטה | beer | other | 330 | 1 | keshet-taamim, tiv-taam | ₪12.90–₪13.90 |
| kasteel | טרופיקל | beer | bottle | 330 | 1 | keshet-taamim, tiv-taam | ₪12.90–₪13.90 |
| kasteel | רובוס | beer | other | 750 | 1 | keshet-taamim, tiv-taam | ₪34.90–₪44.90 |
| kasteel | רוז' | beer | other | 750 | 1 | keshet-taamim, tiv-taam | ₪34.90–₪44.90 |
| krombacher | — | beer | other | 330 | 1 | ampm, stop-market | ₪9.90–₪13.20 |
| kronenbourg | — | beer | can | 330 | 4 | hatzi-hinam, tiv-taam | ₪31.00–₪39.90 |
| maccabee | שנדי אפרסק | radler | bottle | 330 | 1 | carrefour, stop-market | ₪6.00–₪7.90 |
| malka | אדמונית | beer | can | 330 | 1 | stop-market, tiv-taam | ₪14.90–₪15.90 |
| malka | בהירה | beer | can | 330 | 1 | ampm, stop-market | ₪14.90–₪16.90 |
| malka | הינדי | beer | can | 330 | 1 | stop-market, tiv-taam | ₪14.90–₪15.90 |
| shapiro | IPA | beer | bottle | 330 | 1 | ampm, mahsanei | ₪14.90–₪17.90 |
| shapiro | חיטה | beer | other | 330 | 1 | mahsanei, stop-market | ₪14.90–₪14.90 |
| staropramen | — | beer | other | 330 | 1 | rami-levy, stop-market | ₪7.90–₪8.30 |
| tuborg | — | beer | bottle | 330 | 1 | keshet-taamim, politzer | ₪7.90–₪8.70 |
| weihen | — | beer | other | 330 | 1 | carrefour, stop-market | ₪10.00–₪14.90 |
| budweiser | — | beer | other | 275 | 6 | keshet-taamim | ₪29.90–₪29.90 |
| budweiser | — | beer | other | 330 | 6 | keshet-taamim | ₪35.90–₪35.90 |
| budweiser | דארק | beer | other | 500 | 1 | keshet-taamim | ₪10.90–₪10.90 |
| carlsberg | — | beer | other | 330 | 6 | mahsanei | ₪39.90–₪39.90 |
| chouffe | — | beer | other | 1500 | 1 | stop-market | ₪69.90–₪69.90 |
| chouffe | — | beer | other | 330 | 1 | stop-market | ₪14.90–₪14.90 |
| corona | — | beer | bottle | 355 | 1 | politzer | ₪10.00–₪10.00 |
| corona | — | beer | other | 330 | 1 | politzer | ₪7.90–₪7.90 |
| estrella | — | beer | bottle | 330 | 1 | ampm | ₪9.90–₪9.90 |
| estrella | — | beer | other | 500 | 1 | ampm | ₪12.90–₪12.90 |
| franziskaner | — | beer | other | 500 | 1 | politzer | ₪12.90–₪12.90 |
| goldstar | — | beer | other | 330 | 1 | rami-levy | ₪7.90–₪7.90 |
| goldstar | סלואו ברו | beer | other | 330 | 1 | ampm | ₪9.90–₪9.90 |
| guinness | — | beer | can | 440 | 1 | keshet-taamim | ₪15.90–₪15.90 |
| heineken | — | beer | can | 330 | 1 | mahsanei | ₪8.50–₪8.50 |
| kasteel | טרופיקל | beer | other | 750 | 1 | tiv-taam | ₪44.90–₪44.90 |
| kasteel | כהה | beer | other | 330 | 1 | tiv-taam | ₪13.90–₪13.90 |
| kasteel | רוז' 0.0 | non_alcoholic | other | 330 | 1 | tiv-taam | ₪13.90–₪13.90 |
| kronenbourg | — | beer | bottle | 330 | 1 | keshet-taamim | ₪9.90–₪9.90 |
| kronenbourg | רוזה | beer | bottle | 330 | 1 | keshet-taamim | ₪12.90–₪12.90 |
| leffe | — | beer | other | 330 | 1 | yochananof | ₪9.90–₪9.90 |
| maccabee | שנדי | radler | bottle | 330 | 1 | carrefour | ₪6.90–₪6.90 |
| maccabee | שנדי | radler | other | 330 | 1 | stop-market | ₪7.90–₪7.90 |
| miller | — | beer | other | 330 | 1 | stop-market | ₪7.90–₪7.90 |
| negev | פאטה מורגנה | beer | other | 330 | 1 | rami-levy | ₪13.90–₪13.90 |
| paulaner | — | beer | other | 500 | 1 | keshet-taamim | ₪12.90–₪12.90 |
| stella | — | beer | can | 500 | 1 | keshet-taamim | ₪9.90–₪9.90 |
| tuborg | — | beer | other | 500 | 1 | mahsanei | ₪10.80–₪10.80 |
| weihen | קריסטל | beer | other | 500 | 1 | stop-market | ₪12.90–₪12.90 |

## Promotions

| Retailer | Promotion | Read as | Basis | Audience | Outcome |
| --- | --- | --- | --- | --- | --- |
| carrefour | בירה מכבי 330 בקבוק שישייה | 2 for ₪65.00 | DiscountedPrice only | everyone | published as a group |
| carrefour | גולדסטאר ח פ בקבוק 6*330 מ ל | ₪24.90 | DiscountedPrice only | everyone | published |
| carrefour | בירה לאגר שישיה 330 מ ל | ₪35.90 | DiscountedPrice only | everyone | published |
| carrefour | בירה סטלה ארטואה שישיה 330 מ ל/קורונה אק | 2 for ₪66.00 | DiscountedPrice only | everyone | published as a group |
| carrefour | בירה הייניקן בקבוק ח פ 6*330מ ל | ₪35.90 | DiscountedPrice only | everyone | published |
| carrefour | בירה היינקן/גולדסטאר רביעייה 250 מ ל | ₪18.90 | DiscountedPrice only | everyone | published |
| yeinot-bitan | בירה מכבי 330 בקבוק שישייה | 2 for ₪67.00 | DiscountedPrice only | everyone | published as a group |
| yeinot-bitan | בירה סטלה ארטואה שישיה 330 מ ל/קורונה אק | ₪36.90 | DiscountedPrice only | everyone | published |
| yeinot-bitan | שפירא פייל אייל 330 בקבוק | 2 for ₪27.00 | DiscountedPrice only | everyone | published as a group |
| yeinot-bitan | גולדסטאר לא מסונן // rostBlackBatchWild | ₪32.90 | DiscountedPrice only | everyone | published |
| yeinot-bitan | בירה פאולנר מינכן הל פחית 500 מ ל | 2 for ₪24.00 | DiscountedPrice only | everyone | published |
| yeinot-bitan | בירה הייניקן בקבוק ח פ 6*330מ ל | ₪36.90 | DiscountedPrice only | everyone | published |
| yeinot-bitan | שישיית בירה טובורג/קרלסברג 330 מ ל | 2 for ₪75.00 | DiscountedPrice only | everyone | published as a group |
| yeinot-bitan | בירה היינקן/גולדסטאר רביעייה 250 מ ל | ₪20.00 | DiscountedPrice only | everyone | published |
| yeinot-bitan | גולדסטאר ח פ בקבוק 6*330 מ ל | ₪27.90 | DiscountedPrice only | everyone | published |
| carrefour | בירה מכבי 330 בקבוק שישייה | 2 for ₪64.00 | DiscountedPrice only | everyone | published as a group |
| carrefour | גולדסטאר ח פ בקבוק 6*330 מ ל | ₪24.90 | DiscountedPrice only | everyone | published |
| carrefour | שפירא פייל אייל 330 בקבוק | 2 for ₪25.00 | DiscountedPrice only | everyone | published as a group |
| carrefour | גולדסטאר לא מסונן // rostBlackBatchWild | ₪29.90 | DiscountedPrice only | everyone | published |
| carrefour | בירה פאולנר מינכן הל פחית 500 מ ל | 2 for ₪22.00 | DiscountedPrice only | everyone | published |
| carrefour | שישיית בירה טובורג/קרלסברג 330 מ ל | 2 for ₪70.00 | DiscountedPrice only | everyone | published as a group |
| carrefour | בירה לאגר שישיה 330 מ ל | ₪34.90 | DiscountedPrice only | everyone | published |
| carrefour | בירה היינקן/גולדסטאר רביעייה 250 מ ל | ₪17.90 | DiscountedPrice only | everyone | published |
| carrefour | בירה סטלה ארטואה שישיה 330 מ ל/קורונה אק | 2 for ₪65.00 | DiscountedPrice only | everyone | published as a group |
| carrefour | בירה הייניקן בקבוק ח פ 6*330מ ל | ₪34.90 | DiscountedPrice only | everyone | published |
| ampm | מבצע בירה אלכסנדר/גמס 2 יח ב 27.90 שח | 2 for ₪27.90 | description + DiscountedPrice | everyone | published |
| ampm | מבצע 1/6 בירה קורונה/סטלה ב 42.90 שח | ₪42.90 | description + DiscountedPrice | everyone | published |
| ampm | מבצע 1/6 בירה לף בלונד/הוגרדן ב 45.90 שח | ₪45.90 | description + DiscountedPrice | everyone | published |
| ampm | מבצע בירה קורונה/סטלה בקבוק 2 ב 18.90 שח | 2 for ₪18.90 | description + DiscountedPrice | everyone | published as a group |
| ampm | מבצע שישיית בירה קרומבאכר ב 39.90 שח | ₪39.90 | description + DiscountedPrice | everyone | published |
| ampm | מבצע מגוון מבירות 440-500 בפחית 3ב32שח | 3 for ₪32.00 | description + DiscountedPrice | everyone | published as a group |
| ampm | מבצע בירה טובורג/קרלסברג פחית 2ב 19.90שח | 2 for ₪19.90 | description + DiscountedPrice | everyone | published as a group |
| ampm | מבצע בירה קרלסברג/טובורג 330מל 2ב 18.90 | 2 for ₪18.90 | description + DiscountedPrice | everyone | published as a group |
| ampm | מבצע 1/6 בירה קרלסברג ב 42.90 שחLUMA | ₪42.90 | description + DiscountedPrice | everyone | published |
| ampm | מבצע 1/6 בירה באדוויזר ב 34.90 שח | ₪34.90 | description + DiscountedPrice | everyone | published |
| ampm | מבצע 1/6 בירה בקס ב 29.90 שח | ₪29.90 | description + DiscountedPrice | everyone | published |
| ampm | מבצע בירה בלומון 5.4% כוהל 2ב26שח | 2 for ₪26.00 | description + DiscountedPrice | everyone | published |
| ampm | מבצע בירה באדוויזר/בקס פחית 2 ב 20 שח | 2 for ₪20.00 | description + DiscountedPrice | everyone | published as a group |
| ampm | מבצע בירה פרנסיסקאנר 500 מ ל 26.902 שח | 2 for ₪26.90 | DiscountedPrice only | everyone | published |
| ampm | מבצע בירה בלו מון 330 מ ל 2 ב 22.90 שח | 2 for ₪22.90 | description + DiscountedPrice | everyone | published |
| ampm | מבצע בירה לה שוף/מק שוף 2 ב 22.90 שח | 2 for ₪22.90 | description + DiscountedPrice | everyone | published as a group |
| ampm | מבצע מכבי/גולדסטאר ב.חוזר 3 ב 22 שח | 3 for ₪22.00 | description + DiscountedPrice | everyone | published as a group |
| ampm | מבצע בירה הייניקן בקבוק חוזר 2 ב 17.90שח | 2 for ₪17.90 | description + DiscountedPrice | everyone | published |
| ampm | מבצע גולדסטאר לא מסונן ב.חוזר 2 ב 17.9שח | 2 for ₪17.90 | description + DiscountedPrice | everyone | published |
| ampm | מבצע גולדסטאר לא מסונן 330 מל 3 ב 25 שח | 3 for ₪25.00 | description + DiscountedPrice | everyone | published |
| ampm | מבצע 1/6 בירה גולדסטאר/ ב 44.90 שחSLOW | ₪44.90 | description + DiscountedPrice | everyone | published |
| ampm | מבצע 1/6 בירה מכבי/גולדסטאר ב 36.90 שח | ₪36.90 | description + DiscountedPrice | everyone | published |
| ampm | מבצע בירה הייניקן שישייה ב 45 שח | ₪45.00 | description + DiscountedPrice | everyone | published |
| ampm | מבצע בירה גולדסטאר/מכבי פחית 2 ב 20 שח | 2 for ₪20.00 | description + DiscountedPrice | everyone | published as a group |
| ampm | מבצע 1/6בירה קרלסברג/טובורג ב 42.90שח | ₪42.90 | description + DiscountedPrice | everyone | published |
| ampm | מבצע בירה מלכה330 מ ל 2 ב 28 שח | 2 for ₪28.00 | description + DiscountedPrice | everyone | published as a group |
| fresh-market | בירה באדוויזר שישיית ב35.90 | ₪35.90 | description + DiscountedPrice | everyone | published |
| fresh-market | בירה דובל/מרדסו/שוף 2 ב28 | 2 for ₪28.00 | description + DiscountedPrice | everyone | published as a group |
| fresh-market | בירה אסטרייה דאם ב47.90 | ₪47.90 | description + DiscountedPrice | everyone | published |
| fresh-market | בירה קרלסברג/טובורג שישייה 2ב70 | 2 for ₪70.00 | description + DiscountedPrice | everyone | published as a group |
| fresh-market | בירה גולדסטאר ב39.90 | ₪39.90 | description + DiscountedPrice | everyone | published |
| fresh-market | בירה מכבי/גולדסטאר 2 ב75 | 2 for ₪75.00 | description + DiscountedPrice | everyone | published |
| fresh-market | בירה היניקן שישייה ב42.90 | ₪42.90 | description + DiscountedPrice | everyone | published |
| fresh-market | בירה פאולנר בקבוק 2 ב26 | 2 for ₪26.00 | description + DiscountedPrice | everyone | published as a group |
| fresh-market | בירה מלכה /נגב 2 ב27 | 2 for ₪27.00 | description + DiscountedPrice | everyone | published as a group |
| fresh-market | בירה סטלה/קורונה ב42.90 | ₪42.90 | description + DiscountedPrice | everyone | published |
| fresh-market | מגוון פחיות בירות 2 ב23 | 2 for ₪23.00 | description + DiscountedPrice | everyone | published as a group |
| fresh-market | בירה מילר/סטארופראמן /קרומבכר ב28.90 | ₪28.90 | description + DiscountedPrice | everyone | published |
| fresh-market | בירה בנדקטינר פחית 2 ב22 | 2 for ₪22.00 | description + DiscountedPrice | everyone | published as a group |
| fresh-market | היינק /גולדסטר רביעייה ב19.90 | ₪19.90 | description + DiscountedPrice | everyone | published |
| fresh-market | בירה מילר/סטארופראמן ב29.90 | ₪29.90 | description + DiscountedPrice | everyone | published |
| fresh-market | בירה לף/הוגארדן/קורונה 2 ב24 | 2 for ₪24.00 | description + DiscountedPrice | everyone | published as a group |
| hatzi-hinam | פחית בירה קרלסברג 2 יח ב-17 ש"ח | 2 for ₪17.00 | description + DiscountedPrice | everyone | published |
| hatzi-hinam | בירה פאולנר 2 יח ב-22 ש"ח | 2 for ₪22.00 | description + DiscountedPrice | everyone | published |
| hatzi-hinam | מגוון בירות אלכסדר/ג'מס 2 ב 23 ש"ח | 2 for ₪23.00 | description + DiscountedPrice | everyone | published as a group |
| hatzi-hinam | בירות הכרם מלכה/נגב/הרצל/אלון 2 ב 26 ש"ח | 2 for ₪26.00 | description + DiscountedPrice | everyone | published as a group |
| hatzi-hinam | בירה צ'רי שוף 2 ב 20 ש"ח | 2 for ₪20.00 | description + DiscountedPrice | everyone | published |
| hatzi-hinam | בירה דובל/לה שוף/מק שוף 2 ב 24 ש"ח | 2 for ₪24.00 | description + DiscountedPrice | everyone | published |
| hatzi-hinam | מגוון בירות הכרם 2 ב 24 ש"ח | 2 for ₪24.00 | description + DiscountedPrice | everyone | published as a group |
| hatzi-hinam | בירה היינקן/גולדסטאר רביעיות 2ב-35ש"ח | 2 for ₪35.00 | description + DiscountedPrice | everyone | published as a group |
| keshet-taamim | שישיית גולדסטאר לא מסונן 330 מל ב 29.90 | ₪29.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה בלו מון 330 מל 2 ב 19.90 | 2 for ₪19.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | שישיית בירה מכבי/גולדסטאר 330 מל ב 27.90 | ₪27.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה באדוויזר 5 בק 330 מל+כוס ב 24.90 | ₪24.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה באדוויזר/בקס/לוונבראו פח 2 ב 17.90 | 2 for ₪17.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | שישיית בירה באדוויזר בק 330 מל ב 29.90 | ₪29.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | שישיית בירה בקס 275 מל ב 27.90 | ₪27.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | שישיית בירה טובורג 330 מל ב 29.90 | ₪29.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | שישייה בירה מילר 330 מל ב 29.90 | ₪29.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה סטארופרמן 330 מל שישייה ב 29.90 | ₪29.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה גינס פחית 440 מל 2 ב 24.90 | 2 for ₪24.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה קרלסברג פחית 500 מל 2 ב 16.90 | 2 for ₪16.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | שישיית בירה בלאנק 1664 בק 330 מל ב 39.90 | ₪39.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה פאולנר 500 מל 2 ב 19.90 | 2 for ₪19.90 | description + DiscountedPrice | everyone | published as a group |
| keshet-taamim | שישיית בירה קרלסברג 330 מל ב 29.90 | ₪29.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה סטלה ארטואה 330 מל שישיה ב 29.90 | ₪29.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה קורונה 355 מל שישייה ב 32.90 | ₪32.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | שישיית בירה בנדיקטינר 330 מל ב 39.90 | ₪39.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | רביעיית בירה בנדיקטינר 500 מל ב 34.90 | ₪34.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | מגוון בירות חבית 5 ל ב 99.90 | ₪99.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה בנדיקטינר 500 מל 2 ב 19.90 | 2 for ₪19.90 | description + DiscountedPrice | everyone | published as a group |
| keshet-taamim | בירה פאולנר בק 500 מל 2 ב 19.90 | 2 for ₪19.90 | description + DiscountedPrice | everyone | published as a group |
| keshet-taamim | שישיית גולדסטאר סלוב בריו 330 מל ב 34.90 | ₪34.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה גולדסטאר חוזר 500 מל 3 ב 22.90 | 3 for ₪22.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה מכבי חוזר 500 מל 3 ב 20.90 | 3 for ₪20.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה היינקן חוזר 500 מל 3 ב 26.90 | 3 for ₪26.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה מכבי 7.9% חוזר בק 500 מל 3 ב 22.90 | 3 for ₪22.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה איגל פחית 500 מל 3 ב 19.90 | 3 for ₪19.90 | description + DiscountedPrice | everyone | published as a group |
| keshet-taamim | בירה לף/הוגרדן פח 500 מל 2 ב 22.90 | 2 for ₪22.90 | description + DiscountedPrice | everyone | published as a group |
| keshet-taamim | בירה בנדיקטינר/קונינג פח 500 מל 2 ב 18.9 | 2 for ₪18.90 | description + DiscountedPrice | everyone | published as a group |
| keshet-taamim | שישיית בירה היינקן 330 מל ב 34.90 | ₪34.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה מלכה/נגב 330 מל 2 ב 24.90 | 2 for ₪24.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | שישיית בירה מכבי שנדי 330 מל ב 27.90 | ₪27.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | רביעיית בירה היינקן 250 מל ב 17.90 | ₪17.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה קסטיל 330 מל 2 ב 22.90 | 2 for ₪22.90 | description + DiscountedPrice | everyone | published as a group |
| keshet-taamim | בירה קסטיל/ברבר 750 מל ב 29.90 | ₪29.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה טוכר סבאלדוס/ארדינגר 500 מ 2 ב 21.9 | 2 for ₪21.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה לבנה בנדיקטינר 330 מל 2 ב 14.90 | 2 for ₪14.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה רוזה 1664 בק 6*330 מל ב 39.90 | ₪39.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה ויינשטפן 500 מל 2 ב 21.90 | 2 for ₪21.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה דובל/צרי שוף/מרדסוס 330 מל 3 ב 32.9 | 3 for ₪32.90 | description + DiscountedPrice | everyone | published as a group |
| keshet-taamim | בירה ספטאן/בלו מון/פרנסיסקנר 2 ב 19.90 | 2 for ₪19.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה מלכה 750 מל ב 25.90 | ₪25.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | רביעיית בירה בלו מון 330 מל ב 34.90 | ₪34.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה שוף/לינדמנס/מרדסו 750 מל ב 24.90 | ₪24.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בנדיקטינר ללא אלכוהול 500 מל 2 ב 18.90 | 2 for ₪18.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה מילר 500 מל 2 ב 18.90 | 2 for ₪18.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה סטארופרמן פרמיום בק 500 מל 2 ב 19.9 | 2 for ₪19.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה קרומבאכר פחית 500 מל 2 ב 18.90 | 2 for ₪18.90 | description + DiscountedPrice | everyone | published as a group |
| keshet-taamim | בירה קרומבאכר פילס 330 מל שישיה ב 32.90 | ₪32.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה סטארופרמן פרמיום פחית 2 ב 17.90 | 2 for ₪17.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה לף/הוגרדן 330 מל 2 ב 14.90 | 2 for ₪14.90 | description + DiscountedPrice | everyone | published as a group |
| keshet-taamim | בירה סטלה פחית 500 מל 2 ב 14.90 | 2 for ₪14.90 | description + DiscountedPrice | everyone | published as a group |
| keshet-taamim | בירה קרלסברג 330 מל 2 ב 16.90 | 2 for ₪16.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה בלאנק 1664 בק 330 מל 2 ב 16.90 | 2 for ₪16.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה קורונה פחית 500 מל 2 ב 19.90 | 2 for ₪19.90 | description + DiscountedPrice | everyone | published |
| keshet-taamim | בירה טובורג/קרלסברג 500 מל 3 ב 24.90 | 3 for ₪24.90 | description + DiscountedPrice | everyone | published as a group |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | published |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | published |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | published |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | published |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | published |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | published |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | published |
| mahsanei | *בירה סטלה שישייה 300 מ"ל 2ב55ש | 2 for ₪55.00 | description + DiscountedPrice | everyone | published |
| mahsanei | *מכבי חזקה/גולדסטאר שישייה 330מ"ל 2ב60ש"ח | 2 for ₪60.00 | description + DiscountedPrice | everyone | published |
| mahsanei | *מכבי חזקה/גולדסטאר שישייה 330מ"ל 2ב60ש"ח | 2 for ₪60.00 | description + DiscountedPrice | everyone | published |
| mahsanei | *מכבי חזקה/גולדסטאר שישייה 330מ"ל 2ב60ש"ח | 2 for ₪60.00 | description + DiscountedPrice | everyone | published |
| mahsanei | *גולדסטאר UF בקבוק 330מל שישייה 2ב65ש | 2 for ₪65.00 | description + DiscountedPrice | everyone | published |
| mahsanei | *גולדסטאר WILD BATCH 330 מייל שישייה 2ב62ש | 2 for ₪62.00 | description + DiscountedPrice | everyone | published |
| mahsanei | *קרלסברג בירה 500 חוזר 3ב20ש | 3 for ₪20.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/היינקן סליק בירה 330מ"ל פחית 2ב12ש: | 2 for ₪12.00 | description + DiscountedPrice | everyone | published |
| mahsanei | ויינשטפן שישייה 330מ"ל 2ב120ש | 2 for ₪120.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/קרלסברג Luma שישיות} 330מ"ל ב35.90ש | ₪35.90 | description + DiscountedPrice | everyone | published |
| mahsanei | א/קרלסברג 500 פחית 2ב15ש | 2 for ₪15.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/קרלסברג 330מ"ל שישייה 2ב70ש | 2 for ₪70.00 | description + DiscountedPrice | everyone | published |
| mahsanei | היינקן סילק 330 שישייה 2ב70ש | 2 for ₪70.00 | description + DiscountedPrice | everyone | published |
| mahsanei | היינקן שישיה בקבוק 330 מייל ב34.90ש"ח: | ₪34.90 | description + DiscountedPrice | everyone | published |
| mahsanei | א/גולדסטאר SLOW BREW בקבוק 330 שישייה ב35.90ש | ₪35.90 | description + DiscountedPrice | everyone | published |
| mahsanei | בירה קרומבאכר 0.5ל בקבוק ב10ש | ₪10.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/בירה קורונה פחית 500מייל 3ב25ש | 3 for ₪25.00 | description + DiscountedPrice | everyone | published |
| mahsanei | בירה סטלה ארטואה 440מ"ל פחית 2ב20ש | 2 for ₪20.00 | description + DiscountedPrice | everyone | published |
| mahsanei | בירה לף/הוגרדן פחית 500מ"ל ב10ש | ₪10.00 | description + DiscountedPrice | everyone | published |
| mahsanei | בירה לף/הוגרדן פחית 500מ"ל ב10ש | ₪10.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/שישיית בירה 330מ"ל הוגרדן ב39.90ש"ח | ₪39.90 | description + DiscountedPrice | everyone | published |
| mahsanei | א/קרומבאכר בקבוק 330 מ"ל שישייה ב29.90ש | ₪29.90 | description + DiscountedPrice | everyone | published |
| mahsanei | קרומבאכר פחית בודד 0.5ל 2ב18ש | 2 for ₪18.00 | description + DiscountedPrice | everyone | published |
| mahsanei | קרומבאכר פחית בודד 0.5ל 2ב18ש | 2 for ₪18.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/מכבי/גולדסטאר 500מ"ל פחית 3ב20ש: | 3 for ₪20.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/מכבי/גולדסטאר 500מ"ל פחית 3ב20ש: | 3 for ₪20.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/מכבי/גולדסטאר 500מ"ל פחית 3ב20ש: | 3 for ₪20.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/בירה גולדסטאר לא מסונן פחית/היינקן 500מ"ל 2ב16ש | 2 for ₪16.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/בירה גולדסטאר לא מסונן פחית/היינקן 500מ"ל 2ב16ש | 2 for ₪16.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/בירה גולדסטאר לא מסונן פחית/היינקן 500מ"ל 2ב16ש | 2 for ₪16.00 | description + DiscountedPrice | everyone | published |
| mahsanei | היינקן 250מ"ל בקבוק רביעייה 4ב60ש מוגבל 2מנות: | 4 for ₪60.00 | description + DiscountedPrice | everyone | published |
| mahsanei | גולדסטאר 250מ"ל בקבוק רביעייה 3ב45ש מוגבל מנה ללקוח: | 3 for ₪45.00 | description + DiscountedPrice | everyone | published |
| mahsanei | גולדסטאר UF בקבוק 250מ"ל רביעייה 3ב50ש מוגבל 2מנות | 3 for ₪50.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/בירה שפירא 330מ"ל 3ב33ש"ח | 3 for ₪33.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/בירה שפירא 330מ"ל 3ב33ש"ח | 3 for ₪33.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/בירה שפירא 330מ"ל 3ב33ש"ח | 3 for ₪33.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/בירה שפירא 330מ"ל 3ב33ש"ח | 3 for ₪33.00 | description + DiscountedPrice | everyone | published |
| mahsanei | טובורג רד/גרין שישיה 330מ"ל 2ב60ש: | 2 for ₪60.00 | description + DiscountedPrice | everyone | published |
| mahsanei | טובורג רד/גרין שישיה 330מ"ל 2ב60ש: | 2 for ₪60.00 | description + DiscountedPrice | everyone | published |
| mahsanei | ^קרלסברג בקבוק 330 מ"ל 2ב12ש: | 2 for ₪12.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/איגל 2ב11ש חוזר 500מ"ל | 2 for ₪11.00 | description + DiscountedPrice | everyone | published |
| mahsanei | ^מכבי 4ב26ש 500מ"ל ! | 4 for ₪26.00 | description + DiscountedPrice | everyone | published |
| mahsanei | א/בירה קורונה שישייה 3ב99.90ש 3מנות | 3 for ₪99.90 | description + DiscountedPrice | everyone | published |
| mahsanei | א/בירה קורונה שישייה 3ב99.90ש 3מנות | 3 for ₪99.90 | description + DiscountedPrice | everyone | published |
| mahsanei | בירה גינס בקבוק 330מ"ל 4ב45ש"ח מוגבל 2מנות : | 4 for ₪45.00 | description + DiscountedPrice | everyone | published |
| mahsanei | בירה איגל 500מ"ל פחית 3ב18ש | 3 for ₪18.00 | description + DiscountedPrice | everyone | published |
| mahsanei | בירה איגל 500מ"ל פחית 3ב18ש | 3 for ₪18.00 | description + DiscountedPrice | everyone | published |
| osher-ad | שישיית בירה גולדסטאר / מכבי 2 ב 55 | 2 for ₪55.00 | description + DiscountedPrice | everyone | published as a group |
| osher-ad | שישיית בירה טובורג 29.9 מוג 3 | ₪29.90 | description + DiscountedPrice | everyone | published |
| osher-ad | בירה פחית הוגרדן 2 ב 18 | 2 for ₪18.00 | description + DiscountedPrice | everyone | published as a group |
| osher-ad | שישיית בירה קורונה 2 ב 65 | 2 for ₪65.00 | description + DiscountedPrice | everyone | published as a group |
| osher-ad | בירה מכבי/גולדסטאר 3 ב 20 | 3 for ₪20.00 | description + DiscountedPrice | everyone | published as a group |
| osher-ad | בירה סטלה פחית 2 ב 16- | 2 for ₪16.00 | description + DiscountedPrice | everyone | published |
| osher-ad | בירה פחית קורונה 2 ב 16 | 2 for ₪16.00 | description + DiscountedPrice | everyone | published |
| osher-ad | בירה ויינשטפן 2 ב 20 | 2 for ₪20.00 | description + DiscountedPrice | everyone | published |
| osher-ad | בירה קרומבאכר פחית 2 ב 16 | 2 for ₪16.00 | description + DiscountedPrice | everyone | published |
| osher-ad | בירה 500 מ ל היינקן 2 ב 17 | 2 for ₪17.00 | description + DiscountedPrice | everyone | published |
| osher-ad | בירה מכבי/גולדסטאר 3 ב 20 | 3 for ₪20.00 | description + DiscountedPrice | everyone | published as a group |
| osher-ad | בירה פחית הוגרדן 2 ב 18 | 2 for ₪18.00 | description + DiscountedPrice | everyone | published as a group |
| osher-ad | שישיית בירה קורונה 2 ב 65 | 2 for ₪65.00 | description + DiscountedPrice | everyone | published as a group |
| politzer | ויינשטפן 0.5 ליטר 2 ב 22.90- | 2 for ₪22.90 | description + DiscountedPrice | everyone | published |
| politzer | בירה פרנסיסקאנר בקבוק/ פחית 2 ב 24 | 2 for ₪24.00 | description + DiscountedPrice | everyone | published as a group |
| politzer | פחית בירה בלומון 2 ב 24 | 2 for ₪24.00 | description + DiscountedPrice | everyone | published |
| politzer | בירה לה/ מק/ צרי שוף 2 ב 23 | 2 for ₪23.00 | description + DiscountedPrice | everyone | published as a group |
| politzer | בקבוק/פחית בירה מלכה 2 ב 25 | 2 for ₪25.00 | description + DiscountedPrice | everyone | published as a group |
| politzer | בקבוק בירה נגב 2 ב 25 | 2 for ₪25.00 | description + DiscountedPrice | everyone | published |
| politzer | שישייה בירה באדוויזר ב 29.90 | ₪29.90 | description + DiscountedPrice | everyone | published |
| politzer | גולדסטאר שישייה ב-29.90 | ₪29.90 | description + DiscountedPrice | everyone | published |
| politzer | קרלסברג פחית 0.5 ליטר 2 ב 17.90- | 2 for ₪17.90 | description + DiscountedPrice | everyone | published |
| politzer | פחית לף בלונד/ הוגרדן 2 ב 22 | 2 for ₪22.00 | description + DiscountedPrice | everyone | published |
| politzer | בירה קורונה פחית 500 מ ל 2 ב 18 | 2 for ₪18.00 | description + DiscountedPrice | everyone | published |
| politzer | בירה מילר פחית 2 ב 20 | 2 for ₪20.00 | description + DiscountedPrice | everyone | published |
| politzer | בירה קרומבכר פחית/בקבוק 2 ב 20 | 2 for ₪20.00 | description + DiscountedPrice | everyone | published as a group |
| politzer | קרומבכר פילס שישייה ב 33.90 | ₪33.90 | description + DiscountedPrice | everyone | published |
| politzer | שישייה בירה מילר ב 33.90 | ₪33.90 | description + DiscountedPrice | everyone | published |
| politzer | שישייה בירה לף בלונד/ בראון ב 43.90 | ₪43.90 | description + DiscountedPrice | everyone | published |
| politzer | בירה אלכסנדר/ ג מס 2 ב 22 | 2 for ₪22.00 | description + DiscountedPrice | everyone | published |
| politzer | שישיה בירה הוגרדן ב 42.90- | ₪42.90 | description + DiscountedPrice | everyone | published |
| politzer | בירה קורונה שישייה ב 34.90 | ₪34.90 | description + DiscountedPrice | everyone | published |
| politzer | בירה סטלה שישייה 2 ב 65 | 2 for ₪65.00 | description + DiscountedPrice | everyone | published |
| rami-levy | בירה 500 מ ל איגל3ב15.90 כולל | 3 for ₪15.90 | description + DiscountedPrice | everyone | published |
| rami-levy | בירה קורונה שישייה 2ב65 כולל | 2 for ₪65.00 | description + DiscountedPrice | everyone | published |
| rami-levy | פחית בירה 500 מ ל קרלסברג/היינ 3ב25 כולל | 3 for ₪25.00 | description + DiscountedPrice | everyone | published as a group |
| rami-levy | שישיית בירה מכבי 6*330 מ ל ב27.50 כולל | ₪27.50 | description + DiscountedPrice | everyone | published |
| rami-levy | גולדסטאר פחית 500 מ ל 2ב13 כולל | 2 for ₪13.00 | description + DiscountedPrice | everyone | published as a group |
| rami-levy | בירה מכבי 500 מל 2ב13כולל | 2 for ₪13.00 | description + DiscountedPrice | everyone | published as a group |
| rami-levy | בירה מלכה 330 מ ל 2ב26 כולל | 2 for ₪26.00 | description + DiscountedPrice | everyone | published as a group |
| rami-levy | בירה לאגר קרלסברג בק330מל ב6.90 | ₪6.90 | description + DiscountedPrice | everyone | published |
| rami-levy | בירה גולדסטאר 4*250מ ל ב14.90 כולל | ₪14.90 | description + DiscountedPrice | everyone | published |
| rami-levy | שישיית בירה 6*330 מ ל באדוויזר 2ב65 כולל | 2 for ₪65.00 | description + DiscountedPrice | everyone | published |
| rami-levy | ויינשטפן 500מל 2ב20 כולל | 2 for ₪20.00 | description + DiscountedPrice | everyone | published |
| rami-levy | בירה אלכסנדר 330מל 2ב24 כולל | 2 for ₪24.00 | description + DiscountedPrice | everyone | published |
| rami-levy | קרומבכר פילס בק שישייה ב29.90 כולל | ₪29.90 | description + DiscountedPrice | everyone | published |
| rami-levy | קרומבכר בק 500מל 2ב18 כולל | 2 for ₪18.00 | description + DiscountedPrice | everyone | published |
| rami-levy | בירה קורונה/סטלה/קרונבכר/מילר 500מל 2ב16 | 2 for ₪16.00 | description + DiscountedPrice | everyone | published as a group |
| rami-levy | בירה לף בלונד/הוגארדן 500מל 2ב18 כולל | 2 for ₪18.00 | description + DiscountedPrice | everyone | published as a group |
| rami-levy | בירה שוף/דובל/מרדסו 330מל 2ב19.90 כולל | 2 for ₪19.90 | description + DiscountedPrice | everyone | published |
| rami-levy | בירה פרנסיסקאנר 500מל 2ב23.90 כולל | 2 for ₪23.90 | description + DiscountedPrice | everyone | published |
| rami-levy | בירה מילר בוק 330מל שישייה ב19.90 מו2 כו | ₪19.90 | description + DiscountedPrice | everyone | published |
| rami-levy | שישיית בירה גולדסטאר 29.90כולל | ₪29.90 | DiscountedPrice only | everyone | published |
| rami-levy | שישיית בירה 6*330 מ ל קרלסברג לומה ב35.9 | ₪35.90 | description + DiscountedPrice | everyone | published |
| rami-levy | בירה טובורג רד/גרין 6*330מ ל ב29.90 כולל | ₪29.90 | description + DiscountedPrice | everyone | published |
| rami-levy | סטרופארמן בק 330מל שישייה ב19.90 כולל | ₪19.90 | description + DiscountedPrice | everyone | published |
| rami-levy | בירה 6*330 מ ל קרלסברג ב29.90 כולל | ₪29.90 | description + DiscountedPrice | everyone | published |
| rami-levy | בירה גולדסטאר 4*250מ ל ב14.90 כולל | ₪14.90 | description + DiscountedPrice | everyone | published |
| rami-levy | שישיית גולדסטאר ב24.90 מעל 75 מו2 כולל | ₪24.90 | description + DiscountedPrice | everyone | published |
| shufersal | 2ב71.40 פקדון בירה סטלה ארטואה 6 * 330 מ | 2 for ₪71.40 | description + DiscountedPrice | everyone | published |
| shufersal | 2ב71.40 פקדון בירה קורונה 355*6 מ"ל | 2 for ₪71.40 | description + DiscountedPrice | everyone | published |
| shufersal | 3ב24.10 פקדון בירה קרלסברג בפחית500מ"ל | 3 for ₪24.10 | description + DiscountedPrice | everyone | published |
| shufersal | 2ב25.40 פקדון בירה ויינשטפן 500 מ"ל | 2 for ₪25.40 | description + DiscountedPrice | everyone | published |
| shufersal | 68.10 פקדון בירה ויינשטפן 330*6 מ"ל | ₪68.10 | description + DiscountedPrice | everyone | published |
| shufersal | 38.10 פקדון קרלסברג לומה 6בק* 330מל | ₪38.10 | description + DiscountedPrice | everyone | published |
| shufersal | 38.10 פקדון בירה אסטרייה דאם330*6מ | ₪38.10 | description + DiscountedPrice | everyone | published |
| shufersal | 2ב66.40 פקדון בירה באדוויזר 330*6 מ"ל | 2 for ₪66.40 | description + DiscountedPrice | everyone | published |
| shufersal | 2ב71.40 פקדון בירה הייניקן פח 330*6מ"ל | 2 for ₪71.40 | description + DiscountedPrice | everyone | published |
| shufersal | 32.10 פקדון הייניקן 0% אלכוהול330*6 | ₪32.10 | description + DiscountedPrice | everyone | published |
| shufersal | 3ב14.40 פקדון בירה איגל בקבוק חוזר500מ | 3 for ₪14.40 | description + DiscountedPrice | everyone | published |
| shufersal | 32.10 פקדון מכבי שנדי 330*6 מ"ל | ₪32.10 | description + DiscountedPrice | everyone | published |
| shufersal | 2ב29.40 פקדון בריזר/שפירא אייל 275-330 מ | 2 for ₪29.40 | description + DiscountedPrice | everyone | published |
| shufersal | 2ב61.40 פקדון בירה טובורג רד/גרין 330*6 | 2 for ₪61.40 | description + DiscountedPrice | everyone | published |
| shufersal | 38.10 פקדון גולדסטאר לא מסוננת/מכבי/היינ | ₪38.10 | description + DiscountedPrice | everyone | published |
| shufersal | 2ב24.40 פקדון בירה שוף/דובל/מרדסו/סן ברנ | 2 for ₪24.40 | description + DiscountedPrice | everyone | published as a group |
| shufersal | 2ב66.40 פקדון בירה קרלסברג בק330*6 מ"ל | 2 for ₪66.40 | description + DiscountedPrice | everyone | published |
| shufersal | 28.10 פקדון בירה גולדסטאר/בקס/מכבי 275X6 | ₪28.10 | description + DiscountedPrice | everyone | published |
| stop-market | ספקים שונים מארזי שישיית בירה 2ב60שח | 2 for ₪60.00 | description + DiscountedPrice | everyone | published as a group |
| stop-market | מבחר בירות 3ב30שח מחיר מכירה 11.90שח | 3 for ₪30.00 | description + DiscountedPrice | everyone | published as a group |
| stop-market | מבחר בירות 2ב55שח מחיר מכירה 29.90שח | 2 for ₪55.00 | description + DiscountedPrice | everyone | published as a group |
| stop-market | מבחר בירות 3ב20שח מחיר מכירה 7.90שח | 3 for ₪20.00 | description + DiscountedPrice | everyone | published as a group |
| stop-market | מבחר בירות 4ב30שח מחיר מכירה 8.90שח | 4 for ₪30.00 | description + DiscountedPrice | everyone | published as a group |
| stop-market | שלישיית טונה ריו ב22.90שח בקניה מעל100שח | ₪22.90 | description only | everyone | published |
| stop-market | מרק עוף קנור ר.ט ב15.90שח בקניה מעל100שח | ₪15.90 | description only | everyone | published |
| stop-market | דגני דליפקאן 400גר ב16.90שח בקניה מעל100 | ₪16.90 | description only | everyone | published |
| tiv-taam | בירה 31.9 | ₪31.90 | description + DiscountedPrice | everyone | published |
| tiv-taam | בירה 31.9 | ₪31.90 | description + DiscountedPrice | everyone | published |
| tiv-taam | בירה 35.9 | ₪35.90 | description + DiscountedPrice | everyone | published |
| tiv-taam | ויינשטפן 3 ב 33 | 3 for ₪33.00 | description + DiscountedPrice | everyone | published as a group |
| tiv-taam | בירה 2 ב 18 | 2 for ₪18.00 | description + DiscountedPrice | everyone | published |
| tiv-taam | בירה 35.9 | ₪35.90 | description + DiscountedPrice | everyone | published |
| tiv-taam | בירה 36.9 | ₪36.90 | description + DiscountedPrice | everyone | published |
| tiv-taam | בירה 35.9 | ₪35.90 | description + DiscountedPrice | everyone | published |
| tiv-taam | בירה 37.9 | ₪37.90 | description + DiscountedPrice | everyone | published |
| tiv-taam | בירה 2 ב 25 | 2 for ₪25.00 | description + DiscountedPrice | everyone | published as a group |
| tiv-taam | בירה 2 ב 22 | 2 for ₪22.00 | description + DiscountedPrice | everyone | published |
| tiv-taam | בירה 2 ב 18 | 2 for ₪18.00 | description + DiscountedPrice | everyone | published as a group |
| tiv-taam | בירה 2 ב 15 | 2 for ₪15.00 | description + DiscountedPrice | everyone | published as a group |
| tiv-taam | שישיית בירה 39.9 | ₪39.90 | description + DiscountedPrice | everyone | published |
| tiv-taam | בירה 2 ב 24 | 2 for ₪24.00 | description + DiscountedPrice | everyone | published as a group |
| tiv-taam | היינקן 19.9 | ₪19.90 | description + DiscountedPrice | everyone | published |
| tiv-taam | שישיית בירה 34.9 | ₪34.90 | description + DiscountedPrice | everyone | published |
| tiv-taam | שישיית בירה 29.9 | ₪29.90 | description + DiscountedPrice | everyone | published |
| victory | 31.90בירה בקס מארז שישייה | ₪31.90 | DiscountedPrice only | everyone | published |
| victory | 11.90בירה ויינשטפן 500 מ"ל | ₪11.90 | DiscountedPrice only | everyone | published |
| victory | 64.90בירה ויינשטפן 330 מ"ל מארז שישייה | ₪64.90 | DiscountedPrice only | everyone | published |
| victory | 36.90בירה טובורג 330 מ"ל מארז שישייה | ₪36.90 | DiscountedPrice only | everyone | published |
| victory | 32.90בירה גולדסטאר 330 מל בקבוק מארז שישייה | ₪32.90 | DiscountedPrice only | everyone | published |
| victory | 33.90בירה מכבי 330 מ"ל מארז שישייה | ₪33.90 | DiscountedPrice only | everyone | published |
| victory | 34.90בירה הייניקן 330 מ"ל מארז שישייה | ₪34.90 | DiscountedPrice only | everyone | published |
| victory | 9.90קרומבאכר חיטה בקבוק בודד 500 מ"ל | ₪9.90 | DiscountedPrice only | everyone | published |
| victory | 34.90בירה קורונה שישייה | ₪34.90 | DiscountedPrice only | everyone | published |
| victory | 2ב17בירה הייניקן פחית 500 מ"ל | 2 for ₪17.00 | description + DiscountedPrice | everyone | published |
| victory | 15.90בירה הייניקן/גולדסטאר 250 מ"ל מארז רביעייה | ₪15.90 | DiscountedPrice only | everyone | published |
| victory | 15.90בירה הייניקן/גולדסטאר 250 מ"ל מארז רביעייה | ₪15.90 | DiscountedPrice only | everyone | published |
| victory | 2ב15בירה גולדסטאר לא מסוננת (500 מל) | 2 for ₪15.00 | description + DiscountedPrice | everyone | published |
| victory | 2ב14בירה גולדסטאר פחית 500 מ"ל | 2 for ₪14.00 | description + DiscountedPrice | everyone | published |
| victory | 2ב65בירה מכבי 7.9% 330 מ"ל מארז שישייה | 2 for ₪65.00 | description + DiscountedPrice | everyone | published |
| victory | 2ב15גולדסטאר SLOWBRE פחית 500 מל | 2 for ₪15.00 | description + DiscountedPrice | everyone | published |
| victory | 2ב70בירה גולדסטאר 330 מ"ל מארז שישייה-לא מסוננת/סלו ברו | 2 for ₪70.00 | description + DiscountedPrice | everyone | published |
| victory | 2ב70בירה גולדסטאר 330 מ"ל מארז שישייה-לא מסוננת/סלו ברו | 2 for ₪70.00 | description + DiscountedPrice | everyone | published |
| victory | 11.90בירה פאולנר 500 מ"ל בקבוק | ₪11.90 | DiscountedPrice only | everyone | published |
| victory | 2ב14בירה מכבי 7.9% 500 פחית | 2 for ₪14.00 | description + DiscountedPrice | everyone | published |
| victory | 2ב18בירה קרלסברג 500 מ"ל פחית | 2 for ₪18.00 | description + DiscountedPrice | everyone | published |
| victory | 2ב65בירה סטלה ארטואה 330 מ"ל מארז שישייה | 2 for ₪65.00 | description + DiscountedPrice | everyone | published |
| victory | 3ב22בירה לף בלונד/בראון/הוגרדן 330 מ"ל | 3 for ₪22.00 | description + DiscountedPrice | everyone | published |
| victory | 3ב25בירה פחית מילר/סטארופרמן/קרומבכר/סטלה/קורונה | 3 for ₪25.00 | description + DiscountedPrice | everyone | published |
| victory | 3ב25בירה פחית מילר/סטארופרמן/קרומבכר/סטלה/קורונה | 3 for ₪25.00 | description + DiscountedPrice | everyone | published |
| victory | 3ב25בירה פחית מילר/סטארופרמן/קרומבכר/סטלה/קורונה | 3 for ₪25.00 | description + DiscountedPrice | everyone | published |
| victory | 3ב25בירה פחית מילר/סטארופרמן/קרומבכר/סטלה/קורונה | 3 for ₪25.00 | description + DiscountedPrice | everyone | published |
| victory | 3ב25בירה פחית מילר/סטארופרמן/קרומבכר/סטלה/קורונה | 3 for ₪25.00 | description + DiscountedPrice | everyone | published |
| yochananof | בירה בנדקטינר | 2 for ₪20.00 | DiscountedPrice only | everyone | published as a group |
| yochananof | בירה קרלסברג/הייניקן פחית | 3 for ₪20.00 | DiscountedPrice only | everyone | published as a group |
| yochananof | בירה מלכה | 2 for ₪26.00 | DiscountedPrice only | everyone | published |
| yochananof | בירה שוף/מרדסו/דובל/ליפמנס/בלומון | 2 for ₪20.00 | DiscountedPrice only | everyone | published |
| yochananof | בירה סטלה פחית 440 מ"ל | 2 for ₪16.00 | DiscountedPrice only | everyone | published |
| yochananof | הייניקן שישייה | ₪34.90 | DiscountedPrice only | everyone | published |
| yochananof | הייניקן/גולדסטאר רביעייה | ₪14.90 | DiscountedPrice only | everyone | published |
| yochananof | בירה איגל | 2 for ₪11.00 | DiscountedPrice only | everyone | published |
| yochananof | בירה לף בלונד | 6 for ₪30.00 | DiscountedPrice only | everyone | published |
| yochananof | בירה גולדסטאר לא מסונן פחית 500 מ"ל | 2 for ₪15.00 | DiscountedPrice only | everyone | published |
| yochananof | קורונה שישייה | 2 for ₪65.00 | DiscountedPrice only | everyone | published |
| yochananof | בירה ויינשטפן 500 מ"ל | 2 for ₪20.00 | DiscountedPrice only | everyone | published |
| yochananof | קרלסברג לא מסונן שישייה | ₪35.90 | DiscountedPrice only | everyone | published |
| yochananof | גולדסטאר/מכבי פחית | 2 for ₪14.00 | DiscountedPrice only | everyone | published as a group |
| yochananof | שנדי שישייה | ₪27.90 | DiscountedPrice only | everyone | published |
| yochananof | פחית בירה הוגארדן/לף 500 מ"ל | 2 for ₪18.00 | DiscountedPrice only | everyone | published as a group |
| yochananof | שישיית בירה סטלה | ₪24.90 | DiscountedPrice only | everyone | published |
| yochananof | קרלסברג/טובורג שישייה | ₪29.90 | DiscountedPrice only | everyone | published |
| yochananof | גולדסטאר שישייה | 2 for ₪55.00 | DiscountedPrice only | everyone | published |
| yochananof | בירה גולדסטאר לא מסונן שישייה | ₪29.90 | DiscountedPrice only | everyone | published |
| yochananof | שישיית בירה באדוויזר 330 מ"ל | 2 for ₪65.00 | DiscountedPrice only | everyone | published |
| carrefour | קופון פיצוי לקוח גולדסטאר 330 מל שישייה | excluded | — | coupon | excluded |
| carrefour | קופון פיצוי לקוח היינקן 330 מל שישייה | excluded | — | coupon | excluded |
| yeinot-bitan | קופון פיצוי לקוח גולדסטאר 330 מל שישייה | excluded | — | coupon | excluded |
| yeinot-bitan | קופון פיצוי לקוח היינקן 330 מל שישייה | excluded | — | coupon | excluded |
| carrefour | קופון פיצוי לקוח גולדסטאר 330 מל שישייה | excluded | — | coupon | excluded |
| carrefour | קופון פיצוי לקוח היינקן 330 מל שישייה | excluded | — | coupon | excluded |
| keshet-taamim | בירה בלטס/אקסטרא 568 מל 2 ב 14.90 | 2 for ₪14.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | בירה אובולון 1 ל ב 11.90 | ₪11.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | בירה קלה בטעמים 500 מל 2 ב 14.90 | 2 for ₪14.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | בירה אובולון ללא אלכוהול 500 מ 2 ב 14.90 | 2 for ₪14.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | בירה לביבסקה ללא אלכוהול 450 מל 2 ב 14.9 | 2 for ₪14.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | בירה לביבסקה בהירה 480 מל 2 ב 15.90 | 2 for ₪15.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | בירה אובולון פחית 500 מל 2 ב 15.90 | 2 for ₪15.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | בירה אובולון חזקה פח 500 מל 2 ב 15.90 | 2 for ₪15.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | בירה אוטקרינגר 500 מל 2 ב 16.90 | 2 for ₪16.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | בירה וייס ברג/לש/מאזאי 440 מל 2 ב 14.90 | 2 for ₪14.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | בירה בהירה וייס ברג/לש 450 מל 3 ב 19.90 | 3 for ₪19.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | בירה לבובסקי בק 450 מל 2 ב 17.90 | 2 for ₪17.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | בירה לבובסקי פרמיום בק 500 מל 2 ב 17.90 | 2 for ₪17.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | רוברט דומס/אריה/לביבסקה 500 מל 2 ב 21.90 | 2 for ₪21.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | בירה לביבסקה 1715 פח 480 מל 2 ב 15.90 | 2 for ₪15.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | בירה אובולון חזקה פח 500 מל 2 ב 16.90 | 2 for ₪16.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| keshet-taamim | בירה קייקי/קזבגי 500 מל ב 9.90 | ₪9.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| rami-levy | קופון גולדסטאר 330מל שישייה בק במתנה | excluded | — | coupon | excluded |
| rami-levy | קופון הייניקן 330מל בק/ שישייה במתנה | excluded | — | coupon | excluded |
| tiv-taam | קופון מנוהל חדש 50 מעל 249 | excluded | — | coupon | excluded |
| tiv-taam | בירה גרלסבורג 2 ב 15 מועדון | 2 for ₪15.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 12.9 ש"ח מועדון | 2 for ₪12.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה סיארה נאבדה 2 ב 25 מועדון | 2 for ₪25.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 24.9 מועדון | 2 for ₪24.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 3 ב 25.9 מועדון | unmapped | — | club | held: description says 3 for ₪25.90, DiscountedPrice says 3 for ₪25.00 |
| tiv-taam | בירה 2 ב 17.9 מועדון | 2 for ₪17.90 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 2 ב 20 מועדון | 2 for ₪20.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 20 מועדון | 2 for ₪20.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 22.9 מועדון | 2 for ₪22.90 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 3 ב 35.9 מועדון | 3 for ₪35.90 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 2 ב 25.9 מועדון | 2 for ₪25.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 28.9 מועדון | 2 for ₪28.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 33.9 מועדון | 2 for ₪33.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 35.9 מועדון | ₪35.90 | description + DiscountedPrice | club | held: club members only |
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
| tiv-taam | בירה 2 ב 22 מועדון | 2 for ₪22.00 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 4 ב 25.9 - מועדון | 4 for ₪25.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 19.90 - מועדון | 2 for ₪19.90 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 2 ב 22 - מועדון | 2 for ₪22.00 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 2 ב 25.9 - מועדון | 2 for ₪25.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 15.90 - מועדון | ₪15.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 39.90 - מועדון | ₪39.90 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 3 ב 19.9 מועדון | 3 for ₪19.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 21 מועדון | 2 for ₪21.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 20 מועדון | 2 for ₪20.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 18 מועדון | 2 for ₪18.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 29.9 מועדון | ₪29.90 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 2 ב 50 מועדון | 2 for ₪50.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 20 - מועדון | 2 for ₪20.00 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 35.9 - מועדון | ₪35.90 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 32.9 - מועדון | ₪32.90 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 32.9 - מועדון | ₪32.90 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 2 ב 25 - מועדון | 2 for ₪25.00 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 2 ב 22 - מועדון | 2 for ₪22.00 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 2 ב 24 - מועדון | 2 for ₪24.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 24 - מועדון | 2 for ₪24.00 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 42.9 - מועדון | ₪42.90 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 2 ב 22.9 - מועדון | 2 for ₪22.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 22.9 - מועדון | 2 for ₪22.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 26.9 - מועדון | 2 for ₪26.90 | description + DiscountedPrice | club | held: club members only |
| tiv-taam | בירה 2 ב 30 - מועדון | 2 for ₪30.00 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 3 ב 18.9 - מועדון | 3 for ₪18.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 14.9 - מועדון | 2 for ₪14.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | רביעיית בירה ב 25.90 - מועדון | ₪25.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה ב 9.90 - מועדון | ₪9.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 16.90 - מועדון | 2 for ₪16.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 16.9 מועדון | 2 for ₪16.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | שישיית בירה 39.9 מועדון | ₪39.90 | description + DiscountedPrice | club | held: none of its items is a pack we could read |
| tiv-taam | בירה 11.9 מועדון | ₪11.90 | description + DiscountedPrice | club | held: club members only |
| carrefour | בירה קרפור סנשיין/בירה אדומה 330 מ ל | 3 for ₪20.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| carrefour | בירה 6*250 מ לWalbergem | ₪19.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| carrefour | בירה 6*250 מ לBRAUSAER | 2 for ₪30.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yeinot-bitan | בירה קרפור סנשיין/בירה אדומה 330 מ ל | 3 for ₪20.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yeinot-bitan | בירה 6*250 מ לWalbergem | ₪19.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yeinot-bitan | בירה 6*250 מ לBRAUSAER | 2 for ₪30.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| carrefour | בירה 6*250 מ לWalbergem | ₪19.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| carrefour | בירה 6*250 מ לBRAUSAER | 2 for ₪30.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| carrefour | בירה קרפור סנשיין/בירה אדומה 330 מ ל | 3 for ₪20.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| ampm | מבצע 1/6 בירה אסטרייה דאם ב 49.90 שח | ₪49.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע בירה שקמה 330 מ ל 2 יח ב 26.90 שח | 2 for ₪26.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע 1/4 בירה פאולנר בקבוק ב 39.90 שח | ₪39.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע 1/4 גולדסטאר/הייניקן 2250ב45שח | unmapped | — | everyone | held: description says 50 for ₪45.00, DiscountedPrice says 2 for ₪45.00 |
| ampm | מבצע בירה סאן מיגל אספסיאל 2 ב 16 שח | 2 for ₪16.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע בירה סאן מיגל אספסיאל 500מל 2 ב17.9 | 2 for ₪17.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| ampm | מבצע 1/4 בירה סאן מיגל אספסיאל ב 24.90שח | ₪24.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| fresh-market | בירה שנדי מארז ב33.90 | ₪33.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| fresh-market | בירה אלכסנדר/גיימס 2 ב28 | 2 for ₪28.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| fresh-market | בירה ואן פור/מולר 3 ב14 | 3 for ₪14.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| fresh-market | בירה קוניגסבכר 2 ב15 | 2 for ₪15.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | בירה שקמה 2 יח ב-18 ש"ח | 2 for ₪18.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | בירה ליפמנס און דה רוקס 2 ב 18 ש"ח | 2 for ₪18.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | פחית בירה פילזנר 500 מ"ל 3ב19.90 | 3 for ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | פחית בירה צ'סו 568מ"ל 2ב 16.90 | 2 for ₪16.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| hatzi-hinam | מגוון בירות וולפאס 2 ב 19.90 ש"ח | 2 for ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה קוזל כהה בק 500 מל 2 ב 17.90 | 2 for ₪17.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | רביעיית בירה ליפמנס 250 מל ב 44.90 | ₪44.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה ברודוג פחית 330 מל 2 ב 25.90 | 2 for ₪25.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה פרנסיסקנר בהירה בק 500 מל 3 ב 24.90 | 3 for ₪24.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה לינדמנס 250 מל 1+1 | unmapped | — | everyone | held: no price in the description and no DiscountedPrice |
| keshet-taamim | בירה בלטיקה 400-500 מל 2 ב 15.90 | 2 for ₪15.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | מארז קרומבאכר 5 פחיות 500 מל+כוס ב 39.90 | ₪39.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה סנט עומר לאגר בלונד 2505% מל ב 4.9 | ₪4.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה בלטיקה 900 מל ב 12.90 | ₪12.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בלטיקה ללא אלכוהול 450-500 מל 3 ב 19.90 | 3 for ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה ברלינר קינדל פילסנר 500 מל 2 ב 14.9 | 2 for ₪14.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה שופרהופר 500 מל 2 ב 15.90 | 2 for ₪15.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה סנט עומר בלונד 250 מל 10 בק ב 39.90 | ₪39.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה קראפט רד/סטים בריו 500 מל 1+1 | unmapped | — | everyone | held: no price in the description and no DiscountedPrice |
| keshet-taamim | בירה ביטבורגר/ווילדר לאגר 500 מ 3 ב 19.9 | 3 for ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | שישייה בירה פרוני 330 מל ב 29.90 | ₪29.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה שקמה בק 330 מל 2 ב 22.90 | 2 for ₪22.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה ויינשטפן בק 500 מל 2 ב 21.90 | 2 for ₪21.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה מרטנס 500 מל 4 ב 24.90 | 4 for ₪24.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה אובולון/הייק 500 מל 3 ב 19.90 | 3 for ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה ברלינר 500 מל 2 ב 14.90 | 2 for ₪14.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | שישייה בירה ביטבורגר 330 מל ב 29.90 | ₪29.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה ביטבורגר פח 500 מל 2 ב 14.90 | 2 for ₪14.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה קרושוביצה פח 500 מל 2 ב 18.90 | 2 for ₪18.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה רוברט דומס 500 מל 2 ב 17.90 | 2 for ₪17.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה פילזנר/וויסביר פח 500 מל 3 ב 19.90 | 3 for ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | מגוון בירות 500 מל 2 ב 33.90 | 2 for ₪33.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה וולפאס אנגלמן 500-568 מל 2 ב 19.90 | 2 for ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה פרימטור וויצן 500 מל 2 ב 21.90 | 2 for ₪21.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה אייל חיטה ללא אלכ 500 מל 2 ב 13.90 | 2 for ₪13.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה אותינגר סופרפורטה 500 מל 2 ב 14.90 | 2 for ₪14.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה סטאמגסט פח 500 מל 2 ב 14.90 | 2 for ₪14.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה צסו 568 מל 2 ב 16.90 | 2 for ₪16.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה זיגולי 450 מל 2 ב 15.90 | 2 for ₪15.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה סופריאור 500 מל 2 ב 14.90 | 2 for ₪14.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | מגוון בירות 500 מל 3 ב 14.90 | 3 for ₪14.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה קוניגסבכר חיטה 500 מל 3 ב 19.90 | 3 for ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | רדלר אוטקרינגר ללא אלכוהול 500 מ 2 ב11.9 | 2 for ₪11.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | מגוון בירות 568 מל 2 ב 15.90 | 2 for ₪15.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | רביעיית בירה מורטי 330 מל ב 29.90 | ₪29.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | רביעיית בירה גולדסטאר 250 מל ב 17.90 | ₪17.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה אותינגר 500 מל 3 ב 15.90 | 3 for ₪15.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה ברבר 330 מל 2 ב 22.90 | 2 for ₪22.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה טוכר הלס/אדלוויס 500 מל 2 ב 19.90 | 2 for ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה באדוויזר פחית 500 מל 2 ב 14.90 | 2 for ₪14.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה בלאנש 330 מל 2 ב 16.90 | 2 for ₪16.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | רביעיית בירה פאולנר 330 מל ב 32.90 | ₪32.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה זיגולי ללא אלכוהול 450 מל 2 ב 14.90 | 2 for ₪14.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה אייל חיטה אפוסטל ברו פח 2 ב 17.90 | 2 for ₪17.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה לא מסוננת וייס ברג 450 מל 2 ב 10.90 | 2 for ₪10.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה בוצונוק מלניק 4504.3% מל 2 ב 17.90 | 2 for ₪17.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה לה טראפ 330 מל 2 ב 25.90 | 2 for ₪25.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה לה טראפ נטול אלכוהול 330 מ 2 ב 21.9 | 2 for ₪21.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה קראפט 450 מל 2 ב 21.90 | 2 for ₪21.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה חזקה אולבי 500 מל 2 ב 23.90 | 2 for ₪23.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בקניה 3 בירה אורייך 500 מל ציפר 6 שח | 3 for ₪6.01 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בקניה 3 בירה קרומבאכר 500 מל ציפר 11 שח | 3 for ₪11.01 | DiscountedPrice only | everyone | held: ₪7.34 per litre is implausibly low |
| keshet-taamim | בירה הופייגר 500 מל 3 ב 19.90 | 3 for ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה טאורס 568 מל 2 ב 16.90 | 2 for ₪16.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה טאורס/קראפט 500-568 מל 2 ב 18.90 | 2 for ₪18.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה סאליוונס פחית 440 מל 2 ב 29.90 | 2 for ₪29.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה אייפי סיירה נבדה 355 מל 2 ב 24.90 | 2 for ₪24.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה פול מון 330-490 מל 2 ב 22.90 | 2 for ₪22.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה פילסנר/סטפאנס בראו 500 מל 2 ב 14.90 | 2 for ₪14.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה אובולון סופר סטרונג 500 מל 2 ב 16.9 | 2 for ₪16.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| keshet-taamim | בירה קוזל כהה/לאגר 500 מל 2 ב 16.90 | 2 for ₪16.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה בקבוק 330/500מ"ל המשתתפים 3ב33ש | 3 for ₪33.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | *בירה סטלה שישייה 300 מ"ל 2ב55ש | 2 for ₪55.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | *בירה מורטי/פאולנר 330מ"ל רביעייה 2ב59.90ש | 2 for ₪59.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | *בירה מורטי/פאולנר 330מ"ל רביעייה 2ב59.90ש | 2 for ₪59.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | *שנדי 330מ"ל שישיה 2ב50ש | 2 for ₪50.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | *שנדי 330מ"ל שישיה 2ב50ש | 2 for ₪50.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | *שנדי 330מ"ל שישיה 2ב50ש | 2 for ₪50.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה בקבוק קוניגסבכר 500מ"ל 3ב18ש | 3 for ₪18.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | שישיית בירה סינגה 325מ"ל ב29.90ש | ₪29.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה מילר/סטארופרמן פחית בודד 0.5ל 3ב25ש | 3 for ₪25.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | א/שישיית בירה לף 330מ"ל ב39.90ש | ₪39.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה מילר/סטארופרמן בקבוק 330מ"ל שישייה 2ב60ש | 2 for ₪60.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה מילר/סטארופרמן בקבוק 330מ"ל שישייה 2ב60ש | 2 for ₪60.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | סן מיגל פחית 500מ"ל 2ב18ש | 2 for ₪18.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה 3ב10ש 500מ"ל בקבוק: | 3 for ₪10.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה ליפמנס און דה רוקס 250מ"ל ב4.90 מוגבל ל24יח* | ₪4.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | בירה סאן מיגל רביעייה 330 מ"ל ב17.90ש: | ₪17.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| mahsanei | הצגת תעדה זהות | excluded | — | everyone | excluded |
| osher-ad | שישיית בירה סטלה 24.9 מוג 2 | ₪24.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| osher-ad | בירה מולר 500 מ ל 3 ב 10- | 3 for ₪10.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| osher-ad | בירה קורונה 355 מ ל 2 ב 13 | 2 for ₪13.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| politzer | בקבוק בירה דובל/לינדמנס/מרדסו 2 ב 23 | 2 for ₪23.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| politzer | גולדסטאר 500 מ ל פחית 2-ב-13.90 | unmapped | — | everyone | held: description says ₪13.90, DiscountedPrice says 2 for ₪13.90 |
| politzer | מארז שישיה בקבוקי אסטרייה ב 36.90- | ₪36.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| politzer | גולדסטאר לא מסונן פחית 500 מ ל 2-ב-16 | unmapped | — | everyone | held: description says ₪16.00, DiscountedPrice says 2 for ₪16.00 |
| politzer | הייניקן 500 מ ל פחית 2-ב-16.90 | unmapped | — | everyone | held: description says ₪16.90, DiscountedPrice says 2 for ₪16.90 |
| politzer | בירה מכבי 500 מ ל פחית 2-ב-13.90 | unmapped | — | everyone | held: description says ₪13.90, DiscountedPrice says 2 for ₪13.90 |
| politzer | שמרי בירה פתיתים תבואות ב-19.90 | ₪19.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| politzer | קרלסברג בק שישיה ב 29.90- | ₪29.90 | description + DiscountedPrice | everyone | not in force |
| politzer | טובורג שישיה בק 330 ב 29.90- | unmapped | — | everyone | not in force |
| politzer | שישייה בירה סטארופרמן ב 33.90 | ₪33.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה פילזנר פחית 500 מ ל 2ב13כולל | 2 for ₪13.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה אנגלמן 500-568 מ ל 2ב19 כולל | 2 for ₪19.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה קורונה בודד 2ב12.90 כולל | 2 for ₪12.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה ואן פור 500 מ ל 3ב11 כולל | 3 for ₪11.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה מולר 500 מ ל 3ב10 כולל | 3 for ₪10.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | פחית בירה צסו 568 מ ל 2ב16.90 כולל | 2 for ₪16.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| rami-levy | בירה הייניקן 4*250מ ל ב15.90כולל | unmapped | — | everyone | held: description says ₪15.90, DiscountedPrice says ₪15.30 |
| rami-levy | בירה שנדי 6*330מ ל ב27.90 כולל | ₪27.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 2ב34.40 פקדון בירה גינס פחית 440 מ"ל | 2 for ₪34.40 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 38.70 פקדון בירה פאולנר 330*4 מ"ל | ₪38.70 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 2ב25.40 פקדון בירה מרפיס סטאוט 500 מ"ל | 2 for ₪25.40 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 2ב24.40 פקדון בירה פאולנר חיטה פחית500 | 2 for ₪24.40 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 3ב31.10 פקדון בירה פייל אייל 568 מ"ל | 3 for ₪31.10 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| shufersal | 3ב16.4פקדון בירה מצוננת בקבוק 500 מ"ל | 3 for ₪16.40 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| stop-market | מבחר בירות 3ב35שח מחיר מכירה 12.90שח | excluded | — | everyone | excluded |
| stop-market | מבחר בירות 2ב25שח מחיר מכירה 14.90שח | excluded | — | everyone | excluded |
| stop-market | צלחות שלי דקל ב6.90שח בקניה מעל100שח | ₪6.90 | description only | everyone | held: ₪3.48 per litre is implausibly low |
| stop-market | מבחר בירות 3ב25שח מחיר מכירה 9.90שח | excluded | — | everyone | excluded |
| stop-market | מבחר בירות 2ב30שח מחיר מכירה 16.90שח | excluded | — | everyone | excluded |
| stop-market | מבחר בירות 2ב60שח מחיר מכירה 35שח | 2 for ₪60.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| stop-market | אטריות מאסטר 400 גר 4ב10שח בקניה מעל100ש | 4 for ₪10.00 | description only | everyone | held: ₪1.26 per litre is implausibly low |
| stop-market | שקדי מרק מנה 400גר ב6.90שח בקניה מעל 100 | ₪6.90 | description only | everyone | held: ₪3.48 per litre is implausibly low |
| stop-market | חליטות הגן קסום ב12.90שח בקניה מעל100שח | excluded | — | everyone | excluded |
| stop-market | עוגיות עבאדי 400גר ב11.90שח בקניה מעל100 | ₪11.90 | description only | everyone | held: ₪6.01 per litre is implausibly low |
| stop-market | קטשופ היינץ 700גר ב9.90שח בקניה מעל 100 | ₪9.90 | description only | everyone | held: ₪5.00 per litre is implausibly low |
| stop-market | שישייה פחיות פפסי ב12.90שח בקניה מעל100ש | excluded | — | everyone | excluded |
| stop-market | שישיית בירה מילר ב19.90שח בקניה מעל100שח | unmapped | — | everyone | held: description says ₪19.90, DiscountedPrice says ₪18.10 |
| stop-market | חומוס אחלה 600גר ב7.90שח בקניה מעל100שח | ₪7.90 | description only | everyone | held: ₪3.99 per litre is implausibly low |
| stop-market | טמפו#שישיית מכבי שנדי 2ב55שח | 2 for ₪55.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| stop-market | טמפו#מארז רביעיית בירה פאולנר 330מל 34.9 | ₪34.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| stop-market | יורוסטנדרט משקה בריטוויק 5ב25שח | 5 for ₪25.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה 37.90 | ₪37.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה 2 ב 22.9 | 2 for ₪22.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה ב- 34.90 | ₪34.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה 39.9 | ₪39.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | בירה 34.9 | ₪34.90 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| tiv-taam | קראביס פטל 2 ב 14 | 2 for ₪14.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| victory | 2ב16בירה ליפמנס און דה רוקס 250 מ"ל | 2 for ₪16.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| victory | 29.90בירה מכבי שנדי 330 מ"ל מארז שישייה | ₪29.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| victory | 29.90בירה מכבי שנדי 330 מ"ל מארז שישייה | ₪29.90 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| victory | מארז בירה קרלסבר שישייה מוגבל 2 | ₪100.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| victory | 3ב22בירה לף בלונד/בראון/הוגרדן 330 מ"ל | 3 for ₪22.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| victory | 3ב22בירה לף בלונד/בראון/הוגרדן 330 מ"ל | 3 for ₪22.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| victory | 3ב25בירה פחית מילר/סטארופרמן/קרומבכר/סטלה/קורונה | 3 for ₪25.00 | description + DiscountedPrice | everyone | held: none of its items is a pack we could read |
| yochananof | בירה לבנה 5.4% בפחית 568 מ"ל | 2 for ₪17.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | בירה פילזנר פחית 500 מ"ל | 3 for ₪20.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |
| yochananof | בירה ואן פור/מולר | 3 for ₪11.00 | DiscountedPrice only | everyone | held: none of its items is a pack we could read |

## Unresolved products (why each one was not priced)

* 15 × the same barcode reads differently — carrefour: tuborg-red #×# can / yeinot-bitan: tuborg-red #×# can / carrefour: tuborg-red #×# can / ampm: tuborg #×# can / hatzi-hinam: tuborg-r
* 12 × which alexander beer? the name names no known variant
* 10 × the same barcode reads differently — carrefour: weihen ויטוס #×# bottle / carrefour: weihen ויטוס #×# bottle / hatzi-hinam: weihen ויטוס #×# bottle / keshet-taamim: weihen ויטוס #×
* 9 × the same barcode reads differently — yeinot-bitan: corona #×# bottle / carrefour: corona #×# bottle / ampm: corona #×# bottle / keshet-taamim: corona #×# / osher-ad: corona #×# / r
* 8 × which negev beer? the name names no known variant
* 8 × the same barcode reads differently — keshet-taamim: paulaner #×# / mahsanei: paulaner חיטה #×# / rami-levy: paulaner חיטה #×# / shufersal: paulaner חיטה #×# can / stop-market: paul
* 7 × the same barcode reads differently — ampm: paulaner #×# / keshet-taamim: paulaner #×# / mahsanei: paulaner חיטה #×# bottle / osher-ad: paulaner #×# bottle / shufersal: paulaner #×#
* 7 × the same barcode reads differently — ampm: guinness #×# can / hatzi-hinam: guinness #×# can / keshet-taamim: guinness #×# can / mahsanei: guinness #×# can / politzer: guinness #×# 
* 6 × which malka beer? the name names no known variant
* 6 × the same barcode reads differently — carrefour: maccabee שנדי לימון ליים radler #×# / carrefour: maccabee שנדי לימון ליים radler #×# / politzer: maccabee שנדי radler #×# bottle / s
* 4 × which shapiro beer? the name names no known variant
* 4 × volume unknown; container unknown
* 4 × pack size unknown
* 4 × the same barcode reads differently — keshet-taamim: malka בהירה #×# / politzer: malka בהירה #×# / stop-market: malka סטאוט #×# / tiv-taam: malka בהירה #×#
* 4 × # different items at this branch read as the same pack (…, …) — an unlisted variant
* 2 × which kasteel beer? the name names no known variant
* 2 × volume unknown; pack size unknown; container unknown
* 2 × the same barcode reads differently — ampm: paulaner #×# bottle / tiv-taam: paulaner #×# bottle
* 1 × pack size unknown; container unknown
* 1 × volume unknown; pack size unknown

Examples:

| Retailer | Code | Shelf name | Why |
| --- | --- | --- | --- |
| ampm | 7290012921636 | פחית בירה מלכה אדמונ | which malka beer? the name names no known variant |
| ampm | 7290013430250 | בירה אלכסנדר חיטה יש | which alexander beer? the name names no known variant |
| ampm | 7290013430625 | בירה אלכסנדר לאגר | which alexander beer? the name names no known variant |
| fresh-market | 7290019443124 | בקבוק בירה נגב אואזי | which negev beer? the name names no known variant |
| fresh-market | 7290013430250 | בירה אלכסנדר חיטה יש | which alexander beer? the name names no known variant |
| fresh-market | 7290017925363 | בירה נגב פאטה מורגה | which negev beer? the name names no known variant |
| fresh-market | 7290012921032 | בירה מלכה בוטיק אדמו | which malka beer? the name names no known variant |
| fresh-market | 8066145 | בירה קורונה 355 מל ב | pack size unknown; container unknown |
| hatzi-hinam | 7290013430250 | בירה אלכסנדר חיטה ישראלית | which alexander beer? the name names no known variant |
| hatzi-hinam | 7290013430403 | בירה אלכסנדר בלייזר - בירה ישראלית | which alexander beer? the name names no known variant |
| hatzi-hinam | 7290013430144 | בירה אלכסנדר BOCK | which alexander beer? the name names no known variant |
| hatzi-hinam | 7290013430625 | אלכסנדר בירה ישראלית פסט לאגר | which alexander beer? the name names no known variant |
| mahsanei | 7290014056060 | שפירא ניו לאגר ח"פ 330 מ"ל | which shapiro beer? the name names no known variant |
| politzer | 7290019443124 | בקבוק בירה נגב אואזי | which negev beer? the name names no known variant |
| politzer | 7290000000344 | ארגז קרלסברג/טובורג | volume unknown; container unknown |
| politzer | 7290000000446 | ארגז גולדסטאר | volume unknown; container unknown |
| politzer | 7290012921025 | בירה מלכה | which malka beer? the name names no known variant |
| politzer | 7290013430250 | בירה אלכסנדר חיטה יש | which alexander beer? the name names no known variant |
| politzer | 7290017925363 | בקבוק בירה נגב פאטה | which negev beer? the name names no known variant |
| rami-levy | 7290012921032 | בקבוק בירה מלכה אדמו | which malka beer? the name names no known variant |
| rami-levy | 5411081011963 | בירה קסטיל 0% אלכוהו | which kasteel beer? the name names no known variant |
| rami-levy | 7290019443124 | בירה נגב אואזיס 330 | which negev beer? the name names no known variant |
| shufersal | 7290013430250 | בירה אלכסנדר חיטה 330 מל | which alexander beer? the name names no known variant |
| shufersal | 7290014056053 | שפירא איי.פי.איי 330 מ"ל | which shapiro beer? the name names no known variant |
| shufersal | 7290019443124 | בירה נגב אואזיס 330 מ"ל | which negev beer? the name names no known variant |
| stop-market | 7290019443124 | בירה נגב אואזיס 330 | which negev beer? the name names no known variant |
| stop-market | 7290013430403 | בירה אלכסנדר בלייזר | which alexander beer? the name names no known variant |
| stop-market | 7290013430250 | בירה אלכסנדר חיטה יש | which alexander beer? the name names no known variant |
| stop-market | 7290014056053 | בירה שפירא אי.פי.אי | which shapiro beer? the name names no known variant |
| tiv-taam | 5411081008420 | בירה בירה שושנע קסטיל 330 מ"ל | which kasteel beer? the name names no known variant |
| tiv-taam | 7290013430250 | בירה אלכסנדר חיטה ישראלית 330 מ"ל | which alexander beer? the name names no known variant |
| tiv-taam | 7290014056053 | בירה שפירא אי פי אי 330 מ"ל | which shapiro beer? the name names no known variant |
| tiv-taam | 7290019443124 | בירה נגב אואזיס 330 מ"ל | which negev beer? the name names no known variant |
| victory | 2140 | ארגז בירה 4 שישיות קרלסברג | volume unknown; container unknown |
| yochananof | 7290012921032 | בקבוק בירה מלכה אדמו | which malka beer? the name names no known variant |
| yochananof | 7290012921063 | בקבוק בירה מלכה הינד | which malka beer? the name names no known variant |
| fresh-market | 7290000327587 | גולדסטאר בקבוק 250 מ | pack size unknown |
| fresh-market | 7290019398264 | בירה קורונה בקבוק 35 | volume unknown; pack size unknown |
| keshet-taamim | 4607051150270 | תה מאיסקי קורונה 100 | volume unknown; pack size unknown; container unknown |
| keshet-taamim | 4008287958201 | מארז קרומבאכר 5 פחיו | volume unknown; pack size unknown; container unknown |

## Invalid prices

* tiv-taam 7290067642005 בירה גולדסטאר 10% 330 מ"ל SLOW BREW ₪8.2: ₪4.14 per litre is implausibly low

## Out of scope (kept out on purpose)

* malt: 38 rows
* cider: 120 rows

