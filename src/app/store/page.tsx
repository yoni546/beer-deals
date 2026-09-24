import { Picker } from "@/components/Picker";
import { Screen, TopBar } from "@/components/Chrome";
import { getStores } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function StorePickerPage() {
  const stores = await getStores();

  return (
    <Screen>
      <TopBar title="חיפוש לפי סופר / מכולת" />
      <Picker
        items={stores.map((store) => ({ slug: store.slug, label: store.name_he }))}
        hrefFor={(slug) => `/store/${slug}`}
        placeholder="איזה סופר?"
        emptyLabel="לא מצאנו חנות בשם הזה."
      />
    </Screen>
  );
}
