# Changelog

<!-- GENERATED from src/content/releases.json by `npm run changelog`. Do not edit by hand. -->

Versioning: PATCH = fix / copy / data, MINOR = new user-visible capability,
MAJOR = data-model or navigation rebuild. Every meaningful change ships an entry
(see CLAUDE.md).

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
