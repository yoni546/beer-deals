import Link from "next/link";
import { AdminSection } from "@/components/admin/AdminUi";
import { EmptyState } from "@/components/Chrome";
import { Price } from "@/components/ui/Price";
import { getAdminOverview, getExpiringOffers } from "@/lib/admin-queries";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The admin home: the shape of the whole thing on one screen.
 *
 * These are counts, not a chart — no series, no comparison over time, nothing a
 * plot would make clearer. So they are stat tiles in the app's own type, with
 * no colour carrying meaning: anything that wants attention says so in words,
 * because a number that is only urgent by being orange is not urgent to anyone
 * who cannot see orange.
 *
 * Every figure is counted by `admin_overview()`. There are no estimates here,
 * and a thing that has never happened reads 0 rather than being hidden.
 */

function Tile({
  label,
  value,
  hint,
  attention = false,
  href,
}: {
  label: string;
  value: number | string;
  hint?: string;
  attention?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-sm text-ink-2">{label}</p>
      <p className="mt-1 num text-3xl font-black text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
      {attention && (
        <p className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-paper-line px-2 py-0.5 text-xs font-semibold text-ink">
          דורש טיפול
        </p>
      )}
    </>
  );

  const className = "block rounded-2xl border border-paper-line bg-paper px-4 py-4";
  return href ? (
    <Link href={href} className={`${className} transition hover:bg-paper-2`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export default async function AdminHomePage() {
  const [overview, expiring, viewer] = await Promise.all([
    getAdminOverview(7),
    getExpiringOffers(7, 8),
    getViewer(),
  ]);

  if (!overview) {
    return <EmptyState>לא הצלחנו לטעון את הנתונים. רעננו את הדף.</EmptyState>;
  }

  const { people, deals, reports, offers, notifications, branches } = overview;

  return (
    <div className="space-y-10">
      <AdminSection
        title={`שלום ${viewer.profile?.first_name ?? ""}`}
        note="מה שקורה באפליקציה עכשיו. כל מספר נספר, אף אחד לא מוערך."
      >
        <div className="grid grid-cols-2 gap-3">
          <Tile
            label="מכשירים שסיימו הרשמה"
            value={people.onboarded}
            hint={`מתוך ${people.total} שפתחו את האפליקציה`}
          />
          <Tile label="נפתחו השבוע" value={people.this_week} hint="מכשירים חדשים, לא בהכרח שסיימו" />
          {/* offers.live ALREADY contains the approved manual deals: offers_feed is
              catalog UNION ALL deals_public. Adding deals.live counted every one twice. */}
          <Tile
            label="מבצעים באוויר"
            value={offers.live}
            hint={`${offers.from_chains} מהרשתות · ${deals.live} שנוספו ידנית`}
          />
          <Tile
            label="ממתינים לאישור"
            value={deals.pending}
            attention={deals.pending > 0}
            href="/admin/queue"
          />
        </div>
      </AdminSection>

      <AdminSection title="השבוע האחרון">
        <div className="grid grid-cols-2 gap-3">
          <Tile label="נוספו" value={deals.added_this_week} hint="מבצעים שאושרו" />
          <Tile label="הורדו" value={deals.taken_down_this_week} hint="הוסרו או נדחו" />
          <Tile label="נשלחו ע״י משתמשים" value={deals.submitted_this_week} />
          <Tile
            label="דיווחים פתוחים"
            value={reports.open}
            attention={reports.open > 0}
            href="/admin/reports"
          />
        </div>
      </AdminSection>

      <AdminSection
        title="מבצעים שעומדים להיגמר"
        note={`בשבוע הקרוב. מבצע בלי תאריך סיום לא נספר כאן — אין לו תאריך לסיים בו.`}
      >
        {!expiring.ok ? (
          <EmptyState>לא הצלחנו לקרוא את רשימת המבצעים שנגמרים. זה לא אומר שאין.</EmptyState>
        ) : expiring.rows.length === 0 ? (
          <EmptyState>אין מבצעים עם תאריך סיום בשבוע הקרוב.</EmptyState>
        ) : (
          <ul className="divide-y divide-paper-line rounded-2xl border border-paper-line bg-paper">
            {expiring.rows.map((offer) => (
              <li key={offer.offer_key} className="flex items-baseline gap-2 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  <span className="font-bold">{offer.beer_name}</span>
                  <span className="text-ink-2">
                    {" "}
                    · {offer.pack_label} · {offer.store_name}
                  </span>
                </span>
                <Price agorot={offer.effective_agorot} size="sm" className="shrink-0 text-price" />
                <span className="num shrink-0 text-xs text-ink-3">
                  {new Date(offer.valid_to as string).toLocaleDateString("he-IL", {
                    day: "numeric",
                    month: "numeric",
                    timeZone: "Asia/Jerusalem",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      {branches && (
        <AdminSection
          title="מיקומי סניפים"
          note={'"הכי קרוב אליי" עובד רק לסניף שאנחנו יודעים איפה הוא. סניף בלי מיקום לא מוצג כקרוב — לא מנחשים.'}
        >
          <div className="grid grid-cols-2 gap-3">
            <Tile
              label="סניפים עם מיקום"
              value={branches.located}
              hint={`מתוך ${branches.total} פעילים`}
            />
            <Tile
              label="ממתינים לאיתור"
              value={branches.geocodable}
              attention={branches.geocodable > 0}
              hint="יש להם כתובת או עיר"
            />
            {branches.no_address > 0 && (
              <Tile
                label="בלי כתובת כלל"
                value={branches.no_address}
                hint="אי אפשר לאתר אותם מהנתונים שיש לנו"
              />
            )}
          </div>
        </AdminSection>
      )}

      <AdminSection title="התראות">
        <div className="grid grid-cols-2 gap-3">
          <Tile
            label="ממתינות לעיבוד"
            value={notifications.pending}
            hint={notifications.pending === 0 ? "אין תור" : "לא כולן יישלחו — חלקן ייפסלו בסינון"}
          />
          <Tile label="נשלחו אי פעם" value={notifications.sent_ever} hint="בלי התראות בדיקה" />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-2">
          {people.notifiable === 0
            ? "אף אחד עדיין לא הפעיל התראות, אז אין למי לשלוח."
            : `${people.notifiable} אנשים הפעילו התראות.`}
        </p>
      </AdminSection>

      <AdminSection title="ניהול">
        <nav className="grid gap-2">
          {[
            { href: "/admin/queue", label: "תור האישורים", note: "לאשר, לדחות, לערוך ולהוסיף מבצע" },
            { href: "/admin/reports", label: "דיווחים", note: "מבצעים שמשתמשים דיווחו שנגמרו" },
            { href: "/admin/weekly", label: "מבצע השבוע", note: "לבחור מה מופיע עם הגביע" },
            ...(viewer.isSuperAdmin
              ? [
                  { href: "/admin/admins", label: "מנהלים", note: "להוסיף ולהסיר הרשאות" },
                  { href: "/admin/settings", label: "הגדרות התראות", note: "מתי שולחים, ולמי" },
                ]
              : []),
            { href: "/whats-new", label: "מה חדש", note: "היסטוריית הגרסאות" },
            { href: "/", label: "לאפליקציה", note: "לראות מה המשתמשים רואים" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between gap-3 rounded-2xl border border-paper-line bg-paper px-4 py-3 transition hover:bg-paper-2"
            >
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink">{item.label}</span>
                <span className="block text-xs text-ink-2">{item.note}</span>
              </span>
              <span aria-hidden className="shrink-0 text-ink-3">
                ‹
              </span>
            </Link>
          ))}
        </nav>
      </AdminSection>
    </div>
  );
}
