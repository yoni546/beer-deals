import { AdminDealRow } from "@/components/admin/DealActions";
import { EmptyState } from "@/components/Chrome";
import { getDealsByStatus } from "@/lib/admin-queries";
import { getBeers, getStores } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * The queue. Pending first, because that is the only list with work in it.
 */
export default async function AdminQueuePage() {
  const [pending, approved, beers, stores] = await Promise.all([
    getDealsByStatus("pending"),
    getDealsByStatus("approved", 30),
    getBeers(),
    getStores(),
  ]);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-black opacity-70">
          ממתינים לאישור {pending.length > 0 && `(${pending.length})`}
        </h2>
        {pending.length === 0 ? (
          <EmptyState>אין מבצעים שממתינים לאישור.</EmptyState>
        ) : (
          <div className="space-y-2.5">
            {pending.map((deal) => (
              <AdminDealRow key={deal.id} deal={deal} beers={beers} stores={stores} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-black opacity-70">מבצעים מאושרים</h2>
        {approved.length === 0 ? (
          <EmptyState>אין מבצעים מאושרים כרגע.</EmptyState>
        ) : (
          <div className="space-y-2.5">
            {approved.map((deal) => (
              <AdminDealRow key={deal.id} deal={deal} beers={beers} stores={stores} canFeature />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
