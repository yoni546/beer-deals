"use client";

import { useActionState, useState } from "react";
import { Notice } from "@/components/Chrome";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, PlusIcon } from "@/components/ui/icons";
import { Tape } from "@/components/ui/Tape";
import { savePreferences } from "@/lib/actions/profile";
import { IDLE } from "@/lib/actions/result";
import type { Beer } from "@/lib/db/types";

/**
 * Settings → the name and the four beers, in order.
 *
 * Reordering is up/down buttons, not drag-and-drop: a drag competes with scrolling on a
 * phone and cannot be done at all with a screen reader, while two 44px buttons per row can
 * be used by anyone. Swapping a beer out is remove-then-add; the new one lands last and
 * can be moved up.
 *
 * Nothing is saved until "שמירה". The button is enabled only for exactly four beers and a
 * change, and Postgres checks the same rules again (save_preferences).
 */
export function FavouritesEditor({
  beers,
  currentName,
  currentFavourites,
}: {
  beers: Beer[];
  currentName: string;
  currentFavourites: Beer[];
}) {
  const [name, setName] = useState(currentName);
  const [picked, setPicked] = useState<Beer[]>(currentFavourites);
  const [state, submit, pending] = useActionState(savePreferences, IDLE);

  const sameAsSaved =
    name.trim() === currentName.trim() &&
    picked.length === currentFavourites.length &&
    picked.every((beer, index) => beer.id === currentFavourites[index]?.id);
  const remaining = beers.filter((beer) => !picked.some((chosen) => chosen.id === beer.id));

  const move = (from: number, to: number) =>
    setPicked((current) => {
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  const remove = (id: string) => setPicked((current) => current.filter((beer) => beer.id !== id));
  const add = (beer: Beer) => setPicked((current) => (current.length >= 4 ? current : [...current, beer]));

  return (
    <form action={submit} className="space-y-6">
      <Tape className="px-4 py-4">
        <label htmlFor="name" className="mb-1.5 block text-base font-bold text-ink">
          השם שלכם
        </label>
        <input id="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} autoComplete="given-name" className="field" />
      </Tape>

      <Tape className="pb-2">
        <div className="px-4 pt-4 pb-1">
          <h3 className="text-base font-bold text-ink">ארבע הבירות שלכם, לפי הסדר</h3>
          <p className="mt-0.5 text-sm text-ink-2">הראשונה קובעת את המראה של האפליקציה ואת ההתראות.</p>
        </div>

        <ol className="divide-y divide-dotted divide-paper-line">
          {picked.map((beer, index) => (
            <li key={beer.id} className="flex items-center gap-1 ps-4 pe-1">
              <span
                aria-hidden
                className={`me-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  index === 0 ? "bg-deal text-on-deal" : "border border-paper-line text-ink"
                }`}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate py-3 text-base font-semibold text-ink">
                <span className="sr-only">מקום {index + 1}: </span>
                {beer.name_he}
              </span>
              <IconButton label={`העלו את ${beer.name_he} מקום אחד`} disabled={index === 0} onClick={() => move(index, index - 1)}>
                <ArrowUpIcon size={20} />
              </IconButton>
              <IconButton label={`הורידו את ${beer.name_he} מקום אחד`} disabled={index === picked.length - 1} onClick={() => move(index, index + 1)}>
                <ArrowDownIcon size={20} />
              </IconButton>
              <IconButton label={`הסירו את ${beer.name_he}`} onClick={() => remove(beer.id)}>
                <CloseIcon size={20} />
              </IconButton>
            </li>
          ))}
        </ol>

        {picked.length < 4 && (
          <div className="tear mx-0 px-4 pt-3 pb-2">
            <p className="mb-2 text-sm font-semibold text-ink">
              {picked.length === 3 ? "עוד בירה אחת" : `עוד ${4 - picked.length} בירות`}. לחצו כדי להוסיף:
            </p>
            <ul className="flex flex-wrap gap-2">
              {remaining.map((beer) => (
                <li key={beer.id}>
                  <button
                    type="button"
                    onClick={() => add(beer)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-paper-line px-3.5 text-sm font-semibold text-ink"
                  >
                    <PlusIcon size={16} />
                    {beer.name_he}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Tape>

      <input type="hidden" name="firstName" value={name} />
      <input type="hidden" name="beerIds" value={picked.map((beer) => beer.id).join(",")} />

      {!state.ok && <Notice>{state.error}</Notice>}
      {state.ok && state.message && sameAsSaved && <Notice tone="info">{state.message}</Notice>}

      <button type="submit" disabled={pending || picked.length !== 4 || sameAsSaved} className="btn w-full">
        {pending ? "שומרים…" : "שמירה"}
      </button>
    </form>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink disabled:text-ink-3 disabled:opacity-60"
    >
      {children}
    </button>
  );
}
