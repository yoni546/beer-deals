import { AdminList, AdminSection } from "@/components/admin/AdminUi";
import { AuditEntryRow } from "@/components/admin/AuditEntryRow";
import { EmptyState } from "@/components/Chrome";
import { CouldNotLoad } from "@/components/CouldNotLoad";
import { getAuditLog } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";

/**
 * What administrators did (migration 0032).
 *
 * Until 0032 nothing in this system could answer "who took this deal down?". Each
 * table kept at most the latest actor on a column, and the actions that matter most
 * erase even that: removing a deal nulls `approved_by` by design, and deleting one
 * destroys the row. This screen is the only place those questions have an answer.
 *
 * It is a reading screen. There is deliberately nothing to press: an audit log with
 * controls on it is a log somebody can tidy.
 */
export default async function AdminAuditPage() {
  const { rows, ok } = await getAuditLog(100);

  return (
    <AdminSection
      title="מה נעשה כאן"
      note="כל פעולה של מנהל, מהחדשה לישנה. הרשומות נכתבות בלבד — אי אפשר לערוך או למחוק אותן, גם לא מנהל ראשי."
    >
      {!ok ? (
        <div className="px-4 py-6">
          <CouldNotLoad what="את יומן הפעולות" headingLevel={3} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState>עוד לא נרשמה שום פעולה.</EmptyState>
      ) : (
        <AdminList>
          {rows.map((entry) => (
            <AuditEntryRow key={entry.id} entry={entry} />
          ))}
        </AdminList>
      )}
    </AdminSection>
  );
}
