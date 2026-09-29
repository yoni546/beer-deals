"use client";

import { useActionState, useState } from "react";
import { completeOnboarding } from "@/lib/actions/profile";
import { hardNavigate } from "@/lib/navigation";
import { IDLE } from "@/lib/actions/result";
import { InstallPrompt } from "@/components/InstallPrompt";
import type { Beer } from "@/lib/db/types";

/**
 * First run: name, then four beers in order of preference, then the two
 * optional extras (install, notifications).
 *
 * Ranking by tap order rather than by drag-and-drop. Drag is fiddly on a phone
 * and unreachable with a screen reader; tapping four beers in the order you
 * like them is the same information with none of that cost. The chosen ones
 * carry their number so the ranking is visible rather than remembered.
 *
 * The last step appears only once the save has actually succeeded (a failure
 * stays on the ranking step, next to its error message), and it stays until the
 * user presses the button. It used to advance on click regardless of the result
 * and then get replaced by the home page a second later.
 */
export function Onboarding({ beers }: { beers: Beer[] }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Beer[]>([]);
  const [state, submit, pending] = useActionState(completeOnboarding, IDLE);

  const primary = picked[0] ?? null;
  // A successful save is the only way onto the last step.
  const saved = state.ok && Boolean(state.message);
  const visibleStep = saved ? 3 : step;

  function toggle(beer: Beer) {
    setPicked((current) => {
      const at = current.findIndex((b) => b.id === beer.id);
      // Removing one closes the gap, so the remaining ranks stay 1,2,3 with no
      // hole to explain.
      if (at !== -1) return current.filter((b) => b.id !== beer.id);
      if (current.length >= 4) return current;
      return [...current, beer];
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-8">
      <header>
        <p className="text-4xl">🍺</p>
        <h1 className="mt-2 text-2xl font-black">מבצעי בירה</h1>
        <p className="mt-1 text-sm opacity-65">
          איזו בירה במבצע, בכמה, ואיפה. תוך שניות.
        </p>
      </header>

      {visibleStep === 1 && (
        <section className="space-y-4">
          <label htmlFor="firstName" className="block text-lg font-bold">
            איך קוראים לכם?
          </label>
          <input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="יוני"
            maxLength={40}
            className="w-full rounded-2xl bg-[color:var(--surface)] px-4 py-3.5 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-[color:var(--accent)]"
          />
          <button
            type="button"
            disabled={name.trim().length === 0}
            onClick={() => setStep(2)}
            className="w-full rounded-2xl bg-[color:var(--accent)] px-4 py-3.5 font-bold text-[color:var(--base)] disabled:opacity-40"
          >
            ממשיכים
          </button>
        </section>
      )}

      {visibleStep === 2 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-bold">ארבע הבירות האהובות עליכם</h2>
            <p className="mt-1 text-sm opacity-65">
              לפי הסדר. הראשונה היא הבירה הראשית — היא קובעת את המראה של האפליקציה,
              ורק עליה נשלח התראות.
            </p>
          </div>

          <ol className="flex gap-2">
            {[0, 1, 2, 3].map((index) => (
              <li
                key={index}
                className={[
                  "flex h-11 flex-1 items-center justify-center rounded-xl text-xs font-bold",
                  picked[index]
                    ? "bg-[color:var(--accent)] text-[color:var(--base)]"
                    : "bg-[color:var(--surface)] opacity-40 ring-1 ring-white/10",
                ].join(" ")}
              >
                {picked[index]?.name_he ?? `#${index + 1}`}
              </li>
            ))}
          </ol>

          <div className="grid grid-cols-2 gap-2">
            {beers.map((beer) => {
              const rank = picked.findIndex((b) => b.id === beer.id);
              const chosen = rank !== -1;
              return (
                <button
                  key={beer.id}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => toggle(beer)}
                  className={[
                    "relative flex min-h-14 items-center justify-center rounded-2xl px-3 py-3 text-sm font-bold transition",
                    chosen
                      ? "ring-2 ring-[color:var(--accent)]"
                      : "ring-1 ring-white/10 opacity-80",
                  ].join(" ")}
                  style={{ background: beer.theme_surface, color: beer.theme_ink }}
                >
                  {chosen && (
                    <span
                      className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-black"
                      style={{ background: beer.theme_accent, color: beer.theme_base }}
                    >
                      {rank + 1}
                    </span>
                  )}
                  {beer.name_he}
                </button>
              );
            })}
          </div>

          <form action={submit} className="space-y-2">
            <input type="hidden" name="firstName" value={name} />
            <input type="hidden" name="beerIds" value={picked.map((b) => b.id).join(",")} />
            {!state.ok && <p className="text-sm text-red-300">{state.error}</p>}
            <button
              type="submit"
              disabled={picked.length !== 4 || pending}
              className="w-full rounded-2xl bg-[color:var(--accent)] px-4 py-3.5 font-bold text-[color:var(--base)] disabled:opacity-40"
            >
              {pending ? "שומרים…" : picked.length === 4 ? "סיימנו" : `בחרו עוד ${4 - picked.length}`}
            </button>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="w-full rounded-2xl px-4 py-2 text-sm opacity-60"
            >
              חזרה
            </button>
          </form>
        </section>
      )}

      {visibleStep === 3 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-bold">אהלן {name} 🍺</h2>
            <p className="mt-1 text-sm opacity-65">
              {primary ? `הבירה הראשית שלכם: ${primary.name_he}.` : ""} שני דברים אחרונים,
              שניהם רשות.
            </p>
          </div>

          <InstallPrompt />

          <p className="text-xs opacity-55">
            את ההתראות אפשר להפעיל מההגדרות בכל רגע — נשלח רק על מבצע חזק במיוחד,
            ורק על הבירה הראשית.
          </p>

          <button
            type="button"
            // A real page load, not a client navigation: the root layout (which
            // carries the theme) is not re-rendered by one, so the new Primary
            // Beer's colours would otherwise wait for a manual refresh.
            onClick={() => hardNavigate("/")}
            className="w-full rounded-2xl bg-[color:var(--accent)] px-4 py-3.5 font-bold text-[color:var(--base)]"
          >
            קדימה, למבצעים
          </button>
        </section>
      )}
    </main>
  );
}
