"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Notice } from "@/components/Chrome";
import { saveDisplayName } from "@/lib/actions/profile";
import { IDLE } from "@/lib/actions/result";

/**
 * The name on a deal you found.
 *
 * Deliberately opt-in and deliberately reversible. Nobody is credited until they ask
 * to be, and emptying the field takes the name back — their deals then say nothing
 * about who found them, which is not the same as saying "anonymous".
 *
 * It is not the name in "אהלן, יוני": that one is private and stays in `profiles`.
 * This one is published on a card anybody can see, which is exactly why it is a
 * separate decision.
 */
export function CreditEditor({ current }: { current: string }) {
  const [name, setName] = useState(current);
  // What is on record. The server prop cannot tell us: this is a client component, so
  // its initial props do not come back changed after the action revalidates — the same
  // thing that hid the save notice in LocationEditor.
  const [saved, setSaved] = useState(current);
  const [state, submit, pending] = useActionState(saveDisplayName, IDLE);

  const latest = useRef(name);
  latest.current = name;

  useEffect(() => {
    if (state.ok && state.message) setSaved(latest.current.trim());
  }, [state]);

  const unchanged = name.trim() === saved.trim();

  return (
    <form action={submit} className="space-y-3">
      <input
        name="displayName"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={24}
        placeholder="למשל: יוני"
        aria-label="השם שיוצג על מבצעים שמצאתם"
        className="field"
      />
      <p className="text-sm text-on-ground-2">
        {saved
          ? `מבצעים שתמצאו יציגו "דווח על ידי ${saved}". מחיקת השם מסירה את הקרדיט.`
          : "בלי שם, מבצעים שתמצאו לא יציגו מי דיווח עליהם."}
      </p>

      {!state.ok && <Notice>{state.error}</Notice>}
      {state.ok && state.message && unchanged && <Notice tone="info">{state.message}</Notice>}

      <button type="submit" disabled={pending || unchanged} className="btn w-full">
        {pending ? "שומרים…" : "שמירה"}
      </button>
    </form>
  );
}
