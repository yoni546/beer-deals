import { cookies } from "next/headers";
import { ButtonLink, EmptyState, Screen, TopBar } from "@/components/Chrome";
import { CouldNotLoad } from "@/components/CouldNotLoad";
import { Strip } from "@/components/BeerStrip";
import { MeLink } from "@/components/ui/MeLink";
import { attempt } from "@/lib/attempt";
import { getOffersByKeys } from "@/lib/offers";
import { SAVED_COOKIE, parseSaved } from "@/lib/saved";

export const dynamic = "force-dynamic";

/**
 * The deals this person saved (0.41.0), as they stand NOW: every line is read from the
 * live feed by its key, so a price shown here is today's. A saved deal that ended or
 * changed price is no longer in the feed, and is counted rather than shown — an old
 * price on a shelf that no longer has it is the one failure this app does not allow.
 */
export default async function SavedPage() {
  const keys = parseSaved((await cookies()).get(SAVED_COOKIE)?.value);
  // Newest save first.
  const result = await attempt("saved", () => getOffersByKeys([...keys].reverse()));
  const gone = result.ok ? keys.length - result.value.length : 0;

  return (
    <Screen>
      <TopBar title="המבצעים ששמרתי" sub="המחירים כאן מתעדכנים, כמו בכל האפליקציה" action={<MeLink />} />

      {!result.ok ? (
        <CouldNotLoad what="את המבצעים ששמרתם" />
      ) : result.value.length === 0 ? (
        <EmptyState
          title={gone > 0 ? "המבצעים ששמרתם הסתיימו" : "עוד לא שמרתם מבצעים"}
          action={
            <ButtonLink href="/" variant="quiet">
              לכל המבצעים
            </ButtonLink>
          }
        >
          {gone > 0
            ? "כשמבצע נגמר או שהמחיר שלו משתנה, הוא יורד מהרשימה."
            : "בכל מבצע יש כפתור ״שמירה״. מה ששומרים מופיע כאן."}
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <Strip title="שמורים" offers={result.value} lead="beer" />
          {gone > 0 && (
            <p className="text-sm text-on-ground-2">
              {gone === 1
                ? "מבצע אחד ששמרתם הסתיים או שהמחיר שלו השתנה, ולכן הוא לא מופיע."
                : `${gone} מבצעים ששמרתם הסתיימו או שהמחיר שלהם השתנה, ולכן הם לא מופיעים.`}
            </p>
          )}
        </div>
      )}
    </Screen>
  );
}
