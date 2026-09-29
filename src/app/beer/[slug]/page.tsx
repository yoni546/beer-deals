import { notFound } from "next/navigation";
import { ButtonLink, EmptyState, Screen, TopBar } from "@/components/Chrome";
import { Freshness } from "@/components/Freshness";
import { Strip } from "@/components/BeerStrip";
import { RegularStrip } from "@/components/RegularStrip";
import { SortBar } from "@/components/SortBar";
import { Segmented } from "@/components/ui/Chip";
import { packText } from "@/lib/format";
import { getOffers, getRegularPrices } from "@/lib/offers";
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
  type PackFilter,
} from "@/lib/offer-logic";
import { getBeerBySlug } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Search = { view?: string; sort?: string; unit?: string; pack?: string; c?: string };

/**
 * One beer, every pack, every chain.
 *
 * Two views of the same beer: what is on promotion now, and what it costs on an ordinary
 * day. Packs are never mixed — Goldstar 6×330 and Goldstar 6×500 are different strips —
 * and inside a pack the chains are ordered the way the person asked.
 */
export default async function BeerPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const query = await searchParams;

  const beer = await getBeerBySlug(slug);
  if (!beer) notFound();

  const view = query.view === "regular" ? "regular" : "deals";
  const sort = parseSort(query.sort);
  const perLiter = query.unit === "1";
  const pack = parsePack(query.pack, query.c);

  const [offers, regular] = await Promise.all([getOffers({ beerSlug: slug }), getRegularPrices({ beerSlug: slug })]);
  const path = `/beer/${beer.slug}`;
  const chains = new Set(offers.map((offer) => offer.store_id)).size;
  const freshest = newestObservation(view === "deals" ? offers : regular);

  const availablePacks = [...new Set(view === "deals" ? offers.map(packClass) : regular.map(regularPackClass))] as PackFilter[];
  const dealGroups = orderPackGroups(groupByPack(filterByPack(offers, pack)));
  const regularGroups = groupRegularByPack(filterRegularByPack(regular, pack));

  return (
    <Screen>
      <TopBar
        title={beer.name_he}
        backHref="/beer"
        sub={
          <>
            {view === "deals"
              ? offers.length > 0
                ? `${offers.length} ${offers.length === 1 ? "מבצע" : "מבצעים"} ב־${chains} ${chains === 1 ? "רשת" : "רשתות"}`
                : "אין כרגע מבצע על הבירה הזו"
              : "המחיר ביום רגיל, בלי מבצע"}
            {freshest && (
              <>
                {" · "}
                <Freshness at={freshest} />
              </>
            )}
          </>
        }
      />

      <div className="mb-4">
        <Segmented
          label="תצוגה"
          items={[
            { href: path, label: `מבצעים${offers.length ? ` (${offers.length})` : ""}`, selected: view === "deals" },
            { href: `${path}?view=regular`, label: "מחירים רגילים", selected: view === "regular" },
          ]}
        />
      </div>

      {(view === "deals" ? offers.length > 0 : regular.length > 0) && (
        <div className="mb-5 space-y-3">
          <SortBar
            path={path}
            state={{ sort, perLiter, pack, extra: { view: view === "regular" ? "regular" : undefined } }}
            sorting={view === "deals"}
            availablePacks={availablePacks}
          />
        </div>
      )}

      {view === "deals" &&
        (offers.length === 0 ? (
          <EmptyState
            title={`אין כרגע מבצע על ${beer.name_he}`}
            action={regular.length > 0 ? <ButtonLink href={`${path}?view=regular`}>לראות את המחירים הרגילים</ButtonLink> : undefined}
          >
            כשמבצע יופיע, הוא יעלה כאן. אם בירה זו אחת מארבע הבירות שלכם, תקבלו על כך גם התראה.
          </EmptyState>
        ) : dealGroups.length === 0 ? (
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
                printIn={index === 0}
              />
            ))}
          </div>
        ))}

      {view === "regular" &&
        (regular.length === 0 ? (
          <EmptyState title="עוד אין מחירים רגילים לבירה הזו">
            מחירים רגילים נכנסים מפרסומי הרשתות. עד אז אפשר לראות רק מבצעים.
          </EmptyState>
        ) : regularGroups.length === 0 ? (
          <EmptyState title="אין מחיר באריזה הזו">נסו סוג אריזה אחר.</EmptyState>
        ) : (
          <div className="space-y-7">
            {regularGroups.map((group) => (
              <RegularStrip
                key={group.key}
                title={packText(group.prices[0])}
                aside={`${group.prices.length} ${group.prices.length === 1 ? "רשת" : "רשתות"}`}
                prices={group.prices}
                lead="chain"
              />
            ))}
          </div>
        ))}
    </Screen>
  );
}
