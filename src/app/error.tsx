"use client";

import Link from "next/link";
import { Screen } from "@/components/Chrome";
import { Tape } from "@/components/ui/Tape";

/**
 * Something on the server failed. The words matter more than the styling here: say what is
 * true (we could not reach the prices, not that there are none), and what to do next.
 */
export default function ErrorScreen({ reset }: { error: Error; reset: () => void }) {
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
        </Tape>
      </div>
    </Screen>
  );
}
