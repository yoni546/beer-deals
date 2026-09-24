"use client";

import { useActionState, useState } from "react";
import { savePreferences } from "@/lib/actions/profile";
import { IDLE } from "@/lib/actions/result";
import type { Beer } from "@/lib/db/types";

/**
 * Change the name, the four beers, and the order they are in.
 *
 * The same tap-to-rank interaction as onboarding, prefilled. Reordering means
 * clearing and re-picking, which sounds heavy but is four taps, and it keeps
 * one interaction to learn instead of two.
 */
export function PreferencesEditor({
  beers,
  currentName,
  currentFavorites,
}: {
  beers: Beer[];
  currentName: string;
  currentFavorites: Beer[];
}) {
  const [name, setName] = useState(currentName);
  const [picked, setPicked] = useState<Beer[]>(currentFavorites);
  const [state, submit, pending] = useActionState(savePreferences, IDLE);

  function toggle(beer: Beer) {
    setPicked((current) => {
      const at = current.findIndex((b) => b.id === beer.id);
      if (at !== -1) return current.filter((b) => b.id !== beer.id);
      if (current.length >= 4) return current;
      return [...current, beer];
    });
  }

  return (
    <form action={submit} className="space-y-4">
      <div>
        <label htmlFor="name" className="mb-1.5 block text-sm font-bold">
          השם שלכם
        </label>
        <input
          id="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          className="w-full rounded-2xl bg-[color:var(--surface)] px-4 py-3.5 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-[color:var(--accent)]"
        />
      </div>

      <div>
        <p className="mb-1.5 text-sm font-bold">ארבע הבירות שלכם, לפי הסדר</p>
        <p className="mb-2.5 text-xs opacity-60">
          הראשונה קובעת את המראה של האפליקציה ואת ההתראות.
        </p>

        <ol className="mb-3 flex gap-2">
          {[0, 1, 2, 3].map((index) => (
            <li
              key={index}
              className={[
                "flex h-11 flex-1 items-center justify-center rounded-xl px-1 text-xs font-bold",
                picked[index]
                  ? "bg-[color:var(--accent)] text-[color:var(--base)]"
                  : "bg-[color:var(--surface)] opacity-40 ring-1 ring-white/10",
              ].join(" ")}
            >
              <span className="truncate">{picked[index]?.name_he ?? `#${index + 1}`}</span>
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
                  chosen ? "ring-2 ring-[color:var(--accent)]" : "ring-1 ring-white/10 opacity-80",
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
      </div>

      <input type="hidden" name="firstName" value={name} />
      <input type="hidden" name="beerIds" value={picked.map((b) => b.id).join(",")} />

      {!state.ok && <p className="text-sm text-red-300">{state.error}</p>}
      {state.ok && state.message && (
        <p className="text-sm text-[color:var(--accent)]">{state.message}</p>
      )}

      <button
        type="submit"
        disabled={pending || picked.length !== 4 || name.trim().length === 0}
        className="w-full rounded-2xl bg-[color:var(--accent)] px-4 py-3.5 font-bold text-[color:var(--base)] disabled:opacity-40"
      >
        {pending ? "שומרים…" : "שמירה"}
      </button>
    </form>
  );
}
