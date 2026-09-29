import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink, EmptyState, Screen, TopBar } from "@/components/Chrome";
import { Freshness } from "@/components/Freshness";
import { Strip } from "@/components/BeerStrip";
import { RegularStrip } from "@/components/RegularStrip";
import { SortBar } from "@/components/SortBar";
import { Chip, Segmented } from "@/components/ui/Chip";
import { CheckIcon } from "@/components/ui/icons";
import { Tape } from "@/components/ui/Tape";
import { getOffers, getRegularPrices } from "@/lib/offers";
import {
  filterByPack,
  filterRegularByPack,
  groupByBeer,
  groupRegularByBeer,
  newestObservation,
  packClass,
  parsePack,
  parseSort,
  regularPackClass,
  sortOffers,
  type PackFilter,
} from "@/lib/offer-logic";
import { getStoreBySlug } from "@/lib/queries";
import { getViewer } from "@/lib/session";
import { withParams } from "@/lib/urls";

export const dynamic = "force-dynamic";

type Search = { view?: string; mine?: string; sort?: string; unit?: string; pack?: string; c?: string; tab?: string };

/**
 * One chain (not one branch): what is on offer there, grouped by beer with the person's
 * favourites first.
 *
 * "הבירות שלי" narrows the page to the four ranked beers and lists all four, in order,
 * even when some have nothing on offer — saying so, instead of quietly dropping them and
 * leaving the person unsure whether the app had checked.
 */
export default async function StorePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const query = await searchParams;

  const store = await getStoreBySlug(slug);
  if (!store) notFound();

  const viewer = await getViewer();
  const view = query.view === "regular" ? "regular" : "deals";
  // `tab=mine` is the old link shape; it keeps working.
  const mineOnly = query.mine === "1" || query.tab === "mine";
  const sort = parseSort(query.sort);
  const perLiter = query.unit === "1";
  const pack = parsePack(query.pack, query.c);

  const favouriteIds = viewer.favorites.map((beer) => beer.id);
  const [offers, regular] = await Promise.all([getOffers({ storeSlug: slug }), getRegularPrices({ storeSlug: slug })]);

  const path = `/store/${store.slug}`;
  const scope = <T extends { beer_id: string }>(rows: T[]) => (mineOnly ? rows.filter((row) => favouriteIds.includes(row.beer_id)) : rows);
  const scopedOffers = scope(offers);
  const scopedRegular = scope(regular);

  const current: Record<string, string | undefined> = {
    view: view === "regular" ? "regular" : undefined,
    mine: mineOnly ? "1" : undefined,
    sort,
    unit: perLiter ? "1" : "",
    pack,
  };
  const defaults = { sort: "value", unit: "", pack: "all" };
  const link = (patch: Record<string, string | undefined>) => withParams(path, current, patch, defaults);

  const availablePacks = [...new Set(view === "deals" ? scopedOffers.map(packClass) : scopedRegular.map(regularPackClass))] as PackFilter[];
  const beerCount = new Set(offers.map((offer) => offer.beer_id)).size;
  const freshest = newestObservation(view === "deals" ? scopedOffers : scopedRegular);

  const dealGroups = groupByBeer(filterByPack(scopedOffers, pack), favouriteIds).map((group) => ({
    ...group,
    offers: sortOffers(group.offers, sort, perLiter),
  }));
  const regularGroups = groupRegularByBeer(filterRegularByPack(scopedRegular, pack), favouriteIds);

  // With "mine" on, every favourite gets a place in the person's own order, whether or not
  // this chain has anything for it.
  const dealItems = mineOnly ? viewer.favorites.map((beer) => dealGroups.find((group) => group.beerId === beer.id) ?? beer) : dealGroups;
  const regularItems = mineOnly ? viewer.favorites.map((beer) => regularGroups.find((group) => group.beerId === beer.id) ?? beer) : regularGroups;

  return (
    <Screen>
      <TopBar
        title={store.name_he}
        backHref="/store"
        sub={
          <>
            {offers.length > 0
              ? `${offers.length} ${offers.length === 1 ? "מבצע" : "מבצעים"} על ${beerCount} ${beerCount === 1 ? "בירה" : "בירות"}`
              : "אין כרגע מבצעים ברשת הזו"}
            {freshest && (
              <>
                {" · "}
                <Freshness at={freshest} />
              </>
            )}
          </>
        }
      />

      <div className="mb-4 space-y-3">
        <Segmented
          label="תצוגה"
          items={[
            { href: link({ view: undefined }), label: `מבצעים${offers.length ? ` (${offers.length})` : ""}`, selected: view === "deals" },
            { href: link({ view: "regular" }), label: "מחירים רגילים", selected: view === "regular" },
          ]}
        />
      </div>

      {(view === "deals" ? offers.length > 0 : regular.length > 0) && (
        <div className="mb-5 space-y-3">
          <SortBar
            path={path}
            state={{ sort, perLiter, pack, extra: { view: current.view, mine: current.mine } }}
            sorting={view === "deals"}
            availablePacks={availablePacks}
            leading={
              <Chip href={link({ mine: mineOnly ? undefined : "1" })} selected={mineOnly}>
                {mineOnly && <CheckIcon size={16} />}
                הבירות שלי
              </Chip>
            }
          />
        </div>
      )}

      {view === "deals" &&
        (offers.length === 0 ? (
          <EmptyState
            title={`אין כרגע מבצע ב${store.name_he}`}
            action={regular.length > 0 ? <ButtonLink href={link({ view: "regular" })}>לראות את המחירים הרגילים</ButtonLink> : undefined}
          >
            כשמבצע יופיע, הוא יעלה כאן.
          </EmptyState>
        ) : (
          <div className="space-y-7">
            {dealItems.map((item, index) =>
              "offers" in item ? (
                <Strip
                  key={item.beerId}
                  title={item.name}
                  href={`/beer/${item.slug}`}
                  aside={`${item.offers.length} ${item.offers.length === 1 ? "מבצע" : "מבצעים"}`}
                  offers={item.offers}
                  lead="pack"
                  showStore={false}
                  printIn={index === 0}
                />
              ) : (
                <NoOffer key={item.id} name={item.name_he} slug={item.slug} where={store.name_he} />
              ),
            )}
            {dealItems.length === 0 && (
              <EmptyState title="אין מבצע באריזה הזו">נסו סוג אריזה אחר.</EmptyState>
            )}
          </div>
        ))}

      {view === "regular" &&
        (regular.length === 0 ? (
          <EmptyState title="עוד אין מחירים רגילים לרשת הזו">מחירים רגילים נכנסים מפרסומי הרשתות.</EmptyState>
        ) : (
          <div className="space-y-7">
            {regularItems.map((item) =>
              "prices" in item ? (
                <RegularStrip
                  key={item.beerId}
                  title={item.name}
                  href={`/beer/${item.slug}`}
                  aside={`${item.prices.length} ${item.prices.length === 1 ? "אריזה" : "אריזות"}`}
                  prices={item.prices}
                  lead="pack"
                />
              ) : (
                <NoOffer key={item.id} name={item.name_he} slug={item.slug} where={store.name_he} price />
              ),
            )}
            {regularItems.length === 0 && (
              <EmptyState title="אין מחיר באריזה הזו">נסו סוג אריזה אחר.</EmptyState>
            )}
          </div>
        ))}
    </Screen>
  );
}

/** A favourite with nothing to show at this chain: named, and said plainly. */
function NoOffer({ name, slug, where, price = false }: { name: string; slug: string; where: string; price?: boolean }) {
  return (
    <Tape className="px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="min-w-0 truncate text-lg font-bold text-ink">
          <Link href={`/beer/${slug}`} className="inline-flex min-h-11 min-w-11 items-center underline-offset-4 hover:underline">
            {name}
          </Link>
        </h2>
        <span className="hatch shrink-0 rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink">
          {price ? "אין מחיר" : "אין מבצע"}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-2">
        {price ? `לא ראינו מחיר רגיל של ${name} ב${where}.` : `אין כרגע מבצע על ${name} ב${where}.`}
      </p>
    </Tape>
  );
}
