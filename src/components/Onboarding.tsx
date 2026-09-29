"use client";

import { useActionState, useEffect, useState } from "react";
import { Notice } from "@/components/Chrome";
import { InstallPrompt } from "@/components/InstallPrompt";
import { Tape } from "@/components/ui/Tape";
import { BeerMark, BottleBackdrop } from "@/components/ui/Bottle";
import { getThemeForBeer, themeStyleSheet } from "@/design/themes";
import { completeOnboarding } from "@/lib/actions/profile";
import { IDLE } from "@/lib/actions/result";
import type { Beer } from "@/lib/db/types";
import { hardNavigate } from "@/lib/navigation";

/**
 * First run: a name (optional), then four beers in order of preference, then the two
 * optional extras (install, notifications).
 *
 * Ranking by tap order rather than by drag-and-drop. Drag is fiddly on a phone and
 * unreachable with a screen reader; tapping four beers in the order you like them is the
 * same information with none of that cost. The four slots at the top show the ranking as
 * text, so it is read rather than remembered.
 *
 * The first beer you pick becomes the app straight away — its bottle stands on the counter and
 * the page takes its colours. That is the product rule ("favourite #1 is the app") shown instead
 * of explained. The saved profile does the same thing on every later visit, from the server.
 *
 * The last step appears only once the save has actually succeeded (a failure stays on the
 * ranking step, next to its error message), and it stays until the person presses the
 * button. It used to advance on click regardless of the result and then get replaced by
 * the home page a second later.
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

  // Before anything is saved the server still renders the neutral look, so the preview is local:
  // the stylesheet is swapped here and the bottle is drawn by this component.
  const preview = getThemeForBeer(primary?.slug);
  useEffect(() => {
    const style = document.getElementById("theme");
    if (style) style.textContent = themeStyleSheet(getThemeForBeer(primary?.slug));
  }, [primary?.slug]);

  function toggle(beer: Beer) {
    setPicked((current) => {
      const at = current.findIndex((b) => b.id === beer.id);
      // Removing one closes the gap, so the remaining ranks stay 1,2,3 with no hole to explain.
      if (at !== -1) return current.filter((b) => b.id !== beer.id);
      if (current.length >= 4) return current;
      return [...current, beer];
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[30rem] flex-col px-5 pt-8 pb-6">
      {primary && <BottleBackdrop key={primary.slug} preset={preview} />}
      <header className="mb-6">
        <p className="text-sm font-semibold text-on-ground-2" aria-hidden>
          שלב <span className="num">{visibleStep}</span> מתוך <span className="num">3</span>
        </p>
        <h1 className="mt-1 text-[2rem] leading-tight font-bold text-on-ground">מבצעי בירה</h1>
        <p className="mt-1 text-sm text-on-ground-2">איזו בירה במבצע, בכמה, ואיפה. תוך שניות.</p>
      </header>

      {visibleStep === 1 && (
        <Tape className="px-5 py-6">
          <label htmlFor="firstName" className="block text-lg font-bold text-ink">
            איך קוראים לכם?
          </label>
          <p className="mt-1 mb-4 text-sm text-ink-2">רק כדי שנוכל להגיד שלום. אפשר גם בלי.</p>
          <input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="יוני"
            maxLength={40}
            className="field"
          />
          <button type="button" onClick={() => setStep(2)} className="btn mt-4 w-full">
            ממשיכים
          </button>
        </Tape>
      )}

      {visibleStep === 2 && (
        <section className="flex flex-1 flex-col">
          <div className="mb-4">
            <h2 className="text-xl font-bold text-on-ground">ארבע הבירות האהובות עליכם</h2>
            <p className="mt-1 text-sm leading-relaxed text-on-ground-2">
              לפי הסדר. הראשונה היא הבירה הראשית: הבקבוק והצבעים שלה הופכים לאפליקציה שלכם, ורק עליה נשלח התראות.
            </p>
          </div>

          <ol aria-label="הבירות שבחרתם, לפי הסדר" className="mb-4 grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((index) => (
              <li
                key={index}
                className={`flex h-[4.5rem] flex-col justify-between rounded-xl p-2 ${
                  picked[index] ? "tape tape-flat" : "border-2 border-dashed border-ground-line"
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                    picked[index] ? (index === 0 ? "bg-deal text-on-deal" : "border border-paper-line text-ink") : "text-on-ground-2"
                  }`}
                >
                  {index + 1}
                </span>
                <span className={`line-clamp-2 text-xs leading-tight font-bold ${picked[index] ? "text-ink" : "text-on-ground-2"}`}>
                  {picked[index]?.name_he ?? <span className="sr-only">מקום {index + 1} פנוי</span>}
                </span>
              </li>
            ))}
          </ol>

          <ul className="grid grid-cols-2 gap-2">
            {beers.map((beer) => {
              const rank = picked.findIndex((b) => b.id === beer.id);
              const chosen = rank !== -1;
              return (
                <li key={beer.id}>
                  <button
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => toggle(beer)}
                    className={`tape tape-flat flex min-h-14 w-full items-center gap-2.5 rounded-xl px-3 text-start text-[0.95rem] font-semibold text-ink ${
                      chosen ? "outline-[3px] outline-offset-0 outline-accent [outline-style:solid]" : ""
                    }`}
                  >
                    <BeerMark slug={beer.slug} height={36} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{beer.name_he}</span>
                    {chosen && (
                      <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-deal text-xs font-bold text-on-deal">
                        {rank + 1}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <form
            action={submit}
            className="sticky bottom-0 -mx-5 mt-5 space-y-2 border-t border-ground-line bg-ground px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          >
            <input type="hidden" name="firstName" value={name} />
            <input type="hidden" name="beerIds" value={picked.map((b) => b.id).join(",")} />
            {!state.ok && <Notice>{state.error}</Notice>}
            <button type="submit" disabled={picked.length !== 4 || pending} className="btn w-full">
              {pending ? "שומרים…" : picked.length === 4 ? "סיימנו" : `בחרו עוד ${4 - picked.length}`}
            </button>
            <button type="button" onClick={() => setStep(1)} className="btn btn-ghost w-full">
              חזרה
            </button>
          </form>
        </section>
      )}

      {visibleStep === 3 && (
        <section className="space-y-5">
          {/* The moment the app becomes theirs: their #1's bottle, seen, not covered. */}
          {primary && (
            <div className="stage-window flex items-end justify-center">
              <span className="stage-caption inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold">
                <span className="text-on-ground-2">הבירה שלכם</span>
                <span className="text-on-ground">{primary.name_he}</span>
              </span>
            </div>
          )}
          <Tape className="px-5 py-6">
            <h2 className="text-xl font-bold text-ink">{name.trim() ? `אהלן, ${name.trim()}` : "אהלן"}</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              {primary ? `${primary.name_he} קובעת עכשיו את המראה של האפליקציה ואת ההתראות.` : ""} עוד שני דברים, שניהם רשות.
            </p>
            <div aria-hidden className="tear my-4" />
            <InstallPrompt onPaper />
            <p className="mt-3 text-sm leading-relaxed text-ink-2">
              את ההתראות אפשר להפעיל מההגדרות בכל רגע. נשלח רק על מבצע חזק במיוחד, ורק על הבירה הראשית.
            </p>
          </Tape>

          <button
            type="button"
            // A real page load, not a client navigation: the root layout (which carries the
            // theme) is not re-rendered by one, so the new Primary Beer's colours would
            // otherwise wait for a manual refresh.
            onClick={() => hardNavigate("/")}
            className="btn w-full"
          >
            קדימה, למבצעים
          </button>
        </section>
      )}
    </main>
  );
}
