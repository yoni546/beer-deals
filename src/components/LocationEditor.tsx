"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Notice } from "@/components/Chrome";
import { PlacePicker, type Place } from "@/components/PlacePicker";
import { saveLocation } from "@/lib/actions/profile";
import { IDLE } from "@/lib/actions/result";

/**
 * Changing where you live and how far you will go, after onboarding.
 *
 * The same picker the first run uses, so there is one idea of what a place is and
 * one set of distances. Clearing the field and saving removes the location
 * entirely — somebody who no longer wants us measuring distances should not have
 * to invent a town to stop us.
 */
const same = (a: Place, b: Place) => a.city === b.city && a.lat === b.lat && a.radiusKm === b.radiusKm;

export function LocationEditor({ current }: { current: Place }) {
  const [place, setPlace] = useState<Place>(current);
  // What is on record. The server prop cannot tell us: this is a client component, so
  // its initial props do not come back changed after the action revalidates.
  const [saved, setSaved] = useState<Place>(current);
  const [state, submit, pending] = useActionState(saveLocation, IDLE);

  const latest = useRef(place);
  latest.current = place;

  useEffect(() => {
    if (state.ok && state.message) setSaved(latest.current);
  }, [state]);

  const unchanged = same(place, saved);

  return (
    <form action={submit} className="space-y-4">
      <PlacePicker value={place} onChange={setPlace} />

      {!state.ok && <Notice>{state.error}</Notice>}
      {/* Only while nothing has been touched since: a success message above a changed
          form would be telling the person their current edit is saved. */}
      {state.ok && state.message && unchanged && <Notice tone="info">{state.message}</Notice>}

      <button type="submit" disabled={pending || unchanged} className="btn w-full">
        {pending ? "שומרים…" : "שמירה"}
      </button>
    </form>
  );
}
