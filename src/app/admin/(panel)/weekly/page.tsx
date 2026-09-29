import { AdminList, AdminSection } from "@/components/admin/AdminUi";
import { AdminDealRow } from "@/components/admin/DealActions";
import { EmptyState } from "@/components/Chrome";
import { getDealsByStatus } from "@/lib/admin-queries";
import { getBeers, getSettings, getStores } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Choosing the Weekly Deal.
 *
 * The spec says Goldstar gets preference when its deal is good enough, so the
 * page sorts a qualifying Goldstar deal to the top and says why it is there —
 * but it still takes a human press. A rule that picked the Weekly Deal by
 * itself would put a trophy on a deal nobody had checked, and the trophy is the
 * one place in the app where the claim is editorial rather than arithmetic.
 */
export default async function AdminWeeklyPage() {
  const [approved, settings, beers, stores] = await Promise.all([
    getDealsByStatus("approved", 60),
    getSettings(),
    getBeers(),
    getStores(),
  ]);

  const preferredSlug = settings?.weekly_deal_preferred_beer_slug ?? null;
  const minDiscount = settings?.notify_min_discount_percent ?? 25;

  const isPreferredAndStrong = (slug: string | undefined, discount: number) =>
    Boolean(preferredSlug) && slug === preferredSlug && discount >= minDiscount;

  const ranked = [...approved].sort((a, b) => {
    const aPreferred = isPreferredAndStrong(a.beers?.slug, a.discount_percent);
    const bPreferred = isPreferredAndStrong(b.beers?.slug, b.discount_percent);
    if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
    return b.discount_percent - a.discount_percent;
  });

  const preferredName = beers.find((beer) => beer.slug === preferredSlug)?.name_he;
  const hasPreferredCandidate =
    ranked.length > 0 && isPreferredAndStrong(ranked[0]?.beers?.slug, ranked[0]?.discount_percent);

  return (
    <AdminSection
      title="מבצע השבוע"
      note={
        hasPreferredCandidate && preferredName
          ? `יש מבצע חזק על ${preferredName} (${minDiscount}% ומעלה) — הוא מוצג ראשון, אבל הבחירה שלכם.`
          : "המבצעים מסודרים לפי גובה ההנחה. הבחירה ידנית."
      }
    >
      {ranked.length === 0 ? (
        <EmptyState>אין מבצעים מאושרים לבחירה.</EmptyState>
      ) : (
        <AdminList>
          {ranked.map((deal) => (
            <AdminDealRow
              key={deal.id}
              deal={deal}
              beers={beers}
              stores={stores}
              canFeature
              isWeekly={settings?.weekly_deal_id === deal.id}
            />
          ))}
        </AdminList>
      )}
    </AdminSection>
  );
}
