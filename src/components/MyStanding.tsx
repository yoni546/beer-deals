import type { MyStanding as Standing } from "@/lib/contributors";

/**
 * Where this person stands, and what it actually does (migration 0038).
 *
 * A ladder nobody can see is not an incentive, it is a secret — so it is said here,
 * beside the name it belongs to. And it is said SMALL and exactly: the only thing
 * standing does is make their reports about an empty shelf count for more. Dressing
 * that up as a rank or a badge would promise authority the system deliberately does
 * not grant, and the first person to notice it grants nothing would be right to
 * stop trusting the rest of the screen.
 */

const SAYS: Record<Standing["trust"], { title: string; what: string }> = {
  new: {
    title: "אתם בתחילת הדרך",
    what: "אחרי שכמה מהדיווחים שלכם יאושרו, מה שתגידו על מדף ריק ייחשב יותר.",
  },
  known: {
    title: "יש לכם רקורד",
    what: "מה שאתם אומרים על מדף ריק נחשב כפול ממי שאין לו רקורד.",
  },
  trusted: {
    title: "יש לכם רקורד טוב לאורך זמן",
    what: "מה שאתם אומרים על מדף ריק נחשב פי שלושה — התקרה. גם מי שהכי אמין לא מכריע לבד.",
  },
};

export function MyStanding({ standing }: { standing: Standing }) {
  const says = SAYS[standing.trust];
  return (
    <div className="mt-2">
      <p className="text-sm font-bold text-on-ground">{says.title}</p>
      <p className="mt-0.5 text-sm leading-relaxed text-on-ground-2">
        <span className="num">{standing.approved}</span>{" "}
        {standing.approved === 1 ? "מבצע שלכם אושר" : "מבצעים שלכם אושרו"}
        {standing.weekly > 0 && (
          <>
            {" · "}
            <span className="num">{standing.weekly}</span> נבחרו למבצע השבוע
          </>
        )}
        {" · "}
        <span className="num">{standing.score}</span> נקודות
      </p>
      <p className="mt-0.5 text-sm leading-relaxed text-on-ground-2">{says.what}</p>
    </div>
  );
}
