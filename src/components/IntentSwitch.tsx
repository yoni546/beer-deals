import Link from "next/link";
import { EmptyState, ButtonLink } from "@/components/Chrome";
import { Segmented } from "@/components/ui/Chip";
import type { Distances } from "@/lib/distance";
import type { SearchIntent } from "@/lib/offer-logic";

/**
 * "Closest to me" or "Best deal" — for THIS search.
 *
 * The brief is explicit that this is not a personality: the same person wants the
 * nearest shop when they need beer tonight and the best price when they are willing
 * to drive on Friday. So it lives in the URL beside the sort and the pack filter, is
 * never written to the profile, and a shared link reproduces what the sender saw.
 */
export function IntentSwitch({ intent, hrefFor }: { intent: SearchIntent; hrefFor: (next: SearchIntent) => string }) {
  return (
    <Segmented
      label="מה מחפשים עכשיו"
      items={[
        { href: hrefFor("best"), label: "הכי משתלם", selected: intent === "best" },
        { href: hrefFor("near"), label: "הכי קרוב אליי", selected: intent === "near" },
      ]}
    />
  );
}

/**
 * Why "closest to me" has nothing to show.
 *
 * There are two different reasons and they need two different answers, because one is
 * something the person can fix in ten seconds and the other is not their doing at all.
 * Neither may be dressed up as "no deals found".
 */
export function CannotMeasure({ distances, unplaceable }: { distances: Distances; unplaceable: number }) {
  if (distances.available) {
    if (unplaceable === 0) return null;
    // Some were placed and some were not: a quiet footnote, not an alarm.
    return (
      <p className="mt-3 text-sm text-on-ground-2">
        עוד <span className="num">{unplaceable}</span> מבצעים לא מוצגים כאן, כי אנחנו עדיין לא יודעים איפה הסניפים שלהם.
      </p>
    );
  }

  if (distances.reason === "no_home") {
    return (
      <EmptyState
        title="לא סיפרתם לנו איפה אתם"
        action={<ButtonLink href="/settings">להגדרת היישוב</ButtonLink>}
      >
        כדי לסדר מבצעים לפי מרחק אנחנו צריכים לדעת מאיפה למדוד. רק היישוב — לא צריך כתובת.
      </EmptyState>
    );
  }

  return (
    <EmptyState title="עוד אין לנו את המיקומים של הסניפים">
      אנחנו יודעים איפה אתם, אבל עוד לא איפה הסניפים — אז אנחנו לא יכולים להגיד מה קרוב, ולא נמציא.{" "}
      <Link href="/?intent=best" className="underline underline-offset-4">
        בינתיים אפשר לראות את המבצעים הכי משתלמים
      </Link>
      .
    </EmptyState>
  );
}
