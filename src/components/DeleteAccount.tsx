"use client";

import { useState, useTransition } from "react";
import { Tape } from "@/components/ui/Tape";
import { deleteMyAccount } from "@/lib/actions/profile";

/**
 * "Delete my account" (0070). Two taps, the second one saying exactly what goes, because it cannot be
 * undone: there is no password to sign back in with, so a deleted anonymous account is gone for good.
 */
export function DeleteAccount() {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="btn btn-ghost w-full">
        מחיקת החשבון שלי
      </button>
    );
  }

  return (
    <Tape as="div" role="alertdialog" aria-labelledby="delete-title" aria-describedby="delete-what" className="space-y-3 px-4 py-4">
      <p id="delete-title" className="text-base font-bold text-ink">
        למחוק את החשבון?
      </p>
      <p id="delete-what" className="text-sm leading-relaxed text-ink-2">
        יימחקו השם, המקום, הבירות שבחרתם, הבירות שאתם עוקבים אחריהן, ההתראות והדיווחים שלכם. אי אפשר לשחזר את זה. מבצעים ששלחתם יישארו
        באפליקציה, בלי שום קשר אליכם.
      </p>
      {error && (
        <p role="alert" className="text-sm font-semibold text-ink">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await deleteMyAccount();
              if (!result.ok) setError(result.error);
            })
          }
          className="btn btn-danger"
        >
          {pending ? "מוחקים…" : "כן, למחוק הכול"}
        </button>
        <button type="button" disabled={pending} onClick={() => setAsking(false)} className="btn btn-quiet">
          ביטול
        </button>
      </div>
    </Tape>
  );
}
