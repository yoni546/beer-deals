import { Screen, TopBar } from "@/components/Chrome";
import { ListingSearch } from "@/components/ListingSearch";
import { getListing } from "@/lib/offers";
import { getBeers } from "@/lib/queries";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Every beer, searchable. The person's four go first, in their own order and numbered:
 * the beer they want is almost always one of them, and scrolling past twenty others to
 * reach it is the friction this app exists to remove.
 */
export default async function BeersPage() {
  const [beers, listing, viewer] = await Promise.all([getBeers(), getListing("beer"), getViewer()]);
  const bySlug = new Map(listing.map((row) => [row.slug, row]));
  const rank = new Map(viewer.favorites.map((beer, index) => [beer.id, index + 1]));

  return (
    <Screen>
      <TopBar title="בירות" sub="חפשו בירה, או בחרו אחת מהרשימה" />
      <ListingSearch
        basePath="/beer"
        placeholder="איזו בירה?"
        emptyLabel="לא מצאנו בירה בשם הזה"
        mineLabel="הבירות שלי"
        allLabel="כל הבירות"
        items={beers.map((beer) => ({
          slug: beer.slug,
          label: beer.name_he,
          alias: beer.name_en,
          count: bySlug.get(beer.slug)?.count ?? 0,
          bestValuePct: bySlug.get(beer.slug)?.bestValuePct ?? null,
          rank: rank.get(beer.id) ?? null,
          beerSlug: beer.slug,
        }))}
      />
    </Screen>
  );
}
