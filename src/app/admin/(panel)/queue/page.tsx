import { AddDealForm } from "@/components/admin/AddDealForm";
import { AdminDealRow } from "@/components/admin/DealActions";
import { AdminList, AdminSection } from "@/components/admin/AdminUi";
import { EmptyState } from "@/components/Chrome";
import { getDealsByStatus } from "@/lib/admin-queries";
import { getBeers, getStores } from "@/lib/queries";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The queue. Pending first, because that is the only list with work in it.
 */
export default async function AdminQueuePage() {
  const [pending, approved, beers, stores, viewer] = await Promise.all([
    getDealsByStatus("pending"),
    getDealsByStatus("approved", 30),
    getBeers(),
    getStores(),
    getViewer(),
  ]);

  return (
    <div className="space-y-10">
      <AdminSection
        title={
          <>
            ממתינים לאישור{" "}
            {pending.length > 0 && (
              <>
                (<span className="num">{pending.length}</span>)
              </>
            )}
          </>
        }
      >
        {pending.length === 0 ? (
          <EmptyState>אין מבצעים שממתינים לאישור.</EmptyState>
        ) : (
          <AdminList>
            {pending.map((deal) => (
              <AdminDealRow key={deal.id} deal={deal} beers={beers} stores={stores} canDelete={viewer.isSuperAdmin} />
            ))}
          </AdminList>
        )}
      </AdminSection>

      <AdminSection title="מבצעים מאושרים">
        {approved.length === 0 ? (
          <EmptyState>אין מבצעים מאושרים כרגע.</EmptyState>
        ) : (
          <AdminList>
            {approved.map((deal) => (
              <AdminDealRow key={deal.id} deal={deal} beers={beers} stores={stores} canFeature canDelete={viewer.isSuperAdmin} />
            ))}
          </AdminList>
        )}
      </AdminSection>
    </div>
  );
}
