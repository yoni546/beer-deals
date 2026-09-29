"use client";

import { useActionState, useRef, useState } from "react";
import { Notice } from "@/components/Chrome";
import { BeerBottle } from "@/components/ui/Bottle";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, GripIcon, PlusIcon } from "@/components/ui/icons";
import { Tape } from "@/components/ui/Tape";
import { savePreferences } from "@/lib/actions/profile";
import { IDLE } from "@/lib/actions/result";
import type { Beer } from "@/lib/db/types";

/**
 * Settings → the name and the four beers, in order.
 *
 * Reordering: drag a row by its grip, or use the up/down buttons. The grip is the only part of
 * the row that captures the pointer (touch-action: none), so dragging never fights scrolling;
 * the buttons do the same job for a keyboard or a screen reader, and every change of rank is
 * announced. Swapping a beer out is remove-then-add; the new one lands last and can be moved up.
 *
 * Rank #1 is marked as what it is: the beer that decides the app's look and the notifications.
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

  const [announcement, setAnnouncement] = useState("");
  const announce = (list: Beer[], beer: Beer) => setAnnouncement(`${beer.name_he} עכשיו במקום ${list.indexOf(beer) + 1}`);

  const moveTo = (from: number, to: number) =>
    setPicked((current) => {
      if (to < 0 || to >= current.length || from === to) return current;
      const next = [...current];
      const [beer] = next.splice(from, 1);
      next.splice(to, 0, beer);
      announce(next, beer);
      return next;
    });
  const move = moveTo;

  // --- drag by the grip ----------------------------------------------------------
  const rows = useRef<Array<HTMLLIElement | null>>([]);
  const drag = useRef<{ id: string; pointerId: number; lastY: number; rowHeight: number } | null>(null);
  const [dragging, setDragging] = useState<{ id: string; offset: number } | null>(null);

  function onGripDown(event: React.PointerEvent, beer: Beer, index: number) {
    const row = rows.current[index];
    if (!row) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { id: beer.id, pointerId: event.pointerId, lastY: event.clientY, rowHeight: row.getBoundingClientRect().height };
    setDragging({ id: beer.id, offset: 0 });
  }

  function onGripMove(event: React.PointerEvent) {
    const d = drag.current;
    if (!d || event.pointerId !== d.pointerId) return;
    let offset = event.clientY - d.lastY;
    const from = picked.findIndex((beer) => beer.id === d.id);
    // Past half a row: the row changes place, and the offset is measured from its new slot.
    const steps = Math.trunc(offset / d.rowHeight + (offset > 0 ? 0.5 : -0.5));
    const to = Math.min(picked.length - 1, Math.max(0, from + steps));
    if (to !== from) {
      moveTo(from, to);
      d.lastY += (to - from) * d.rowHeight;
      offset = event.clientY - d.lastY;
    }
    setDragging({ id: d.id, offset });
  }

  function onGripUp(event: React.PointerEvent) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(null);
  }
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

        <ol className="divide-y divide-dotted divide-ground-line">
          {picked.map((beer, index) => {
            const isDragged = dragging?.id === beer.id;
            return (
            <li
              key={beer.id}
              ref={(el) => {
                rows.current[index] = el;
              }}
              data-rank={index + 1}
              className={`relative flex items-center gap-1 pe-1 ${isDragged ? "z-10 rounded-xl bg-ground shadow-lg ring-2 ring-accent" : ""}`}
              style={isDragged ? { transform: `translateY(${dragging.offset}px)` } : undefined}
            >
              <span
                aria-hidden
                onPointerDown={(event) => onGripDown(event, beer, index)}
                onPointerMove={onGripMove}
                onPointerUp={onGripUp}
                onPointerCancel={onGripUp}
                data-grip={beer.slug}
                className="flex h-16 w-11 shrink-0 cursor-grab touch-none items-center justify-center text-on-ground-2 active:cursor-grabbing"
              >
                <GripIcon size={20} />
              </span>
              <span
                aria-hidden
                className={`num me-1 shrink-0 rounded-full px-1.5 text-xs leading-5 font-bold ${
                  index === 0 ? "bg-deal text-on-deal" : "text-on-ground-2 ring-1 ring-ground-line"
                }`}
              >
                #{index + 1}
              </span>
              <BeerBottle slug={beer.slug} height={52} className="shrink-0" />
              <span className="min-w-0 flex-1 py-2 ps-1">
                <span className="block truncate text-base font-semibold text-on-ground">
                  <span className="sr-only">מקום {index + 1}: </span>
                  {beer.name_he}
                </span>
                {index === 0 && <span className="block text-xs text-on-ground-2">המראה וההתראות</span>}
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
            );
          })}
        </ol>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>

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

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-on-ground disabled:opacity-35"
    >
      {children}
    </button>
  );
}
