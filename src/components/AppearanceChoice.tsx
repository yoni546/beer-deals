"use client";

import { useOptimistic, useTransition } from "react";
import { setAppearance } from "@/lib/actions/appearance";
import { APPEARANCES, APPEARANCE_LABEL_HE, type Appearance } from "@/lib/appearance";
import { CheckIcon } from "@/components/ui/icons";

/**
 * Light, dark, or whatever the phone says.
 *
 * Three radios in the pattern the submit form already uses (SubmitDealForm's "איזה מארז?"):
 * a real <input type="radio"> hidden behind its label, so it is one tab stop, the arrow keys
 * move between the options, and a screen reader announces a group with one chosen. A row of
 * <button>s would have looked the same and said none of that.
 *
 * The answer is a cookie read on the server, so the page that comes back is already in the
 * new mode -- there is nothing to change in the DOM here. What the optimistic state is for
 * is the tick: without it the chosen option would not move until the server round trip
 * finished, which on a slow connection reads as a tap that did nothing.
 */
export function AppearanceChoice({ current }: { current: Appearance }) {
  const [pending, startTransition] = useTransition();
  const [chosen, choose] = useOptimistic(current);

  return (
    <fieldset disabled={pending}>
      <legend className="sr-only">מראה האפליקציה</legend>
      <div className="flex gap-2">
        {APPEARANCES.map((value) => (
          <label
            key={value}
            className="group flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-paper-line px-2 py-3 text-center text-sm font-semibold text-ink has-checked:border-ink has-checked:bg-ink has-checked:text-paper has-focus-visible:outline-3 has-focus-visible:outline-focus"
          >
            <input
              type="radio"
              name="appearance"
              value={value}
              checked={chosen === value}
              onChange={() =>
                startTransition(async () => {
                  choose(value);
                  await setAppearance(value);
                })
              }
              className="sr-only"
            />
            <span aria-hidden className="hidden group-has-checked:inline">
              <CheckIcon size={16} />
            </span>
            {APPEARANCE_LABEL_HE[value]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
