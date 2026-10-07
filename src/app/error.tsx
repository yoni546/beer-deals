"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Screen } from "@/components/Chrome";
import { Tape } from "@/components/ui/Tape";

/**
 * Something on the server failed. The words matter more than the styling here: say what is
 * true (we could not reach the prices, not that there are none), and what to do next.
 *
 * This boundary used to discard the error entirely, which is why the recurring failures in
 * production were never diagnosed: nothing anywhere recorded that a screen had died, let
 * alone which read killed it. `digest` is the id the server assigned to the throw, and it is
 * the only thing that ties this screen to the server log line.
 *
 * Reaching here at all is now a bug in its own right: a read that is allowed to fail should
 * be wrapped in `attempt()` and degrade to <CouldNotLoad> inside its own section.
 */
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(
      `[beer-deals] error screen rendered digest=${JSON.stringify(error.digest ?? "")} message=${JSON.stringify(error.message)}`,
    );
  }, [error]);

  return (
    <Screen>
      <div className="pt-10">
        <Tape className="px-5 py-8 text-center" role="alert">
          <h1 className="text-xl font-bold text-ink">משהו השתבש</h1>
          <div aria-hidden className="mx-auto my-3 w-16 border-t-2 border-dotted border-paper-line" />
          <p className="text-sm leading-relaxed text-ink-2">
            לא הצלחנו להגיע למחירים. הם לא נעלמו. נסו שוב, ואם זה חוזר, כנראה שהשרת לא זמין כרגע.
          </p>
          <div className="mt-5 flex flex-col items-center gap-2">
            <button type="button" onClick={reset} className="btn w-full">
              ניסיון נוסף
            </button>
            <Link href="/" className="btn btn-quiet w-full">
              חזרה לדף הבית
            </Link>
          </div>
          {error.digest && (
            <p dir="ltr" className="num mt-5 text-xs text-ink-2">
              {error.digest}
            </p>
          )}
        </Tape>
      </div>
    </Screen>
  );
}
