"use client";

import { useState, useTransition } from "react";
import { reportOffer } from "@/lib/actions/deals";

/**
 * "Still there" or "Gone" — on any offer, chain feed included.
 *
 * Until migration 0031 only a user-submitted deal could be reported at all: the
 * button rendered for `origin === "legacy"` alone and the table had a foreign key
 * to `deals`. The chain feed is the bulk of what anybody sees, so a person standing
 * in front of an empty shelf had nowhere to say so.
 *
 * BOTH DIRECTIONS, deliberately. The people most likely to tap are the ones who
 * just had a wasted journey, so an app that only collects complaints collects a
 * biased picture. Being able to confirm is what lets somebody answer a report
 * instead of only an admin being able to.
 *
 * The wording is careful on purpose: pressing this does not remove anything, and
 * the confirmation says so. Somebody who thinks they have just deleted a deal will
 * hesitate before pressing it again.
 */
export function OfferFeedback({ offerKey, seenPriceAgorot }: { offerKey: string; seenPriceAgorot?: number }) {
  const [said, setSaid] = useState<"ended" | "still_there" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function say(verdict: "ended" | "still_there") {
    setFailed(null);
    startTransition(async () => {
      const result = await reportOffer(offerKey, verdict, seenPriceAgorot);
      if (result.ok) setSaid(verdict);
      // The database's own words when it has better ones than "try again" -- a rate
      // limit (0033) says when to come back, and "לא הצלחנו לשלוח" would hide that.
      else setFailed(result.error);
    });
  }

  if (said) {
    return (
      <p className="text-sm text-ink-2">
        {said === "ended"
          ? "תודה. לא הסרנו כלום — נבדוק מול דיווחים נוספים."
          : "תודה, רשמנו שראיתם אותו."}{" "}
        <button type="button" onClick={() => setSaid(null)} className="underline underline-offset-4">
          שינוי
        </button>
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => say("still_there")}
          className="inline-flex min-h-11 items-center rounded-full border border-paper-line px-4 text-sm font-semibold text-ink disabled:opacity-50"
        >
          המבצע עדיין קיים
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => say("ended")}
          className="inline-flex min-h-11 items-center rounded-full border border-paper-line px-4 text-sm font-semibold text-ink disabled:opacity-50"
        >
          המבצע נגמר
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-sm text-ink">
          {failed}
        </p>
      )}
    </div>
  );
}
