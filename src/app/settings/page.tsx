import Link from "next/link";
import { redirect } from "next/navigation";
import { Screen, TopBar } from "@/components/Chrome";
import { PreferencesEditor } from "@/components/PreferencesEditor";
import { PushToggle } from "@/components/PushToggle";
import { InstallPrompt } from "@/components/InstallPrompt";
import { getBeers } from "@/lib/queries";
import { getViewer } from "@/lib/session";
import { publicEnv } from "@/lib/env";
import { latestRelease, latestVisibleVersion } from "@/lib/releases";
import { WhatsNewLink } from "@/components/WhatsNewLink";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [viewer, beers] = await Promise.all([getViewer(), getBeers()]);
  if (!viewer.isOnboarded) redirect("/welcome");

  return (
    <Screen>
      <TopBar title="הגדרות" />

      <section className="mb-8 space-y-3">
        <h2 className="text-sm font-black opacity-70">התראות</h2>
        <PushToggle
          vapidPublicKey={publicEnv.vapidPublicKey}
          enabled={viewer.profile?.notifications_enabled ?? false}
          primaryBeerName={viewer.primaryBeer?.name_he ?? null}
        />
        <p className="text-xs opacity-50">
          שולחים רק על מבצע חזק במיוחד, ורק על הבירה הראשית. לא על שאר הבירות שבחרתם.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-black opacity-70">העדפות</h2>
        <PreferencesEditor
          beers={beers}
          currentName={viewer.profile?.first_name ?? ""}
          currentFavorites={viewer.favorites}
        />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-black opacity-70">האפליקציה</h2>
        <InstallPrompt />
      </section>

      <section className="mb-6 flex items-center justify-between rounded-2xl bg-[color:var(--surface)] px-4 py-1.5 ring-1 ring-white/10">
        <WhatsNewLink latestVersion={latestVisibleVersion} className="-mx-2.5" />
        <span className="text-xs opacity-60">
          גרסה <span className="num">{latestRelease.version}</span>
        </span>
      </section>

      {viewer.isAdmin && (
        <Link
          href="/admin"
          className="block rounded-2xl bg-[color:var(--surface)] px-4 py-3.5 text-center text-sm font-bold ring-1 ring-white/10"
        >
          🛠️ לוח ניהול
        </Link>
      )}

      {!viewer.isAdmin && (
        <Link href="/admin/login" className="block py-4 text-center text-xs opacity-35">
          כניסת מנהלים
        </Link>
      )}
    </Screen>
  );
}
