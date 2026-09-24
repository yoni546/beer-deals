import { Screen, TopBar } from "@/components/Chrome";
import { SubmitDealForm } from "@/components/SubmitDealForm";
import { getBeers, getStores } from "@/lib/queries";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SubmitPage() {
  const [beers, stores, viewer] = await Promise.all([getBeers(), getStores(), getViewer()]);

  return (
    <Screen>
      <TopBar title="מצאתם מבצע?" />
      <SubmitDealForm beers={beers} stores={stores} userId={viewer.userId} />
    </Screen>
  );
}
