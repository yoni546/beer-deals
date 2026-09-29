import { Screen, TopBar } from "@/components/Chrome";
import { MarkReleaseSeen } from "@/components/MarkReleaseSeen";
import { visibleReleases, type Release } from "@/lib/releases";

export const metadata = { title: "מה חדש" };

const dateFormat = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function ReleaseDate({ date }: { date: string }) {
  return <time dateTime={date}>{dateFormat.format(new Date(`${date}T00:00:00Z`))}</time>;
}

function Bullets({ release }: { release: Release }) {
  return (
    <ul className="space-y-2 text-sm leading-relaxed">
      {release.highlights_he.map((line) => (
        <li key={line} className="flex gap-2">
          <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--accent)]" />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What's New: the latest update in full, earlier ones one tap away.
 * Static content from src/content/releases.json — no database, no login.
 */
export default function WhatsNewPage() {
  const [latest, ...earlier] = visibleReleases;

  return (
    <Screen>
      <TopBar title="מה חדש" />

      {latest ? (
        <>
          <MarkReleaseSeen version={latest.version} />

          <section aria-labelledby="latest-title" className="rounded-2xl bg-[color:var(--surface)] p-5 ring-1 ring-white/10">
            <p className="text-xs opacity-60">
              גרסה <span className="num">{latest.version}</span> · <ReleaseDate date={latest.date} />
            </p>
            <h2 id="latest-title" className="mt-1 mb-4 text-lg font-black">
              {latest.title_he}
            </h2>
            <Bullets release={latest} />
          </section>

          {earlier.length > 0 && (
            <section className="mt-8" aria-labelledby="earlier-title">
              <h2 id="earlier-title" className="mb-3 text-sm font-black opacity-70">
                עדכונים קודמים
              </h2>
              <div className="space-y-2">
                {earlier.map((release) => (
                  <details key={release.version} className="rounded-2xl bg-[color:var(--surface)] ring-1 ring-white/10">
                    <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-bold">
                      <span>{release.title_he}</span>
                      <span className="shrink-0 text-xs font-normal opacity-60">
                        <span className="num">{release.version}</span> · <ReleaseDate date={release.date} />
                      </span>
                    </summary>
                    <div className="px-4 pb-4">
                      <Bullets release={release} />
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <p className="rounded-2xl bg-[color:var(--surface)]/60 px-4 py-8 text-center text-sm opacity-55">
          עוד אין עדכונים להציג.
        </p>
      )}
    </Screen>
  );
}
