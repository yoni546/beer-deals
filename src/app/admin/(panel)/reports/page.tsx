import { AdminList, AdminSection } from "@/components/admin/AdminUi";
import { ReportRow } from "@/components/admin/ReportRow";
import { EmptyState } from "@/components/Chrome";
import { getOfferFeedback, getOpenReports } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";

const STANDING: Record<string, { label: string; note: string }> = {
  unclear: { label: "לא ברור", note: "יש משקל אמיתי לשני הכיוונים — בדיוק המקרה שכלל לא אמור להכריע" },
  ended: { label: "כנראה נגמר", note: "מספיק אנשים אמרו שנגמר, ואף אחד אמין לא חולק" },
  still_there: { label: "נראה שעדיין קיים", note: "מישהו הלך ובדק" },
};

export default async function AdminReportsPage() {
  const [reports, feedback] = await Promise.all([getOpenReports(), getOfferFeedback(50)]);

  return (
    <div className="space-y-10">
      <AdminSection
        title="מה אומרים על המדף"
        note="משוב מהאפליקציה על מבצעים — כולל מבצעי רשתות, שלא היה להם מסלול דיווח בכלל. אף מבצע לא יורד מכאן מעצמו."
      >
        {!feedback.ok ? (
          <EmptyState>לא הצלחנו לקרוא את המשוב. זה לא אומר שאין.</EmptyState>
        ) : feedback.rows.length === 0 ? (
          <EmptyState>אף אחד עוד לא אמר משהו שמצדיק בדיקה.</EmptyState>
        ) : (
          <AdminList>
            {feedback.rows.map((row) => (
              <div key={row.offer_key} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-base font-bold text-ink">{STANDING[row.standing]?.label ?? row.standing}</p>
                  <p className="num shrink-0 text-sm text-ink-2" dir="ltr">
                    {row.offer_key}
                  </p>
                </div>
                <p className="mt-0.5 text-sm text-ink-2">{STANDING[row.standing]?.note}</p>
                <p className="mt-1 text-sm text-ink-2">
                  נגמר: <span className="num font-bold text-ink">{Number(row.ended_weight).toFixed(1)}</span> · עדיין קיים:{" "}
                  <span className="num font-bold text-ink">{Number(row.still_weight).toFixed(1)}</span> ·{" "}
                  <span className="num">{row.voices}</span> {row.voices === 1 ? "אדם" : "אנשים"}
                </p>
                {row.notes.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm leading-relaxed text-ink-2">
                    {row.notes.slice(0, 3).map((note, i) => (
                      <li key={i}>״{note}״</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </AdminList>
        )}
      </AdminSection>

      <AdminSection
        title={
          <>
            דיווחים פתוחים{" "}
            {reports.length > 0 && (
              <>
                (<span className="num">{reports.length}</span>)
              </>
            )}
          </>
        }
        note="דיווח של משתמש לא מוריד מבצע. ההחלטה כאן."
      >
        {reports.length === 0 ? (
          <EmptyState>אין דיווחים פתוחים.</EmptyState>
        ) : (
          <AdminList>
            {reports.map((report) => (
              <ReportRow key={report.id} report={report} />
            ))}
          </AdminList>
        )}
      </AdminSection>
    </div>
  );
}
