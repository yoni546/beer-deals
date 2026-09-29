# Changelog

<!-- GENERATED from src/content/releases.json by `npm run changelog`. Do not edit by hand. -->

Versioning: PATCH = fix / copy / data, MINOR = new user-visible capability,
MAJOR = data-model or navigation rebuild. Every meaningful change ships an entry
(see CLAUDE.md).

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
