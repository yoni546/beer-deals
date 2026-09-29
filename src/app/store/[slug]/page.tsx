import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, Screen, TopBar } from "@/components/Chrome";
import { Freshness } from "@/components/Freshness";
import { Strip } from "@/components/BeerStrip";
import { GroupStrip } from "@/components/GroupOffers";
import { RegularStrip } from "@/components/RegularStrip";
import { CategorySection, NoDealLine, Part } from "@/components/Sections";
import { SortBar } from "@/components/SortBar";
import { Chip } from "@/components/ui/Chip";
import { CheckIcon } from "@/components/ui/icons";
import { Tape } from "@/components/ui/Tape";
import { PACK_CLASS_HE } from "@/lib/format";
import { getGroupOffers, getOffers, getRegularPrices } from "@/lib/offers";
import {
  PACK_CLASSES,
  groupByBeer,
  groupPackClass,
  groupRegularByBeer,
  newestObservation,
  orderByPack,
  packClass,
  parsePack,
  parseSort,
  regularPackClass,
  sortRegular,
  type PackFilter,
} from "@/lib/offer-logic";
import { getStoreBySlug } from "@/lib/queries";
import { getViewer } from "@/lib/session";
import { withParams } from "@/lib/urls";

export const dynamic = "force-dynamic";

type Search = { view?: string; mine?: string; sort?: string; unit?: string; pack?: string; c?: string; tab?: string };

/**
 * One chain (not one branch), by kind of pack — שישיות, then ארגזים, then בודדים — and inside each kind
 * the current beer deals (everyone can use them, including "any N of these" mix-and-match offers) first,
 * then the regular beer prices. Never mixed. Beers are grouped with the person's favourites first. Prices
 * are per branch; a chain row says which branch, or "החל מ־".
 *
 * "הבירות שלי" narrows the page to the four ranked beers, and a favourite this chain has nothing for is
 * still named at the end, instead of quietly dropped and leaving the person unsure whether we checked.
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

  const availablePacks = [
    ...new Set([...scopedOffers.map(packClass), ...scopedRegular.map(regularPackClass), ...scopedGroups.map(groupPackClass)]),
  ] as PackFilter[];
  const beerCount = new Set(offers.map((offer) => offer.beer_id)).size;
  const freshest = newestObservation([...scopedOffers, ...scopedRegular]);
  const dealCount = offers.length + groupOffers.length;

  const kinds = PACK_CLASSES.filter((kind) => (pack === "all" || pack === kind) && availablePacks.includes(kind)).map((kind) => ({
    kind,
    deals: groupByBeer(scopedOffers.filter((offer) => packClass(offer) === kind), favouriteIds).map((group) => ({
      ...group,
      offers: orderByPack(group.offers, sort, perLiter),
    })),
    groups: scopedGroups.filter((group) => groupPackClass(group) === kind),
    // Inside a beer the packs keep their natural order (a 330 ml bottle is not "cheaper" than a six-pack);
    // only per litre — the one number that compares packs — re-orders them.
    regular: groupRegularByBeer(scopedRegular.filter((price) => regularPackClass(price) === kind), favouriteIds).map((group) => ({
      ...group,
      prices: perLiter ? sortRegular(group.prices, sort, true) : group.prices,
    })),
  }));
  // With "mine" on, a favourite this chain has nothing for is still named.
  const missing = mineOnly
    ? viewer.favorites.filter((beer) => !scopedOffers.some((o) => o.beer_id === beer.id) && !scopedRegular.some((p) => p.beer_id === beer.id))
    : [];

  // A busy chain must not become an endless page: the first few beers of each list, the rest one tap away.
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
        <div className="mb-6">
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
        </div>
      )}

      {dealCount === 0 && regular.length === 0 ? (
        <EmptyState title={`עוד אין מחירי בירה מ${store.name_he}`}>מחירים ומבצעים נכנסים מפרסומי הרשתות. כשיופיעו, הם יעלו כאן.</EmptyState>
      ) : kinds.length === 0 && missing.length === 0 ? (
        <EmptyState title="אין כאן כלום מהסוג הזה">נסו שישיות, ארגזים או בודדים.</EmptyState>
      ) : (
        <div className="space-y-10">
          {kinds.map(({ kind, deals, groups: mixes, regular: prices }, section) => {
            const dealNodes = deals.map((item, index) => (
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
                printIn={section === 0 && index === 0}
                headingLevel="h4"
              />
            ));
            const regularNodes = prices.map((item) => (
              <RegularStrip
                key={item.beerId}
                title={item.name}
                href={`/beer/${item.slug}`}
                aside={`${item.prices.length} ${item.prices.length === 1 ? "אריזה" : "אריזות"}`}
                prices={item.prices}
                lead="pack"
                perLiter={perLiter}
                headingLevel="h4"
              />
            ));
            return (
              <CategorySection key={kind} kind={kind}>
                {dealNodes.length > 0 || mixes.length > 0 ? (
                  <Part part="deals" title="מבצעים">
                    {head(dealNodes)}
                    <Fold hidden={tail(dealNodes).length}>{tail(dealNodes)}</Fold>
                    <GroupStrip title="מבצעי שילוב" offers={mixes} showStore={false} headingLevel="h4" />
                  </Part>
                ) : (
                  <NoDealLine>
                    אין כרגע מבצע על {PACK_CLASS_HE[kind]} ב{store.name_he}.
                  </NoDealLine>
                )}
                {regularNodes.length > 0 && (
                  <Part part="regular" title="מחירים רגילים">
                    {head(regularNodes)}
                    <Fold hidden={tail(regularNodes).length}>{tail(regularNodes)}</Fold>
                  </Part>
                )}
              </CategorySection>
            );
          })}
          {missing.length > 0 && (
            <div className="space-y-5">
              {missing.map((beer) => (
                <NoOffer key={beer.id} name={beer.name_he} slug={beer.slug} where={store.name_he} />
              ))}
            </div>
          )}
        </div>
      )}
    </Screen>
  );
}

/** A favourite with nothing at all at this chain — no deal and no price: named, and said plainly. */
function NoOffer({ name, slug, where }: { name: string; slug: string; where: string }) {
  return (
    <Tape className="px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate text-lg font-bold text-ink">
          <Link href={`/beer/${slug}`} className="inline-flex min-h-11 min-w-11 items-center underline-offset-4 hover:underline">
            {name}
          </Link>
        </h3>
        <span className="hatch shrink-0 rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink">אין מחיר</span>
      </div>
      <p className="mt-1 text-sm text-ink-2">{`לא ראינו את ${name} ב${where} — לא במבצע ולא במחיר רגיל.`}</p>
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
