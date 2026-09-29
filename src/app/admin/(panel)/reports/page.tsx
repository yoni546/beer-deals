import { AdminList, AdminSection } from "@/components/admin/AdminUi";
import { ReportRow } from "@/components/admin/ReportRow";
import { EmptyState } from "@/components/Chrome";
import { getOpenReports } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const reports = await getOpenReports();

  return (
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
  );
}
