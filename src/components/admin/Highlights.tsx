import Link from "next/link";
import { AdminSection } from "@/components/admin/AdminUi";
import { Tape } from "@/components/ui/Tape";
import type { Highlights as Data } from "@/lib/admin-queries";

/**
 * What is big right now (migration 0042).
 *
 * Each line names the thing and the number behind it, because a superlative with
 * no figure under it is a claim rather than a measurement.
 *
 * "Active users today" is deliberately absent and the absence is SAID. Nothing in
 * this system records a visit — there is no session table and no page-view log,
 * by design — so the number would have to be something else wearing that label,
 * and four numbers that did not mean what they said is exactly what 0.11.1 was
 * spent fixing.
 */
export function Highlights({ data }: { data: Data }) {
  const rows = [
    data.top_beer && {
      key: "beer",
      label: "הבירה הראשית של הכי הרבה אנשים",
      value: data.top_beer.name,
      detail: `${data.top_beer.people}`,
      unit: "אנשים",
      href: `/beer/${data.top_beer.slug}`,
    },
    data.top_store && {
      key: "store",
      label: "הרשת עם הכי הרבה מבצעים כרגע",
      value: data.top_store.name,
      detail: `${data.top_store.offers}`,
      unit: "מבצעים",
      href: `/store/${data.top_store.slug}`,
    },
    data.top_city && {
      key: "city",
      label: "היישוב עם הכי הרבה אנשים",
      value: data.top_city.city,
      detail: `${data.top_city.people}`,
      unit: "אנשים",
      href: null,
    },
    data.best_score && {
      key: "score",
      label: "הציון הגבוה ביותר כרגע",
      value: `${data.best_score.beer} · ${data.best_score.store}`,
      detail: `${data.best_score.score}`,
      unit: "ניקוד",
      href: null,
    },
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    value: string;
    detail: string;
    unit: string;
    href: string | null;
  }>;

  return (
    <AdminSection title="מה גדול עכשיו">
      <Tape as="div" className="divide-y divide-dotted divide-paper-line">
        {rows.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm text-ink-2">{row.label}</p>
              <p className="truncate text-base font-bold text-ink">
                {row.href ? (
                  <Link href={row.href} className="underline underline-offset-4">
                    {row.value}
                  </Link>
                ) : (
                  row.value
                )}
              </p>
            </div>
            <p className="shrink-0 text-sm text-ink-2">
              <span className="num text-lg font-bold text-ink">{row.detail}</span> {row.unit}
            </p>
          </div>
        ))}

        {data.top_contributors.length > 0 && (
          <div className="px-4 py-3">
            <p className="text-sm text-ink-2">התורמים החזקים</p>
            <ol className="mt-1 space-y-0.5">
              {data.top_contributors.map((person, i) => (
                <li key={person.name} className="text-base text-ink">
                  <span className="num text-ink-2">{i + 1}.</span> {person.name}{" "}
                  <span className="text-sm text-ink-2">
                    · <span className="num">{person.score}</span> ניקוד ·{" "}
                    <span className="num">{person.approved}</span> אושרו
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {!data.activity_measurable && (
          <p className="px-4 py-3 text-sm leading-relaxed text-ink-2">
            אין כאן ״משתמשים פעילים היום״: המערכת לא מתעדת כניסות, במכוון. לספור מי שלח או דיווח ולקרוא
            לזה ״פעילים״ היה מספר אחר שלובש את השם הזה.
          </p>
        )}
      </Tape>
    </AdminSection>
  );
}
