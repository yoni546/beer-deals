import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, Screen, TopBar } from "@/components/Chrome";
import { Freshness } from "@/components/Freshness";
import { Strip } from "@/components/BeerStrip";
import { GroupStrip } from "@/components/GroupOffers";
import { RegularStrip } from "@/components/RegularStrip";
import { JumpToRegular, SectionHeading } from "@/components/Sections";
import { SortBar } from "@/components/SortBar";
import { Chip } from "@/components/ui/Chip";
import { CheckIcon } from "@/components/ui/icons";
import { Tape } from "@/components/ui/Tape";
import { getGroupOffers, getOffers, getRegularPrices } from "@/lib/offers";
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
  sortRegular,
  type PackFilter,
} from "@/lib/offer-logic";
import { getStoreBySlug } from "@/lib/queries";
import { getViewer } from "@/lib/session";
import { withParams } from "@/lib/urls";

export const dynamic = "force-dynamic";

type Search = { view?: string; mine?: string; sort?: string; unit?: string; pack?: string; c?: string; tab?: string };

/**
 * One chain (not one branch), in two parts, never mixed: current beer deals (everyone can use them,
 * including "any N of these" group offers), then regular beer prices — grouped by beer with the
 * person's favourites first. Prices are per branch; a chain row says which branch, or "החל מ־".
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
  // `tab=mine` is the old link shape; it keeps working.
  const mineOnly = query.mine === "1" || query.tab === "mine";
  const sort = parseSort(query.sort);
  const perLiter = query.unit === "1";
  const pack = parsePack(query.pack, query.c);

  const favouriteIds = viewer.favorites.map((beer) => beer.id);
  const [offers, regular, groupOffers] = await Promise.all([
    getOffers({ storeSlug: slug }),
    getRegularPrices({ storeSlug: slug }),
    getGroupOffers({ storeSlug: slug }),
  ]);

  const path = `/store/${store.slug}`;
  const scope = <T extends { beer_id: string }>(rows: T[]) => (mineOnly ? rows.filter((row) => favouriteIds.includes(row.beer_id)) : rows);
  const scopedOffers = scope(offers);
  const scopedRegular = scope(regular);
  const scopedGroups = mineOnly ? groupOffers.filter((g) => g.beer_ids.some((id) => favouriteIds.includes(id))) : groupOffers;

  const current: Record<string, string | undefined> = {
    mine: mineOnly ? "1" : undefined,
    sort,
    unit: perLiter ? "1" : "",
    pack,
  };
  const defaults = { sort: "value", unit: "", pack: "all" };
  const link = (patch: Record<string, string | undefined>) => withParams(path, current, patch, defaults);

  const availablePacks = [...new Set([...scopedOffers.map(packClass), ...scopedRegular.map(regularPackClass)])] as PackFilter[];
  const beerCount = new Set(offers.map((offer) => offer.beer_id)).size;
  const freshest = newestObservation([...scopedOffers, ...scopedRegular]);
  const dealCount = offers.length + groupOffers.length;

  const dealGroups = groupByBeer(filterByPack(scopedOffers, pack), favouriteIds).map((group) => ({
    ...group,
    offers: sortOffers(group.offers, sort, perLiter),
  }));
  // Inside a beer the packs stay smallest-first (a 330 ml bottle is not "cheaper" than a six-pack);
  // only per litre — the one number that compares packs — re-orders them.
  const regularGroups = groupRegularByBeer(filterRegularByPack(scopedRegular, pack), favouriteIds).map((group) => ({
    ...group,
    prices: perLiter ? sortRegular(group.prices, sort, true) : group.prices,
  }));

  // With "mine" on, every favourite gets a place in the person's own order, whether or not
  // this chain has anything for it.
  const dealItems = mineOnly ? viewer.favorites.map((beer) => dealGroups.find((group) => group.beerId === beer.id) ?? beer) : dealGroups;
  const regularItems = mineOnly ? viewer.favorites.map((beer) => regularGroups.find((group) => group.beerId === beer.id) ?? beer) : regularGroups;

  const dealNodes = dealItems.map((item, index) =>
    "offers" in item ? (
      <Strip
        key={item.beerId}
        title={item.name}
        beerSlug={item.slug}
        href={`/beer/${item.slug}`}
        aside={`${item.offers.length} ${item.offers.length === 1 ? "מבצע" : "מבצעים"}`}
        offers={item.offers}
        lead="pack"
        perLiter={perLiter}
        showStore={false}
        printIn={index === 0}
        headingLevel="h3"
      />
    ) : (
      <NoOffer key={item.id} name={item.name_he} slug={item.slug} where={store.name_he} />
    ),
  );
  const regularNodes = regularItems.map((item) =>
    "prices" in item ? (
      <RegularStrip
        key={item.beerId}
        title={item.name}
        href={`/beer/${item.slug}`}
        aside={`${item.prices.length} ${item.prices.length === 1 ? "אריזה" : "אריזות"}`}
        prices={item.prices}
        lead="pack"
        perLiter={perLiter}
        headingLevel="h3"
      />
    ) : (
      <NoOffer key={item.id} name={item.name_he} slug={item.slug} where={store.name_he} price />
    ),
  );
  // A busy chain must not become an endless page: the first few beers, the rest one tap away.
  // ("My beers" is at most four, so it is never folded.)
  const FIRST = 6;
  const head = (nodes: React.ReactNode[]) => (mineOnly ? nodes : nodes.slice(0, FIRST));
  const tail = (nodes: React.ReactNode[]) => (mineOnly ? [] : nodes.slice(FIRST));

  return (
    <Screen>
      <TopBar
        title={store.name_he}
        backHref="/store"
        sub={
          <>
            {dealCount > 0
              ? `${dealCount} ${dealCount === 1 ? "מבצע" : "מבצעים"} על ${beerCount || "כמה"} ${beerCount === 1 ? "בירה" : "בירות"}`
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

      {(dealCount > 0 || regular.length > 0) && (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-2">
          <SortBar
            path={path}
            state={{ sort, perLiter, pack, extra: { mine: current.mine } }}
            availablePacks={availablePacks}
            leading={
              <Chip href={link({ mine: mineOnly ? undefined : "1" })} selected={mineOnly}>
                {mineOnly && <CheckIcon size={16} />}
                הבירות שלי
              </Chip>
            }
          />
          <JumpToRegular count={regular.length} />
        </div>
      )}

      <section aria-labelledby="deals" className="scroll-mt-4">
        <SectionHeading id="deals">מבצעי בירה עכשיו</SectionHeading>
        {dealCount === 0 ? (
          <EmptyState title={`אין כרגע מבצע ב${store.name_he}`}>כשמבצע שפתוח לכולם יופיע, הוא יעלה כאן.</EmptyState>
        ) : (
          <div className="space-y-7">
            {head(dealNodes)}
            <Fold hidden={tail(dealNodes).length}>{tail(dealNodes)}</Fold>
            {dealItems.length === 0 && scopedGroups.length === 0 && <EmptyState title="אין מבצע באריזה הזו">נסו סוג אריזה אחר.</EmptyState>}
            <GroupStrip title="מבצעי שילוב" offers={scopedGroups} showStore={false} headingLevel="h3" />
          </div>
        )}
      </section>

      <section aria-labelledby="regular" className="mt-9 scroll-mt-4">
        <SectionHeading id="regular">מחירי בירה רגילים</SectionHeading>
        {regular.length === 0 ? (
          <EmptyState title="עוד אין מחירים רגילים לרשת הזו">מחירים רגילים נכנסים מפרסומי הרשתות.</EmptyState>
        ) : (
          <div className="space-y-7">
            {head(regularNodes)}
            <Fold hidden={tail(regularNodes).length}>{tail(regularNodes)}</Fold>
            {regularItems.length === 0 && <EmptyState title="אין מחיר באריזה הזו">נסו סוג אריזה אחר.</EmptyState>}
          </div>
        )}
      </section>
    </Screen>
  );
}

/** A favourite with nothing to show at this chain: named, and said plainly. */
function NoOffer({ name, slug, where, price = false }: { name: string; slug: string; where: string; price?: boolean }) {
  return (
    <Tape className="px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate text-lg font-bold text-ink">
          <Link href={`/beer/${slug}`} className="inline-flex min-h-11 min-w-11 items-center underline-offset-4 hover:underline">
            {name}
          </Link>
        </h3>
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

/** "Show N more beers": the rest of a long list, folded (native <details>, no script). */
function Fold({ hidden, children }: { hidden: number; children: React.ReactNode }) {
  if (hidden === 0) return null;
  return (
    <details className="group">
      <summary className="btn btn-ghost w-full cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">
          הציגו עוד {hidden} {hidden === 1 ? "בירה" : "בירות"}
        </span>
        <span className="hidden group-open:inline">הסתירו</span>
      </summary>
      <div className="mt-7 space-y-7">{children}</div>
    </details>
  );
}
