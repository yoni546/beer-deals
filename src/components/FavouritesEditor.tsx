"use client";

import { useActionState, useState } from "react";
import { Notice } from "@/components/Chrome";
import { RankedBeers, moveItem } from "@/components/RankedBeers";
import { PlusIcon } from "@/components/ui/icons";
import { Tape } from "@/components/ui/Tape";
import { savePreferences } from "@/lib/actions/profile";
import { IDLE } from "@/lib/actions/result";
import type { Beer } from "@/lib/db/types";

/**
 * Settings → the name and the four beers, in order.
 *
 * Reordering is <RankedBeers> (drag by the grip, or the up/down buttons). Swapping a beer out is
 * remove-then-add; the new one lands last and can be moved up.
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

      {/* The four beers stand on the counter (no card): each one's bottle, a small rank, its name. */}
      <div>
        <div className="pb-1">
          <h3 className="text-base font-bold text-on-ground">ארבע הבירות שלכם, לפי הסדר</h3>
          <p className="mt-0.5 text-sm text-on-ground-2">גררו כדי לשנות את הסדר. הראשונה היא האפליקציה שלכם.</p>
        </div>

        <RankedBeers beers={picked} onMove={(from, to) => setPicked((current) => moveItem(current, from, to))} onRemove={remove} />

        {picked.length < 4 && (
          <div className="border-t border-dotted border-ground-line pt-3 pb-2">
            <p className="mb-2 text-sm font-semibold text-on-ground">
              {picked.length === 3 ? "עוד בירה אחת" : `עוד ${4 - picked.length} בירות`}. לחצו כדי להוסיף:
            </p>
            <ul className="flex flex-wrap gap-2">
              {remaining.map((beer) => (
                <li key={beer.id}>
                  <button
                    type="button"
                    onClick={() => add(beer)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-ground-line px-3.5 text-sm font-semibold text-on-ground"
                  >
                    <PlusIcon size={16} />
                    {beer.name_he}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

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
