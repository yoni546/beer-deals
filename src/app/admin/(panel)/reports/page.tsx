import { ReportRow } from "@/components/admin/ReportRow";
import { EmptyState } from "@/components/Chrome";
import { getOpenReports } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const reports = await getOpenReports();

  return (
    <section>
      <h2 className="mb-1 text-sm font-black opacity-70">
        דיווחים פתוחים {reports.length > 0 && `(${reports.length})`}
      </h2>
      <p className="mb-3 text-xs opacity-50">
        דיווח של משתמש לא מוריד מבצע. ההחלטה כאן.
      </p>

      {reports.length === 0 ? (
        <EmptyState>אין דיווחים פתוחים.</EmptyState>
      ) : (
        <div className="space-y-2.5">
          {reports.map((report) => (
            <ReportRow key={report.id} report={report} />
          ))}
        </div>
      )}
    </section>
  );
}
