import { Screen, TopBar } from "@/components/Chrome";
import { Tape } from "@/components/ui/Tape";
import { PRIVACY_CONTACT, PRIVACY_UPDATED } from "@/lib/privacy";

export const metadata = { title: "מדיניות פרטיות" };

/**
 * The privacy policy (0.43.0) — required by both app stores, and linked from the store listings, so it
 * opens without onboarding and without a session (the middleware leaves /privacy alone).
 *
 * EVERY LINE IS A FACT ABOUT THIS CODE. When a feature starts collecting something new, this page changes
 * in the same pull request; tests/privacy.test.ts holds the claims that are easiest to break silently.
 */
export default function PrivacyPage() {
  return (
    <Screen bare>
      <TopBar title="מדיניות פרטיות" sub={`עודכן ב־${PRIVACY_UPDATED}`} />
      <Tape as="article" className="space-y-5 px-5 py-6 text-base leading-relaxed text-ink">
        <Part title="בקצרה">
          מבצעי בירה מראה מחירי בירה מהרשתות ומחנויות משקאות. אין באפליקציה פרסומות, אנחנו לא מוכרים מידע לאף אחד, ואין כלי מעקב או
          ניתוח שימוש של צד שלישי. כדי להשתמש בה לא צריך להירשם, למסור טלפון או אימייל.
        </Part>

        <Part title="מה נשמר עליכם">
          <ul className="list-disc space-y-1.5 ps-5">
            <li>חשבון אנונימי שנוצר אוטומטית בכניסה הראשונה, כדי לזכור את ההעדפות שלכם. אין לו שם משתמש או סיסמה.</li>
            <li>שם פרטי, אם בחרתם לכתוב אחד. הוא נשאר פרטי ומשמש רק לברכה במסך הבית.</li>
            <li>הבירות שבחרתם ובירות שאתם עוקבים אחריהן, עם מחיר יעד אם קבעתם.</li>
            <li>
              המקום שלכם, אם מסרתם: יישוב, ואם ביקשתם &quot;מיקום נוכחי&quot;, נקודה בדיוק של כ־10 מטרים. היא משמשת רק לחישוב המרחק
              לסניפים. אפשר למחוק אותה בהגדרות.
            </li>
            <li>אם הפעלתם התראות: כתובת ההתראות שהדפדפן או הטלפון נותנים, והתראות שנשלחו אליכם.</li>
            <li>מבצעים ששלחתם (כולל תמונה, אם צירפתם), ודיווחים כמו &quot;המבצע נגמר&quot;.</li>
            <li>שם לקרדיט, אם בחרתם אחד. השם הזה כן מוצג לכולם, ליד מבצעים שמצאתם.</li>
          </ul>
        </Part>

        <Part title="מה נשמר רק על המכשיר">
          המבצעים ששמרתם (כפתור &quot;שמירה&quot;) נשמרים בעוגייה במכשיר בלבד, כמזהים של מבצעים, בלי מחירים ובלי פרטים עליכם.
        </Part>

        <Part title="מי עוד רואה מידע">
          <ul className="list-disc space-y-1.5 ps-5">
            <li>Supabase, שמאחסנת את מסד הנתונים, ו־Vercel, שמריצה את האתר. שתיהן שומרות את המידע עבורנו בלבד.</li>
            <li>
              במסך המפה, האריחים של המפה נטענים משרתי OpenStreetMap, ולכן הם רואים את כתובת ה־IP שלכם. הם לא מקבלים את המקום ששמרתם.
            </li>
            <li>התראות עוברות דרך שירות ההתראות של הדפדפן או של מערכת ההפעלה (Google, Apple או Mozilla), כמו בכל אפליקציה.</li>
            <li>כשאתם לוחצים על קישור לחנות משקאות, אתם עוברים לאתר שלה, והמדיניות שלה חלה שם.</li>
          </ul>
        </Part>

        <Part title="מחיקה">
          בהגדרות, תחת &quot;הפרטיות שלי&quot;, יש &quot;מחיקת החשבון שלי&quot;. היא מוחקת מיד את החשבון ואת כל מה שנשמר עליו. מבצעים
          ששלחתם, ותמונות שצירפתם להם, נשארים כי הם מחיר שפורסם בחנות, אבל בלי שום קשר אליכם. אפשר גם לבקש מחיקה באימייל.
        </Part>

        <Part title="גיל">האפליקציה עוסקת במשקאות אלכוהוליים ומיועדת לבני 18 ומעלה.</Part>

        <Part title="יצירת קשר">
          שאלות או בקשות על המידע שלכם:{" "}
          <a href={`mailto:${PRIVACY_CONTACT}`} className="underline underline-offset-4">
            <bdi>{PRIVACY_CONTACT}</bdi>
          </a>
        </Part>
      </Tape>
    </Screen>
  );
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="text-ink-2">{children}</div>
    </section>
  );
}
