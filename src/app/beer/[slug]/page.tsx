import { notFound } from "next/navigation";
import { CategoryTabs } from "@/components/CategoryTabs";
import { DealCard } from "@/components/DealCard";
import { EmptyState, Screen, TopBar } from "@/components/Chrome";
import { parseCategory, CATEGORY_LABEL } from "@/lib/categories";
import { getBeerBySlug, getDealsForBeer } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Deals for one beer, cheapest first.
 *
 * The cheapest is first because that is the answer to the question the user
 * arrived with. It gets no badge and no special treatment beyond its position —
 * the list is already sorted, and decorating the top row would just add ink.
 */
export default async function BeerDealsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const { slug } = await params;
  const { c } = await searchParams;

  const beer = await getBeerBySlug(slug);
  if (!beer) notFound();

  const category = parseCategory(c);
  const deals = await getDealsForBeer(beer.id, category);

  return (
    <Screen>
      <TopBar title={beer.name_he} backHref="/beer" />
      <CategoryTabs basePath={`/beer/${beer.slug}`} active={category} />

      {deals.length === 0 ? (
        <EmptyState>
          אין כרגע מבצע מאושר על {beer.name_he} ב{CATEGORY_LABEL[category]}.
        </EmptyState>
      ) : (
        <div className="space-y-2.5">
          {deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} showBeerName={false} />
          ))}
        </div>
      )}
    </Screen>
  );
}
