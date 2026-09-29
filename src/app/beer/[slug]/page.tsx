import { notFound } from "next/navigation";
import { EmptyState, Screen, TopBar } from "@/components/Chrome";
import { Freshness } from "@/components/Freshness";
import { Strip } from "@/components/BeerStrip";
import { GroupStrip } from "@/components/GroupOffers";
import { RegularStrip } from "@/components/RegularStrip";
import { JumpToRegular, SectionHeading } from "@/components/Sections";
import { SortBar } from "@/components/SortBar";
import { packText } from "@/lib/format";
import { getGroupOffers, getOffers, getRegularPrices } from "@/lib/offers";
import {
  filterByPack,
  filterRegularByPack,
  groupByPack,
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
 * One beer, every pack, every chain — in two parts, never mixed:
 *
 *   מבצעים עכשיו      promotions everyone can use, pack by pack, plus "any N of these" group offers
 *   מחירים רגילים      the ordinary shelf price per pack and chain
 *
 * Packs are never compared as the same product: Goldstar 6×330 and 6×500 are different strips.
 * One sort (price ↑ / price ↓ / best verified saving, optionally per litre) orders both parts.
 * (`?view=regular`, the old tab link, still opens the page; both parts are on it.)
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

  const availablePacks = [...new Set([...offers.map(packClass), ...regular.map(regularPackClass)])] as PackFilter[];
  const dealGroups = orderPackGroups(groupByPack(filterByPack(offers, pack)));
  const regularGroups = groupRegularByPack(filterRegularByPack(regular, pack));

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
        <div className="mb-6 flex flex-wrap items-start justify-between gap-2">
          <SortBar path={path} state={{ sort, perLiter, pack }} availablePacks={availablePacks} />
          <JumpToRegular count={regular.length} />
        </div>
      )}

      <section aria-labelledby="deals" className="scroll-mt-4">
        <SectionHeading id="deals">מבצעים עכשיו</SectionHeading>
        {dealCount === 0 ? (
          <EmptyState title={`אין כרגע מבצע על ${beer.name_he}`}>
            כשמבצע שפתוח לכולם יופיע, הוא יעלה כאן. אם זו אחת מארבע הבירות שלכם, תקבלו גם התראה.
          </EmptyState>
        ) : dealGroups.length === 0 && groups.length === 0 ? (
          <EmptyState title="אין מבצע באריזה הזו">נסו סוג אריזה אחר.</EmptyState>
        ) : (
          <div className="space-y-7">
            {dealGroups.map((group, index) => (
              <Strip
                key={group.key}
                title={packText(group.offers[0])}
                aside={`${group.offers.length} ${group.offers.length === 1 ? "רשת" : "רשתות"}`}
                offers={sortOffers(group.offers, sort, perLiter)}
                lead="chain"
                perLiter={perLiter}
                printIn={index === 0}
                headingLevel="h3"
              />
            ))}
            <GroupStrip title="מבצעי שילוב" offers={groups} headingLevel="h3" />
          </div>
        )}
      </section>

      <section aria-labelledby="regular" className="mt-9 scroll-mt-4">
        <SectionHeading id="regular">מחירים רגילים</SectionHeading>
        {regular.length === 0 ? (
          <EmptyState title="עוד אין מחירים רגילים לבירה הזו">מחירים רגילים נכנסים מפרסומי הרשתות.</EmptyState>
        ) : regularGroups.length === 0 ? (
          <EmptyState title="אין מחיר באריזה הזו">נסו סוג אריזה אחר.</EmptyState>
        ) : (
          <div className="space-y-7">
            {regularGroups.map((group) => (
              <RegularStrip
                key={group.key}
                title={packText(group.prices[0])}
                aside={`${group.prices.length} ${group.prices.length === 1 ? "רשת" : "רשתות"}`}
                prices={sortRegular(group.prices, sort, perLiter)}
                lead="chain"
                perLiter={perLiter}
                headingLevel="h3"
              />
            ))}
          </div>
        )}
      </section>
    </Screen>
  );
}
