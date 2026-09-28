import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/session";
import { getLatestDeals, getWeeklyDeal } from "@/lib/queries";
import { DealCard } from "@/components/DealCard";
import { Screen } from "@/components/Chrome";
import { InstallPrompt } from "@/components/InstallPrompt";

export const dynamic = "force-dynamic";

/**
 * Home.
 *
 * The whole screen answers one question — "what am I looking for?" — with two
 * targets big enough to hit without looking. Everything else on the page is
 * below them.
 */
export default async function HomePage() {
  const viewer = await getViewer();
  if (!viewer.isOnboarded) redirect("/welcome");

  // Sequential rather than parallel: the list has to know which deal already
  // has the trophy so it can leave that one out.
  const weekly = await getWeeklyDeal();
  const latest = await getLatestDeals(6, weekly?.id);

  return (
    <Screen>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-black">אהלן {viewer.profile?.first_name} 🍺</h1>
          <p className="mt-1 text-sm opacity-65">איזה מבצע מחפשים היום?</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {viewer.isAdmin && (
            <Link
              href="/admin"
              aria-label="ניהול"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--surface)] ring-1 ring-white/10"
            >
              🛠️
            </Link>
          )}
          <Link
            href="/settings"
            aria-label="הגדרות"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--surface)] ring-1 ring-white/10"
          >
            ⚙️
          </Link>
        </div>
      </header>

      <nav className="grid gap-3">
        <Link
          href="/beer"
          className="flex items-center gap-4 rounded-3xl bg-[color:var(--accent)] px-5 py-6 text-[color:var(--base)]"
        >
          <span aria-hidden className="text-3xl">🍺</span>
          <span className="text-lg font-black">חיפוש לפי בירה</span>
        </Link>
        <Link
          href="/store"
          className="flex items-center gap-4 rounded-3xl bg-[color:var(--surface)] px-5 py-6 ring-1 ring-white/10"
        >
          <span aria-hidden className="text-3xl">🛒</span>
          <span className="text-lg font-black">חיפוש לפי סופר / מכולת</span>
        </Link>
      </nav>

      <Link
        href="/submit"
        className="mt-3 block rounded-2xl px-4 py-3 text-center text-sm font-medium opacity-65 ring-1 ring-white/10"
      >
        + מצאת מבצע? שלח לנו
      </Link>

      {weekly && (
        <section className="mt-8">
          <h2 className="mb-2.5 text-base font-black">🏆 מבצע השבוע</h2>
          <DealCard deal={weekly} highlight />
        </section>
      )}

      {latest.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2.5 text-base font-black">מבצעים עכשיו</h2>
          <div className="space-y-2.5">
            {latest.map((deal) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
        </section>
      )}

      {!weekly && latest.length === 0 && (
        <section className="mt-8 rounded-2xl bg-[color:var(--surface)]/60 px-4 py-8 text-center text-sm opacity-60 ring-1 ring-white/5">
          <p>עדיין אין מבצעים מאושרים.</p>
          <p className="mt-1">
            <Link href="/submit" className="underline">
              ראיתם מבצע? שלחו לנו
            </Link>{" "}
            ונפרסם אותו אחרי בדיקה.
          </p>
        </section>
      )}

      <div className="mt-8">
        <InstallPrompt compact />
      </div>
    </Screen>
  );
}
