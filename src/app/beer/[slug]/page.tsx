import { notFound } from "next/navigation";
import { EmptyState, Screen, TopBar } from "@/components/Chrome";
import { Freshness } from "@/components/Freshness";
import { Strip } from "@/components/BeerStrip";
import { GroupStrip } from "@/components/GroupOffers";
import { RegularStrip } from "@/components/RegularStrip";
import { CategorySection, NoDealLine, Part } from "@/components/Sections";
import { SortBar } from "@/components/SortBar";
import { PACK_CLASS_HE, packText } from "@/lib/format";
import { getGroupOffers, getOffers, getRegularPrices } from "@/lib/offers";
import {
  PACK_CLASSES,
  groupByPack,
  groupPackClass,
  groupRegularByPack,
  newestObservation,
  orderPackGroups,
  packClass,
  parsePack,
  parseSort,
  regularPackClass,
  sortOffers,
  sortRegular,
  type PackFilter,
} from "@/lib/offer-logic";
import { getBeerBySlug } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Search = { view?: string; sort?: string; unit?: string; pack?: string; c?: string };

/**
 * One beer, every pack, every chain — by kind of pack, in the order someone buying beer for home looks:
 *
 *   שישיות     deals everyone can use (pack by pack: שישייה, then שמינייה, then רביעייה), then regular prices
 *   ארגזים     deals, then regular prices
 *   בודדים     deals, then regular prices
 *
 * Packs are never compared as the same product: Goldstar 6×330 and 6×500 are different strips. One sort
 * (best verified saving / cheapest / dearest, optionally per litre) orders everything; a category chip
 * keeps one kind. (`?view=regular`, the old tab link, still opens the page.)
 */
export default async function BeerPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const query = await searchParams;

  const [beer, offers, regular, groups] = await Promise.all([
    getBeerBySlug(slug),
    getOffers({ beerSlug: slug }),
    getRegularPrices({ beerSlug: slug }),
    getGroupOffers({ beerSlug: slug }),
  ]);
  if (!beer) notFound();

  const sort = parseSort(query.sort);
  const perLiter = query.unit === "1";
  const pack = parsePack(query.pack, query.c);
  const path = `/beer/${beer.slug}`;
  const chains = new Set([...offers.map((o) => o.store_id), ...groups.map((g) => g.store_id)]).size;
  const freshest = newestObservation([...offers, ...regular]);
  const dealCount = offers.length + groups.length;

  const availablePacks = [...new Set([...offers.map(packClass), ...regular.map(regularPackClass), ...groups.map(groupPackClass)])] as PackFilter[];
  const kinds = PACK_CLASSES.filter((kind) => (pack === "all" || pack === kind) && availablePacks.includes(kind)).map((kind) => ({
    kind,
    deals: orderPackGroups(groupByPack(offers.filter((offer) => packClass(offer) === kind)), sort, perLiter),
    groups: groups.filter((group) => groupPackClass(group) === kind),
    regular: groupRegularByPack(regular.filter((price) => regularPackClass(price) === kind), sort, perLiter),
  }));

  return (
    <Screen>
      <TopBar
        title={beer.name_he}
        backHref="/beer"
        sub={
          <>
            {dealCount > 0
              ? `${dealCount} ${dealCount === 1 ? "מבצע" : "מבצעים"} ב־${chains} ${chains === 1 ? "רשת" : "רשתות"}`
              : "אין כרגע מבצע על הבירה הזו"}
            {freshest && (
              <>
                {" · "}
                <Freshness at={freshest} />
              </>
            )}
          </>
        }
      />

      {(dealCount > 0 || regular.length > 0) && (
        <div className="mb-6">
          <SortBar path={path} state={{ sort, perLiter, pack }} availablePacks={availablePacks} />
        </div>
      )}

      {kinds.length === 0 ? (
        dealCount > 0 || regular.length > 0 ? (
          <EmptyState title="אין כאן כלום מהסוג הזה">נסו שישיות, ארגזים או בודדים.</EmptyState>
        ) : (
          <EmptyState title={`אין כרגע מבצע על ${beer.name_he}`}>
            כשמבצע שפתוח לכולם יופיע, הוא יעלה כאן. אם זו אחת מארבע הבירות שלכם, תקבלו גם התראה.
          </EmptyState>
        )
      ) : (
        <div className="space-y-10">
          {kinds.map(({ kind, deals, groups: mixes, regular: prices }, section) => (
            <CategorySection key={kind} kind={kind}>
              {deals.length > 0 || mixes.length > 0 ? (
                <Part part="deals" title="מבצעים">
                  {deals.map((group, index) => (
                    <Strip
                      key={group.key}
                      title={packText(group.offers[0])}
                      aside={`${group.offers.length} ${group.offers.length === 1 ? "רשת" : "רשתות"}`}
                      offers={sortOffers(group.offers, sort, perLiter)}
                      lead="chain"
                      perLiter={perLiter}
                      printIn={section === 0 && index === 0}
                      headingLevel="h4"
                    />
                  ))}
                  <GroupStrip title="קונים כמה, בוחרים מהמבצע" offers={mixes} headingLevel="h4" />
                </Part>
              ) : (
                <NoDealLine>
                  אין כרגע מבצע על {PACK_CLASS_HE[kind]} של {beer.name_he}.
                </NoDealLine>
              )}
              {prices.length > 0 && (
                <Part part="regular" title="מחירים רגילים">
                  {prices.map((group) => (
                    <RegularStrip
                      key={group.key}
                      title={packText(group.prices[0])}
                      aside={`${group.prices.length} ${group.prices.length === 1 ? "רשת" : "רשתות"}`}
                      prices={sortRegular(group.prices, sort, perLiter)}
                      lead="chain"
                      perLiter={perLiter}
                      headingLevel="h4"
                    />
                  ))}
                </Part>
              )}
            </CategorySection>
          ))}
        </div>
      )}
    </Screen>
  );
}
