import Link from "next/link";
import { Tape, TapeHeading } from "@/components/ui/Tape";
import type { Standing } from "@/lib/contributors";

/**
 * The people who find the deals.
 *
 * Words and tokens, never an emoji (CLAUDE.md; tests/no-emoji.test.ts). The rank is
 * a number on the counter, not a medal, and the score is explained in one line
 * rather than left as a mystery figure — a leaderboard nobody understands is just
 * a ranking of strangers.
 *
 * Empty renders NOTHING. An empty frame saying "no deal hunters yet" would be a
 * worse thing to put on a screen than nothing at all.
 */

export function TopHunter({ standing }: { standing: Standing | null }) {
  if (!standing) return null;
  return (
    <Tape className="px-5 py-4">
      <p className="text-sm font-semibold text-ink-2">צייד המבצעים של השבוע</p>
      <p className="mt-1 text-xl font-bold text-ink">{standing.display_name}</p>
      <p className="mt-0.5 text-sm text-ink-2">
        <span className="num">{standing.approved}</span>{" "}
        {standing.approved === 1 ? "מבצע שאושר" : "מבצעים שאושרו"}
        {standing.weekly > 0 && (
          <>
            {" · "}
            <span className="num">{standing.weekly}</span> הגיעו למבצע השבוע
          </>
        )}
      </p>
      <Link
        href="/hunters"
        prefetch={false}
        className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-ink underline underline-offset-4"
      >
        כל הציידים
      </Link>
    </Tape>
  );
}

export function HuntersTable({ standings }: { standings: Standing[] }) {
  if (standings.length === 0) return null;
  return (
    <Tape className="pb-1">
      <TapeHeading>הניקוד</TapeHeading>
      <ol className="divide-y divide-paper-line">
        {standings.map((row, index) => (
          <li key={row.display_name + index} className="flex items-baseline gap-3 px-4 py-3">
            <span aria-hidden className="num w-5 shrink-0 text-sm font-bold text-ink-2">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-base font-bold text-ink">
              <span className="sr-only">מקום {index + 1}: </span>
              {row.display_name}
            </span>
            <span className="shrink-0 text-sm text-ink-2">
              <span className="num">{row.approved}</span> מבצעים
            </span>
            <span className="num shrink-0 text-base font-bold text-price">{row.score}</span>
          </li>
        ))}
      </ol>
    </Tape>
  );
}
