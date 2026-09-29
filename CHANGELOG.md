# Changelog

<!-- GENERATED from src/content/releases.json by `npm run changelog`. Do not edit by hand. -->

Versioning: PATCH = fix / copy / data, MINOR = new user-visible capability,
MAJOR = data-model or navigation rebuild. Every meaningful change ships an entry
(see CLAUDE.md).

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
