import type { DealScore as Score, ScoreBand } from "@/lib/db/types";

/**
 * How good this deal is: a word and a number.
 *
 * The word carries the meaning and the colour only supports it — never colour
 * alone (DESIGN.md), and never an emoji (CLAUDE.md; tests/no-emoji.test.ts).
 *
 * Only the four contrast-verified text roles are used. `danger` is a fixed red
 * that the theme generator does not re-derive per mode, which is why the project
 * uses it as a border and never as text on paper; the weak band follows that.
 *
 * An offer with no score renders NOTHING — no placeholder, no zero. A deal with no
 * trusted reference price has no score to show, and showing a zero would be a
 * claim we cannot defend (docs/DEAL-SCORE.md).
 */

const BAND: Record<ScoreBand, { label: string; className: string }> = {
  amazing: { label: "מטורף", className: "bg-deal text-on-deal" },
  very_good: { label: "משתלם מאוד", className: "text-ink ring-1 ring-deal" },
  fair: { label: "סביר", className: "text-ink-2 ring-1 ring-paper-line" },
  weak: { label: "לא באמת מבצע", className: "text-ink ring-1 ring-danger" },
};

export function DealScoreChip({ score, className = "" }: { score: Score | null | undefined; className?: string }) {
  if (!score) return null;
  const band = BAND[score.band];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${band.className} ${className}`}
    >
      <span className="sr-only">ציון מבצע {score.score} מתוך 100,</span>
      <span>{band.label}</span>
      <span aria-hidden className="num opacity-80">
        {score.score}
      </span>
    </span>
  );
}

/** The band on its own, for places with no room for the number. */
export function dealScoreLabel(score: Score | null | undefined): string | null {
  return score ? BAND[score.band].label : null;
}
