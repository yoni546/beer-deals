"use client";

import { useRef, useState } from "react";
import { BeerBottle } from "@/components/ui/Bottle";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, GripIcon } from "@/components/ui/icons";
import type { Beer } from "@/lib/db/types";

/** The same list with one item moved; the same array when there is nothing to move. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * The ranked beers, in order, standing on the counter (no card): each one's bottle, a small rank,
 * its name. Shared by onboarding and Settings, so ranking works the same way in both.
 *
 * Reordering: drag a row by its grip, or use the up/down buttons. The grip is the only part of
 * the row that captures the pointer (touch-action: none), so dragging never fights scrolling;
 * the buttons do the same job for a keyboard or a screen reader, and every change of rank is
 * announced.
 *
 * Rank #1 is marked as what it is: the beer that decides the app's look and the notifications.
 */
export function RankedBeers({
  beers,
  onMove,
  onRemove,
}: {
  beers: Beer[];
  onMove: (from: number, to: number) => void;
  /** Settings can swap a beer out; onboarding goes back a step instead. */
  onRemove?: (id: string) => void;
}) {
  const [announcement, setAnnouncement] = useState("");

  const move = (from: number, to: number) => {
    if (to < 0 || to >= beers.length || from === to) return;
    onMove(from, to);
    setAnnouncement(`${beers[from].name_he} עכשיו במקום ${to + 1}`);
  };

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
    const from = beers.findIndex((beer) => beer.id === d.id);
    // Past half a row: the row changes place, and the offset is measured from its new slot.
    const steps = Math.trunc(offset / d.rowHeight + (offset > 0 ? 0.5 : -0.5));
    const to = Math.min(beers.length - 1, Math.max(0, from + steps));
    if (to !== from) {
      move(from, to);
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

  return (
    <>
      <ol className="divide-y divide-dotted divide-ground-line">
        {beers.map((beer, index) => {
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
              <IconButton label={`הורידו את ${beer.name_he} מקום אחד`} disabled={index === beers.length - 1} onClick={() => move(index, index + 1)}>
                <ArrowDownIcon size={20} />
              </IconButton>
              {onRemove && (
                <IconButton label={`הסירו את ${beer.name_he}`} onClick={() => onRemove(beer.id)}>
                  <CloseIcon size={20} />
                </IconButton>
              )}
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
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
