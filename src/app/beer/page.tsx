import { Picker } from "@/components/Picker";
import { Screen, TopBar } from "@/components/Chrome";
import { getBeers } from "@/lib/queries";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function BeerPickerPage() {
  const [beers, viewer] = await Promise.all([getBeers(), getViewer()]);

  // The user's four favourites first, in their own order — the beer they want
  // is almost always one of them, and scrolling past twenty others to reach it
  // is the kind of friction this app exists to remove.
  const favoriteIds = new Set(viewer.favorites.map((beer) => beer.id));
  const ordered = [...viewer.favorites, ...beers.filter((beer) => !favoriteIds.has(beer.id))];

  return (
    <Screen>
      <TopBar title="חיפוש לפי בירה" />
      <Picker
        items={ordered.map((beer) => ({
          slug: beer.slug,
          label: beer.name_he,
          alias: beer.name_en,
          surface: beer.theme_surface,
          ink: beer.theme_ink,
        }))}
        basePath="/beer"
        placeholder="איזו בירה?"
        emptyLabel="לא מצאנו בירה בשם הזה."
      />
    </Screen>
  );
}
