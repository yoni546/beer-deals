import { AdminList, AdminSection } from "@/components/admin/AdminUi";
import { CouldNotLoad } from "@/components/CouldNotLoad";
import { EmptyState } from "@/components/Chrome";
import { getAdminCoverage, type AdminCoverage } from "@/lib/admin-queries";
import { relativeTimeHe } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Coverage, as the database holds it (migration 0036).
 *
 * `docs/RETAILER-COVERAGE.md` is the fuller picture and is produced by the scan on
 * the machine that ran it — it knows why a source is blocked, because that lives in
 * the publisher metadata and in no table. It is also a snapshot of one run. Nothing
 * in the app could say what the database holds NOW, which is the gap this fills.
 *
 * So the words here are about OUR RECORD, never about the retailer: "every branch
 * was checked in the last scan" is a fact about `branch_scans`. Whether the
 * retailer's own files were complete is the document's question, and the page says
 * so rather than implying it knows.
 */

/** What the evidence in branch_scans supports — and nothing more. */
function recordHe(row: AdminCoverage): { text: string; hatched: boolean } {
  if (row.branches === 0) return { text: "אין סניפים במערכת", hatched: true };
  if (!row.last_scan_id) return { text: "לא נסרקה", hatched: true };
  if (row.failed > 0) return { text: `${row.failed} סניפים נכשלו בסריקה`, hatched: true };
  if (row.checked === 0) return { text: "אף סניף לא נבדק בסריקה האחרונה", hatched: true };
  if (row.checked < row.branches) return { text: `${row.checked} מתוך ${row.branches} סניפים נבדקו`, hatched: true };
  if (row.promo_checked < row.branches) {
    return { text: `כל הסניפים נבדקו; קובץ מבצעים ל-${row.promo_checked} מהם`, hatched: false };
  }
  return { text: "כל הסניפים נבדקו בסריקה האחרונה", hatched: false };
}

export default async function AdminCoveragePage() {
  const { rows, ok } = await getAdminCoverage();
  const located = rows.reduce((sum, row) => sum + row.located, 0);
  const branches = rows.reduce((sum, row) => sum + row.branches, 0);

  return (
    <div className="space-y-10">
      <AdminSection
        title="כיסוי הרשתות"
        note="מה שהמערכת יודעת עכשיו, מהסריקה האחרונה של כל רשת בנפרד. התמונה המלאה — כולל מקורות שאנחנו לא מצליחים להגיע אליהם — נמצאת ב-docs/RETAILER-COVERAGE.md, שנוצר על ידי הסריקה עצמה."
      >
        {!ok ? (
          <div className="px-4 py-6">
            <CouldNotLoad what="את נתוני הכיסוי" headingLevel={3} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState>אין רשתות פעילות.</EmptyState>
        ) : (
          <AdminList>
            {rows.map((row) => {
              const record = recordHe(row);
              return (
                <div key={row.store_id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-base font-bold text-ink">{row.store_name}</p>
                    <span
                      className={`${record.hatched ? "hatch " : ""}shrink-0 rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink`}
                    >
                      {record.text}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-ink-2">
                    סניפים <span className="num font-bold text-ink">{row.branches}</span> · נבדקו{" "}
                    <span className="num font-bold text-ink">{row.checked}</span> · עם קובץ מבצעים{" "}
                    <span className="num font-bold text-ink">{row.promo_checked}</span> · מבצעים כרגע{" "}
                    <span className="num font-bold text-ink">{row.live_offers}</span>
                  </p>

                  {/* The number the geo work had no surface for anywhere (0026). */}
                  <p className="mt-0.5 text-sm text-ink-2">
                    יש לנו מיקום ל-<span className="num font-bold text-ink">{row.located}</span> סניפים
                    {row.located === 0 && row.branches > 0 && " — אי אפשר למדוד מהם מרחק"}
                  </p>

                  {row.last_scan_at ? (
                    <p className="mt-0.5 text-sm text-ink-2">
                      סריקה אחרונה {relativeTimeHe(row.last_scan_at)}
                      {row.stale > 0 && <> · <span className="num">{row.stale}</span> קבצים לא עדכניים</>}
                      {row.not_published > 0 && <> · <span className="num">{row.not_published}</span> לא פורסמו במקור</>}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-sm text-ink-2">הרשת הזאת לא נסרקה אף פעם.</p>
                  )}
                </div>
              );
            })}
          </AdminList>
        )}
      </AdminSection>

      {ok && branches > 0 && (
        <AdminSection
          title="מיקומי סניפים"
          note="בלי מיקום אין מרחק, ו״הכי קרוב אליי״ אומר את זה במקום לנחש. המיקומים מתווספים דרך scripts/ingest/geocode.mjs (docs/GEOCODING.md)."
        >
          <div className="px-4 py-4">
            <p className="text-base text-ink">
              <span className="num font-bold">{located}</span> מתוך <span className="num font-bold">{branches}</span>{" "}
              סניפים ממוקמים.
            </p>
            {located === 0 && (
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                אף סניף עוד לא ממוקם, ולכן המסך ״הכי קרוב אליי״ אומר שאין לנו את המיקומים — ולא מציג סדר שאי אפשר להצדיק.
              </p>
            )}
          </div>
        </AdminSection>
      )}
    </div>
  );
}
