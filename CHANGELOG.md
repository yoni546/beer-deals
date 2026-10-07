# Changelog

<!-- GENERATED from src/content/releases.json by `npm run changelog`. Do not edit by hand. -->

Versioning: PATCH = fix / copy / data, MINOR = new user-visible capability,
MAJOR = data-model or navigation rebuild. Every meaningful change ships an entry
(see CLAUDE.md).

## 0.15.0 — 2026-10-07

**אפשר לשנות את היישוב ואת מרחק הנסיעה בהגדרות** · Feature, Fix

- מי שדילג על שאלת המיקום בהרשמה, או שעבר דירה, יכול להגדיר אותה עכשיו בהגדרות.
- אותו בורר יישובים ואותם מרחקים כמו בהרשמה.
- מחיקת היישוב ושמירה מסירה אותו לגמרי — לא צריך להמציא עיר כדי שנפסיק למדוד מרחקים.

Internal:

- src/components/LocationEditor.tsx reuses PlacePicker and the saveLocation action, added to /settings as a new section. It tracks what is on record in its own state rather than from the prop: a client component's initial props do not come back changed after the action revalidates, so the success notice and the disabled-save both need a local snapshot. The notice shows only while nothing has been touched since the save -- a success message above a changed form would be telling the person their current edit is saved.
- ACCESSIBILITY FIX (from the V2 audit). Settings built its section ids as `s-${title}`, so the Hebrew heading 'הבירות שלי' produced the id 's-הבירות שלי'. A space is not valid in an id, and aria-labelledby is a SPACE-SEPARATED list of IDREFs -- it split into two tokens pointing at nothing, leaving every section on the page unnamed to a screen reader navigating by region. axe does not flag it, because the attribute and the heading each look well-formed alone. Sections take an explicit slug id now, and tests/aria-ids.test.ts refuses any aria id interpolated from free text.
- Profile gains home_city/home_lat/home_lon/search_radius_km, and getViewer asks for them with a fallback to the pre-0026 column list -- a database that has not had the migration applied yet must not fail the whole profile read, which is the read that used to throw people out of the app.
- The two forms on /settings both say 'שמירה', so the e2e scopes each to its section by region name -- which the aria fix above is what makes possible.

## 0.14.1 — 2026-10-07

**הציון מופיע על המבצעים** · Feature

- על כל מבצע עם מחיר ייחוס אמין מופיע עכשיו הדירוג שלו: מטורף, משתלם מאוד, סביר, או לא באמת מבצע — עם המספר לצידו.
- מבצע בלי מחיר ייחוס פשוט לא מציג ציון. בלי אפס, בלי מציין מקום.

Internal:

- src/lib/offers.ts reads offer_scores through the shared cached reader and merges on offer_key (decorate = withPackaging + withScores). offers_feed is deliberately untouched: joining the score in would mean replacing the view 0018 and 0022 spent two migrations making cheap. A missing table (migration not yet applied) returns {} rather than throwing -- the deals are still true, they just arrive unscored.
- src/components/ui/DealScore.tsx: the band in WORDS with the number beside it, never colour alone and never an emoji. Only contrast-verified text roles; the weak band uses ring-danger and not text-danger, because the theme generator fixes `danger` at one lightness for both modes, which is why the project uses it as a border. Shown on OfferLine (in the facts row, beside the condition chips) and on the Hero.
- refresh_offer_scores() runs at the end of scripts/ingest/run.mjs and after the five admin actions that add, remove or reprice a deal. Neither is allowed to fail its caller: a live but unscored deal is a far smaller problem than an import being undone or an admin being told their approval failed when it did not.
- The ingest run also rings POST /api/cache/revalidate, reading the address and the secret from the TARGET'S git-ignored env file rather than the shell -- the project's own guard test (tests/ingest.test.ts) caught the first attempt, and reading it from the environment could point the doorbell at a different deployment than the data.

## 0.14.0 — 2026-10-07

**ציון למבצע — כמה הוא באמת שווה** · Feature

- לכל מבצע עם מחיר ייחוס אמין יש עכשיו ציון מ-0 עד 100, ודירוג: מטורף, משתלם מאוד, סביר, או לא באמת מבצע.
- הציון בודק בעיקר מול הרשתות האחרות, לא מול מחיר המדף של אותה רשת — כך שרשת לא יכולה לנפח לעצמה הנחה.
- הוא גם יודע אם זה המחיר הכי טוב שראינו לאריזה הזאת בחצי השנה האחרונה.
- למבצע בלי מחיר ייחוס אמין פשוט אין ציון. לא ננחש.

Internal:

- Migration 0027: public.offer_scores (offer_key primary key, score, band, basis jsonb, computed_at) plus refresh_offer_scores(). Formula and reasoning in docs/DEAL-SCORE.md; 12 cases in tests/deal-score.test.ts.
- Three components, each from a measurement already on record: CHAIN 0.25 (value_pct, the chain's own claim, weighted LEAST because a chain that lifts its shelf price deepens its own discount for free), MARKET 0.45 (market_value_pct, the median of >= 2 OTHER chains, which no chain can inflate), HISTORY 0.30 (where the price sits between the lowest and the median of every observation for that pack in 180 days, >= 4 samples required). Missing components are dropped and the weights renormalised; a chain-only score is capped at 80, because one self-reported signal cannot make something exceptional. basis records every input, its points and its weight, so any score can be explained.
- value_pct null or needs_review -> NO ROW. Not a zero: a zero is a claim, absence is the truth. Same rule CLAUDE.md sets for discounts, one level up. Each refresh also deletes the score of an offer that has ended, so nothing keeps a number it can no longer justify.
- A table refreshed by the import, not a view: 0018's header records the feeds timing out at ~10,600 live promotions and ~32,000 regular prices when something recomputed over the ledger per request, and the history component reads 180 days of it. offers_feed is deliberately untouched -- joining the score in would mean replacing the view 0018 and 0022 spent two migrations making cheap. The app reads offer_scores separately on the same offer_key and merges.
- Guarded by require_price_writer() (0008) rather than a second hand-rolled check: whoever may write a price may write what we think of it. Everyone may read.

## 0.13.0 — 2026-10-07

**מספרים לנו איפה אתם גרים, וכמה רחוק שווה לכם לנסוע** · Feature

- בהרשמה יש עכשיו שלב חדש: היישוב שלכם, וכמה רחוק אתם מוכנים לנסוע בשביל מבצע.
- רק היישוב — לא צריך כתובת. אפשר גם לבחור "השתמשו במיקום שלי", והדפדפן יבקש רשות רק אחרי שתלחצו.
- אם היישוב שלכם לא ברשימה, פשוט כתבו אותו. זה נשמר.
- אפשר לדלג על השלב הזה לגמרי ולהמשיך.

Internal:

- src/data/israel-cities.ts: 90 settlements with approximate centres, each row carrying its source. The file states plainly what it is -- hand-compiled from public geographic knowledge, good to a kilometre or two, which is the right precision for a radius chosen in 5 km steps and nothing more -- and documents the refresh path from data.gov.il's settlements resource for when the build has outbound network. Deliberately a weaker claim than the project makes about prices.
- src/lib/cities.ts reuses src/lib/search.ts rather than growing a second idea of matching, so the folding that lets 'שופר-סל' find שופרסל also lets 'תל אביב' find תל אביב-יפו and forgives 'נתנייה'. nearestCity() returns null beyond 25 km rather than naming somewhere absurd for a fix we cannot explain. kmBetween() is the same haversine as public.km_between (0026), so client and database never disagree.
- src/components/PlacePicker.tsx: settlement autocomplete, an explicit 'use my location' (the geolocation prompt never fires because a screen loaded -- an e2e stubs getCurrentPosition and asserts it is untouched until tapped), and the radius chips, which appear only once there is a place to measure from. A typed name we do not hold is kept as text with no coordinates: a real answer, just not a measurable one.
- Onboarding is five steps now; the save moved from the ranking step to the place step so the beers and the place go in one submit. persistLocation() runs after save_preferences and is deliberately not allowed to fail the whole save -- the beers are what the app cannot work without, a location is an enhancement. Also exports saveLocation for Settings.
- Added PinIcon. The 'use my location' button is btn-ghost, not btn-quiet: btn-quiet is the paper variant and its ink colour fails contrast against the dark counter -- caught by the existing axe sweep, which now also covers the place step in light and dark and at three viewport sizes.
- tests/cities.test.ts holds the list to its own claim: every point inside the bounds 0026 accepts, no two places on the same spot, and the distances between the big cities check out against reality.

## 0.12.0 — 2026-10-07

**בקבוקים קלים יותר, והתשתית למבצעים לפי מרחק** · Feature, Fix

- תמונות הבקבוקים ברשימות קלות ב-90 אחוז. דף הבית נפתח מהר יותר, במיוחד ברשת איטית.
- הכנו את הבסיס ל"מבצעים קרובים אליי": מרחקים, רדיוס חיפוש ועיר מגורים.
- סניף שאנחנו לא יודעים איפה הוא פשוט לא יוצג כקרוב — לא ננחש.

Internal:

- Thumbnail tier: scripts/lib/bottle-thumb.mjs writes <slug>@216.webp (3x the 72px Home key) beside the hero asset; prepare-bottle.mjs does it for new photos and scripts/make-bottle-thumbs.mjs backfilled the 27 on record. 1245 KB -> 123 KB, 90% smaller. BeerBottle takes the thumb at height <= 96; BottleBackdrop keeps the full file. Home's keys are eager, not lazy: they are in the header, above the fold on every phone. Same approved pixels, only scaled, so the provenance recorded for the full photo covers it.
- tests/bottle-photos.test.ts now declares PHOTOLESS, so photo coverage can only shrink deliberately (the old floor was '>= 19 entries' while 27 existed -- eight photos and their manifest entries could have been deleted together and CI stayed green); asserts manifest width/height against sharp metadata; and holds a per-file byte budget.
- Migration 0026 is the geographic foundation. branches gets latitude/longitude/geocoded_at/geocode_source/geocode_precision with four CHECKs: both-or-neither, inside Israel (a typo and unit-confusion guard, catching a swapped pair or a 0/0 fix), a known precision, and no coordinate without a recorded source. profiles gets home_city/home_lat/home_lon/search_radius_km, the radius constrained to the set the app offers plus 0 for nationwide. save_location() is a definer function, not a column grant, for the same reason save_preferences is: 0010 revoked table-wide UPDATE on profiles, and the columns that decide what a person is shown are written in one audited place that can only touch auth.uid()'s row.
- km_between() is haversine in plain SQL and branches_within_km() is a bounding-box prefilter plus the exact distance -- NOT postgis/earthdistance, because the suite runs the real migrations on PGlite and that is what makes the RLS tests trustworthy. At ~1,100 branches this is comfortably fast; every caller goes through branches_within_km(), so a spatial index later is a local change.
- NO COORDINATE IS INVENTED. The price-transparency Stores file carries name, address and city and never a position, so real branch coordinates need a geocoding provider and a credential this repository does not have. The columns ship empty and branches_within_km() never returns an unlocated branch -- not even nationwide. 'We do not know where this is' is a first-class state, like a price with no trusted reference.
- New POST /api/cache/revalidate (Bearer CRON_SECRET, 503 when unconfigured, same discipline as the notification worker). The shared reads are held under FEEDS_TAG for five minutes and every admin action clears it, but an INGESTION RUN writes to Postgres from a script and cannot -- so after an import the app served the previous catalogue, and the SKU index is not merely stale in that window, it decides which offers a beer page can find at all. The e2e suite rings the same doorbell after it resets the fake database; without it one test's catalogue was served to the next, which is how 0.11.2's caching broke seven specs.
- middleware no longer runs the session machinery for /bottles/, /onboarding/ or /api/cache/ -- static files and a bearer-token endpoint have no use for an anonymous user, and the bottle path was adding a hop to the LCP image.

## 0.11.2 — 2026-10-07

**האפליקציה נפתחת מהר יותר** · Fix

- מעבר בין המסכים כבר לא מבקש מהשרת דפים שלא ביקשתם — זה היה עד פי ארבעה עבודה מיותרת בכל צפייה.
- רשימת הבירות והרשתות נקראת פעם אחת ולא בכל כניסה לכל דף.
- תמונות הבקבוקים נשמרות במכשיר במקום להיבדק מחדש בכל ניווט.
- מסך שליחת מבצע נטען קל יותר בשני שלישים.
- אחרי עדכון גרסה כבר לא תיתקעו עם קוד ישן שגורם לשגיאה בלחיצה על כפתור.

Internal:

- prefetch={false} on the TabBar (root layout, four force-dynamic routes) and on ListingSearch/BeerStrip/OfferLine/RegularStrip row links. /beer renders ~40 prefetching rows and a busy chain page ~340 anchors, each one a full dynamic render in Tokyo queued ahead of the person's own tap. Hero keeps its prefetch: one link, the likeliest tap.
- New src/lib/feeds.ts holds publicReader + cachedFeed + FEEDS_TAG, so queries.ts can use them without importing offers.ts (which imports queries.ts). getBeers/getStores/getSettings and the SKU index now read through the cookie-less anon client under FEEDS_TAG with explicit column lists instead of select(*) on every page load — 4-5 round trips off the critical path of every page. Every table involved is `select to anon, authenticated using (true)` with a matching grant, so the anon role sees the same rows; every admin mutation already clears FEEDS_TAG.
- getBeerBySlug/getStoreBySlug read a SEPARATE cached index over every row, not the filtered choose-from list: a deactivated beer's or a cider's page must still render rather than 404.
- next.config.ts: /bottles/ and /onboarding/ get max-age=31536000, immutable. They are written once per beer by prepare-bottle.mjs and were revalidated on every navigation — the LCP image.
- sw.js: navigationPreload so a navigation leaves the device while the worker boots (navigations stay network-only); the offline page is precached with its own add so a missing icon cannot take it down, and the navigate handler can no longer call respondWith(undefined); /bottles/ and /onboarding/ are cache-first; /_next/static/ is NO LONGER cached — Next already serves it immutable, while a cache-first rule under a fixed cache name grew without bound and let an open tab run the previous deploy's JS against the new server, which is what produced 'Failed to find Server Action' and the generic error screen after a release.
- SubmitDealForm imports supabase-js dynamically inside the upload handler: /submit first load 178 kB -> 111 kB.
- The store page no longer awaits getStoreBySlug before getViewer; they are independent.
- Still outstanding from the audit's section 2: getFreshness computes the ranked feed to read one timestamp (needs a cheap SQL function), and the materialized-CTE fence in offers_ranked (C1) is the remaining database floor.

## 0.11.1 — 2026-10-07 (internal)

**המספרים בלוח הניהול אומרים את האמת** · Fix

- "מבצעים באוויר" ספר כל מבצע ידני פעמיים. עכשיו הוא נכון.
- "הורדו השבוע" ספר גם עריכות של מבצעים ישנים. עכשיו הוא סופר רק הורדות אמיתיות.
- "נשלחו ע״י משתמשים" ספר גם מבצעים שמנהל הקליד בעצמו.
- תיבת "שלחו התראה" ביצירת מבצע ידני לא עשתה כלום. עכשיו היא עובדת.
- רשימת המנהלים כבר לא גלויה למי שאינו מנהל.

Internal:

- Migration 0025. deals.deactivated_at (written by set_deal_status) replaces updated_at as the takedown signal — deals_touch bumps updated_at on any edit, so editing a months-old rejection counted as a takedown this week. deals.entered_by_admin is recorded at insert by admin_add_deal, because deciding it from current admins membership would be wrong the moment somebody gains or loses the role. Rows deactivated before 0025 have a null deactivated_at and are not counted: honest from here rather than wrong forever.
- admin_overview: offers.live and the new offers.from_chains are reported separately and must never be added (offers_feed is catalog UNION ALL deals_public). notifications.sent_ever filters kind='offer' so an admin's test pushes stop inflating it. The expiring window uses (now() at time zone 'Asia/Jerusalem')::date — current_date is UTC on Supabase and rolls over at 02:00/03:00 local. The three whole-feed counts are one pass instead of three.
- admin_add_deal now enqueues the notification itself: the enqueue trigger is `after update of status`, so an INSERT never fired it and p_notify had no effect at all. Same dedupe key and expiry as enqueue_deal_notification (0012).
- M-3: admins_read was `to authenticated using (true)`, and middleware gives every visitor an authenticated anonymous session, so the whole roster — including which id is the super admin — was readable with the public anon key. Now own-row-or-admin. is_admin()/is_super_admin() still answer 'am I an admin?' for anon.
- getAdminOverview and getExpiringOffers report their errors instead of discarding them, and getExpiringOffers returns {rows, ok} so the screen can tell 'nothing ends this week' from 'we could not look'. Its window was also UTC-dated in JS.
- tests/admin-metrics.test.ts (9 cases) asserts what each number MEANS. The previous suite only proved admin_overview refuses a non-admin, which is why four wrong metrics survived.

## 0.11.0 — 2026-10-07

**בוחרים בין בירה אחת לארבע — והמסכים כבר לא נופלים בשלמותם** · Feature, Fix

- לא חייבים ארבע בירות. בוחרים אחת, שתיים, שלוש או ארבע — והראשונה עדיין קובעת את המראה של האפליקציה.
- כשחלק מהמסך לא נטען, רק אותו חלק אומר זאת ומציע לנסות שוב. שאר הדף נשאר.
- כבר לא יוצג "אין מבצעים" כשפשוט לא הצלחנו לבדוק — אלו שני דברים שונים.
- תקלה רגעית כבר לא מחזירה אתכם להרשמה מחדש ולא מאבדת את הבירות שלכם.
- הדף הראשי נפתח מהר יותר כשמוגדר מבצע שבועי.

Internal:

- Migration 0024 replaces save_preferences(): between one and four beer ids instead of exactly four, and an INSERT ... ON CONFLICT DO NOTHING plus a row-count check so a missing profile row can no longer produce a successful-looking save that leaves onboarded_at null — the silent onboarding loop. user_favorite_beers needed no change: check (rank between 1 and 4) with PK (profile_id, rank) already allowed one to three rows.
- The 1-4 change touches: src/lib/actions/profile.ts (zod min/max), src/lib/session.ts (isOnboarded >= 1), Onboarding.tsx, FavouritesEditor.tsx (the last beer has no remove button), OnboardingStage.tsx (empty slots only during 'pick'; data-count on the stage), onboarding.css (per-count re-centring of the line), FavouriteKeys.tsx (grid sized from beers.length; aria-label no longer says ארבע — it was an e2e locator in two specs).
- src/lib/attempt.ts + src/components/CouldNotLoad.tsx: each Home read fails on its own instead of blanking the route. offers.ts still throws rather than returning an empty list — that part was right. Home's empty state is now suppressed when a read failed.
- src/lib/session.ts reports a degraded read; every redirect that could act on an absence (/, /settings, the admin layout) checks it first. Previously a timeout was indistinguishable from 'no profile and no favourites'.
- src/middleware.ts mints an anonymous user only when no session cookie is present — getUser() returns {user:null} for every failure, including the refresh-token rotation race, and the old branch replaced the person's identity. It also skips the auth round trip while the token is comfortably valid.
- getOfferByKey pairs offer_key with origin (a plan-time constant per union branch) so a weekly-deal lookup no longer computes the whole feed on every Home render.
- Added src/app/global-error.tsx; src/app/error.tsx now surfaces and logs the digest; src/lib/log.ts is the app's first server-side logging.
- docs/V2-AUDIT-2026-10-07.md records the full audit these fixes came from.

## 0.10.4 — 2026-10-06 (internal)

**הקשחת אבטחה** · Fix

- חיזקנו את ההגנה על פעולות של מנהלים ושל משתמשים מחוברים. שום דבר לא משתנה בשימוש באפליקציה.

Internal:

- Migration 0023: EXECUTE revoked from PUBLIC/anon on admin_update_deal, approve_deal, grant_admin, resolve_report, revoke_admin, save_preferences, save_push_subscription, set_deal_status, set_weekly_deal, update_notification_settings (authenticated keeps it; each function already refused inside). Found by the production security audit 2026-10-06. tests/function-grants.test.ts.

## 0.10.3 — 2026-10-06

**הדף הראשי ועמודי הרשתות והבירות נפתחים מהר יותר** · Fix

- עמודי הרשתות והבירות טוענים רק את מה שצריך להם, ולכן נפתחים מהר יותר.
- הדף הראשי ורשימות הרשתות והבירות כבר לא מחשבים את כל המבצעים מחדש בכל כניסה.

Internal:

- src/lib/offers.ts: feeds are filtered by their partition keys — a chain by store_id, a beer by its SKU ids (+ legacy deals by beer_id, where the view is tiny) — never by slug or beer_id, which made Postgres compute the whole feed first. Production 2026-10-06: a chain's deals 1.3 s → 0.22 s, regular prices 0.76–1.4 s → 0.08 s, mix-and-match 0.50 s → 0.016 s; a beer's deals 1.3 s → 0.32 s, regular prices 0.7 s → 0.09 s.
- Whole-feed reads that are the same for everyone (Home's freshness and 'more deals' pool of the top 200 by saving, the beer and chain listings) are cached for 5 minutes via unstable_cache with a cookie-less anon client; admin actions revalidateTag('feeds'). Guard: tests/feed-filters.test.ts.

## 0.10.2 — 2026-10-06

**עמודי מבצעים מהירים יותר** · Fix

- עמודי הרשתות והבירות נטענים מהר יותר, גם כשיש הרבה סניפים ומחירים.

Internal:

- Migration 0022: offers_ranked's reference regular price found by two one-row probes of the new partial index price_obs_live_regular (sku, store, branch, observed_at desc, id desc) INCLUDE (price_agorot, source_id) WHERE kind='regular' AND status='live', instead of reading every branch's price of the pack and sorting. Same rows as 0018 (except all both ways on staging: 13,728 rows; tests/offers-reference.test.ts). Staging, warm, as the public: Rami Levy 0.42 → 0.22 s, Shufersal 1.7 → 0.46 s, Victory 0.30 → 0.14 s, a beer page 2.36 → 0.89 s; buffers 467k → 43k. Rollback: supabase/rollback/0022_offers_reference_probe.down.sql.

## 0.10.1 — 2026-10-06

**ארגזים הם ארגזים של בקבוקים** · Fix, Data

- תחת "ארגזים" מופיעים רק ארגזים אמיתיים של בקבוקים, כשהרשת עצמה מוכרת אותם כארגז.
- מגש של 24 פחיות, או קרטון של בקבוקים, הוא מארז ומופיע תחת "שישיות" בשם "מארז 24".
- ארגז מופיע תחת "ארגזים" גם כשאין עליו מבצע: קודם המבצעים, ואחריהם המחירים הרגילים.

Internal:

- Migration 0021 (skus.packaging single|multipack|bottle_crate, part of skus_identity; a trigger defaults single/multipack from the count, never a crate; checks: crate = 12+ bottles, single = 1 unit). Backfill: bottle_crate only where a source_products title says ארגז on 12+ bottles and not קרטון/שרינק/מגש. Rollback: supabase/rollback/0021_sku_packaging.down.sql.
- Ingestion: normalize.mjs packagingOf (positive evidence: the chain's own ארגז/crate wording on 12+ bottles); packaging joins skuKey and the writer's SKU identity; a crate's display_he says ארגז.
- App: classOfPack/packNameHe read packaging (src/lib/offers.ts joins skus.packaging by sku_id; unknown = never a crate); the push worker names crates the same way. Identifiers small_multipack/case unchanged (?pack=case links keep working).
- Production audit 2026-10-06: Stella 24×330 at Victory (31 branches) is the one bottle crate — title 'ארגז בירה סטלה בקבוק 330 מל- 24 יח', 7.92 L, ₪120, GTIN 5410228154693. Carlsberg 24×500 cans ('פחית קרלסברג קרטון 2') is a multipack.
- Admin: /admin/queue renders AddDealForm (imported but never rendered in 0.9.0/0.10.0). Tests: tests/admin-rpcs.test.ts, tests/e2e/admin.spec.ts, tests/sku-packaging.test.ts.

## 0.10.0 — 2026-10-05

**כניסה ראשונה חדשה: הבקבוקים שלכם על הבמה** · Feature, Design

- ההיכרות עם האפליקציה היא עכשיו ארבעה צעדים קצרים: שם, ארבע בירות, הסדר שלהן, וסיום.
- הבירות שבחרתם עומדות בשורה בראש המסך, כבקבוקים אמיתיים. את הסדר קובעים בגרירה של בקבוק או של שורה, והצבעים מתחלפים מיד לפי הבירה הראשונה.
- בסוף הפקק עף מהבירה הראשונה והיא מוזגת לעצמה כוס, בצבע ובכוס שמתאימים לה.
- בכניסה לאפליקציה הבקבוק עובר מהבמה אל מסך הבית, והאפליקציה כבר נראית כמו הבירה שלכם.
- באנדרואיד יש רטט קצר ברגעים החשובים, והבקבוק מסתובב כשמטים את הטלפון. כפתור "בלי אנימציה" מכבה את הכל.

Internal:

- No WebGL, no new dependency, no new assets: the stage (src/components/OnboardingStage.tsx + src/app/welcome/onboarding.css, loaded by /welcome only) is the approved bottle photos in CSS perspective — a slow turn, a band of light masked by the photo's own outline, a drawn cap that pops, and a pour into a drawn glass. Transforms and opacity only.
- Flow: name → pick four → rank (new, separate step) → reveal. The save still happens once, through completeOnboarding/save_preferences, with beerIds in ranked order; the last step still appears only after a successful save and stays until the button is pressed. No schema change, no migration.
- RankedBeers (drag by grip + arrows + announcements) extracted from FavouritesEditor and shared by Settings and onboarding. Same labels and data attributes as before.
- Motion levels on main.ob[data-motion]: full / lite (hardwareConcurrency or deviceMemory < 4: no idle loops) / off (the in-page switch; not stored anywhere). prefers-reduced-motion lands every scene in its final state.
- Design data: pourFor() (themes.ts) gives the beer and head colours and the kind of glass.
- Tests: tests/e2e/onboarding.spec.ts (flow, mid-pour exit, back, reduced motion, the switch, no-identity beer, quality floor + axe in light and dark, 360×640 / 412×915 / 1280×800). e2e helper and the unit test walk the extra step; floorViolations moved to tests/e2e/helpers.ts.
- Home arrival: cross-document view transition (globals.css @view-transition + names hero-bottle / page / tab-bar). The inline pagereveal script in the root layout adds the type from-welcome for /welcome → / and calls skipTransition() for every other page load, so nothing else in the app changes. prefers-reduced-motion: navigation none; the in-page switch skips it on pageswap.
- Real cap: bottle-photos.json gains `cap` (fraction of height where the crown ends), measured from the cut-out's outline by scripts/lib/bottle-cutout.mjs capBottom(); scripts/measure-caps.mjs re-measures all, prepare-bottle.mjs records it for a new photo. Tuborg, Tuborg Red (pull-ring) and Leffe (foil) have none and simply pour. The photo files are unchanged.
- Haptics (navigator.vibrate) and tilt (deviceorientation → --gyro) live in Onboarding.tsx, gated by the motion level.
- Dev note: the service worker caches /_next/static, so a running `next dev` can serve stale client chunks after an edit — unregister it in DevTools when the page and the server disagree.
- The opening bottle is a Blender (Cycles) render of our own — scripts/render-opening-bottle.py builds it from numbers (a lathed profile, no model file, texture or brand); scripts/render-opening-bottle.mjs runs it, crops, and writes public/onboarding/{bottle,cap}.webp (40 KB + 4 KB) and src/design/opening-bottle.json. The cap is a separate piece so it can come off. It also stands in for a beer without an identity. Needs Blender only to re-render, never to build or test.

## 0.9.0 — 2026-09-30

**זמינות מבצעים לפי סניף, כיסוי רחב יותר של הרשתות ובדיקה משופרת של ארגזים** · Feature, Data

- ליד כל מבצע כתוב איפה הוא באמת קיים: בכל הרשת, בסניפים משתתפים, או בסניף אחד. "בכל הרשת" מופיע רק כשבדקנו את כל הסניפים.
- אפשר ללחוץ על השורה ולראות באילו סניפים נמצא המבצע.
- אנחנו בודקים עכשיו את כל הסניפים של כל רשת, ולא סניף אחד לדוגמה.
- מבצע שמופיע בהרבה סניפים מוצג פעם אחת, ולא שוב ושוב.
- מבצעים של "כמה ביחד" כתובים עכשיו במילים פשוטות: 2 ב־₪35, לבחירה מהמוצרים שבמבצע.

Internal:

- Migration 0017 (STAGING only): branches.listed_in_stores_file/source_listed_at; branch_scans (every known branch's outcome per scan); promotions (canonical, with scope + evidence + known/checked/matching/coverage_as_of/only_branch_id); promotion_occurrences (every public promotion a branch's current file lists, published or not); promotion_scope() — the one rule; record_branch_scan, record_promotion_occurrences, close_missing_promotions, refresh_promotion_scope; offers_feed/group_offers_feed carry scope; promotion_branches view for the where-sheet. Rollback: supabase/rollback/0017_branch_scope.down.sql (rehearsed on staging).
- Canonical promotion identity (lib/plan.mjs termsKey + canonicalKeys): listings in force with identical terms (kind, qty/price, audience, written terms, end day) that share an item or the chain's promotion id, connected over the whole chain (union-find). Dates as days; ids and item codes without leading zeros. Never the price alone, never the item list, never the id alone.
- Promotion and group content hashes include the file's time (as regular prices already did): a promotion still listed in the next file is re-recorded, so close_missing_promotions never closes a running promotion. A same-file --reprocess replays and rewrites nothing.
- Migration 0018 (STAGING only): offers_ranked computes the per-chain lowest price and the other-chains median once per query (materialized CTEs) instead of once per promotion row, plus index price_obs_live_store. offers_feed 13–24 s → ~1 s at full-branch scale. Same columns. Rollback: the 0014 definition of offers_ranked.
- scripts/ingest/scan.mjs: every branch from each publisher's Stores file; newest PriceFull/PromoFull per branch; fresh ≤ 36 h; incremental by file name (manifest) — unchanged branches are not downloaded, parsed or re-written; slim per-branch JSON (beer rows + their promotions). run.mjs reads a scan, writes inventory, scans, occurrences, closes what a branch's newest file no longer lists, refreshes scope.
- Cases: 'ארגז' no longer means 24 by itself (explicit counts win: 'ארגז 12', '4 שישיות'); 5 L kegs are not derived as 20×250; the empty returnable crate ('ארגז גולדסטאר' ₪25.90) is not beer.
- UI: ScopeLine (lazy branch list from /api/promotions/[id]/branches), scope in the headline and in notifications (only when known); mix-and-match copy.

## 0.8.0 — 2026-09-30

**שישיות וארגזים קודם, ועוד הרבה רשתות ובירות** · Feature, Data, Design

- בעמוד הראשי מוצגים רק מבצעים על שישיות וארגזים, קודם של הבירות שלכם.
- הכל מסודר בשלוש קטגוריות: שישיות, ארגזים ובודדים. כל אריזה מופיעה בשם הנכון שלה: רביעייה, שישייה, שמינייה או ארגז.
- נוספו ויקטורי, מחסני השוק, קשת טעמים, פרשמרקט, סטופ מרקט ופוליצר, ושתים־עשרה בירות חדשות כמו קרומבכר, איגל ו־1664.
- הרבה יותר מבצעים ומחירים מכל רשת: תיקנו את הקריאה של שישיות ושל מבצעים שבעבר לא הצלחנו לקרוא.
- הבירות שלי מוצגות עכשיו כבקבוקים אמיתיים עם המקום של כל אחת, ויש כפתור לשתף את האפליקציה עם חברים.

Internal:

- Beer for home: Home shows packs and cases only (offers_feed read with packsOnly: pack_quantity >= 2 or legacy); order favourites, 6-packs, cases, 8/4-packs, other packs (orderForHome); empty state 'אין כרגע מבצעי שישיות או ארגזים לבירות שלך'. Hero and editor's pick from packs only.
- Pack classes single (1) / small_multipack (2-11) / case (12+) in src/lib/offer-logic.ts; categories שישיות/ארגזים/בודדים (never מארזים); ?pack=multi and c=sixpack map to small_multipack. Labels with the real count (packNameHe). Beer and chain pages: one section per kind, deals then regular prices; default pack order 6 -> 8 -> 4 unless a price sort is chosen.
- What's New is admin-only: /whats-new checks getViewer().isAdmin on the server (notFound otherwise); the link shows for admins only. Regular users get ShareApp (Web Share API, else clipboard; always https://beer-deals.vercel.app; 'הקישור הועתק').
- Ingestion: container 'other' instead of hold; per-unit Quantity; unit-less Hatzi Hinam volumes; pack from barcode consensus (pass 1b, incl. names cut before the pack word); same-price code collapse; shelf-price confirmation of single-statement promotions; per-pack price cuts; unreadable items left out; duplicate promotions merged; min-basket / per-customer limit terms. Laib Catalog JSON API (Victory, Mahsanei). New publishers keshet, freshmarket, stop-market, politzer; blocked (password): super-yuda, salach-dabach, yellow.
- Migration 0016: 12 beers (+brands), 4 stores, 4 sources. Applied to STAGING only. Staging re-imported (rollback + re-import of 2026-09-29 files): 1,027 regular, 307 public promotion rows, 70 mix-and-match live. docs/RETAILER-COVERAGE.md via scripts/ingest/coverage.mjs. Same files, 0.7.1 rules -> 0.8.0: regular 170 -> 1,027; public promotions 16 -> 307.

## 0.7.1 — 2026-09-29

**מראה נקי יותר, והבירה שלכם במרכז** · Design

- הבקבוק של הבירה הראשונה שלכם עומד עכשיו במרכז המסך, ברור ומזוהה, עם שני בקבוקים קטנים לצדו.
- מיון וסינון נמצאים עכשיו בכפתור אחד קטן, שנפתח רק כשצריך.
- כל מבצע מופרד בבירור מהבא: המחיר וההנחה בשורה אחת, והפרטים החשובים בשורה שמתחת.

Internal:

- Backdrop composition: hero bottle (blur 0.6, label in the upper third) + two side bottles (soft filter, 42svh, tilted); Home stage window with caption; onboarding step 3 stage.
- SortBar folded into one <details> keyed by the active state; JumpToRegular replaces the segmented jump; OfferLine without per-line details (legacy deals keep a report toggle); solid dividers; per-litre only when sorting per litre.
- Fixes: store link at least 44px wide; e2e updated (openSort), composition asserted in favourite-one.spec.

## 0.7.0 — 2026-09-29

**מחירים לפי הסניף, מבצעים שפתוחים לכולם, ובקבוק אמיתי ברקע** · Feature, Data

- הבקבוק של הבירה הראשונה שלכם מופיע עכשיו ברקע כתמונה אמיתית של המוצר.
- בעמוד של בירה ושל רשת: קודם המבצעים של עכשיו, ואחריהם המחירים הרגילים.
- מוצגים רק מבצעים שכל אחד יכול לקבל: בלי מבצעי מועדון, כרטיס אשראי או קופון.
- ליד כל מחיר כתוב באיזה סניף הוא נמצא, וכמה פיקדון משלמים על הבקבוקים או הפחיות.
- מבצע על כמה בירות ביחד (למשל 2 ב־₪35) מוצג כמבצע אחד, ולא כמחיר מומצא לכל בירה.

Internal:

- Migrations 0014 (categories beer/non_alcoholic/radler in, malt/cider out; SKU variant; feed identity on branches; source_products alias+review queue; audience — only 'everyone' offers are read, announced or ranked; deposit beside the price; promotion_groups for mix-and-match; one row per pack x chain with 'from' the lowest branch) and 0015 (re-import after rollback; branch name/city in the views). Applied to STAGING only.
- First real ingestion into STAGING (qpjwnxptitnmtsznjvkw, ap-northeast-1): 9 chains/10 branches incl. Yeinot Bitan inside Carrefour's feed and AM:PM inside Dor Alon's; idempotency, rollback and re-import rehearsed. docs/INGESTION-STAGING-REPORT.md.
- 19 real bottle photos (17 retailer pack shots found by barcode, 1 Commons CC BY-SA) with provenance in src/design/bottle-photos.json; scripts/fetch-bottles.mjs.
- Notification worker resolves catalogue events through offers_ranked (a multi-branch promotion was being dropped as 'stale').
- vercel.json regions [hnd1] next to the database (confirm production's region before merging). Daily ingestion workflow for STAGING, gated on a clean import.

## 0.6.0 — 2026-09-29

**הבירה הראשונה שלכם היא האפליקציה** · Design, Feature

- המראה של האפליקציה נקבע לפי הבירה מספר 1 שלכם: הבקבוק שלה עומד ברקע, והצבעים באים ממנה.
- רוצים מראה אחר? משנים את סדר הבירות. בחירת מראה ידנית הוסרה, וגם הבחירה בין בהיר לכהה, שנקבעת עכשיו לפי הטלפון.
- בהגדרות אפשר לגרור בירה כדי לשנות את הסדר. הכפתורים למעלה ולמטה נשארו.
- ליד כל בירה מופיע הבקבוק שלה בקטן, כדי לזהות אותה במבט.

Internal:

- Permanent rule: favourite #1 → BEER_IDENTITIES → bottle → tokens via getThemeForBeer(slug) only. Removed ThemePicker, saveAppearance, profiles.theme_override/appearance (dropped from the never-applied draft of 0011; STAGING.md has the cleanup for any DB built from it), resolveTheme/ALL_THEMES/isThemeSlug/swatches.
- Bottle backdrop: drawn bottles (no marks) or a licensed photo (scripts/prepare-bottle.mjs, provenance in src/design/bottle-photos.json). An SVG tone filter maps every pixel into [lo, hi] so all counter text keeps >= 4.5:1 over any bottle pixel (proved per beer and mode in tests/design.test.ts); depth-of-field blur; vignette + scrim.
- Identities re-derived from each beer's colours (21 beers; Somersby deliberately neutral). Drag-to-reorder by a grip (pointer events, touch-action: none) with announced ranks; up/down buttons kept. BeerMark beside names.
- Tests: design (rule, readability proof, fallback, no override API/schema), bottle-photos, e2e favourite-one.spec (Goldstar → Heineken, drag, keyboard, no picker, device-driven mode, fallback, no flash via server HTML).

## 0.5.2 — 2026-09-29

**שיפורים קטנים בחיפוש ובהגדרות** · Design

- כשחיפוש לא מוצא כלום יש עכשיו כפתור שמנקה אותו.
- בבחירת מראה ידנית, כל מראה מציג גם את שם הבירה שהוא שייך לה.

Internal:

- ThemePicker gets beerNames (slug → Hebrew name); empty search states in HomeSearch/ListingSearch get a clear button. Closes critique P2-3 and one P3.

## 0.5.1 — 2026-09-29 (internal)

**הכנה לייבוא מחירים בטוח** · Data

- אין שינוי במה שרואים באתר: הוכנו מנגנוני הגנה לפני שיובאו מחירים אמיתיים מהרשתות (ייבוא של אותו קובץ פעם אחת, החזקת מחירים חשודים, וביטול ייבוא שגוי).

Internal:

- Migration 0013: start/finish_ingestion_run (one run per source+file hash), record_prices holds implausible prices (out of range vs the SKU median, >40% jump in 2 days) and reports them, rollback_ingestion_run rejects a run's rows AND re-records the prices they replaced (rejecting alone leaves shelves empty because superseded rows are immutable), closes pending notification events; restored rows never notify.
- docs/INGESTION-READINESS.md: the 16 prerequisites with evidence. Verdict: not ready (3 done, 7 partly, 5 blocked, 1 not started). Nothing imports anything.

## 0.5.0 — 2026-09-29

**התראות שנבנו מחדש** · Feature

- התראה נשלחת רק על מבצע שאחוז ההנחה שלו מאומת מול מחיר רגיל אמין, ורק על הבירה הראשית שלכם.
- כך היא נראית: "מבצע חדש ברמי לוי", ומתחת הבירה, האריזה, המחיר וכמה חסכתם. לחיצה עליה פותחת את דף הבירה.
- לא מפריעים בלילה: בין 22:00 ל־08:00 מחכים, ואם המבצע עדיין בתוקף מקבלים אותו בבוקר. לכל היותר שתי התראות ביום.
- בהגדרות יש כפתור "שלחו לי התראת בדיקה", כדי לוודא שההתראות מגיעות למכשיר שלכם.
- אנחנו עדיין בודקים אותן על טלפונים אמיתיים. אם משהו לא הגיע, ספרו לנו.

Internal:

- Migration 0012: notification_events (outbox, deduped), notification_deliveries (one row per person per event, every attempt), app_settings daily cap + quiet hours, admin_recent_deliveries(), update_notification_rules(); triggers enqueue on live promotions and approved legacy deals (never sample data).
- src/lib/push/{rules,message,worker,sender,run}.ts; POST /api/notifications/run (bearer CRON_SECRET, closed without it); .github/workflows/notifications.yml rings it every 10 minutes once merged to main. notify.ts and push_log writes are gone.
- Tests: rules (pure), message, worker against the real migrations via the fake Supabase (dedupe, cooldown, daily cap, quiet hours, retries, dead devices), route auth, RLS/grants.
- NOT verified on real devices: docs/NOTIFICATIONS.md §5 is the checklist; the table there is empty on purpose.

## 0.4.0 — 2026-09-29

**מראה חדש ומסכים חדשים** · Feature, Design

- עיצוב חדש מהיסוד: כל מבצע הוא שורה על רצועת קבלה, עם שם, מחיר גדול ואחוז הנחה שנבדק.
- סרגל ניווט תחתון: מבצעים, בירות, סופרים והגדרות. ובראש הדף הראשי חיפוש אחד, לבירה או לסופר.
- האפליקציה לובשת את הצבעים של הבירה הראשית שלכם. בהגדרות אפשר לבחור מראה אחר, ובהיר או כהה.
- דף בירה עם מבצעים ומחירים רגילים בנפרד, לכל אריזה בנפרד, ודף סופר עם "הבירות שלי".
- מיון לפי משתלם, מחיר או מחיר לליטר, וסינון לפי סוג אריזה. אפשר גם לסדר מחדש את ארבע הבירות.

Internal:

- Design system "The Tape" (DESIGN.md, PRODUCT.md, src/design/{color,themes}.ts): OKLCH theme generator with guaranteed contrast and enforced distinctness, 22 beer themes + house look, per-request stylesheet injection, profiles.theme_override/appearance (migration 0011).
- All public screens rebuilt on offers_feed / regular_prices_feed; new pure logic in src/lib/{offer-logic,format,search,urls}.ts (Hebrew-aware search, pack grouping, verified-saving ranking, URL-carried sort/filter state).
- Admin area restyled onto the same tokens (no behaviour change). Legacy DealCard/Picker/CategoryTabs/PreferencesEditor and the legacy deal queries removed.
- Quality gates in CI: Playwright at 390x844 and 430x932 checks touch targets >= 44px, text >= 12px, no sideways scroll, and axe WCAG A/AA in light, dark and five themes.
- Home search (HomeSearch), store pages fold beyond the first six beers, Playwright checks at 360/768px as well.

## 0.3.1 — 2026-09-29 (internal)

**הכנה לסביבת בדיקות נפרדת** · Data

- אין שינוי במה שרואים באתר: הוכנה סביבת בדיקות נפרדת כדי שניסויים לא ייגעו בנתונים האמיתיים.

Internal:

- Staging runbook (docs/STAGING.md), supabase/config.toml for the CLI, scripts/check-environment.mjs (verifies a project + site: anonymous sign-in, migrations 0001-0010, profile protection, sample data, function region).
- EnvironmentBadge: staging/development badge; red warning when a non-production environment is connected to the production database. Nothing renders in production.
- for-collaborators.md no longer tells people to develop against the live database.

## 0.3.0 — 2026-09-29

**בסיס חדש למחירים ולאריזות** · Data, Fix

- אפשר להפעיל התראות שוב גם אחרי שניקיתם את נתוני האתר בדפדפן.
- מאחורי הקלעים: המערכת מבדילה עכשיו בין גדלים ואריזות (למשל גולדסטאר 6×330 מ״ל לעומת 6×500 מ״ל), ומכינה מקום למחירים רגילים לצד מבצעים. המסכים החדשים יגיעו בהמשך.

Internal:

- Migrations 0007–0009: brands, beers.variant, skus (container · volume_ml · pack_quantity), sku_barcodes, branches, sources, ingestion_runs and the append-only price_observations ledger (regular prices + promotions, conditions, validity window, source, observed_at, history).
- record_price()/record_prices() are the only write path; read views regular_prices_current, promotions_current, offers_ranked, offers_feed (safe discount: same SKU + chain, <=14 days, feed/admin source, <=70%).
- Migration 0010: profiles column-level update grant (S-9); save_push_subscription re-parents endpoints (S-10).
- Dev/staging seeds: supabase/seed/dev-catalog.sql; sample-data source flagged is_sample.
- See docs/DATA-MODEL.md.

## 0.2.0 — 2026-09-29

**תיקוני יסוד: החיפוש חזר, ורק מבצעים אמיתיים** · Fix, Feature

- חיפוש לפי בירה ולפי סופר עובד שוב, ולחיצה על שם הבירה או החנות בכרטיס מבצע מובילה אליהם.
- מבצעי הדגמה כבר לא מוצגים כאילו הם אמיתיים.
- כפתור ההתראות בהגדרות מראה את המצב האמיתי, ואם הדפדפן מסרב להתראות מופיעה הודעה במקום שגיאה.
- הקישור שבהתראה פותח את דף הבירה הנכון, והמסך האחרון בהרשמה נשאר עד שלוחצים ״קדימה״.
- חדש: כפתור ״מה חדש״ עם היסטוריית העדכונים.

Internal:

- Guardrails: CLAUDE.md, release data + changelog generator + enforcing test, CI (typecheck, lint, tests, build), e2e harness on a local fake Supabase.
- Migration 0006: retire sample deals, notifications_enabled defaults to false, explicit service_role grants for the push sender.
- Production servers refuse to read sample deals (src/lib/demo.ts).

## 0.1.0 — 2026-09-24

**הגרסה הראשונה** · Feature

- בוחרים ארבע בירות אהובות לפי סדר, והבירה הראשונה קובעת את המראה של האפליקציה.
- מחפשים מבצעים לפי בירה או לפי סופר, בשישיות, בארגזים ובבודדים.
- אפשר לשלוח מבצע שמצאתם, והוא מתפרסם אחרי בדיקה.
- התראות על מבצע חזק על הבירה הראשית.
