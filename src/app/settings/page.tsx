import Link from "next/link";
import { redirect } from "next/navigation";
import { Screen, TopBar } from "@/components/Chrome";
import { FavouritesEditor } from "@/components/FavouritesEditor";
import { InstallPrompt } from "@/components/InstallPrompt";
import { PushToggle } from "@/components/PushToggle";
import { ThemePicker } from "@/components/ThemePicker";
import { Tape } from "@/components/ui/Tape";
import { WhatsNewLink } from "@/components/WhatsNewLink";
import type { Appearance } from "@/design/themes";
import { publicEnv } from "@/lib/env";
import { getBeers } from "@/lib/queries";
import { latestRelease, latestVisibleVersion } from "@/lib/releases";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * "אני": the four beers, notifications, look, and the app itself. Each block is its own strip,
 * headed on the counter, so the page reads as a short list of decisions rather than one long form.
 */
export default async function SettingsPage() {
  const [viewer, beers] = await Promise.all([getViewer(), getBeers()]);
  if (!viewer.isOnboarded) redirect("/welcome");

  return (
    <Screen>
      <TopBar title="הגדרות" />

      <div className="space-y-8">
        <Section title="הבירות שלי">
          <FavouritesEditor beers={beers} currentName={viewer.profile?.first_name ?? ""} currentFavourites={viewer.favorites} />
        </Section>

        <Section title="התראות" note="שולחים רק על מבצע חזק במיוחד, ורק על הבירה הראשית. לא על שאר הבירות שבחרתם.">
          <PushToggle
            vapidPublicKey={publicEnv.vapidPublicKey}
            enabled={viewer.profile?.notifications_enabled ?? false}
            primaryBeerName={viewer.primaryBeer?.name_he ?? null}
          />
        </Section>

        <Section title="מראה">
          <ThemePicker
            override={viewer.profile?.theme_override ?? null}
            appearance={(viewer.profile?.appearance ?? "system") as Appearance}
            primarySlug={viewer.primaryBeer?.slug ?? null}
            primaryName={viewer.primaryBeer?.name_he ?? null}
            beerNames={Object.fromEntries(beers.map((beer) => [beer.slug, beer.name_he]))}
          />
        </Section>

        <Section title="האפליקציה">
          <div className="space-y-3">
            <InstallPrompt />
            <Tape className="flex items-center justify-between px-4 py-1">
              <WhatsNewLink latestVersion={latestVisibleVersion} className="-mx-2.5 text-ink" />
              <span className="text-sm text-ink-2">
                גרסה <span className="num">{latestRelease.version}</span>
              </span>
            </Tape>
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

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`s-${title}`}>
      <h2 id={`s-${title}`} className="mb-2 text-sm font-semibold text-on-ground-2">
        {title}
      </h2>
      {children}
      {note && <p className="mt-2 text-sm leading-relaxed text-on-ground-2">{note}</p>}
    </section>
  );
}
