import Link from "next/link";
import { PinIcon } from "@/components/ui/icons";
import { redirect } from "next/navigation";
import { EmptyState, ButtonLink, Screen } from "@/components/Chrome";
import { CouldNotLoad } from "@/components/CouldNotLoad";
import { FavouriteKeys } from "@/components/FavouriteKeys";
import { Freshness } from "@/components/Freshness";
import { Hero } from "@/components/Hero";
import { HomeSearch } from "@/components/HomeSearch";
import { InstallPrompt } from "@/components/InstallPrompt";
import { ShareApp } from "@/components/ShareApp";
import { SortBar } from "@/components/SortBar";
import { TopHunter } from "@/components/DealHunters";
import { IntentSwitch, CannotMeasure } from "@/components/IntentSwitch";
import { Strip } from "@/components/BeerStrip";
import { GroupStrip } from "@/components/GroupOffers";
import { Gap } from "@/components/ui/Tape";
import { WhatsNewLink } from "@/components/WhatsNewLink";
import { latestVisibleVersion } from "@/lib/releases";
import { getFreshness, getGroupOffers, getOfferByKey, getOffers } from "@/lib/offers";
import {
  filterByPack,
  groupByBeer,
  groupPackClass,
  newestObservation,
  orderForHome,
  packClass,
  orderByIntent,
  parseIntent,
  parsePack,
  parseSort,
  pickHero,
  type SearchIntent,
  summarize,
  watchHits,
  type BeerSummary,
  type PackFilter,
} from "@/lib/offer-logic";
import { topContributors } from "@/lib/contributors";
import { distancesFor } from "@/lib/distance";
import { kmHe } from "@/lib/format";
import { getBeers, getMyWatchlist, getSettings, getStores } from "@/lib/queries";
import { WatchHits } from "@/components/WatchHits";
import { attempt, failed, or } from "@/lib/attempt";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

type Search = { sort?: string; unit?: string; pack?: string; c?: string; intent?: string };

/**
 * Home: the drinker's four beers first, in their own order, then the one deal worth
 * knowing about, then everything else. Sorting and pack filters are chips that change
 * the URL, so the page is the same for anyone who follows the link.
 *
 * Beer for home (PRODUCT.md): Home shows packs and cases only — never a single can. Six-packs first,
 * then cases, then eights and fours, then any other pack; the person's own beers before all of them.
 * Singles are one tap away on each beer's and chain's page.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await getViewer();
  // Never conclude "not onboarded" from a read that failed: that is what used to throw an
  // onboarded person back into onboarding on a transient database hiccup.
  if (viewer.degraded && !viewer.isOnboarded) {
    return (
      <Screen>
        <div className="pt-10">
          <CouldNotLoad what="את הפרופיל שלך" headingLevel={2} />
        </div>
      </Screen>
    );
  }
  if (!viewer.isOnboarded) redirect("/welcome");

  const query = await searchParams;
  const sort = parseSort(query.sort);
  const perLiter = query.unit === "1";
  // Home has no singles, so a "singles" link (an old notification) opens everything Home has.
  const requested = parsePack(query.pack, query.c);
  const pack: PackFilter = requested === "single" ? "all" : requested;
  // What they are after right now. In the URL, never in the profile (src/lib/offer-logic.ts).
  const intent = parseIntent(query.intent);
  const hrefForIntent = (next: SearchIntent) => {
    const params = new URLSearchParams();
    if (query.sort) params.set("sort", query.sort);
    if (query.unit) params.set("unit", query.unit);
    if (query.pack) params.set("pack", query.pack);
    if (next !== "best") params.set("intent", next);
    const search = params.toString();
    return search ? `/?${search}` : "/";
  };

  const favouriteIds = viewer.favorites.map((beer) => beer.id);
  // Every read in one round trip, and every one of them allowed to fail on its own. A page that
  // put all seven in a bare Promise.all lost the whole screen whenever any single one timed out —
  // including the purely decorative "last updated". See src/lib/attempt.ts.
  const watchlist = or(await attempt("home.watchlist", () => getMyWatchlist()), {});
  const watchedIds = Object.keys(watchlist);

  const [catalogue, mineRead, moreRead, groupsRead, settingsRead, freshnessRead, watchedRead] = await Promise.all([
    attempt("catalogue", async () => ({ beers: await getBeers(), stores: await getStores() })),
    attempt("home.mine", () => getOffers({ beerIds: favouriteIds, packsOnly: true })),
    attempt("home.more", () => getOffers({ excludeBeerIds: favouriteIds, topByValue: 24, packsOnly: true })),
    attempt("home.groups", () => getGroupOffers({ beerIds: favouriteIds })),
    attempt("settings", () => getSettings()),
    attempt("freshness", () => getFreshness()),
    // Beers they follow (0037) are in neither of the two reads above: not favourites,
    // and not necessarily among the best savings anywhere. Skipped entirely when
    // nobody is followed, which is most people.
    watchedIds.length > 0
      ? attempt("home.watched", () => getOffers({ beerIds: watchedIds, packsOnly: true }))
      : null,
  ]);

  const { beers: allBeers, stores: allStores } = or(catalogue, { beers: [], stores: [] });
  const mineAll = or(mineRead, []);
  const moreAll = or(moreRead, []);
  const myGroupsAll = or(groupsRead, []);
  const settings = or(settingsRead, null);
  const updatedAt = or(freshnessRead, null);
  const watchedAll = watchedRead ? or(watchedRead, []) : [];

  // Which parts of the screen must say "we could not look" instead of showing nothing.
  const myDealsFailed = failed(mineRead) || failed(groupsRead);
  const moreFailed = failed(moreRead);

  // The editor's pick is one more read, and losing it costs a hero, not a page.
  const pickRead = settings?.weekly_deal_id
    ? await attempt("home.weekly", () => getOfferByKey(`deal:${settings.weekly_deal_id}`))
    : null;
  const pick = pickRead ? or(pickRead, null) : null;
  const featured = pick && packClass(pick) !== "single" ? pick : null;
  // The database leaves out single units by count; a user-submitted deal has no count, only a kind ("בודד").
  const packsOnly = (offer: (typeof mineAll)[number]) => packClass(offer) !== "single";
  const mine = mineAll.filter(packsOnly);
  const more = moreAll.filter(packsOnly);
  const myGroups = myGroupsAll.filter((group) => groupPackClass(group) !== "single");

  // What reached the price they asked for, and what did not. The rest joins the
  // ordinary lists rather than getting a section of its own: a beer somebody follows
  // is not news until it does what they asked.
  const { hits: watchReached, rest: watchedOther } = watchHits(watchedAll.filter(packsOnly), watchlist);

  const everything = [...mine, ...more, ...watchedOther];
  const freshest = updatedAt ?? newestObservation(everything);

  // How far each one is, or the reason we cannot say. Nothing here invents a position:
  // the branch coordinate columns (0026) are deliberately empty until a geocoding
  // provider is configured, so today this reports that we do not know.
  const distances = await distancesFor(viewer, everything);
  const topHunter = or(await attempt("hunters.top", () => topContributors(1)), [])[0] ?? null;
  const nearby = orderByIntent(everything, "near", distances.available ? distances.byOffer : {}, sort, perLiter);

  const summaries: Record<string, BeerSummary> = {};
  for (const beer of viewer.favorites) summaries[beer.id] = summarize(mine.filter((offer) => offer.beer_id === beer.id));

  // "Closest to me", in the person's own order of beers — with the nearest shops kept
  // at the top where the screen's name promises they are.
  //
  // Grouping by favourite was asked for and is right, but it had a consequence nobody
  // asked for: the first thing on the screen stopped being the nearest offer and became
  // favourite #1's nearest offer, which can be an hour's drive while a different beer
  // is on offer down the road. Somebody standing in מנחמיה was shown עפולה and
  // קריית טבעון while בית שאן was nearer and further down the page.
  //
  // So the few genuinely nearest offers lead, whatever beer they are, and the beers
  // follow in the person's own order. Both questions get answered where they are asked.
  const favouriteSet = new Set(favouriteIds);
  const NEAREST_FIRST = 4;
  const closest = nearby.offers.slice(0, NEAREST_FIRST);
  const closestKeys = new Set(closest.map((offer) => offer.offer_key));
  const nearbyMine = nearby.offers.filter((offer) => favouriteSet.has(offer.beer_id) && !closestKeys.has(offer.offer_key));
  const nearbyStrips = groupByBeer(nearbyMine, favouriteIds);
  const nearbyRest = nearby.offers.filter((offer) => !favouriteSet.has(offer.beer_id) && !closestKeys.has(offer.offer_key));

  /** How far the nearest offer in a group is — said on the heading, so the page can be scanned. */
  const kmOf = (offers: typeof nearby.offers) => {
    const all = offers.map((offer) => (distances.available ? distances.byOffer[offer.offer_key] : undefined)).filter((km): km is number => km !== undefined);
    return all.length ? Math.min(...all) : undefined;
  };

  const availablePacks = [...new Set(everything.map(packClass))] as PackFilter[];
  const strips = groupByBeer(filterByPack(mine, pack), favouriteIds).map((group) => ({
    ...group,
    offers: orderForHome(group.offers, favouriteIds, sort, perLiter),
  }));
  const others = orderForHome(filterByPack(more, pack), [], sort, perLiter);

  // An editor's pick wins; otherwise the best verified saving, favourites first.
  const hero = pack === "all" ? (featured ? { offer: featured, reason: "value" as const } : pickHero(everything, favouriteIds)) : null;
  const name = viewer.profile?.first_name;

  return (
    <Screen>
      <header className="mb-5">
        <div className="flex items-center justify-between gap-2">
          <h1 className="min-w-0 truncate text-[1.75rem] leading-tight font-bold text-on-ground">{name ? `אהלן, ${name}` : "אהלן"}</h1>
          {/* Release notes are for the people who run the app (the page itself checks too). */}
          {viewer.isAdmin && <WhatsNewLink latestVersion={latestVisibleVersion} className="-me-2.5 text-on-ground-2" />}
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
        {failed(catalogue) ? (
          <CouldNotLoad what="את החיפוש" />
        ) : (
          <HomeSearch
            beers={allBeers.map((beer) => ({ slug: beer.slug, label: beer.name_he, alias: beer.name_en }))}
            stores={allStores.map((store) => ({ slug: store.slug, label: store.name_he }))}
          />
        )}
      </div>

      {/* Above everything the app chose, because they chose this. */}
      <WatchHits hits={watchReached} />

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

      {everything.length === 0 && myGroups.length === 0 && !myDealsFailed && !moreFailed ? (
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

          <div className="mb-5 flex items-center gap-3">
            <IntentSwitch intent={intent} hrefFor={hrefForIntent} />
            {/* The way into the map. A tab of its own would make a map one of the
                four things this app is, which it is not: it is one way of reading
                the answer Home already gives.

                SHOWN TO EVERYONE, including somebody who has never said where they
                live (the owner's rule, 2026-10-25). It used to appear only when we
                could place the person, which made the map a reward for filling in
                a profile — and wanting to see another town's deals is a reason to
                open a map, not a reason to be turned away from one. */}
            <Link href="/map" prefetch={false} className="disclose shrink-0 text-sm text-on-ground">
              <PinIcon size={16} />
              על המפה
            </Link>
          </div>

          {intent === "near" ? (
            // Your beers first, each one nearest-first — the same shape as the rest of
            // the app, because "favourite #1 is the app" does not stop being true when
            // the question is where. (It was one flat distance list at first, on the
            // argument that "I want beer now" is about where and not whose. The owner
            // used it and said otherwise, which is better evidence than the argument.)
            // Everything else keeps a strip of its own at the foot rather than
            // disappearing, so a bargain on a beer nobody follows is still findable.
            nearby.offers.length === 0 ? (
              <CannotMeasure distances={distances} unplaceable={nearby.unplaceable} />
            ) : (
              <>
                <div className="space-y-7">
                  {closest.length > 0 && (
                    <Strip
                      title="הכי קרוב אליך"
                      offers={closest}
                      lead="beer"
                      perLiter={perLiter}
                      distances={distances.available ? distances.byOffer : undefined}
                      branches={distances.available ? distances.branchByOffer : undefined}
                    />
                  )}
                  {nearbyStrips.map((group) => (
                    <Strip
                      key={group.beerId}
                      title={group.name}
                      beerSlug={group.slug}
                      aside={kmOf(group.offers) !== undefined ? `מ־${kmHe(kmOf(group.offers)!)}` : undefined}
                      offers={group.offers}
                      lead="chain"
                      perLiter={perLiter}
                      limit={6}
                      distances={distances.available ? distances.byOffer : undefined}
                      branches={distances.available ? distances.branchByOffer : undefined}
                    />
                  ))}
                  {nearbyRest.length > 0 && (
                    <Strip
                      title="עוד בסביבה"
                      aside={kmOf(nearbyRest) !== undefined ? `מ־${kmHe(kmOf(nearbyRest)!)}` : undefined}
                      offers={nearbyRest}
                      lead="beer"
                      perLiter={perLiter}
                      limit={8}
                      distances={distances.available ? distances.byOffer : undefined}
                      branches={distances.available ? distances.branchByOffer : undefined}
                    />
                  )}
                </div>
                <CannotMeasure distances={distances} unplaceable={nearby.unplaceable} />
              </>
            )
          ) : (
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

            <GroupStrip title="קונים כמה, בוחרים מהמבצע · הבירות שלי" offers={myGroups} />

            {myDealsFailed ? (
              <CouldNotLoad what="את המבצעים לבירות שלך" />
            ) : (
              mine.length === 0 &&
              myGroups.length === 0 && (
                <EmptyState title="אין כרגע מבצעי שישיות או ארגזים לבירות שלך">
                  כשיופיע מבצע על שישייה או ארגז של אחת מהבירות שלכם, הוא יעלה לכאן ראשון.
                </EmptyState>
              )
            )}

            {moreFailed ? (
              <CouldNotLoad what="את שאר המבצעים" />
            ) : (
              others.length > 0 && (
                <Strip
                  title="עוד מבצעים"
                  offers={others}
                  lead="beer"
                  perLiter={perLiter}
                  limit={6}
                  moreHref="/beer"
                />
              )
            )}
          </div>
          )}
        </>
      )}

      {/* Who found them. One line on Home; the table is a route of its own, because
          a leaderboard is something you go and look at, not something that should sit
          between a person and tonight's beer. */}
      {topHunter && (
        <>
          <Gap />
          <TopHunter standing={topHunter} />
        </>
      )}

      <Gap size="lg" />
      <div className="space-y-4 text-center">
        <ShareApp />
        <InstallPrompt compact />
        <Link href="/submit" className="inline-flex min-h-11 items-center px-4 text-sm font-semibold text-on-ground-2 underline underline-offset-4">
          מצאתם מבצע שאנחנו לא מציגים? שלחו לנו
        </Link>
      </div>
    </Screen>
  );
}
