# Ingestion dry run

**Generated 2026-09-29 from the feed files fetched on 2026-09-29.** DRY RUN: nothing was written to any
database. Produced by `node scripts/ingest/dry-run.mjs` from files parsed by the installed skill's
`parse_price_xml.py` (v1.6.0). One store per chain, today's PriceFull + PromoFull; the raw files stay in the
git-ignored `.ingest-cache/` — this report quotes only product names, codes and prices from them.

## Summary

* Chains detectable: **6** fetched and parsed (carrefour, osher-ad, rami-levy, shufersal, tiv-taam, yochananof); **1 failed**: super-yuda (login as SuperYuda answered 200 (a valid chain code answers 302)).
* Shelf rows read: **65,393**; promotions read: **11,115**.
* Beer-like products: **573** (284 of our 22 beers, 289 beers we do not carry) + 51 out of scope by default (non-alcoholic, malt drinks, cider, radler).
* Confidently normalised: **168** rows (beer + container + volume + pack all read and consistent), 84 more with container unknown → **63 distinct SKUs proposed**, 50 of them seen at 2+ chains.
* Unresolved (held for review, never guessed): **29** rows of our beers whose pack could not be read.
* Invalid prices: **3**. Duplicate source rows: **0**. Same barcode at 2+ chains: **69**, of which **4** read as different packs (held).
* Promotions touching beer: **195** — 126 multi-buy, 59 price cut, 4 unreadable, 6 excluded (coupons), 59 club-only, 75 mix-and-match across packs.
* Promotion price, two statements: the description and the item's `DiscountedPrice` **agree on 151**, disagree on 4. **91** in-force beer promotions would be publishable (both statements agree, one pack, no payment condition); every other one is held.

## Per chain

| Chain | Feed chain id · store | Dialect | Observed (file time) | Rows | Dup. | Beer | Ours | Other beer | Out of scope | Confident | Partial | Unresolved | Invalid | Internal codes | Beer promos (in force) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| carrefour | 7290055700007-001 · 002 | shufersal | 2026-09-29 02:10 UTC | 6148 | 0 | 49 | 30 | 19 | 8 | 18 | 9 | 3 | 0 | 0 | 11 (11) |
| osher-ad | 7290103152017-001 · 003 | shufersal | 2026-09-29 11:05 UTC | 7064 | 0 | 41 | 32 | 9 | 5 | 12 | 14 | 6 | 0 | 0 | 16 (16) |
| rami-levy | 7290058140886-001 · 002 | shufersal | 2026-09-29 09:15 UTC | 11797 | 0 | 83 | 51 | 32 | 7 | 27 | 13 | 8 | 3 | 2 | 35 (35) |
| shufersal | 7290027600007-001 · 002 | shufersal | 2026-09-29 01:31 UTC | 7577 | 0 | 68 | 46 | 22 | 7 | 30 | 13 | 3 | 0 | 0 | 23 (23) |
| tiv-taam | 7290873255550-000 · 002 | shufersal | 2026-09-28 21:40 UTC | 21566 | 0 | 269 | 78 | 191 | 17 | 49 | 24 | 5 | 0 | 4 | 86 (86) |
| yochananof | 7290803800003-000 · 004 | shufersal | 2026-09-28 21:40 UTC | 11241 | 0 | 63 | 47 | 16 | 7 | 32 | 11 | 4 | 0 | 1 | 24 (24) |
| super-yuda | — | cerberus | **not fetched**: login as SuperYuda answered 200 (a valid chain code answers 302) | | | | | | | | | | | | |

The parser reported every chain above as the `shufersal` dialect (Cerberus chains included): its auto-detection keys on
the root element `ChainID`, which all six use. For that dialect the parser does not emit the promotion item's
`<DiscountedPrice>` — though all six files carry it. `scripts/ingest/lib/promo-supplement.mjs` reads that one field from
the same file so the description's price can be cross-checked (below).

## Proposed SKUs

Only rows where the beer, the volume and the pack size were all read — and the name agrees with the feed's
`Quantity` (total volume) — become a SKU. Prices are the regular shelf prices seen, per whole pack.

| SKU (beer · container · ml · pack) | Chains | Prices seen | Example shelf name |
| --- | --- | --- | --- |
| carlsberg · bottle · 330 · 6 | carrefour, osher-ad, rami-levy, shufersal, tiv-taam, yochananof | ₪34.80–₪55.50 | שישיית בירה קרלסברג |
| corona · bottle · 355 · 6 | carrefour, osher-ad, rami-levy, shufersal, tiv-taam, yochananof | ₪37.90–₪47.90 | בירה קורונה אקסטרה 6 |
| goldstar · **container?** · 330 · 6 | carrefour, osher-ad, rami-levy, shufersal, tiv-taam, yochananof | ₪29.90–₪49.70 | גולדסטאר SLOW BREW 3 |
| goldstar · bottle · 330 · 6 | carrefour, osher-ad, rami-levy, shufersal, tiv-taam, yochananof | ₪31.90–₪44.90 | גולדסטאר ח"פ בקבוק 6 |
| goldstar · bottle · 500 · 1 · returnable | carrefour, osher-ad, rami-levy, shufersal, tiv-taam, yochananof | ₪7.50–₪9.30 | גולדסטאר בירה בק חוז |
| goldstar · can · 500 · 1 | carrefour, osher-ad, rami-levy, shufersal, tiv-taam, yochananof | ₪7.90–₪11.90 | גולדסטאר לא מסונן פח |
| heineken · bottle · 330 · 6 | carrefour, osher-ad, rami-levy, shufersal, tiv-taam, yochananof | ₪34.90–₪48.90 | הייניקן בקבוק ח"פ 6* |
| heineken · bottle · 500 · 1 · returnable | carrefour, osher-ad, rami-levy, shufersal, tiv-taam, yochananof | ₪8.90–₪11.00 | הייניקן בירה בקבוק ח |
| heineken · can · 500 · 1 | carrefour, osher-ad, rami-levy, shufersal, tiv-taam, yochananof | ₪9.90–₪14.20 | הייניקן בירה פח 500מ |
| weihen · bottle · 500 · 1 | carrefour, osher-ad, rami-levy, shufersal, tiv-taam, yochananof | ₪11.80–₪16.90 | ויינשטפן בקבוק 500 מ |
| carlsberg · **container?** · 500 · 1 · returnable | carrefour, osher-ad, rami-levy, shufersal, yochananof | ₪7.90–₪11.30 | קרלסברג בירה בק.חוזר |
| carlsberg · can · 500 · 1 | carrefour, rami-levy, shufersal, tiv-taam, yochananof | ₪8.90–₪13.20 | קרלסברג בירה פחית 50 |
| maccabee · bottle · 330 · 6 | carrefour, osher-ad, rami-levy, shufersal, tiv-taam | ₪29.90–₪41.90 | מכבי 7.9% בקבוק 6* 3 |
| maccabee · can · 500 · 1 | osher-ad, rami-levy, shufersal, tiv-taam, yochananof | ₪7.50–₪9.90 | בירה מכבי פחית 7.9% |
| paulaner · bottle · 500 · 1 | carrefour, osher-ad, shufersal, tiv-taam, yochananof | ₪11.70–₪15.90 | בירה פאולנר מינכן הל |
| stella · bottle · 330 · 6 | carrefour, osher-ad, shufersal, tiv-taam, yochananof | ₪29.90–₪49.40 | סטלה ארטואה בירה שיש |
| alexander · **container?** · 330 · 1 | rami-levy, shufersal, tiv-taam, yochananof | ₪12.90–₪17.90 | אלכסנדר בלונד בירה 3 |
| leffe · bottle · 330 · 6 | carrefour, rami-levy, tiv-taam, yochananof | ₪39.90–₪52.00 | לף בלונד בירה חזקה 6 |
| maccabee · bottle · 500 · 1 · returnable | carrefour, rami-levy, shufersal, yochananof | ₪6.90–₪9.30 | מכבי בקבוק חוזר 500 |
| malka · bottle · 330 · 1 | rami-levy, shufersal, tiv-taam, yochananof | ₪13.90–₪16.90 | בקבוק בירה מלכה בהיר |
| becks · **container?** · 275 · 6 | shufersal, tiv-taam, yochananof | ₪29.90–₪35.90 | בירה בקס 6*275 מ"ל |
| budweiser · **container?** · 330 · 6 | shufersal, tiv-taam, yochananof | ₪34.90–₪42.90 | בירה באדוויזר 6*330 מ"ל |
| carlsberg · bottle · 330 · 1 | rami-levy, tiv-taam, yochananof | ₪6.90–₪9.90 | בירה לאגר קרלסברג בק |
| corona · can · 500 · 1 | osher-ad, rami-levy, tiv-taam | ₪11.90–₪13.90 | בירה קורונה 4.5% פחי |
| goldstar · bottle · 250 · 4 | carrefour, tiv-taam, yochananof | ₪24.90–₪27.90 | גולדסטאר ח"פ 250 מ"ל |
| goldstar · bottle · 330 · 1 | carrefour, rami-levy, tiv-taam | ₪6.90–₪9.00 | גולדסטאר בירה ח"פ 33 |
| leffe · can · 500 · 1 | osher-ad, rami-levy, yochananof | ₪11.90–₪12.90 | בירה לף 6.6% פחית 50 |
| negev · **container?** · 330 · 1 | rami-levy, shufersal, tiv-taam | ₪13.90–₪17.20 | בירה נגב פאטה מורגנה |
| paulaner · bottle · 330 · 4 | osher-ad, shufersal, tiv-taam | ₪34.90–₪45.90 | מארז בירה פאולנר בקב |
| paulaner · can · 500 · 1 | rami-levy, shufersal, tiv-taam | ₪11.50–₪13.90 | פאולנר מינכן הל 500 |
| somersby · **container?** · 330 · 1 | shufersal, tiv-taam, yochananof | ₪9.90–₪12.50 | סומרסבי מנגו ליים 330מ"ל |
| somersby · bottle · 330 · 1 | rami-levy, shufersal, yochananof | ₪9.90–₪12.50 | סומרסבי אוכמניות בקב |
| stella · can · 440 · 1 | carrefour, osher-ad, yochananof | ₪9.90–₪14.40 | סטלה בירה ארטואה פחי |
| tuborg · bottle · 330 · 6 | rami-levy, tiv-taam, yochananof | ₪34.80–₪39.90 | בירה טובורג גרין 6*3 |
| tuborg · bottle · 500 · 1 · returnable | carrefour, shufersal, yochananof | ₪7.90–₪11.30 | טובורג גרין 500 מ"ל |
| weihen · **container?** · 330 · 6 | carrefour, shufersal, tiv-taam | ₪66.90–₪78.70 | ויינשטפן בירה לבנה 6 |
| budweiser · can · 500 · 1 | shufersal, tiv-taam | ₪9.20–₪11.90 | באדוויזר לאגר פחית 500מל |
| goldstar · **container?** · 330 · 1 | rami-levy, tiv-taam | ₪7.90–₪7.90 | גולדסטאר 330 מל |
| guinness · bottle · 330 · 1 | shufersal, tiv-taam | ₪17.50–₪17.50 | בירה גינס 330 מ"ל |
| guinness · can · 440 · 1 | shufersal, tiv-taam | ₪18.90–₪19.50 | בירה גינס פחית 440 מ"ל |
| heineken · **container?** · 330 · 6 | rami-levy, yochananof | ₪32.20–₪32.90 | בירה היינקן מארז שיש |
| heineken · bottle · 250 · 4 | tiv-taam, yochananof | ₪23.90–₪24.90 | בירה היינקן רביעיה 250 מ"ל בקבוק |
| heineken · can · 330 · 6 | shufersal, tiv-taam | ₪39.90–₪46.00 | בירה הייניקן פח 6*330מ"ל |
| leffe · bottle · 330 · 1 | tiv-taam, yochananof | ₪8.90–₪10.00 | בירה לף בלונד בקבוק 330 מ"ל |
| maccabee · **container?** · 330 · 1 | rami-levy, tiv-taam | ₪7.10–₪7.90 | בירה מכבי 7.9 330 מל |
| maccabee · **container?** · 330 · 6 | carrefour, shufersal | ₪39.70–₪39.90 | בירה מכבי מארז 6 *33 |
| malka · **container?** · 330 · 1 | shufersal, tiv-taam | ₪15.90–₪16.90 | בירה מלכה חיטה 330 מ"ל |
| shapiro · **container?** · 330 · 1 | shufersal, tiv-taam | ₪14.50–₪16.90 | שפירא פייל אייל 330 מ"ל |
| stella · **container?** · 330 · 6 | osher-ad, yochananof | ₪29.90–₪34.90 | מארז בירה סטלה 6*330 |
| tuborg · bottle · 330 · 1 | rami-levy, tiv-taam | ₪7.90–₪9.90 | בירה טובורג בקבוק 33 |
| becks · can · 500 · 1 | tiv-taam | ₪10.90–₪10.90 | בירה בקס פחית 500 מ"ל |
| budweiser · **container?** · 330 · 1 | rami-levy | ₪6.90–₪6.90 | בירה בדוויזר 330 מל |
| budweiser · **container?** · 500 · 1 | tiv-taam | ₪15.10–₪15.10 | בירה בדוויזר בודבר בהיר 500 מל |
| corona · **container?** · 355 · 6 | osher-ad | ₪41.90–₪41.90 | מארז בירה קורונה 4.5 |
| erdinger · **container?** · 500 · 1 | tiv-taam | ₪12.50–₪12.50 | בירה ארדינגר וויסביר 500 מ"ל |
| heineken · bottle · 330 · 1 | rami-levy | ₪8.90–₪8.90 | היינקן ח"פ 330 בקבוק |
| leffe · **container?** · 330 · 1 | yochananof | ₪9.90–₪9.90 | לף בלונד 330 מ"ל |
| maccabee · bottle · 330 · 1 | tiv-taam | ₪6.50–₪6.50 | בירה מכבי בקבוק 330 מל |
| malka · **container?** · 750 · 1 | tiv-taam | ₪34.90–₪34.90 | בירה מלכה אדמונית 750 מ"ל |
| malka · can · 330 · 1 | tiv-taam | ₪15.90–₪15.90 | בירה מלכה חיטה 330 מ"ל פחית |
| paulaner · **container?** · 500 · 1 | tiv-taam | ₪14.90–₪14.90 | בירה פאולנר אורטובר פאסט 500 מ"ל בקובק |
| paulaner · bottle · 330 · 1 | tiv-taam | ₪11.90–₪11.90 | בירה פאולנר בקבוק 330 מ"ל |
| stella · **container?** · 330 · 1 | osher-ad | ₪7.90–₪7.90 | בירה סטלה ארטואה 5% |

## Unresolved — our beers whose pack could not be read

| Chain | Code | Shelf name | Quantity / unit | Beer | Why |
| --- | --- | --- | --- | --- | --- |
| carrefour | 7290000136554 | בירה היינקן מארז רב | 1.00 ליטר | heineken | volume unknown; pack size unknown; container unknown |
| osher-ad | 7290000136554 | מארז בירה היינקן 5% | 1.00 קילוגרם | heineken | volume unknown; pack size unknown; container unknown |
| osher-ad | 7290000327105 | מארז בירה גולדסטאר 5 | 1.00 קילוגרם | goldstar | volume unknown; pack size unknown; container unknown |
| osher-ad | 7290000327822 | מארז בירה גולדסטאר 5 | 1.00 קילוגרם | goldstar | volume unknown; pack size unknown; container unknown |
| rami-levy | 7290000327105 | גולדסטאר UF בקבוק רב | 1.00 ליטר | goldstar | volume unknown; pack size unknown |
| rami-levy | 7290000327822 | בירה גולדסטאר בק' רב | 1.00 ליטר | goldstar | volume unknown; pack size unknown |
| rami-levy | 3858887585205 | סומרסבי מנגו ליים | 1.00 יחידות | somersby | volume unknown; pack size unknown; container unknown |
| rami-levy | 5410228267515 | בירה בדוויזר שישייה | 330.00 100 מיליליטר | budweiser | volume unknown; container unknown |
| tiv-taam | 4105120062436 | בירה ויינשטפן דונקל 500 מ"ל בקבוק | 330.00 100 מיליליטר | weihen | pack size unknown |
| tiv-taam | 4105120623941 | בירה ויינשטפן 500 מ"ל בקבוק | 330.00 100 מיליליטר | weihen | pack size unknown |
| carrefour | 7290001594575 | טובורג רד פחית פקדון | 500.00 100 מיליליטר | tuborg-red | the same barcode reads differently — carrefour: tuborg-red 1×500 can / rami-levy: tuborg 1×500 can / shufersal: tuborg 1×500 can / tiv-taam: tuborg 1×500 / yochananof: tuborg 1×500 can |
| carrefour | 7290002871248 | בירה טובורג רד בקבוק | 500.00 100 מיליליטר | tuborg-red | the same barcode reads differently — carrefour: tuborg-red 1×500 bottle / osher-ad: tuborg-red 1×500 / rami-levy: tuborg-red 1×500 / shufersal: tuborg-red 1×500 / yochananof: tuborg 1×500 |
| osher-ad | 7290002871248 | בירה טובורג רד ב.חוז | 500.00 100 מיליליטר | tuborg-red | the same barcode reads differently — carrefour: tuborg-red 1×500 bottle / osher-ad: tuborg-red 1×500 / rami-levy: tuborg-red 1×500 / shufersal: tuborg-red 1×500 / yochananof: tuborg 1×500 |
| osher-ad | 7290019398264 | בירה קורונה 4.5% 355 | 355.00 100 מ"ל | corona | the same barcode reads differently — osher-ad: corona 1×355 / rami-levy: corona 1×335 / tiv-taam: corona 1×355 / yochananof: corona 1×355 |
| osher-ad | 7290001594858 | מארז בירה טובורג רד | 1.98 קילוגרם | tuborg-red | the same barcode reads differently — osher-ad: tuborg-red 6×330 / rami-levy: tuborg-red 6×330 / shufersal: tuborg-red 6×330 bottle / tiv-taam: tuborg-red 6×330 bottle / yochananof: tuborg 6×330 |
| rami-levy | 7290002871248 | בירה טובורג רד 500 מ | 500.00 100 מיליליטר | tuborg-red | the same barcode reads differently — carrefour: tuborg-red 1×500 bottle / osher-ad: tuborg-red 1×500 / rami-levy: tuborg-red 1×500 / shufersal: tuborg-red 1×500 / yochananof: tuborg 1×500 |
| rami-levy | 7290019398264 | בירה קורונה 335 מ"ל | 335.00 100 מיליליטר | corona | the same barcode reads differently — osher-ad: corona 1×355 / rami-levy: corona 1×335 / tiv-taam: corona 1×355 / yochananof: corona 1×355 |
| rami-levy | 7290001594575 | בירה טובורג בפחית 50 | 500.00 100 מיליליטר | tuborg | the same barcode reads differently — carrefour: tuborg-red 1×500 can / rami-levy: tuborg 1×500 can / shufersal: tuborg 1×500 can / tiv-taam: tuborg 1×500 / yochananof: tuborg 1×500 can |
| rami-levy | 7290001594858 | בירה טובורג רד 6*330 | 1.98 ליטר | tuborg-red | the same barcode reads differently — osher-ad: tuborg-red 6×330 / rami-levy: tuborg-red 6×330 / shufersal: tuborg-red 6×330 bottle / tiv-taam: tuborg-red 6×330 bottle / yochananof: tuborg 6×330 |
| shufersal | 7290001594575 | בירה טובורג פחית 500 מ"ל | 500.00 100 מיליליטר | tuborg | the same barcode reads differently — carrefour: tuborg-red 1×500 can / rami-levy: tuborg 1×500 can / shufersal: tuborg 1×500 can / tiv-taam: tuborg 1×500 / yochananof: tuborg 1×500 can |
| shufersal | 7290001594858 | בירה טובורג רד בק6*330מל | 1.98 1ליטר | tuborg-red | the same barcode reads differently — osher-ad: tuborg-red 6×330 / rami-levy: tuborg-red 6×330 / shufersal: tuborg-red 6×330 bottle / tiv-taam: tuborg-red 6×330 bottle / yochananof: tuborg 6×330 |
| shufersal | 7290002871248 | טובורג רד בק.חוזר 500מ"ל | 500.00 100 מיליליטר | tuborg-red | the same barcode reads differently — carrefour: tuborg-red 1×500 bottle / osher-ad: tuborg-red 1×500 / rami-levy: tuborg-red 1×500 / shufersal: tuborg-red 1×500 / yochananof: tuborg 1×500 |
| tiv-taam | 7290001594575 | טובורג 500 מ"ל | 500.00 100 מיליליטר | tuborg | the same barcode reads differently — carrefour: tuborg-red 1×500 can / rami-levy: tuborg 1×500 can / shufersal: tuborg 1×500 can / tiv-taam: tuborg 1×500 / yochananof: tuborg 1×500 can |
| tiv-taam | 7290001594858 | טובורג רד שישייה בקבוק 330 מ"ל | 1980.00 100 מיליליטר | tuborg-red | the same barcode reads differently — osher-ad: tuborg-red 6×330 / rami-levy: tuborg-red 6×330 / shufersal: tuborg-red 6×330 bottle / tiv-taam: tuborg-red 6×330 bottle / yochananof: tuborg 6×330 |
| tiv-taam | 7290019398264 | בירה קורונה 355 מ"ל | 355.00 100 מיליליטר | corona | the same barcode reads differently — osher-ad: corona 1×355 / rami-levy: corona 1×335 / tiv-taam: corona 1×355 / yochananof: corona 1×355 |
| yochananof | 7290001594575 | בירה טובורג פחית 500 | 500.00 100 מיליליטר | tuborg | the same barcode reads differently — carrefour: tuborg-red 1×500 can / rami-levy: tuborg 1×500 can / shufersal: tuborg 1×500 can / tiv-taam: tuborg 1×500 / yochananof: tuborg 1×500 can |
| yochananof | 7290001594858 | בירה טובורג שישייה א | 1.98 1ליטר | tuborg | the same barcode reads differently — osher-ad: tuborg-red 6×330 / rami-levy: tuborg-red 6×330 / shufersal: tuborg-red 6×330 bottle / tiv-taam: tuborg-red 6×330 bottle / yochananof: tuborg 6×330 |
| yochananof | 7290002871248 | בירה טובורג חוזר 500 | 500.00 100 מיליליטר | tuborg | the same barcode reads differently — carrefour: tuborg-red 1×500 bottle / osher-ad: tuborg-red 1×500 / rami-levy: tuborg-red 1×500 / shufersal: tuborg-red 1×500 / yochananof: tuborg 1×500 |
| yochananof | 7290019398264 | בירה קורונה 355 מיל | 355.00 100 מיליליטר | corona | the same barcode reads differently — osher-ad: corona 1×355 / rami-levy: corona 1×335 / tiv-taam: corona 1×355 / yochananof: corona 1×355 |

## Invalid prices

| Chain | Code | Shelf name | Price | Why |
| --- | --- | --- | ---: | --- |
| rami-levy | 7290110110369 | בירה קרלסברג לומה שי | ₪37.9 | ₪114.85 per litre is implausibly high — likely a multipack whose name lost its pack size |
| rami-levy | 7290008464734 | בירה גולדסטאר SLOWBR | ₪34.9 | ₪105.76 per litre is implausibly high — likely a multipack whose name lost its pack size |
| rami-levy | 7290008464703 | בירה מכבי ח"פ 330 בק | ₪33.9 | ₪102.73 per litre is implausibly high — likely a multipack whose name lost its pack size |

## Beers we do not carry (would go to `needs_review`, not into the catalogue)

287 distinct shelf names. First 40:

* אובולון 8.5% - בירה — carrefour
* בירה קרומבאכר חיטה 5 — carrefour
* בירה קלאסיקה בלונד ל — carrefour
* מילר בירה לאגר בהירה — carrefour
* בירה BLANC שישיה 330 — carrefour
* סטרופרמן בירה 500 מ — carrefour
* בירה ללא גלוטן 5% אל — carrefour
* איגל בירה חזקה 7.8% — carrefour
* בירה איגל בקבוק 500 — carrefour
* בירה 6.5% אלכוהול קר — carrefour
* בירה 4.5% אלכוהול קר — carrefour
* בירה אדומה 6.1% אלכו — carrefour
* הוגרדן בירה 330 מל — carrefour
* בירה אובולון לאגר בפ — carrefour
* בירה קרומבכר פילס שי — carrefour
* בירה קרומבכר חיטה בפ — carrefour
* שישיית בירה בלונד לא — carrefour
* שישיית בירה בלונד אי — carrefour
* שישיית בירה בלונד 4. — carrefour
* בירה מולר 500 מל — osher-ad, rami-levy, yochananof
* בירה קרומבאכר חיטה פ — osher-ad
* מארז בירה קרומבאכר פ — osher-ad
* בירה קסטיל רוז 330 מ — osher-ad
* מארז בירה הוגרדן 4.9 — osher-ad
* בירה קסטיל רובוס 330 — osher-ad
* בירה איגל פחית 5% 50 — osher-ad
* בירה בלאנק 1664 5% ב — osher-ad
* בירה הוגרדן 4.9% פחי — osher-ad
* בירה לאגר בהירה בבקב — rami-levy
* בירה סינגה שישייה 33 — rami-levy
* בירה אייל בהירה 6.6% — rami-levy
* בירה הוגארדן בקבוק 6 — rami-levy
* בירה מורטי 4*330מל — rami-levy
* בירה מילר פחית 500 מ — rami-levy
* קרומבכר בירה בהירה 6 — rami-levy
* פחית בירה חיטה וויסב — rami-levy
* בירה קסטיל טריפל בקב — rami-levy
* בירה קסטיל רוז פחית — rami-levy
* בירה ואן פור פילזנר — rami-levy
* בירה סטרופראמן שישיי — rami-levy

## Out of scope by default (owner decision pending, INGESTION-READINESS §6)

* malt drink (non-alcoholic): 18 rows
* non-alcoholic: 20 rows
* radler / shandy: 10 rows
* cider: 3 rows

## Promotions touching beer

| Chain | Promotion | Items (beer) | RewardType | Window | In force | Read as | Basis | Club | Publish? | Note |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| carrefour | בירה מכבי 330 בקבוק שישייה | 2 (2) | 10 | 2026-09-09 → 2026-09-30 | yes | multi-buy 2 for ₪65.00 | DiscountedPrice only |  | held | mix-and-match across packs; the description states no price to confirm it |
| carrefour | גולדסטאר ח פ בקבוק 6*330 מ ל | 1 (1) | 3 | 2026-09-23 → 2026-10-02 | yes | price cut to ₪24.90 | DiscountedPrice only |  | held | the description states no price to confirm it |
| carrefour | בירה לאגר שישיה 330 מ ל | 2 (1) | 3 | 2026-08-30 → 2026-10-02 | yes | price cut to ₪35.90 | DiscountedPrice only |  | held | the description states no price to confirm it |
| carrefour | בירה סטלה ארטואה שישיה 330 מ ל/קורונה אק | 2 (2) | 10 | 2026-08-30 → 2026-10-02 | yes | multi-buy 2 for ₪66.00 | DiscountedPrice only |  | held | mix-and-match across packs; the description states no price to confirm it |
| carrefour | בירה הייניקן בקבוק ח פ 6*330מ ל | 1 (1) | 3 | 2026-09-17 → 2026-10-02 | yes | price cut to ₪35.90 | DiscountedPrice only |  | held | the description states no price to confirm it |
| carrefour | בירה היינקן/גולדסטאר רביעייה 250 מ ל | 3 (3) | 3 | 2026-09-03 → 2026-09-30 | yes | price cut to ₪18.90 | DiscountedPrice only |  | held | mix-and-match across packs; the description states no price to confirm it |
| carrefour | קופון פיצוי לקוח גולדסטאר 330 מל שישייה | 2 (1) | 10,0 | 2026-09-13 → 2026-12-31 | yes | excluded |  |  | held | coupon / compensation, not a shelf offer |
| carrefour | קופון פיצוי לקוח היינקן 330 מל שישייה | 2 (1) | 10,0 | 2026-09-13 → 2026-12-31 | yes | excluded |  |  | held | coupon / compensation, not a shelf offer |
| carrefour | בירה קרפור סנשיין/בירה אדומה 330 מ ל | 5 (4) | 10 | 2026-08-16 → 2026-10-02 | yes | multi-buy 3 for ₪20.00 | DiscountedPrice only |  | held | mix-and-match across packs; the description states no price to confirm it |
| carrefour | בירה 6*250 מ לWalbergem | 1 (1) | 3 | 2026-08-16 → 2026-10-02 | yes | price cut to ₪19.90 | DiscountedPrice only |  | held | the description states no price to confirm it |
| carrefour | בירה 6*250 מ לBRAUSAER | 2 (2) | 10 | 2026-08-16 → 2026-10-02 | yes | multi-buy 2 for ₪30.00 | DiscountedPrice only |  | held | mix-and-match across packs; the description states no price to confirm it |
| osher-ad | שישיית בירה סטלה 24.9 מוג 2 | 1 (1) | 3 | 2026-09-15 → 2026-10-03 | yes | price cut to ₪24.90 | description + DiscountedPrice |  | **yes** |  |
| osher-ad | שישיית בירה גולדסטאר / מכבי 2 ב 55 | 3 (2) | 10 | 2026-09-14 → 2026-10-03 | yes | multi-buy 2 for ₪55.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| osher-ad | שישיית בירה טובורג 29.9 מוג 3 | 3 (2) | 3 | 2026-09-15 → 2026-10-03 | yes | price cut to ₪29.90 | description + DiscountedPrice |  | held | mix-and-match across packs |
| osher-ad | בירה פחית הוגרדן 2 ב 18 | 2 (2) | 10 | 2026-08-26 → 2026-10-03 | yes | multi-buy 2 for ₪18.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| osher-ad | שישיית בירה קורונה 2 ב 65 | 2 (2) | 10 | 2026-08-23 → 2026-10-03 | yes | multi-buy 2 for ₪65.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| osher-ad | בירה מכבי/גולדסטאר 3 ב 20 | 3 (3) | 10 | 2026-08-16 → 2026-10-03 | yes | multi-buy 3 for ₪20.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| osher-ad | בירה מולר 500 מ ל 3 ב 10- | 1 (1) | 1 | 2025-10-26 → 2027-01-02 | yes | multi-buy 3 for ₪10.00 | description + DiscountedPrice |  | **yes** |  |
| osher-ad | בירה קורונה 355 מ ל 2 ב 13 | 1 (1) | 1 | 2026-04-13 → 2027-01-02 | yes | multi-buy 2 for ₪13.00 | description + DiscountedPrice |  | **yes** |  |
| osher-ad | בירה סטלה פחית 2 ב 16- | 1 (1) | 1 | 2026-05-11 → 2027-01-02 | yes | multi-buy 2 for ₪16.00 | description + DiscountedPrice |  | **yes** |  |
| osher-ad | בירה פחית קורונה 2 ב 16 | 1 (1) | 1 | 2026-08-10 → 2026-10-03 | yes | multi-buy 2 for ₪16.00 | description + DiscountedPrice |  | **yes** |  |
| osher-ad | בירה ויינשטפן 2 ב 20 | 2 (2) | 10 | 2026-08-10 → 2026-10-03 | yes | multi-buy 2 for ₪20.00 | description + DiscountedPrice |  | **yes** |  |
| osher-ad | בירה קרומבאכר פחית 2 ב 16 | 2 (1) | 10 | 2026-08-10 → 2026-10-03 | yes | multi-buy 2 for ₪16.00 | description + DiscountedPrice |  | **yes** |  |
| osher-ad | בירה 500 מ ל היינקן 2 ב 17 | 1 (1) | 1 | 2026-08-12 → 2026-10-03 | yes | multi-buy 2 for ₪17.00 | description + DiscountedPrice |  | **yes** |  |
| osher-ad | בירה מכבי/גולדסטאר 3 ב 20 | 3 (3) | 10 | 2026-08-16 → 2026-10-03 | yes | multi-buy 3 for ₪20.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| osher-ad | בירה פחית הוגרדן 2 ב 18 | 2 (2) | 10 | 2026-08-16 → 2026-10-03 | yes | multi-buy 2 for ₪18.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| osher-ad | שישיית בירה קורונה 2 ב 65 | 2 (2) | 10 | 2026-08-23 → 2026-10-03 | yes | multi-buy 2 for ₪65.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| rami-levy | בירה פילזנר פחית 500 מ ל 2ב13כולל | 4 (4) | 10 | 2026-01-04 → 2026-12-31 | yes | multi-buy 2 for ₪13.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| rami-levy | בירה אנגלמן 500-568 מ ל 2ב19 כולל | 5 (4) | 10 | 2026-01-04 → 2026-12-31 | yes | multi-buy 2 for ₪19.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| rami-levy | בירה 500 מ ל איגל3ב15.90 כולל | 1 (1) | 1 | 2026-01-04 → 2026-12-31 | yes | multi-buy 3 for ₪15.90 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | בירה קורונה בודד 2ב12.90 כולל | 2 (1) | 10 | 2026-01-04 → 2026-12-31 | yes | multi-buy 2 for ₪12.90 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | בירה ואן פור 500 מ ל 3ב11 כולל | 1 (1) | 1 | 2026-01-04 → 2026-12-31 | yes | multi-buy 3 for ₪11.00 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | בירה מולר 500 מ ל 3ב10 כולל | 1 (1) | 1 | 2026-01-04 → 2026-12-31 | yes | multi-buy 3 for ₪10.00 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | פחית בירה צסו 568 מ ל 2ב16.90 כולל | 2 (2) | 10 | 2026-01-27 → 2026-12-31 | yes | multi-buy 2 for ₪16.90 | description + DiscountedPrice |  | held | mix-and-match across packs |
| rami-levy | בירה קורונה שישייה 2ב65 כולל | 1 (1) | 1 | 2026-08-23 → 2026-10-03 | yes | multi-buy 2 for ₪65.00 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | פחית בירה 500 מ ל קרלסברג/היינ 3ב25 כולל | 2 (2) | 10 | 2026-05-10 → 2026-10-03 | yes | multi-buy 3 for ₪25.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| rami-levy | קופון גולדסטאר 330מל שישייה בק במתנה | 1 (1) | 2 | 2026-05-10 → 2026-12-31 | yes | excluded |  |  | held | coupon / compensation, not a shelf offer |
| rami-levy | קופון הייניקן 330מל בק/ שישייה במתנה | 1 (1) | 2 | 2026-05-10 → 2026-12-31 | yes | excluded |  |  | held | coupon / compensation, not a shelf offer |
| rami-levy | שישיית בירה מכבי 6*330 מ ל ב27.50 כולל | 2 (2) | 3 | 2026-05-31 → 2026-10-03 | yes | price cut to ₪27.50 | description + DiscountedPrice |  | held | mix-and-match across packs |
| rami-levy | גולדסטאר פחית 500 מ ל 2ב13 כולל | 3 (3) | 10 | 2026-07-05 → 2026-10-03 | yes | multi-buy 2 for ₪13.00 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | בירה מכבי 500 מל 2ב13כולל | 2 (2) | 10 | 2026-07-05 → 2026-10-03 | yes | multi-buy 2 for ₪13.00 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | בירה מלכה 330 מ ל 2ב26 כולל | 6 (4) | 10 | 2026-07-05 → 2026-10-03 | yes | multi-buy 2 for ₪26.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| rami-levy | בירה לאגר קרלסברג בק330מל ב6.90 | 1 (1) | 3 | 2026-07-05 → 2026-10-03 | yes | price cut to ₪6.90 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | בירה גולדסטאר 4*250מ ל ב14.90 כולל | 2 (2) | 3 | 2026-08-23 → 2026-10-03 | yes | price cut to ₪14.90 | description + DiscountedPrice |  | held | mix-and-match across packs |
| rami-levy | שישיית בירה 6*330 מ ל באדוויזר 2ב65 כולל | 1 (1) | 1 | 2026-07-16 → 2026-10-03 | yes | multi-buy 2 for ₪65.00 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | סומרסבי סיידר 330מל2ב16 כולל | 3 (2) | 10 | 2026-08-02 → 2026-10-03 | yes | multi-buy 2 for ₪16.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| rami-levy | ויינשטפן 500מל 2ב20 כולל | 1 (1) | 1 | 2026-08-02 → 2026-10-03 | yes | multi-buy 2 for ₪20.00 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | בירה אלכסנדר 330מל 2ב24 כולל | 2 (1) | 10 | 2026-08-02 → 2026-10-03 | yes | multi-buy 2 for ₪24.00 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | קרומבכר פילס בק שישייה ב29.90 כולל | 1 (1) | 3 | 2026-08-02 → 2026-10-03 | yes | price cut to ₪29.90 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | בירה קורונה/סטלה/קרונבכר/מילר 500מל 2ב16 | 6 (3) | 10 | 2026-08-02 → 2026-10-03 | yes | multi-buy 2 for ₪16.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| rami-levy | בירה לף בלונד/הוגארדן 500מל 2ב18 כולל | 2 (2) | 10 | 2026-08-02 → 2026-10-03 | yes | multi-buy 2 for ₪18.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| rami-levy | בירה שוף/דובל/מרדסו 330מל 2ב19.90 כולל | 5 (1) | 10 | 2026-08-02 → 2026-10-03 | yes | multi-buy 2 for ₪19.90 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | בירה פרנסיסקאנר 500מל 2ב23.90 כולל | 3 (1) | 10 | 2026-08-02 → 2026-10-03 | yes | multi-buy 2 for ₪23.90 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | בירה מילר בוק 330מל שישייה ב19.90 מו2 כו | 1 (1) | 3 | 2026-08-02 → 2026-10-03 | yes | price cut to ₪19.90 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | שישיית בירה גולדסטאר 29.90כולל | 1 (1) | 3 | 2026-09-14 → 2026-10-03 | yes | price cut to ₪29.90 | DiscountedPrice only |  | held | the description states no price to confirm it |
| rami-levy | שישיית בירה 6*330 מ ל קרלסברג לומה ב35.9 | 1 (1) | 3 | 2026-08-04 → 2026-10-03 | yes | price cut to ₪35.90 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | בירה טובורג רד/גרין 6*330מ ל ב29.90 כולל | 2 (2) | 3 | 2026-07-06 → 2026-10-03 | yes | price cut to ₪29.90 | description + DiscountedPrice |  | held | mix-and-match across packs |
| rami-levy | סטרופארמן בק 330מל שישייה ב19.90 כולל | 1 (1) | 3 | 2026-08-02 → 2026-10-03 | yes | price cut to ₪19.90 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | בירה 6*330 מ ל קרלסברג ב29.90 כולל | 1 (1) | 3 | 2026-08-03 → 2026-10-03 | yes | price cut to ₪29.90 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | בירה גולדסטאר 4*250מ ל ב14.90 כולל | 1 (1) | 3 | 2026-08-16 → 2026-10-03 | yes | price cut to ₪14.90 | description + DiscountedPrice |  | **yes** |  |
| rami-levy | בירה הייניקן 4*250מ ל ב15.90כולל | 1 (1) | 3 | 2026-08-16 → 2026-10-03 | yes | unmapped |  |  | held | description says ₪15.90, DiscountedPrice says ₪15.30 |
| rami-levy | שישיית גולדסטאר ב24.90 מעל 75 מו2 כולל | 3 (2) | 0,3 | 2026-09-14 → 2026-10-03 | yes | price cut to ₪24.90 | description + DiscountedPrice |  | held | mix-and-match across packs |
| shufersal | 2ב71.40 פקדון בירה סטלה ארטואה 6 * 330 מ | 1 (1) | 10 | 2026-09-14 → 2026-10-03 | yes | multi-buy 2 for ₪75.00 | description + DiscountedPrice |  | **yes** | description excludes the deposit (12 × ₪0.30) |
| shufersal | 2ב71.40 פקדון בירה קורונה 355*6 מ"ל | 1 (1) | 10 | 2026-09-14 → 2026-10-03 | yes | multi-buy 2 for ₪75.00 | description + DiscountedPrice |  | **yes** | description excludes the deposit (12 × ₪0.30) |
| shufersal | 2ב18.40 פקדון סומרסבי 330 מ"ל | 3 (2) | 10 | 2026-09-14 → 2026-10-03 | yes | multi-buy 2 for ₪19.00 | description + DiscountedPrice |  | held | mix-and-match across packs; description excludes the deposit (2 × ₪0.30) |
| shufersal | 3ב24.10 פקדון בירה קרלסברג בפחית500מ"ל | 1 (1) | 1 | 2026-09-14 → 2026-10-03 | yes | multi-buy 3 for ₪25.00 | description + DiscountedPrice |  | **yes** | description excludes the deposit (3 × ₪0.30) |
| shufersal | 2ב34.40 פקדון בירה גינס פחית 440 מ"ל | 1 (1) | 1 | 2026-09-14 → 2026-10-03 | yes | multi-buy 2 for ₪35.00 | description + DiscountedPrice |  | **yes** | description excludes the deposit (2 × ₪0.30) |
| shufersal | 2ב25.40 פקדון בירה ויינשטפן 500 מ"ל | 3 (2) | 10 | 2026-09-14 → 2026-10-03 | yes | multi-buy 2 for ₪26.00 | description + DiscountedPrice |  | **yes** | description excludes the deposit (2 × ₪0.30) |
| shufersal | 68.10 פקדון בירה ויינשטפן 330*6 מ"ל | 1 (1) | 3 | 2026-09-14 → 2026-10-03 | yes | price cut to ₪69.90 | description + DiscountedPrice |  | **yes** | description excludes the deposit (6 × ₪0.30) |
| shufersal | 38.10 פקדון קרלסברג לומה 6בק* 330מל | 1 (1) | 3 | 2026-09-14 → 2026-10-03 | yes | price cut to ₪39.90 | description + DiscountedPrice |  | **yes** | description excludes the deposit (6 × ₪0.30) |
| shufersal | 38.10 פקדון בירה אסטרייה דאם330*6מ | 1 (1) | 3 | 2026-09-14 → 2026-10-03 | yes | price cut to ₪39.90 | description + DiscountedPrice |  | **yes** | description excludes the deposit (6 × ₪0.30) |
| shufersal | 2ב66.40 פקדון בירה באדוויזר 330*6 מ"ל | 1 (1) | 1 | 2026-09-14 → 2026-10-03 | yes | multi-buy 2 for ₪70.00 | description + DiscountedPrice |  | **yes** | description excludes the deposit (12 × ₪0.30) |
| shufersal | 2ב71.40 פקדון בירה הייניקן פח 330*6מ"ל | 1 (1) | 1 | 2026-09-14 → 2026-10-03 | yes | multi-buy 2 for ₪75.00 | description + DiscountedPrice |  | **yes** | description excludes the deposit (12 × ₪0.30) |
| shufersal | 38.70 פקדון בירה פאולנר 330*4 מ"ל | 1 (1) | 3 | 2026-09-14 → 2026-10-03 | yes | price cut to ₪39.90 | description + DiscountedPrice |  | **yes** | description excludes the deposit (4 × ₪0.30) |
| shufersal | 2ב25.40 פקדון בירה מרפיס סטאוט 500 מ"ל | 1 (1) | 1 | 2026-09-14 → 2026-10-03 | yes | multi-buy 2 for ₪26.00 | description + DiscountedPrice |  | **yes** | description excludes the deposit (2 × ₪0.30) |
| shufersal | 2ב24.40 פקדון בירה פאולנר חיטה פחית500 | 1 (1) | 1 | 2026-09-14 → 2026-10-03 | yes | multi-buy 2 for ₪25.00 | description + DiscountedPrice |  | **yes** | description excludes the deposit (2 × ₪0.30) |
| shufersal | 3ב14.40 פקדון בירה איגל בקבוק חוזר500מ | 1 (1) | 1 | 2026-09-14 → 2026-10-03 | yes | multi-buy 3 for ₪18.00 | description + DiscountedPrice |  | **yes** | description excludes the deposit (12 × ₪0.30) |
| shufersal | 2ב29.40 פקדון בריזר/שפירא אייל 275-330 מ | 8 (2) | 10 | 2026-09-14 → 2026-10-03 | yes | multi-buy 2 for ₪30.00 | description + DiscountedPrice |  | **yes** | description excludes the deposit (2 × ₪0.30) |
| shufersal | 3ב31.10 פקדון בירה פייל אייל 568 מ"ל | 5 (5) | 10 | 2026-09-14 → 2026-10-03 | yes | multi-buy 3 for ₪32.00 | description + DiscountedPrice |  | held | mix-and-match across packs; description excludes the deposit (3 × ₪0.30) |
| shufersal | 2ב61.40 פקדון בירה טובורג רד/גרין 330*6 | 1 (1) | 10 | 2026-09-14 → 2026-10-03 | yes | multi-buy 2 for ₪65.00 | description + DiscountedPrice |  | **yes** | description excludes the deposit (12 × ₪0.30) |
| shufersal | 38.10 פקדון גולדסטאר לא מסוננת/מכבי/היינ | 2 (1) | 3 | 2026-09-14 → 2026-10-03 | yes | price cut to ₪39.90 | description + DiscountedPrice |  | **yes** | description excludes the deposit (6 × ₪0.30) |
| shufersal | 2ב24.40 פקדון בירה שוף/דובל/מרדסו/סן ברנ | 3 (2) | 10 | 2026-09-14 → 2026-10-03 | yes | multi-buy 2 for ₪25.00 | description + DiscountedPrice |  | held | mix-and-match across packs; description excludes the deposit (2 × ₪0.30) |
| shufersal | 2ב66.40 פקדון בירה קרלסברג בק330*6 מ"ל | 1 (1) | 1 | 2026-09-18 → 2026-10-03 | yes | multi-buy 2 for ₪70.00 | description + DiscountedPrice |  | **yes** | description excludes the deposit (12 × ₪0.30) |
| shufersal | 28.10 פקדון בירה גולדסטאר/בקס/מכבי 275X6 | 4 (4) | 3 | 2026-09-22 → 2026-10-03 | yes | price cut to ₪29.90 | description + DiscountedPrice |  | held | mix-and-match across packs; description excludes the deposit (6 × ₪0.30) |
| shufersal | 3ב16.4פקדון בירה מצוננת בקבוק 500 מ"ל | 1 (1) | 1 | 2026-09-22 → 2026-11-01 | yes | multi-buy 3 for ₪20.00 | description + DiscountedPrice |  | **yes** | description excludes the deposit (12 × ₪0.30) |
| tiv-taam | קופון מנוהל חדש 50 מעל 249 | 11380 (3) | 0,10 | 2021-10-10 → 2026-12-31 | yes | excluded |  |  | held | mix-and-match across packs; applies to 11380 items — a store-wide coupon, not a beer offer |
| tiv-taam | בירה גרלסבורג 2 ב 15 מועדון | 1 (1) | 10 | 2023-03-05 → 2027-01-04 | yes | multi-buy 2 for ₪15.00 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 12.9 ש"ח מועדון | 1 (1) | 1 | 2023-03-05 → 2027-01-04 | yes | multi-buy 2 for ₪12.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה סיארה נאבדה 2 ב 25 מועדון | 3 (3) | 10 | 2024-02-05 → 2027-01-04 | yes | multi-buy 2 for ₪25.00 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 24.9 מועדון | 1 (1) | 10 | 2025-10-16 → 2027-01-04 | yes | multi-buy 2 for ₪24.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 3 ב 25.9 מועדון | 2 (2) | 10 | 2026-01-05 → 2027-01-04 | yes | unmapped |  | yes | held | description says 3 for ₪25.90, DiscountedPrice says 3 for ₪25.00 |
| tiv-taam | בירה 2 ב 17.9 מועדון | 1 (1) | 10 | 2026-01-05 → 2027-01-04 | yes | multi-buy 2 for ₪17.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 20 מועדון | 4 (4) | 10 | 2026-01-05 → 2027-01-04 | yes | multi-buy 2 for ₪20.00 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 20 מועדון | 1 (1) | 1 | 2026-01-05 → 2027-01-04 | yes | multi-buy 2 for ₪20.00 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 22.9 מועדון | 1 (1) | 10 | 2026-01-05 → 2027-01-04 | yes | multi-buy 2 for ₪22.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 3 ב 35.9 מועדון | 9 (8) | 10 | 2026-01-05 → 2027-01-04 | yes | multi-buy 3 for ₪35.90 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 25.9 מועדון | 2 (2) | 10 | 2026-01-05 → 2027-01-04 | yes | multi-buy 2 for ₪25.90 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 28.9 מועדון | 3 (3) | 10 | 2026-01-05 → 2027-01-04 | yes | multi-buy 2 for ₪28.90 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 33.9 מועדון | 5 (4) | 10 | 2026-01-05 → 2027-01-04 | yes | multi-buy 2 for ₪33.90 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 35.9 מועדון | 1 (1) | 3 | 2026-01-05 → 2027-01-04 | yes | price cut to ₪35.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 13.9 מועדון | 4 (4) | 10 | 2026-01-05 → 2027-01-04 | yes | multi-buy 2 for ₪13.90 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 17.9 מועדון | 4 (4) | 10 | 2025-12-04 → 2027-01-04 | yes | multi-buy 2 for ₪17.90 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 25.9 מועדון | 6 (6) | 10 | 2026-01-05 → 2027-01-04 | yes | multi-buy 2 for ₪25.90 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | קופון מנוהל 50 מעל 249 טווח 91763 | 11380 (3) | 0,10 | 2026-01-18 → 2026-12-31 | yes | excluded |  |  | held | mix-and-match across packs; applies to 11380 items — a store-wide coupon, not a beer offer |
| tiv-taam | בירה 2 ב 19.9 מועדון | 1 (1) | 1 | 2026-01-26 → 2027-01-04 | yes | multi-buy 2 for ₪19.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 15 מועדון | 1 (1) | 1 | 2026-03-16 → 2026-10-11 | yes | unmapped |  | yes | held | description says 2 for ₪15.00, DiscountedPrice says 2 for ₪14.90 |
| tiv-taam | בירה 16.9 - מועדון | 1 (1) | 3 | 2026-03-16 → 2026-11-23 | yes | price cut to ₪16.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 16.9 - מועדון | 1 (1) | 1 | 2026-03-16 → 2026-11-23 | yes | multi-buy 2 for ₪16.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 34.9 - מועדון | 1 (1) | 3 | 2026-03-16 → 2026-11-23 | yes | unmapped |  | yes | held | description says ₪34.90, DiscountedPrice says ₪36.40 |
| tiv-taam | בירה 2 ב 12 - מועדון | 1 (1) | 1 | 2026-03-16 → 2026-11-23 | yes | multi-buy 2 for ₪12.00 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 21.9 מועדון | 7 (4) | 10 | 2026-03-16 → 2027-01-04 | yes | multi-buy 2 for ₪21.90 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 24.9 מועדון | 1 (1) | 3 | 2026-04-28 → 2027-01-04 | yes | price cut to ₪24.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 25 מועדון | 4 (4) | 10 | 2026-04-28 → 2027-01-04 | yes | multi-buy 2 for ₪25.00 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 31.9 | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪31.90 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | בירה 31.9 | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪31.90 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | בירה 37.90 | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪37.90 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | בירה 2 ב 15.9 - מועדון | 1 (1) | 1 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪15.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 22 מועדון | 3 (3) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪22.00 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 4 ב 25.9 - מועדון | 1 (1) | 1 | 2026-08-24 → 2026-10-11 | yes | multi-buy 4 for ₪25.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 22 - מועדון | 3 (3) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪22.00 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 25.9 - מועדון | 3 (3) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪25.90 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 15.90 - מועדון | 2 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪15.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 39.90 - מועדון | 3 (3) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪39.90 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 35.9 | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪35.90 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | ויינשטפן 3 ב 33 | 3 (3) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 3 for ₪33.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| tiv-taam | סומרסבי 3 ב 19.9 | 3 (1) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 3 for ₪19.90 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | בירה 2 ב 18 | 1 (1) | 1 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪18.00 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | בירה 2 ב 22.9 | 3 (3) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪22.90 | description + DiscountedPrice |  | held | mix-and-match across packs |
| tiv-taam | בירה 35.9 | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪35.90 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | בירה 36.9 | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪36.90 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | בירה 35.9 | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪35.90 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | בירה ב- 34.90 | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪34.90 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | בירה 3 ב 19.9 מועדון | 3 (3) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 3 for ₪19.90 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 37.9 | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪37.90 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | בירה 2 ב 25 | 3 (3) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪25.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 22 | 2 (2) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪22.00 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | בירה 39.9 | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪39.90 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | בירה 34.9 | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪34.90 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | בירה 2 ב 18 | 3 (3) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪18.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 15 | 3 (3) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪15.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| tiv-taam | שישיית בירה 39.9 | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪39.90 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | בירה 2 ב 21 מועדון | 3 (3) | 10 | 2026-08-24 → 2027-01-04 | yes | multi-buy 2 for ₪21.00 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 20 מועדון | 3 (3) | 10 | 2026-08-24 → 2027-01-04 | yes | multi-buy 2 for ₪20.00 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 18 מועדון | 4 (2) | 10 | 2026-07-28 → 2027-01-04 | yes | multi-buy 2 for ₪18.00 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 29.9 מועדון | 2 (2) | 3 | 2026-07-29 → 2026-10-11 | yes | price cut to ₪29.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 50 מועדון | 3 (1) | 10 | 2026-07-29 → 2026-10-11 | yes | multi-buy 2 for ₪50.00 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 20 - מועדון | 3 (3) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪20.00 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 35.9 - מועדון | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪35.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 32.9 - מועדון | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪32.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 25 - מועדון | 5 (5) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪25.00 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 22 - מועדון | 1 (1) | 1 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪22.00 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 24 - מועדון | 2 (2) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪24.00 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 24 - מועדון | 3 (3) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪24.00 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 42.9 - מועדון | 1 (1) | 3 | 2026-08-24 → 2027-01-04 | yes | price cut to ₪42.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 22.9 - מועדון | 3 (2) | 10 | 2026-08-24 → 2027-01-04 | yes | multi-buy 2 for ₪22.90 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 22.9 - מועדון | 1 (1) | 1 | 2026-08-24 → 2027-01-04 | yes | multi-buy 2 for ₪22.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 26.9 - מועדון | 8 (7) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪26.90 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 30 - מועדון | 4 (3) | 10 | 2026-08-24 → 2027-01-04 | yes | multi-buy 2 for ₪30.00 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 3 ב 18.9 - מועדון | 2 (2) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 3 for ₪18.90 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | בירה 2 ב 14.9 - מועדון | 2 (2) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪14.90 | description + DiscountedPrice | yes | held | mix-and-match across packs |
| tiv-taam | קראביס פטל 2 ב 14 | 1 (1) | 1 | 2026-08-12 → 2026-09-30 | yes | multi-buy 2 for ₪14.00 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | בירה 2 ב 24 | 9 (8) | 10 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪24.00 | description + DiscountedPrice |  | held | mix-and-match across packs |
| tiv-taam | רביעיית בירה ב 25.90 - מועדון | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪25.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה ב 9.90 - מועדון | 1 (1) | 3 | 2026-08-24 → 2026-10-11 | yes | price cut to ₪9.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 16.90 - מועדון | 1 (1) | 1 | 2026-08-24 → 2026-10-11 | yes | multi-buy 2 for ₪16.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | בירה 2 ב 16.9 מועדון | 1 (1) | 1 | 2026-08-24 → 2026-11-23 | yes | multi-buy 2 for ₪16.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | שישיית בירה 39.9 מועדון | 1 (1) | 3 | 2026-08-24 → 2026-11-23 | yes | price cut to ₪39.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | היינקן 19.9 | 1 (1) | 3 | 2026-08-30 → 2026-10-11 | yes | price cut to ₪19.90 | description + DiscountedPrice |  | **yes** |  |
| tiv-taam | שישיית בירה 34.9 | 2 (2) | 3 | 2026-09-22 → 2026-10-02 | yes | price cut to ₪34.90 | description + DiscountedPrice |  | held | mix-and-match across packs |
| tiv-taam | בירה 11.9 מועדון | 1 (1) | 3 | 2026-09-14 → 2027-01-04 | yes | price cut to ₪11.90 | description + DiscountedPrice | yes | **yes** |  |
| tiv-taam | שישיית בירה 29.9 | 3 (2) | 3 | 2026-09-14 → 2026-09-30 | yes | price cut to ₪29.90 | description + DiscountedPrice |  | held | mix-and-match across packs |
| yochananof | בירה בנדקטינר | 3 (3) | 10 | 2026-03-26 → 2026-10-03 | yes | multi-buy 2 for ₪20.00 | DiscountedPrice only |  | held | mix-and-match across packs; the description states no price to confirm it |
| yochananof | בירה קרלסברג/הייניקן פחית | 3 (3) | 10 | 2026-05-24 → 2026-10-03 | yes | multi-buy 3 for ₪20.00 | DiscountedPrice only |  | held | mix-and-match across packs; the description states no price to confirm it |
| yochananof | בירה לבנה 5.4% בפחית 568 מ"ל | 1 (1) | 1 | 2026-05-31 → 2026-12-31 | yes | multi-buy 2 for ₪17.00 | DiscountedPrice only |  | held | the description states no price to confirm it |
| yochananof | בירה פילזנר פחית 500 מ"ל | 3 (2) | 10 | 2026-05-31 → 2026-12-31 | yes | multi-buy 3 for ₪20.00 | DiscountedPrice only |  | held | mix-and-match across packs; the description states no price to confirm it |
| yochananof | בירה ואן פור/מולר | 2 (2) | 10 | 2026-05-14 → 2026-12-31 | yes | multi-buy 3 for ₪11.00 | DiscountedPrice only |  | held | mix-and-match across packs; the description states no price to confirm it |
| yochananof | בירה מלכה | 3 (3) | 10 | 2026-07-05 → 2026-10-03 | yes | multi-buy 2 for ₪26.00 | DiscountedPrice only |  | held | the description states no price to confirm it |
| yochananof | בירה שוף/מרדסו/דובל/ליפמנס/בלומון | 5 (1) | 10 | 2026-07-05 → 2026-10-31 | yes | multi-buy 2 for ₪20.00 | DiscountedPrice only |  | held | the description states no price to confirm it |
| yochananof | בירה סטלה פחית 440 מ"ל | 1 (1) | 1 | 2026-07-21 → 2026-10-03 | yes | multi-buy 2 for ₪16.00 | DiscountedPrice only |  | held | the description states no price to confirm it |
| yochananof | הייניקן שישייה | 1 (1) | 3 | 2026-08-02 → 2026-10-03 | yes | price cut to ₪34.90 | DiscountedPrice only |  | held | the description states no price to confirm it |
| yochananof | הייניקן/גולדסטאר רביעייה | 2 (2) | 3 | 2026-08-04 → 2026-10-03 | yes | price cut to ₪14.90 | DiscountedPrice only |  | held | mix-and-match across packs; the description states no price to confirm it |
| yochananof | בירה איגל | 1 (1) | 1 | 2026-08-04 → 2026-10-03 | yes | multi-buy 2 for ₪11.00 | DiscountedPrice only |  | held | the description states no price to confirm it |
| yochananof | בירה לף בלונד | 1 (1) | 1 | 2026-08-30 → 2026-10-03 | yes | multi-buy 6 for ₪30.00 | DiscountedPrice only |  | held | the description states no price to confirm it |
| yochananof | בירה גולדסטאר לא מסונן פחית 500 מ"ל | 1 (1) | 1 | 2026-08-17 → 2026-10-03 | yes | multi-buy 2 for ₪15.00 | DiscountedPrice only |  | held | the description states no price to confirm it |
| yochananof | קורונה שישייה | 1 (1) | 10 | 2026-08-19 → 2026-10-03 | yes | multi-buy 2 for ₪65.00 | DiscountedPrice only |  | held | the description states no price to confirm it |
| yochananof | בירה ויינשטפן 500 מ"ל | 1 (1) | 1 | 2026-08-25 → 2026-10-03 | yes | multi-buy 2 for ₪20.00 | DiscountedPrice only |  | held | the description states no price to confirm it |
| yochananof | קרלסברג לא מסונן שישייה | 1 (1) | 3 | 2026-08-25 → 2026-10-03 | yes | price cut to ₪35.90 | DiscountedPrice only |  | held | the description states no price to confirm it |
| yochananof | גולדסטאר/מכבי פחית | 3 (3) | 10 | 2026-08-25 → 2026-10-03 | yes | multi-buy 2 for ₪14.00 | DiscountedPrice only |  | held | mix-and-match across packs; the description states no price to confirm it |
| yochananof | פחית בירה הוגארדן/לף 500 מ"ל | 2 (2) | 10 | 2026-09-01 → 2026-10-03 | yes | multi-buy 2 for ₪18.00 | DiscountedPrice only |  | held | mix-and-match across packs; the description states no price to confirm it |
| yochananof | שישיית בירה סטלה | 2 (2) | 3 | 2026-09-14 → 2026-10-03 | yes | price cut to ₪24.90 | DiscountedPrice only |  | held | mix-and-match across packs; the description states no price to confirm it |
| yochananof | קרלסברג/טובורג שישייה | 3 (3) | 3 | 2026-09-15 → 2026-10-03 | yes | price cut to ₪29.90 | DiscountedPrice only |  | held | mix-and-match across packs; the description states no price to confirm it |
| yochananof | גולדסטאר שישייה | 1 (1) | 1 | 2026-09-15 → 2026-10-03 | yes | multi-buy 2 for ₪55.00 | DiscountedPrice only |  | held | the description states no price to confirm it |
| yochananof | בירה גולדסטאר לא מסונן שישייה | 1 (1) | 3 | 2026-09-15 → 2026-10-03 | yes | price cut to ₪29.90 | DiscountedPrice only |  | held | the description states no price to confirm it |
| yochananof | שישיית בירה באדוויזר 330 מ"ל | 1 (1) | 1 | 2026-09-15 → 2026-10-03 | yes | multi-buy 2 for ₪65.00 | DiscountedPrice only |  | held | the description states no price to confirm it |
| yochananof | סומרסבי | 3 (3) | 10 | 2026-09-17 → 2026-10-03 | yes | multi-buy 2 for ₪17.00 | DiscountedPrice only |  | held | mix-and-match across packs; the description states no price to confirm it |

## Duplicates

* Within a file, on (chain id, sub-chain, store, item code): 0 repeated rows (the last one wins).
* The same GTIN at 2+ chains (the only codes allowed to match across chains): 69 barcodes. Where the
  readings agree, one chain's name fills in the container another chain's truncated name lost.
* A GTIN read as different packs at different chains: 4 — every reading of it is held (listed under Unresolved).
* Internal (non-GTIN) item codes among beer rows: 7 — matched per chain only, never across chains.

## Schema incompatibilities found

Against migrations 0007–0013 (see INGESTION-READINESS §7 for the full field table):

1. **Mix-and-match promotions** ("גולדסטאר / מכבי 2 ב 55") apply one multi-buy across several SKUs. `price_observations` holds
   one SKU per row: each SKU would carry the same `conditions.multi_buy` plus a `conditions.group` id, or the promotion is held.
   Needs a decision; until then these are held.
2. **Banners vs publishers**: the stores table treats יינות ביתן as a chain, but its feed is published by Carrefour
   (7290055700007). A feed chain id → store mapping (and possibly sub-chain) is needed; there is no column for it.
3. **No source product table**: the chain's item code and raw name are kept only in `raw` per observation. Aliases
   (chain + item code → SKU, created by a human) have no table yet (prerequisite 4).
4. **Unit of the Quantity field**: the skill's output drops the XML `UnitQty`, so a pack's total volume is read by magnitude
   (≥ 50 → ml, else litres). Works for beer; the skill (or our fetcher) should pass `UnitQty` through.
5. **`update_date` is the last price change, not the observation**: it runs back to 2015. The file timestamp is used
   for `observed_at`.
6. **Promotion price**: `<DiscountedPrice>` is the total for `MinQty` units ("2 ב 55" = MinQty 2, 55.00) — a convention read
   from these files, confirmed where the description agrees. RewardType is not used (unsourced). `promo_type` fits
   (multi_buy, price_cut, club_price); `conditions` holds club, min/max qty. A payment-method condition ("אשראי") has no field.
7. **Branches**: each file is one store; `branches` has no rows. Prices are per branch, the app shows chains.
   Chain-wide price = which branch? Decision needed (suggest: the chain's lowest regular price across branches, or one reference branch).

## External prerequisites still missing

* A staging Supabase project to rehearse `start_ingestion_run` → `record_prices` → `rollback_ingestion_run` (owner).
* Each chain's terms of use and attribution (owner / legal).
* Owner decisions: non-alcoholic / malt / radler / cider scope; mix-and-match; chain-wide vs branch price; deposit and VAT (the
  skill says published prices include 18% VAT; deposit is a separate item — see the פקדון rows excluded above).
* Feeds not reachable this way: super-yuda; and victory, mahsanei, hatzi-hinam, king-store, ampm, yeinot-bitan (banner) — see INGESTION-READINESS §7.
