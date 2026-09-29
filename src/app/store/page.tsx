import { Screen, TopBar } from "@/components/Chrome";
import { ListingSearch } from "@/components/ListingSearch";
import { getListing } from "@/lib/offers";
import { getStores } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Every chain, searchable — chains, not branches: a promotion is a chain's, not a shop's. */
export default async function StoresPage() {
  const [stores, listing] = await Promise.all([getStores(), getListing("store")]);
  const bySlug = new Map(listing.map((row) => [row.slug, row]));

  return (
    <Screen>
      <TopBar title="סופרים" sub="מה במבצע ברשת שאתם קונים בה" />
      <ListingSearch
        basePath="/store"
        placeholder="איזה סופר?"
        emptyLabel="לא מצאנו רשת בשם הזה"
        allLabel="כל הרשתות"
        items={stores
          .map((store) => ({
            slug: store.slug,
            label: store.name_he,
            alias: null,
            count: bySlug.get(store.slug)?.count ?? 0,
            bestValuePct: bySlug.get(store.slug)?.bestValuePct ?? null,
            rank: null,
          }))
          // Chains with something on offer first; the rest keep their alphabetical order.
          .sort((a, b) => Number(b.count > 0) - Number(a.count > 0))}
      />
    </Screen>
  );
}
