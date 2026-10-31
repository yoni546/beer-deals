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
 *
 * IT SAYS IT IS A SCORE, and a tap says against what (0.41.0). The chip sits next
 * to the chain's own "−25%", and the weak band used to read "לא באמת מבצע": a
 * shopper saw a quarter off and a verdict that it was no deal, with nothing to say
 * the two measure different things. The percentage is against this chain's shelf
 * price; the score is mostly against the OTHER chains and the last half year. So
 * the number is labelled "ציון", the weak word no longer contradicts the
 * percentage ("לא מיוחד": a real discount, at an ordinary price), and the chip
 * opens one line saying what it compares. Native <details>, no script.
 */

const BAND: Record<ScoreBand, { label: string; className: string }> = {
  amazing: { label: "מטורף", className: "bg-deal text-on-deal" },
  very_good: { label: "משתלם מאוד", className: "text-ink ring-1 ring-deal" },
  fair: { label: "סביר", className: "text-ink-2 ring-1 ring-paper-line" },
  weak: { label: "לא מיוחד", className: "text-ink ring-1 ring-danger" },
};

export function DealScoreChip({ score, className = "" }: { score: Score | null | undefined; className?: string }) {
  if (!score) return null;
  const band = BAND[score.band];
  return (
    <details className={`group/score relative z-10 open:basis-full ${className}`} data-deal-score>
      <summary
        className={`inline-flex min-h-7 cursor-pointer list-none items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold [&::-webkit-details-marker]:hidden ${band.className}`}
      >
        <span className="sr-only">ציון מבצע {score.score} מתוך 100,</span>
        <span aria-hidden className="opacity-80">
          ציון <span className="num">{score.score}</span>
        </span>
        <span>{band.label}</span>
      </summary>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{EXPLAINED}</p>
    </details>
  );
}

/** What the score compares, said where it is opened. */
const EXPLAINED =
  "ציון 0–100: כמה המחיר טוב בהשוואה לרשתות האחרות ולמחירים של חצי השנה האחרונה. אחוז ההנחה משווה רק למחיר המדף של אותה רשת.";

/** The band on its own, for places with no room for the number. */
export function dealScoreLabel(score: Score | null | undefined): string | null {
  return score ? BAND[score.band].label : null;
}
