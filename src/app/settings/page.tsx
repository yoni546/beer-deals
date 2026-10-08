import Link from "next/link";
import { redirect } from "next/navigation";
import { Screen, TopBar } from "@/components/Chrome";
import { CouldNotLoad } from "@/components/CouldNotLoad";
import { CreditEditor } from "@/components/CreditEditor";
import { FavouritesEditor } from "@/components/FavouritesEditor";
import { InstallPrompt } from "@/components/InstallPrompt";
import { LocationEditor } from "@/components/LocationEditor";
import { PushToggle } from "@/components/PushToggle";
import { Tape } from "@/components/ui/Tape";
import { ShareApp } from "@/components/ShareApp";
import { WhatsNewLink } from "@/components/WhatsNewLink";
import { publicEnv } from "@/lib/env";
import { currentCreditName } from "@/lib/contributors";
import { WatchlistEditor } from "@/components/WatchlistEditor";
import { getBeers, getBeersById, getMyWatchlist } from "@/lib/queries";
import { latestRelease, latestVisibleVersion } from "@/lib/releases";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * "אני": the four beers, notifications, look, and the app itself. Each block is its own strip,
 * headed on the counter, so the page reads as a short list of decisions rather than one long form.
 */
export default async function SettingsPage() {
  const [viewer, beers, watchlist, allBeers] = await Promise.all([
    getViewer(),
    getBeers(),
    getMyWatchlist(),
    getBeersById(),
  ]);
  // The published name, if they have chosen one (0030). Read here rather than in
  // getViewer because it belongs to nobody's session: it is a public fact.
  const creditName = await currentCreditName(viewer.userId);
  if (viewer.degraded && !viewer.isOnboarded) {
    return (
      <Screen>
        <div className="pt-10">
          <CouldNotLoad what="את ההגדרות שלך" headingLevel={2} />
        </div>
      </Screen>
    );
  }
  if (!viewer.isOnboarded) redirect("/welcome");

  return (
    <Screen>
      <TopBar title="הגדרות" />

      <div className="space-y-8">
        <Section id="s-beers" title="הבירות שלי">
          <FavouritesEditor beers={beers} currentName={viewer.profile?.first_name ?? ""} currentFavourites={viewer.favorites} />
        </Section>

        <Section id="s-credit" title="הקרדיט שלי" note="השם הזה מוצג על מבצעים שאתם מוצאים. השם ב״אהלן״ נשאר פרטי.">
          <CreditEditor current={creditName} />
        </Section>

        <Section
          id="s-watchlist"
          title="בירות שאני עוקב אחריהן"
          note="מעבר לבירה הראשית. אותן הגבלות התראה — אותה הגבלה יומית ואותן שעות שקט."
        >
          {/* From every beer, not the list people choose from: a beer an admin
              switched off (0034) is still followed, and must not vanish from here. */}
          <WatchlistEditor
            rows={Object.entries(watchlist)
              .map(([beerId, watch]) => ({ beer: allBeers[beerId], watch }))
              .filter((row) => row.beer)
              .map(({ beer, watch }) => ({
                beerId: beer.id,
                slug: beer.slug,
                nameHe: beer.name_he,
                maxPriceAgorot: watch.maxPriceAgorot,
              }))}
          />
        </Section>

        <Section id="s-place" title="איפה אני" note="משמש כדי למצוא את הסניף הקרוב אליכם. אפשר להשאיר ריק.">
          <LocationEditor
            current={{
              city: viewer.profile?.home_city ?? "",
              lat: viewer.profile?.home_lat ?? null,
              lon: viewer.profile?.home_lon ?? null,
              radiusKm: viewer.profile?.search_radius_km ?? null,
            }}
          />
        </Section>

        <Section id="s-notifications" title="התראות" note="שולחים רק על מבצע חזק במיוחד, ורק על הבירה הראשית. לא על שאר הבירות שבחרתם.">
          <PushToggle
            vapidPublicKey={publicEnv.vapidPublicKey}
            enabled={viewer.profile?.notifications_enabled ?? false}
            primaryBeerName={viewer.primaryBeer?.name_he ?? null}
          />
        </Section>

        <Section id="s-app" title="האפליקציה">
          <div className="space-y-3">
            <InstallPrompt />
            <Tape className="flex min-h-11 items-center justify-between px-4 py-1">
              {viewer.isAdmin ? <WhatsNewLink latestVersion={latestVisibleVersion} className="-mx-2.5 text-ink" /> : <span className="text-sm text-ink-2">מבצעי בירה</span>}
              <span className="text-sm text-ink-2">
                גרסה <span className="num">{latestRelease.version}</span>
              </span>
            </Tape>
            <ShareApp />
          </div>
        </Section>

        {viewer.isAdmin ? (
          <Link href="/admin" className="btn btn-ghost w-full">
            לוח ניהול
          </Link>
        ) : (
          <Link href="/admin/login" className="flex min-h-11 items-center justify-center text-sm text-on-ground-2 underline underline-offset-4">
            כניסת מנהלים
          </Link>
        )}
      </div>
    </Screen>
  );
}

/**
 * `id` is a slug, not the Hebrew title.
 *
 * It used to be `s-${title}`, and a title like "הבירות שלי" contains a space — so the
 * id was invalid, and `aria-labelledby`, which is a SPACE-SEPARATED list of IDREFs,
 * resolved to two tokens that pointed at nothing. Every section on this page was
 * unnamed to a screen reader navigating by region. axe does not catch it, so a test does.
 */
function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2 text-sm font-semibold text-on-ground-2">
        {title}
      </h2>
      {children}
      {note && <p className="mt-2 text-sm leading-relaxed text-on-ground-2">{note}</p>}
    </section>
  );
}
