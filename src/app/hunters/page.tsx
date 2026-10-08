import { EmptyState, Screen, TopBar } from "@/components/Chrome";
import { HuntersTable } from "@/components/DealHunters";
import { Gap, Tape } from "@/components/ui/Tape";
import { topContributors } from "@/lib/contributors";

export const dynamic = "force-dynamic";

/**
 * Everyone who has had a deal accepted, in order of what their finds were worth.
 *
 * On its own route rather than on Home: Home is already long, and a leaderboard is
 * something you go and look at rather than something that should be between you and
 * tonight's beer.
 */
export default async function HuntersPage() {
  const standings = await topContributors(25);

  return (
    <Screen>
      <TopBar title="ציידי המבצעים" backHref="/" sub="מי מוצא את המבצעים שכולנו רואים" />

      {standings.length === 0 ? (
        <EmptyState title="עוד אין ציידים">
          ברגע שמישהו ידווח על מבצע והוא יאושר, הוא יופיע כאן. צריך לבחור שם בהגדרות כדי להופיע.
        </EmptyState>
      ) : (
        <HuntersTable standings={standings} />
      )}

      <Gap />

      <Tape className="px-5 py-4">
        <h2 className="text-base font-bold text-ink">איך נספר הניקוד</h2>
        <div aria-hidden className="tear my-3" />
        <ul className="space-y-1.5 text-sm leading-relaxed text-ink-2">
          <li>
            מבצע שאושר — <span className="num">10</span> נקודות.
          </li>
          <li>
            מבצע שהפך למבצע השבוע — עוד <span className="num">25</span>.
          </li>
          <li>
            דיווח שנדחה — <span className="num">5</span> נקודות פחות.
          </li>
        </ul>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          כלומר שני דיווחים טובים שווים יותר ממאה דיווחים שלא. דיווח שעוד לא נבדק לא נספר, והניקוד אף פעם לא
          יורד מתחת לאפס.
        </p>
      </Tape>
    </Screen>
  );
}
