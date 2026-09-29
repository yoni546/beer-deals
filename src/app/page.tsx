import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, ButtonLink, Screen } from "@/components/Chrome";
import { FavouriteKeys } from "@/components/FavouriteKeys";
import { Freshness } from "@/components/Freshness";
import { Hero } from "@/components/Hero";
import { HomeSearch } from "@/components/HomeSearch";
import { InstallPrompt } from "@/components/InstallPrompt";
import { SortBar } from "@/components/SortBar";
import { Strip } from "@/components/BeerStrip";
import { GroupStrip } from "@/components/GroupOffers";
import { Gap } from "@/components/ui/Tape";
import { WhatsNewLink } from "@/components/WhatsNewLink";
import { latestVisibleVersion } from "@/lib/releases";
import { getFreshness, getGroupOffers, getOfferByKey, getOffers } from "@/lib/offers";
import {
  filterByPack,
  groupByBeer,
  newestObservation,
  packClass,
  parsePack,
  parseSort,
  pickHero,
  sortOffers,
  summarize,
  type BeerSummary,
  type PackFilter,
} from "@/lib/offer-logic";
import { getBeers, getSettings, getStores } from "@/lib/queries";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

type Search = { sort?: string; unit?: string; pack?: string; c?: string };

/**
 * Home: the drinker's four beers first, in their own order, then the one deal worth
 * knowing about, then everything else. Sorting and pack filters are chips that change
 * the URL, so the page is the same for anyone who follows the link.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await getViewer();
  if (!viewer.isOnboarded) redirect("/welcome");

  const query = await searchParams;
  const sort = parseSort(query.sort);
  const perLiter = query.unit === "1";
  const pack = parsePack(query.pack, query.c);

  const favouriteIds = viewer.favorites.map((beer) => beer.id);
  // One round trip for everything; the editor's pick (rare) is a second one only when there is one.
  const [allBeers, allStores, mine, more, myGroups, settings, updatedAt] = await Promise.all([
    getBeers(),
    getStores(),
    getOffers({ beerIds: favouriteIds }),
    getOffers({ excludeBeerIds: favouriteIds, topByValue: 24 }),
    getGroupOffers({ beerIds: favouriteIds }),
    getSettings(),
    getFreshness(),
  ]);
  const featured = settings?.weekly_deal_id ? await getOfferByKey(`deal:${settings.weekly_deal_id}`) : null;

  const everything = [...mine, ...more];
  const freshest = updatedAt ?? newestObservation(everything);

  const summaries: Record<string, BeerSummary> = {};
  for (const beer of viewer.favorites) summaries[beer.id] = summarize(mine.filter((offer) => offer.beer_id === beer.id));

  const availablePacks = [...new Set(everything.map(packClass))] as PackFilter[];
  const strips = groupByBeer(filterByPack(mine, pack), favouriteIds).map((group) => ({
    ...group,
    offers: sortOffers(group.offers, sort, perLiter),
  }));
  const others = sortOffers(filterByPack(more, pack), sort, perLiter);

  // An editor's pick wins; otherwise the best verified saving, favourites first.
  const hero = pack === "all" ? (featured ? { offer: featured, reason: "value" as const } : pickHero(everything, favouriteIds)) : null;
  const name = viewer.profile?.first_name;

  return (
    <Screen>
      <header className="mb-5">
        <div className="flex items-center justify-between gap-2">
          <h1 className="min-w-0 truncate text-[1.75rem] leading-tight font-bold text-on-ground">{name ? `אהלן, ${name}` : "אהלן"}</h1>
          <WhatsNewLink latestVersion={latestVisibleVersion} className="-me-2.5 text-on-ground-2" />
        </div>
        <div className="mt-1">
          <Freshness at={freshest} />
        </div>
      </header>

      {/* The stage: an open stretch of counter where favourite #1's bottle is seen, not covered —
          the one place on the screen that says, at a glance, whose app this is. */}
      {viewer.primaryBeer && (
        <div className="stage-window flex items-end justify-center">
          <Link
            href={`/beer/${viewer.primaryBeer.slug}`}
            className="stage-caption inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold"
          >
            <span className="text-on-ground-2">הבירה שלכם</span>
            <span className="text-on-ground">{viewer.primaryBeer.name_he}</span>
          </Link>
        </div>
      )}

      <div className="mb-6">
        <HomeSearch
          beers={allBeers.map((beer) => ({ slug: beer.slug, label: beer.name_he, alias: beer.name_en }))}
          stores={allStores.map((store) => ({ slug: store.slug, label: store.name_he }))}
        />
      </div>

      <section aria-labelledby="mine" className="mb-6">
        <h2 id="mine" className="mb-2 text-sm font-semibold text-on-ground-2">
          הבירות שלי
        </h2>
        <FavouriteKeys beers={viewer.favorites} summaries={summaries} />
      </section>

      {hero && (
        <>
          <Hero pick={hero} editorial={Boolean(featured)} />
          <Gap />
        </>
      )}

      {everything.length === 0 && myGroups.length === 0 ? (
        <EmptyState
          title="עוד אין מבצעים מאומתים"
          action={<ButtonLink href="/submit">ראיתם מבצע? שלחו לנו</ButtonLink>}
        >
          מחירים אמיתיים נכנסים לפי עדכוני הרשתות ודיווחים שנבדקו. עד אז אנחנו לא מציגים מבצעים שאי אפשר לסמוך עליהם.
        </EmptyState>
      ) : (
        <>
          <div className="mb-5">
            <SortBar path="/" state={{ sort, perLiter, pack }} availablePacks={availablePacks} />
          </div>

          <div className="space-y-7">
            {strips.map((group) => (
              <Strip
                key={group.beerId}
                title={group.name}
                beerSlug={group.slug}
                href={`/beer/${group.slug}`}
                aside={`${group.offers.length} ${group.offers.length === 1 ? "מבצע" : "מבצעים"}`}
                offers={group.offers}
                lead="pack"
                perLiter={perLiter}
                limit={3}
                moreHref={`/beer/${group.slug}`}
              />
            ))}

            <GroupStrip title="מבצעי שילוב על הבירות שלי" offers={myGroups} />

            {mine.length === 0 && myGroups.length === 0 && (
              <EmptyState title="אין כרגע מבצע על הבירות שלי">
                כשיופיע מבצע על אחת מהארבע, הוא יעלה לכאן ראשון.
              </EmptyState>
            )}

            {others.length > 0 && (
              <Strip
                title="עוד מבצעים"
                offers={others}
                lead="beer"
                perLiter={perLiter}
                limit={6}
                moreHref="/beer"
              />
            )}
          </div>
        </>
      )}

      <Gap size="lg" />
      <div className="space-y-4 text-center">
        <InstallPrompt compact />
        <Link href="/submit" className="inline-flex min-h-11 items-center px-4 text-sm font-semibold text-on-ground-2 underline underline-offset-4">
          מצאתם מבצע שאנחנו לא מציגים? שלחו לנו
        </Link>
      </div>
    </Screen>
  );
}
