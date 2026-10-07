"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Notice } from "@/components/Chrome";
import { InstallPrompt } from "@/components/InstallPrompt";
import { OnboardingStage, type Scene } from "@/components/OnboardingStage";
import { PlacePicker, EMPTY_PLACE, type Place } from "@/components/PlacePicker";
import { RankedBeers, moveItem } from "@/components/RankedBeers";
import { BeerMark } from "@/components/ui/Bottle";
import { ChevronRightIcon } from "@/components/ui/icons";
import { Tape } from "@/components/ui/Tape";
import { getThemeForBeer, themeStyleSheet } from "@/design/themes";
import { completeOnboarding } from "@/lib/actions/profile";
import { IDLE } from "@/lib/actions/result";
import type { Beer } from "@/lib/db/types";
import { hardNavigate } from "@/lib/navigation";

const SCENES: Scene[] = ["name", "pick", "rank", "place", "reveal"];

/**
 * First run, in five short steps under one stage (OnboardingStage — the bottles themselves):
 * a name (optional), one to four beers, their order, where they live and how far they will
 * travel, and the moment the app becomes theirs.
 *
 * Choosing and ranking are separate on purpose. Choosing is tapping: quick, reachable with a
 * screen reader, and the order of the taps is a first guess at the ranking. Ranking is the same
 * list Settings uses (RankedBeers: drag by the grip, or the arrows), with the line of bottles above
 * following every move — and a bottle can be carried along the line itself.
 *
 * Whoever is #1 becomes the app straight away — the tallest bottle on the stage, and the page takes
 * its colours. That is the product rule ("favourite #1 is the app") shown instead of explained. The
 * saved profile does the same thing on every later visit, from the server.
 *
 * The motion never holds anyone up: every button works while something is still moving, and the
 * switch in the corner (or the phone's reduced-motion setting) stops all of it.
 *
 * The last step appears only once the save has actually succeeded (a failure stays on the
 * ranking step, next to its error message), and it stays until the person presses the
 * button. It used to advance on click regardless of the result and then get replaced by
 * the home page a second later.
 */
export function Onboarding({ beers }: { beers: Beer[] }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Beer[]>([]);
  const [place, setPlace] = useState<Place>(EMPTY_PLACE);
  const [state, submit, pending] = useActionState(completeOnboarding, IDLE);
  const [motion, setMotion] = useState<"full" | "lite" | "off">("full");
  const [leaving, setLeaving] = useState(false);

  const primary = picked[0] ?? null;
  // A successful save is the only way onto the last step.
  const saved = state.ok && Boolean(state.message);
  const visibleStep = saved ? 5 : step;
  const scene = SCENES[visibleStep - 1];

  // Before anything is saved the server still renders the neutral look, so the preview is local:
  // the stylesheet is swapped here, and the stage shows the bottle.
  useEffect(() => {
    const style = document.getElementById("theme");
    if (style) style.textContent = themeStyleSheet(getThemeForBeer(primary?.slug));
  }, [primary?.slug]);

  // A weak phone keeps the moves that explain something and drops the idle loops.
  useEffect(() => {
    const device = navigator as Navigator & { deviceMemory?: number };
    if ((device.deviceMemory ?? 8) < 4 || (device.hardwareConcurrency ?? 8) < 4) setMotion("lite");
  }, []);

  // A tick in the hand where the phone can give one (Android): the cap, a choice, a change of rank,
  // the glass filling. Part of the motion, so the same switch silences it.
  const buzz = (pattern: number | number[]) => {
    if (motion !== "off" && "vibrate" in navigator) navigator.vibrate(pattern);
  };
  useEffect(() => {
    if (scene !== "reveal" || motion === "off" || !("vibrate" in navigator)) return;
    // The same clock as the pour in onboarding.css: the cap leaves, then the glass is full.
    const cap = setTimeout(() => navigator.vibrate(10), 320);
    const full = setTimeout(() => navigator.vibrate([12, 60, 18]), 3050);
    return () => {
      clearTimeout(cap);
      clearTimeout(full);
    };
  }, [scene, motion]);

  // Tip the phone and #1's bottle turns with it (where the phone reports how it is held without
  // being asked — Android; elsewhere the bottle keeps its own slow turn).
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = root.current;
    if (motion !== "full" || !el) return;
    let frame = 0;
    const onTilt = (event: DeviceOrientationEvent) => {
      if (event.gamma == null) return;
      const degrees = Math.max(-14, Math.min(14, event.gamma * 0.6));
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.dataset.gyro = "";
        el.style.setProperty("--gyro", degrees.toFixed(1));
      });
    };
    window.addEventListener("deviceorientation", onTilt);
    return () => {
      window.removeEventListener("deviceorientation", onTilt);
      cancelAnimationFrame(frame);
      delete el.dataset.gyro;
    };
  }, [motion]);

  // With the motion switched off, the bottle does not fly to Home either (see globals.css).
  useEffect(() => {
    if (motion !== "off") return;
    const onSwap = (event: Event) => (event as Event & { viewTransition?: { skipTransition(): void } }).viewTransition?.skipTransition();
    window.addEventListener("pageswap", onSwap);
    return () => window.removeEventListener("pageswap", onSwap);
  }, [motion]);

  // A new step starts at its heading, for a keyboard and a screen reader alike.
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(scene);
  useEffect(() => {
    if (shown.current === scene) return;
    shown.current = scene;
    heading.current?.focus();
  }, [scene]);

  // Back from the app into a page the browser kept in memory: the exit cover must not still be down.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  function toggle(beer: Beer) {
    buzz(8);
    setPicked((current) => {
      const at = current.findIndex((b) => b.id === beer.id);
      // Removing one closes the gap, so the remaining ranks stay 1,2,3 with no hole to explain.
      if (at !== -1) return current.filter((b) => b.id !== beer.id);
      if (current.length >= 4) return current;
      return [...current, beer];
    });
  }

  function move(from: number, to: number) {
    buzz(8);
    setPicked((current) => moveItem(current, from, to));
  }

  const greeting = name.trim() ? `אהלן, ${name.trim()}` : "אהלן";

  return (
    <main
      // Choosing and ranking scroll their own list, so the stage and the button stay where they are.
      className={`ob mx-auto flex w-full max-w-[30rem] flex-col px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] ${scene === "pick" || scene === "rank" ? "h-dvh" : "min-h-dvh"}`}
      data-motion={motion}
      ref={root}
    >
      <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center">
        <div>
          {(scene === "pick" || scene === "rank" || scene === "place") && (
            <button
              type="button"
              aria-label="חזרה"
              onClick={() => setStep(scene === "pick" ? 1 : scene === "rank" ? 2 : 3)}
              className="-ms-2 flex h-11 w-11 items-center justify-center rounded-full text-on-ground"
            >
              <ChevronRightIcon />
            </button>
          )}
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <h1 className="text-sm font-bold text-on-ground">מבצעי בירה</h1>
          <p className="flex gap-1">
            <span className="sr-only">
              שלב {visibleStep} מתוך {SCENES.length}
            </span>
            {SCENES.map((id, index) => (
              <span key={id} aria-hidden className={`h-1 w-5 rounded-full ${index < visibleStep ? "bg-accent" : "bg-ground-line"}`} />
            ))}
          </p>
        </div>
        <button
          type="button"
          aria-pressed={motion === "off"}
          onClick={() => setMotion((current) => (current === "off" ? "full" : "off"))}
          className={`-me-2 flex min-h-11 items-center justify-self-end px-2 text-xs font-semibold ${
            motion === "off" ? "text-on-ground underline underline-offset-4" : "text-on-ground-2"
          }`}
        >
          בלי אנימציה
        </button>
      </header>

      <OnboardingStage scene={scene} picked={picked} onMove={move} />

      {scene === "name" && (
        <form
          className="ob-panel flex flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            buzz(12);
            setStep(2);
          }}
        >
          <h2 ref={heading} tabIndex={-1} className="text-[1.75rem] leading-tight font-bold text-on-ground outline-none">
            <label htmlFor="firstName">איך קוראים לכם?</label>
          </h2>
          <p className="mt-1 mb-4 text-sm text-on-ground-2">רק כדי שנוכל להגיד שלום. אפשר גם בלי.</p>
          <input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            enterKeyHint="next"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="יוני"
            maxLength={40}
            className="field"
          />
          <button type="submit" className="btn mt-4 min-h-13 w-full text-base">
            ממשיכים
          </button>
        </form>
      )}

      {scene === "pick" && (
        <section className="ob-panel flex min-h-0 flex-1 flex-col">
          <h2 ref={heading} tabIndex={-1} className="text-[1.75rem] leading-tight font-bold text-on-ground outline-none">
            הבירות שלכם
          </h2>
          <p className="mt-1 mb-3 text-sm text-on-ground-2">בחרו אחת עד ארבע. את הסדר קובעים מיד אחר כך.</p>

          <ol aria-label="הבירות שבחרתם" className="sr-only">
            {picked.map((beer) => (
              <li key={beer.id}>{beer.name_he}</li>
            ))}
          </ol>

          {/* Full-bleed, so the strips' shadows are not cut off at the sides of the scrolling box. */}
          <ul className="ob-scroll -mx-5 grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto overscroll-contain px-5 pt-1 pb-8">
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

          {/* One beer is enough (0024). Four is the ceiling, not the entry fee. */}
          <button type="button" disabled={picked.length === 0} onClick={() => setStep(3)} className="btn mt-2 min-h-13 w-full shrink-0 text-base">
            {picked.length === 0 ? "בחרו בירה אחת לפחות" : "לדירוג"}
          </button>
        </section>
      )}

      {scene === "rank" && (
        <section className="ob-panel flex min-h-0 flex-1 flex-col">
          <h2 ref={heading} tabIndex={-1} className="text-[1.75rem] leading-tight font-bold text-on-ground outline-none">
            מי במקום הראשון?
          </h2>
          <p className="mt-1 mb-2 text-sm text-on-ground-2">גררו בקבוק או שורה. הראשונה היא האפליקציה שלכם.</p>

          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1">
            <RankedBeers beers={picked} onMove={move} />
          </div>

          <div className="shrink-0 pt-4">
            <button type="button" onClick={() => setStep(4)} className="btn min-h-13 w-full text-base">
              ממשיכים
            </button>
          </div>
        </section>
      )}

      {scene === "place" && (
        <section className="ob-panel flex min-h-0 flex-1 flex-col">
          <h2 ref={heading} tabIndex={-1} className="text-[1.75rem] leading-tight font-bold text-on-ground outline-none">
            איפה לחפש לכם מבצעים?
          </h2>
          <p className="mt-1 mb-3 text-sm text-on-ground-2">
            כדי שנדע איזה סניף קרוב אליכם. אפשר גם לדלג.
          </p>

          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-4">
            <PlacePicker value={place} onChange={setPlace} />
          </div>

          {/* One form, one save: the beers and the place go together. */}
          <form action={submit} className="shrink-0 space-y-2 pt-2">
            <input type="hidden" name="firstName" value={name} />
            <input type="hidden" name="beerIds" value={picked.map((b) => b.id).join(",")} />
            <input type="hidden" name="homeCity" value={place.city} />
            <input type="hidden" name="homeLat" value={place.lat ?? ""} />
            <input type="hidden" name="homeLon" value={place.lon ?? ""} />
            <input type="hidden" name="radiusKm" value={place.radiusKm ?? ""} />
            {!state.ok && <Notice>{state.error}</Notice>}
            <button type="submit" disabled={pending} className="btn min-h-13 w-full text-base">
              {pending ? "שומרים…" : "סיימנו"}
            </button>
          </form>
        </section>
      )}

      {scene === "reveal" && (
        <section className="ob-panel flex flex-1 flex-col">
          {/* The moment the app becomes theirs: their #1 on the stage above, pouring. */}
          <h2 ref={heading} tabIndex={-1} className="text-[1.75rem] leading-tight font-bold text-on-ground outline-none">
            {greeting}
          </h2>
          {primary && <p className="mt-1 text-base text-on-ground">{primary.name_he} היא עכשיו האפליקציה שלכם.</p>}

          <Tape className="mt-4 space-y-3 px-5 py-4">
            <InstallPrompt onPaper />
            <p className="text-sm leading-relaxed text-ink-2">
              התראות נשלח רק על מבצע חזק במיוחד, ורק על הבירה הראשונה. מפעילים אותן בהגדרות, בכל רגע.
            </p>
          </Tape>

          <div className="mt-auto pt-4">
            <button
              type="button"
              // A real page load, not a client navigation: the root layout (which carries the
              // theme) is not re-rendered by one, so the new Primary Beer's colours would
              // otherwise wait for a manual refresh. The counter rises over the screen while it loads.
              onClick={() => {
                setLeaving(true);
                hardNavigate("/");
              }}
              className="btn min-h-13 w-full text-base"
            >
              קדימה, למבצעים
            </button>
          </div>
        </section>
      )}

      {leaving && <div aria-hidden className="ob-flood" />}
    </main>
  );
}
