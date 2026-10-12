import { AddDealForm } from "@/components/admin/AddDealForm";
import { AdminDealRow } from "@/components/admin/DealActions";
import { AdminList, AdminSection } from "@/components/admin/AdminUi";
import { DealFilters } from "@/components/admin/DealFilters";
import { EmptyState } from "@/components/Chrome";
import { CouldNotLoad } from "@/components/CouldNotLoad";
import { getAdminDeals, type AdminDealFilter } from "@/lib/admin-queries";
import { getBeers, getStores } from "@/lib/queries";
import { getViewer } from "@/lib/session";
import type { DealStatus } from "@/lib/db/types";

export const dynamic = "force-dynamic";

const STATUSES: Array<AdminDealFilter["status"]> = ["pending", "approved", "rejected", "inactive", "all"];

/** The URL is the state, so anything unrecognised in it falls back rather than throwing. */
function parseFilter(params: Record<string, string | string[] | undefined>): AdminDealFilter {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) || undefined;
  };
  const status = one("status");
  const source = one("source");
  return {
    status: STATUSES.includes(status as AdminDealFilter["status"]) ? (status as DealStatus | "all") : "pending",
    source: source === "users" || source === "admins" ? source : "all",
    store: one("store"),
    beer: one("beer"),
    q: one("q"),
  };
}

const TITLE: Record<AdminDealFilter["status"], string> = {
  pending: "ממתינים לאישור",
  approved: "מבצעים מאושרים",
  rejected: "מבצעים שנדחו",
  inactive: "מבצעים שהוסרו",
  all: "כל המבצעים",
};

const NOTHING: Record<AdminDealFilter["status"], string> = {
  pending: "אין מבצעים שממתינים לאישור.",
  approved: "אין מבצעים מאושרים כרגע.",
  rejected: "לא נדחו מבצעים.",
  inactive: "לא הוסרו מבצעים.",
  all: "אין מבצעים.",
};

const SHOWN = 50;

/**
 * The moderation list (Phase U).
 *
 * It used to be two fixed lists: every pending deal and the last thirty approved.
 * Workable at a hundred deals, useless at four thousand, and with no way at all to
 * ask "what did this chain send us?" or "what have we rejected on this beer?".
 *
 * One list now, with the question in the URL. Pending is still the default,
 * because that is the only list with work in it.
 */
export default async function AdminQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filter = parseFilter(await searchParams);
  const [deals, beers, stores, viewer] = await Promise.all([
    getAdminDeals(filter, SHOWN),
    getBeers(),
    getStores(),
    getViewer(),
  ]);

  return (
    <div className="space-y-8">
      <AddDealForm beers={beers} stores={stores} />

      <DealFilters filter={filter} beers={beers} stores={stores} />

      <AdminSection
        title={
          <>
            {TITLE[filter.status]}{" "}
            {deals.rows.length > 0 && (
              <>
                (<span className="num">{deals.rows.length}</span>
                {deals.more && "+"})
              </>
            )}
          </>
        }
        // Said rather than implied: a list that is not everything has to say so, and
        // a count we would have to fake is worse than no count (see getAdminDeals).
        note={deals.more ? `מוצגים ${SHOWN} הראשונים. צמצמו את הסינון כדי לראות את השאר.` : undefined}
      >
        {!deals.ok ? (
          <div className="px-4 py-6">
            <CouldNotLoad what="את רשימת המבצעים" headingLevel={3} />
          </div>
        ) : deals.rows.length === 0 ? (
          <EmptyState>
            {filter.store || filter.beer || filter.q ? "אין מבצעים שמתאימים לסינון." : NOTHING[filter.status]}
          </EmptyState>
        ) : (
          <AdminList>
            {deals.rows.map((deal) => (
              <AdminDealRow
                key={deal.id}
                deal={deal}
                beers={beers}
                stores={stores}
                canFeature={deal.status === "approved"}
                canDelete={viewer.isSuperAdmin}
              />
            ))}
          </AdminList>
        )}
      </AdminSection>
    </div>
  );
}
