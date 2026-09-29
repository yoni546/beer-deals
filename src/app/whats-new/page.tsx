import { notFound } from "next/navigation";
import { Screen, TopBar } from "@/components/Chrome";
import { MarkReleaseSeen } from "@/components/MarkReleaseSeen";
import { ChevronDownIcon } from "@/components/ui/icons";
import { Tape } from "@/components/ui/Tape";
import { visibleReleases, type Release } from "@/lib/releases";
import { getViewer } from "@/lib/session";

export const metadata = { title: "מה חדש" };
export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function ReleaseDate({ date }: { date: string }) {
  return <time dateTime={date}>{dateFormat.format(new Date(`${date}T00:00:00Z`))}</time>;
}

function Bullets({ release }: { release: Release }) {
  return (
    <ul className="space-y-2.5 text-base leading-relaxed text-ink">
      {release.highlights_he.map((line) => (
        <li key={line} className="flex gap-3">
          <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-deal" />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What's New: the latest update in full, earlier ones one tap away. Content from src/content/releases.json.
 *
 * For the people who run the app only (0.8.0): the check is here, on the server, from the admins table
 * (getViewer → RLS-protected read) — hiding the link is a courtesy, this is the rule. Anyone else gets the
 * ordinary "not found" page, so the address does not even say there is something behind it.
 */
export default async function WhatsNewPage() {
  const viewer = await getViewer();
  if (!viewer.isAdmin) notFound();
  const [latest, ...earlier] = visibleReleases;

  return (
    <Screen>
      <TopBar title="מה חדש" />

      {latest ? (
        <>
          <MarkReleaseSeen version={latest.version} />

          <Tape className="px-5 py-6" aria-labelledby="latest-title" printIn>
            <p className="text-sm text-ink-2">
              גרסה <span className="num">{latest.version}</span> · <ReleaseDate date={latest.date} />
            </p>
            <h2 id="latest-title" className="mt-1 text-xl font-bold text-ink">
              {latest.title_he}
            </h2>
            <div aria-hidden className="tear my-4" />
            <Bullets release={latest} />
          </Tape>

          {earlier.length > 0 && (
            <section className="mt-8" aria-labelledby="earlier-title">
              <h2 id="earlier-title" className="mb-2 text-sm font-semibold text-on-ground-2">
                עדכונים קודמים
              </h2>
              <Tape as="div">
                <div className="divide-y divide-dotted divide-paper-line">
                  {earlier.map((release) => (
                    <details key={release.version} className="group">
                      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
                        <span className="text-base font-bold text-ink">{release.title_he}</span>
                        <span className="flex shrink-0 items-center gap-2 text-sm text-ink-2">
                          <span>
                            <span className="num">{release.version}</span> · <ReleaseDate date={release.date} />
                          </span>
                          <span aria-hidden className="transition-transform group-open:rotate-180">
                            <ChevronDownIcon size={18} />
                          </span>
                        </span>
                      </summary>
                      <div className="px-4 pb-4">
                        <Bullets release={release} />
                      </div>
                    </details>
                  ))}
                </div>
              </Tape>
            </section>
          )}
        </>
      ) : (
        <Tape className="px-5 py-8 text-center">
          <p className="text-base font-bold text-ink">עוד אין עדכונים להציג</p>
        </Tape>
      )}
    </Screen>
  );
}
