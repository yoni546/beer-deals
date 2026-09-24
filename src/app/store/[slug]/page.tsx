import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryTabs } from "@/components/CategoryTabs";
import { DealCard, NoDealCard } from "@/components/DealCard";
import { EmptyState, Screen, TopBar } from "@/components/Chrome";
import { parseCategory, CATEGORY_LABEL } from "@/lib/categories";
import { getBestDealPerBeerAtStore, getDealsForStore, getStoreBySlug } from "@/lib/queries";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

type Tab = "best" | "mine";

/**
 * Deals at one chain — not one branch. Two tabs: what is worth buying here, and
 * what is on for the beers this person actually drinks.
 *
 * The second tab lists all four favourites in the user's own order even when
 * some have no deal, and says so. Silently dropping them would leave the user
 * unsure whether they had checked or whether the app had.
 */
export default async function StoreDealsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ c?: string; tab?: string }>;
}) {
  const { slug } = await params;
  const { c, tab } = await searchParams;

  const store = await getStoreBySlug(slug);
  if (!store) notFound();

  const category = parseCategory(c);
  const activeTab: Tab = tab === "mine" ? "mine" : "best";
  const viewer = await getViewer();

  const [best, mine] = await Promise.all([
    activeTab === "best" ? getDealsForStore(store.id, category) : Promise.resolve([]),
    activeTab === "mine"
      ? getBestDealPerBeerAtStore(
          store.id,
          viewer.favorites.map((beer) => beer.id),
          category,
        )
      : Promise.resolve(new Map()),
  ]);

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "best", label: "הכי משתלם" },
    { key: "mine", label: "הבירות שאני אוהב" },
  ];

  return (
    <Screen>
      <TopBar title={store.name_he} backHref="/store" />

      <nav className="mb-3 flex gap-1.5 rounded-2xl bg-[color:var(--surface)] p-1.5 ring-1 ring-white/10">
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={`/store/${store.slug}?c=${category}&tab=${item.key}`}
            aria-current={item.key === activeTab ? "page" : undefined}
            className={[
              "flex-1 rounded-xl px-2 py-2.5 text-center text-sm font-bold transition",
              item.key === activeTab
                ? "bg-[color:var(--accent)] text-[color:var(--base)]"
                : "opacity-60",
            ].join(" ")}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <CategoryTabs
        basePath={`/store/${store.slug}`}
        active={category}
        extraParams={{ tab: activeTab }}
      />

      {activeTab === "best" &&
        (best.length === 0 ? (
          <EmptyState>
            אין כרגע מבצע מאושר ב{store.name_he} ב{CATEGORY_LABEL[category]}.
          </EmptyState>
        ) : (
          <div className="space-y-2.5">
            {best.map((deal) => (
              <DealCard key={deal.id} deal={deal} showStoreName={false} />
            ))}
          </div>
        ))}

      {activeTab === "mine" && (
        <div className="space-y-2.5">
          {viewer.favorites.map((beer) => {
            const deal = mine.get(beer.id);
            return deal ? (
              <DealCard key={beer.id} deal={deal} showStoreName={false} />
            ) : (
              <NoDealCard key={beer.id} beerName={beer.name_he} />
            );
          })}
        </div>
      )}
    </Screen>
  );
}
